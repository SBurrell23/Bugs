/**
 * player.js - a headless player good enough to test the balance with.
 *
 * The interesting part is ratio targeting. A competent player of a chain game
 * does not buy whatever is cheapest; they work out how many of each building
 * a given number of Brood Chambers needs and fill in whatever is furthest
 * behind. That is what `idealCounts` computes, walking the chain backwards
 * from the brood and accounting for the yield and thrift upgrades already
 * bought, since those change the ratios.
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

  const broodB = D.BUILDINGS.find((b) => b.brood);
  counts[broodB.id] = brood;

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
  // forages per second over time, and how carefully they play
  keen: { forage: (t) => (t < 900 ? 3.2 : t < 2000 ? 2 : 1.2), deliver: true, careful: true, buys: true },
  normal: { forage: (t) => (t < 900 ? 1.4 : t < 2000 ? 0.9 : 0.5), deliver: true, careful: true, buys: true },
  slack: { forage: (t) => 0.25, deliver: true, careful: false, buys: true },
  afk: { forage: () => 0, deliver: false, careful: false, buys: true },
  // Buys by gut feel rather than by ratio: leans on whatever is cheap and
  // shiny. Used to check that poor balancing is punished but still winnable.
  sloppy: { forage: (t) => 0.8, deliver: true, careful: false, buys: true, sloppy: true },
};

function makePlayer(G, D, profileName) {
  const prof = PROFILES[profileName];
  let forageCredit = 0;

  /* ---------------- demands ---------------- */

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
      const urgent = left < d.window * 0.35;
      const rem = G.demandRemaining(d);
      let worth = urgent;
      if (!worth) {
        for (const res in rem) {
          if (G.state.stocks[res] > caps[res] * 0.55) { worth = true; break; }
        }
      }
      if (worth) G.deliver(d.id);
    }
  }

  /* ---------------- foraging ---------------- */

  function chooseForageTarget() {
    const need = neededByDemands();
    let best = null, bestScore = -1;
    for (const res of D.RAW) {
      const shortfall = (need[res] || 0) - G.state.stocks[res];
      const score = shortfall > 0 ? 100 + shortfall : -G.state.stocks[res];
      if (score > bestScore) { bestScore = score; best = res; }
    }
    if (best) G.setForageTarget(best);
  }

  function doForage(dt, t) {
    forageCredit += prof.forage(t) * dt;
    let n = 0;
    while (forageCredit >= 1 && n < 40) {
      chooseForageTarget();
      G.forage();
      forageCredit -= 1;
      n++;
    }
  }

  /* ---------------- buying ---------------- */

  function bugIncome(elapsed) {
    const st = G.stats();
    const demandRate = elapsed > 30 ? st.demandBugs / elapsed : 0;
    return st.bps + demandRate;
  }

  function buy(elapsed) {
    if (!prof.buys) return;
    const st = G.state;

    // monuments first: each one is a step change
    for (const m of D.MONUMENTS) {
      if (!st.monuments[m.id] && G.canPay(m.cost)) { G.buyMonument(m.id); return; }
    }

    // upgrades that are cheap relative to what we are earning
    const income = Math.max(bugIncome(elapsed), 1);
    const ups = G.availableUpgrades();
    for (const u of ups) {
      if (!G.canPay(u.cost)) continue;
      const cost = u.cost.bugs || 0;
      const overflowing = u.kind === 'cap' && G.chain &&
        G.chain.overflow[u.target] > 0;
      if (overflowing || cost <= income * 45) { G.buyUpgrade(u.id); return; }
    }

    // buildings: fill whatever is furthest below the ratio
    const ctx = G.context();
    const brood = Math.max(1, st.owned.broodChamber + 1);
    const want = idealCounts(D, ctx, brood);

    if (prof.sloppy) {
      // grab the cheapest thing that is unlocked and affordable, ratios be damned
      const opts = D.BUILDINGS.filter((b) =>
        G.buildingUnlocked(b.id) && G.canPay(G.buildingCost(b.id, 1)));
      if (opts.length) {
        const bias = opts[Math.floor(Math.random() * opts.length)];
        G.buyBuilding(bias.id, 1);
      }
      return;
    }

    let pick = null, worst = 0;
    for (const b of D.BUILDINGS) {
      if (!G.buildingUnlocked(b.id)) continue;
      const have = st.owned[b.id];
      const target = want[b.id];
      if (target <= have) continue;
      const gap = (target - have) / Math.max(1, target);
      if (gap > worst && G.canPay(G.buildingCost(b.id, 1))) { worst = gap; pick = b; }
    }
    if (pick) { G.buyBuilding(pick.id, 1); return; }

    // fully in ratio: reach for the next Brood Chamber
    const bc = D.BUILDINGS.find((b) => b.brood);
    if (G.buildingUnlocked(bc.id) && G.canPay(G.buildingCost(bc.id, 1))) {
      G.buyBuilding(bc.id, 1);
    }
  }

  return {
    /** One decision step. dt is seconds of game time since the last call. */
    step(dt, t) {
      handleDemands();
      doForage(dt, t);
      buy(t);
    },
    idealCounts: (brood) => idealCounts(D, G.context(), brood),
  };
}

module.exports = { makePlayer, PROFILES, idealCounts };
