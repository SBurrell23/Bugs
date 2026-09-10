/**
 * player.js - a headless player good enough to test the balance with.
 *
 * Two things make it worth trusting:
 *
 *  - It targets RATIOS. A competent player of a chain game works out how many
 *    of each building a given number of Brood Chambers needs and fills in
 *    whatever is furthest behind. `idealCounts` walks the DAG backwards from
 *    the brood to do exactly that, accounting for the yield and thrift
 *    upgrades already bought, since those move the ratios.
 *
 *  - It CREWS. Bugs are labour, so every tick it spreads the population across
 *    the jobs, keeping every building at the same share of its crew. If the
 *    counts are in ratio, equal crewing keeps the output in ratio too.
 */
'use strict';

/**
 * How many of each building are needed to keep `brood` Brood Chambers fed.
 * Walks the DAG from the deepest stage back to the raw harvesters.
 */
function idealCounts(D, ctx, brood) {
  const counts = {};
  const req = {};
  D.BUILDINGS.forEach((b) => { counts[b.id] = 0; });
  D.RESOURCES.forEach((r) => { req[r.id] = 0; });

  counts[D.BUILDINGS.find((b) => b.brood).id] = brood;

  for (let stage = D.STAGES - 1; stage >= 0; stage--) {
    for (const b of D.BUILDINGS) {
      if (b.stage !== stage) continue;
      let need = counts[b.id];
      for (const res in b.outputs) {
        const rate = req[res];
        if (rate > 0) {
          const per = b.outputs[res] * (ctx.yieldM[b.id] || 1);
          if (per > 0) need = Math.max(need, rate / per);
        }
      }
      counts[b.id] = need;
      for (const res in b.inputs) {
        req[res] += need * b.inputs[res] * (ctx.thriftM[b.id] || 1);
      }
    }
  }

  // The Queen eats raw materials too, so the front of the chain is
  // deliberately overbuilt relative to the pure ratio.
  D.BUILDINGS.forEach((b) => {
    if (b.brood) return;
    counts[b.id] *= b.stage === 0 ? 1.4 : 1.15;
  });
  return counts;
}

const PROFILES = {
  keen: { forage: (t) => (t < 900 ? 3.2 : t < 2000 ? 2 : 1.2), deliver: true, careful: true, buys: true },
  normal: { forage: (t) => (t < 900 ? 1.4 : t < 2000 ? 0.9 : 0.5), deliver: true, careful: true, buys: true },
  slack: { forage: () => 0.25, deliver: true, careful: false, buys: true },
  afk: { forage: () => 0, deliver: false, careful: false, buys: false, noCrew: true },
  // Builds by gut feel instead of by ratio, and crews unevenly. Used to check
  // that poor play is punished but still winnable.
  sloppy: { forage: () => 0.8, deliver: true, careful: false, buys: true, sloppy: true },
};

