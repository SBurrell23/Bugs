/**
 * chain.js - resolves one tick of the production chain.
 *
 * This is the single most important file in the game and it is deliberately
 * pure: no DOM, no globals, no randomness. The live game and tools/simulate.js
 * both call it, so a balance run in the terminal is playing exactly the game
 * the player plays.
 *
 * Buildings are crewed, not switched on: ctx.staff[id] is the share of the crew
 * a building actually has, and a building with half its crew does half the work.
 *
 * How a tick resolves
 * -------------------
 * Buildings sit in stages that form a DAG (raw harvesters, converters, the
 * pollen branch, wax, then the brood). We walk the stages in order:
 *
 *   1. Work out what every building WANTS to consume, at full tilt.
 *   2. For each resource, total that demand once.
 *   3. Walking stage by stage, a resource's supply is whatever upstream stages
 *      have produced this tick plus a slice of what is sitting in the silo.
 *      Satisfaction is supply / demand, capped at 1.
 *   4. A building runs at the WORST satisfaction among its inputs, so one
 *      starved ingredient throttles the whole building. It then consumes and
 *      produces at that fraction.
 *
 * Because demand is totalled per resource, two buildings competing for the same
 * honeydew both run at the same fraction rather than one starving the other.
 * That is the behaviour a player can reason about.
 *
 * The silo slice matters: a full silo should be able to cover a shortfall, but
 * not be drained to nothing in a single 50ms tick. BUFFER_DRAIN spreads a
 * silo's contribution over that many seconds, which keeps efficiency readouts
 * steady instead of flickering.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BUGS_CHAIN = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUFFER_DRAIN = 1.5;

  /**
   * @param D    the built data module
   * @param ctx  {
   *   owned:   { buildingId: count }
   *   staff:   { buildingId: 0..1 }  share of the crew this building needs
   *   stocks:  { resourceId: amount }
   *   caps:    { resourceId: amount }
   *   actM:    { buildingId: multiplier }  scales inputs AND outputs (running harder)
   *   yieldM:  { buildingId: multiplier }  scales outputs only (getting more per input)
   *   thriftM: { buildingId: multiplier }  scales inputs only, <= 1 (needing less)
   *   broodYield: bugs per second per Brood Chamber
   * }
   * @param dt   seconds elapsed
   */
  function resolve(D, ctx, dt) {
    const eff = {};
    const demand = {};      // desired input rate per resource
    const produced = {};    // actual output rate per resource
    const consumed = {};    // actual input rate per resource
    const satisfaction = {};
    const overflow = {};
    const stocks = {};

    D.RESOURCES.forEach(function (r) {
      demand[r.id] = 0;
      produced[r.id] = 0;
      consumed[r.id] = 0;
      satisfaction[r.id] = 1;
      overflow[r.id] = 0;
      stocks[r.id] = ctx.stocks[r.id] || 0;
    });

    // --- 1 and 2: what does everything want, and how much is wanted in total
    const want = {};   // buildingId -> { res: desiredRate }
    const act = {};    // buildingId -> effective unit count after multipliers

    D.BUILDINGS.forEach(function (b) {
      const n = ctx.owned[b.id] || 0;
      // A half-crewed building runs at half speed, so staffing multiplies the
      // effective unit count exactly the way a throttle used to.
      const st = ctx.staff[b.id] === undefined ? 1 : ctx.staff[b.id];
      const a = n * st * (ctx.actM[b.id] || 1);
      act[b.id] = a;
      const w = {};
      if (a > 0) {
        const thrift = ctx.thriftM[b.id] === undefined ? 1 : ctx.thriftM[b.id];
        for (const res in b.inputs) {
          const rate = a * b.inputs[res] * thrift;
          w[res] = rate;
          demand[res] += rate;
        }
      }
      want[b.id] = w;
    });

    // --- 3: walk the stages
    for (let stage = 0; stage < D.STAGES; stage++) {
      for (let i = 0; i < D.BUILDINGS.length; i++) {
        const b = D.BUILDINGS[i];
        if (b.stage !== stage) continue;

        const a = act[b.id];
        if (a <= 0) { eff[b.id] = 0; continue; }

        let e = 1;
        for (const res in want[b.id]) {
          if (demand[res] <= 0) continue;
          const supply = produced[res] + stocks[res] / BUFFER_DRAIN;
          const sat = Math.min(1, supply / demand[res]);
          satisfaction[res] = Math.min(satisfaction[res], sat);
          if (sat < e) e = sat;
        }
        eff[b.id] = e;

        const yieldM = ctx.yieldM[b.id] === undefined ? 1 : ctx.yieldM[b.id];
        for (const res in b.outputs) {
          produced[res] += a * b.outputs[res] * yieldM * e;
        }
        for (const res in want[b.id]) {
          consumed[res] += want[b.id][res] * e;
        }
      }
    }

    // --- bugs from the brood
    let bugsRate = 0;
    D.BUILDINGS.forEach(function (b) {
      if (!b.brood) return;
      const yieldM = ctx.yieldM[b.id] === undefined ? 1 : ctx.yieldM[b.id];
      bugsRate += act[b.id] * ctx.broodYield * yieldM * (eff[b.id] || 0);
    });

    // --- 4: settle the silos, and note anything that spilled
    D.RESOURCES.forEach(function (r) {
      const cap = ctx.caps[r.id];
      const next = stocks[r.id] + (produced[r.id] - consumed[r.id]) * dt;
      if (next > cap) {
        overflow[r.id] = next - cap;
        stocks[r.id] = cap;
      } else {
        stocks[r.id] = Math.max(0, next);
      }
    });

    return {
      eff: eff,
      act: act,
      demand: demand,
      produced: produced,
      consumed: consumed,
      net: D.RESOURCES.reduce(function (o, r) {
        o[r.id] = produced[r.id] - consumed[r.id];
        return o;
      }, {}),
      satisfaction: satisfaction,
      stocks: stocks,
      overflow: overflow,
      bugsRate: bugsRate,
      bugs: bugsRate * dt,
    };
  }

  /**
   * Which inputs are actually holding a building back, for the UI to explain.
   * Returns the resource ids whose satisfaction is at or near the building's
   * own efficiency.
   */
  function blockers(D, b, res) {
    const e = res.eff[b.id];
    if (e === undefined || e >= 0.995) return [];
    const out = [];
    for (const id in b.inputs) {
      if (res.demand[id] > 0) {
        const supply = res.produced[id] + res.stocks[id] / BUFFER_DRAIN;
        const sat = Math.min(1, supply / res.demand[id]);
        if (sat <= e + 0.02) out.push(id);
      }
    }
    return out;
  }

  return { resolve: resolve, blockers: blockers, BUFFER_DRAIN: BUFFER_DRAIN };
});
