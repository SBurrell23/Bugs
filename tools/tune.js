/**
 * tune.js - sweeps the balance knobs in js/data.js and scores each candidate
 * on whether it makes a GOOD two-hour game, not merely a long one.
 *
 * A run is only interesting if, at the moment of victory:
 *   - the casual profile lands near two hours
 *   - every colony is actually worth owning (nothing is dead content)
 *   - most upgrades have been bought
 *   - all three monuments are raised
 *   - final output is modest enough that the last million is a real push
 *   - the player is never left with nothing to buy for long
 *
 * Usage: node tools/tune.js [--top N]
 */
'use strict';

const API = require('../js/data.js');
const { makeSim, fmt } = require('./simulate.js');

const TARGET = 7200;

// costRatio is how much more each colony costs than the last.
// kRatio is how much less efficient it is per bug spent, which is what stops
// the economy running away. bpsRatio falls out of the two.
const grid = {
  costRatio: [6.0, 6.5, 7.2],
  kRatio: [1.8, 2.0, 2.2],
  kScale: [1.4, 1.9, 2.6, 3.4],
  costGrowth: [1.10, 1.12],
  globalMult: [1.22, 1.3],
  monScale: [1.3],
  studyMult: [1.12],
  genUpScale: [1.5, 2.4],
};

function* combos(g) {
  const keys = Object.keys(g);
  const idx = keys.map(() => 0);
  for (;;) {
    yield Object.fromEntries(keys.map((k, i) => [k, g[k][idx[i]]]));
    let p = keys.length - 1;
    while (p >= 0 && ++idx[p] >= g[keys[p]].length) { idx[p] = 0; p--; }
    if (p < 0) return;
  }
}

function toTuning(c) {
  const base = API.DEFAULT_TUNING;
  return {
    colonyBaseBps: 0.1 / c.kScale,
    colonyCostRatio: c.costRatio,
    colonyBpsRatio: c.costRatio / c.kRatio,
    costGrowth: c.costGrowth,
    globalMult: c.globalMult,
    studyMult: c.studyMult,
    monumentMults: [c.monScale, c.monScale + 0.08, c.monScale + 0.2],
    genUpgradeCostMult: base.genUpgradeCostMult.map((m) => Math.round(m * c.genUpScale)),
  };
}

function score(D, r) {
  const s = r.s;
  const win = r.marks.WIN;
  if (win === undefined) return null;

  const deadColonies = D.COLONIES.filter((g) => s.owned[g.id] < 5).length;
  const upgradeShare = s.bought.size / D.UPGRADES.length;
  const monuments = Object.keys(s.monuments).length;

  let prev = 0, idle = 0;
  for (const t of s.buyTimes) { if (t - prev > idle) idle = t - prev; prev = t; }

  // penalties, lower is better
  const timeMiss = Math.abs(Math.log(win / TARGET)) * 3;
  const deadPenalty = deadColonies * 1.2;
  const upgradePenalty = Math.max(0, 0.65 - upgradeShare) * 4;
  const monumentPenalty = (3 - monuments) * 0.8;
  const bpsPenalty = r.bps < 1200 || r.bps > 12000 ? Math.abs(Math.log(r.bps / 4000)) : 0;
  const idlePenalty = Math.max(0, idle - 240) / 240;
  const k0 = D.COLONIES[0].cost / D.COLONIES[0].bps;   // seconds to pay back the first colony
  const openingPenalty = Math.max(0, Math.log(k0 / 240)) * 2.5;

  return {
    total: timeMiss + deadPenalty + upgradePenalty + monumentPenalty + bpsPenalty + idlePenalty + openingPenalty,
    k0: k0,
    win, deadColonies, upgradeShare, monuments, idle, bps: r.bps,
    lifetime: s.lifetime, owned: D.COLONIES.map((g) => s.owned[g.id]),
  };
}

const results = [];
let tried = 0, reached = 0;

for (const c of combos(grid)) {
  const tuning = toTuning(c);
  const D = API.build(tuning);
  const sim = makeSim(D);
  tried++;

  const casual = sim.run('casual', 4242);
  const sc = score(D, casual);
  if (!sc) continue;
  reached++;

  const active = sim.run('active', 4242);
  const idleRun = sim.run('idle', 4242);
  results.push({ c, tuning, sc, active: active.marks.WIN, idle: idleRun.marks.WIN });
}

results.sort((a, b) => a.sc.total - b.sc.total);

const topN = Number((process.argv.find((a) => a.startsWith('--top')) || '--top 10').split(/[ =]/)[1]) || 10;

console.log('tried ' + tried + ', ' + reached + ' reached the goal within the time limit\n');
console.log('score  casual   active     idle    endBps  upg  mon dead  idleGap   K0  settings');
for (const r of results.slice(0, topN)) {
  console.log(
    r.sc.total.toFixed(2).padStart(5) +
    fmt(r.sc.win).padStart(8) +
    fmt(r.active).padStart(9) +
    fmt(r.idle).padStart(9) +
    ('' + Math.round(r.sc.bps)).padStart(9) +
    (Math.round(r.sc.upgradeShare * 100) + '%').padStart(5) +
    ('' + r.sc.monuments).padStart(4) +
    ('' + r.sc.deadColonies).padStart(5) +
    fmt(r.sc.idle).padStart(9) + ('' + Math.round(r.sc.k0)).padStart(6) + '  ' +
    Object.entries(r.c).map(([k, v]) => k + '=' + v).join(' ')
  );
}

if (results.length) {
  const best = results[0];
  console.log('\nbest candidate owns: ' + best.sc.owned.join(' / ') +
    '  (lifetime ' + (best.sc.lifetime / 1e6).toFixed(2) + 'M)');
  console.log('\ntuning block:');
  console.log(JSON.stringify(best.tuning, null, 2));
}