function makePlayer(G, D, profileName) {
  const prof = PROFILES[profileName];
  let forageCredit = 0;

  /* ---------------- orders ---------------- */

  function neededByDemands() {
    const need = {};
    G.state.demands.forEach((d) => {
      const rem = G.demandRemaining(d);
      for (const res in rem) need[res] = (need[res] || 0) + rem[res];
    });
    return need;
  }

  function canCompleteNow(d) {
    const rem = G.demandRemaining(d);
    for (const res in rem) if (G.state.stocks[res] < rem[res]) return false;
    return true;
  }

  function handleDemands() {
    if (!prof.deliver) return;
    const caps = G.caps();
    for (const d of G.state.demands.slice()) {
      if (canCompleteNow(d)) { G.deliver(d.id); continue; }
      if (!prof.careful) { G.deliver(d.id); continue; }

      // Part-delivering starves the chain for no payout, so only push a
      // resource forward when there is plenty of it, or when time is short.
      const left = (d.expiresAt - Date.now()) / 1000;
      let worth = left < d.window * 0.35;
      if (!worth) {
        const rem = G.demandRemaining(d);
        for (const res in rem) {
          if (G.state.stocks[res] > caps[res] * 0.55) { worth = true; break; }
        }
      }
      if (worth) G.deliver(d.id);
    }
  }

  /* ---------------- hands ---------------- */

  /** Returns false when every raw silo is already brimming. */
  function chooseForageTarget() {
    const need = neededByDemands();
    const caps = G.caps();
    let best = null, bestScore = -1;
    for (const res of D.RAW) {
      if (G.state.stocks[res] >= caps[res] * 0.99) continue;
      const shortfall = (need[res] || 0) - G.state.stocks[res];
      const score = shortfall > 0 ? 100 + shortfall : -G.state.stocks[res];
      if (score > bestScore) { bestScore = score; best = res; }
    }
    if (best) G.setForageTarget(best);
    return !!best;
  }

  function doForage(dt, t) {
    forageCredit += prof.forage(t) * dt;
    let n = 0;
    while (forageCredit >= 1 && n < 40) {
      if (!chooseForageTarget()) { forageCredit = 0; break; }
      G.forage();
      forageCredit -= 1;
      n++;
    }
  }

  /** Cash in a silo that is brimming and that no order wants. */
  function titheSurplus() {
    if (!prof.deliver) return false;
    const caps = G.caps();
    const need = neededByDemands();
    for (const r of D.RESOURCES) {
      const have = G.state.stocks[r.id];
      if (have < caps[r.id] * 0.97) continue;
      if ((need[r.id] || 0) > have * 0.6) continue;
      if (G.tithe(r.id)) return true;
    }
    return false;
  }

  /* ---------------- crewing ---------------- */

  /**
   * Hold every building at the same share of its crew. With the counts in
   * ratio, equal crewing keeps the output in ratio, which is the baseline a
   * thinking player works from.
   */
  function restaff() {
    if (prof.noCrew) return;
    const needs = D.BUILDINGS.map((b) => ({ id: b.id, need: G.crewNeeded(b.id) }));
    const total = needs.reduce((a, x) => a + x.need, 0);
    if (total <= 0) return;

    if (prof.sloppy) {
      // Builds badly, but does what a careless human actually does when the
      // colony looks wrong: mashes Auto-assign. Testing bad BUILDING is the
      // point; a profile that also refuses the recovery button in the UI is
      // measuring stubbornness, not balance.
      G.autoStaff();
      return;
    }
    const f = Math.min(1, Math.floor(G.state.bugs) / total);
    for (const x of needs) G.setAssign(x.id, Math.floor(x.need * f));
    G.autoStaff();
  }

  /* ---------------- buying ---------------- */

  function buy() {
    if (!prof.buys) return false;
    const st = G.state;
    const caps = G.caps();

    // monuments first: each one is a step change
    for (const m of D.MONUMENTS) {
      if (!st.monuments[m.id] && G.canPay(m.cost)) { G.buyMonument(m.id); return true; }
    }

    // Buildings before upgrades. Buildings are what grow the economy, and a
    // player who spends every last leaf on upgrades stalls out.
    const ctx = G.context();
    const want = idealCounts(D, ctx, Math.max(1, st.owned.broodChamber + 1));

    if (prof.sloppy) {
      const opts = D.BUILDINGS.filter((b) =>
        G.buildingUnlocked(b.id) && G.canPay(G.buildingCost(b.id, 1)));
      if (opts.length) {
        G.buyBuilding(opts[Math.floor(Math.random() * opts.length)].id, 1);
        return true;
      }
    } else {
      let pick = null, worst = 0;
      for (const b of D.BUILDINGS) {
        if (!G.buildingUnlocked(b.id)) continue;
        const target = want[b.id];
        const have = st.owned[b.id];
        if (target <= have) continue;
        const gap = (target - have) / Math.max(1, target);
        if (gap > worst && G.canPay(G.buildingCost(b.id, 1))) { worst = gap; pick = b; }
      }
      if (pick) { G.buyBuilding(pick.id, 1); return true; }
    }

    // Upgrades with whatever is left over, but never spending a silo down so
    // far that the next building becomes unaffordable.
    for (const u of G.availableUpgrades()) {
      if (!G.canPay(u.cost)) continue;
      const overflowing = u.kind === 'cap' && G.chain && G.chain.overflow[u.target] > 0;
      const nearFull = u.kind === 'cap' && st.stocks[u.target] >= caps[u.target] * 0.8;
      const leavesRoom = Object.keys(u.cost)
        .every((r) => st.stocks[r] - u.cost[r] >= caps[r] * 0.25);
      if (overflowing || nearFull || leavesRoom) { G.buyUpgrade(u.id); return true; }
    }

    // fully in ratio and nothing worth upgrading: reach for another Brood Chamber
    const bc = D.BUILDINGS.find((b) => b.brood);
    if (G.buildingUnlocked(bc.id) && G.canPay(G.buildingCost(bc.id, 1))) {
      G.buyBuilding(bc.id, 1);
      return true;
    }
    return false;
  }

  return {
    /** One decision step. dt is seconds of game time since the last call. */
    step(dt, t) {
      handleDemands();
      doForage(dt, t);
      // Tithing is a LAST resort. Selling off sap that an order wants, or that
      // the next building costs, is how a player talks themselves into a
      // stall, so only reach for it when there was nothing else to do.
      if (!buy()) titheSurplus();
      restaff();
    },
    idealCounts: (brood) => idealCounts(D, G.context(), brood),
  };
}

module.exports = { makePlayer, PROFILES, idealCounts };
