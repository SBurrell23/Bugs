/**
 * tune.js - sweeps the balance knobs and scores each candidate on whether it
 * makes a GOOD one-hour game, not merely a one-hour one.
 *
 * A candidate is only interesting if:
 *   - a normal run lands near an hour
 *   - bugs come from BOTH the brood and the Queen, so neither system is decoration
 *   - every building is worth owning
 *   - all three monuments get raised
 *   - an away-from-keyboard run does NOT win, which is the whole point
 *   - the player is never left with nothing to buy for long
 *
 * Usage: node tools/tune.js [--top N] [--quick]
 */
'use strict';

const { run, fmt, num, pct } = require('./simulate');

const TARGET = 3600;

const FULL = {
  broodYield: [22, 28, 36],
  demandPay: [3, 4, 5],
  demandCover: [22, 30],
  costGrowth: [1.135, 1.155],
  upgradeCostMult: [1, 1.6],
};
const QUICK = {
  broodYield: [26, 32],
  demandPay: [3.5, 4.5],
  demandCover: [26],
  costGrowth: [1.135],
  upgradeCostMult: [1],
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

function score(r) {
  const s = r.stats;
  const win = r.marks.WIN;
  if (win === undefined) return null;

  const total = s.broodBugs + s.demandBugs;
  const broodShare = total ? s.broodBugs / total : 0;
  const dead = r.owned.filter((n) => n < 5).length;

  // penalties, lower is better
  const timeMiss = Math.abs(Math.log(win / TARGET)) * 4;
  // both income sources should matter; 50/50 is ideal, either extreme is bad
  const splitMiss = Math.abs(broodShare - 0.5) * 3;
  const deadPenalty = dead * 1.5;
  const monumentPenalty = (3 - s.monuments) * 1.0;
  const idlePenalty = Math.max(0, r.idleGap - 300) / 300;
  const bpsPenalty = s.bps < 1000 || s.bps > 25000
    ? Math.abs(Math.log(s.bps / 5000)) : 0;

  return {
    total: timeMiss + splitMiss + deadPenalty + monumentPenalty + idlePenalty + bpsPenalty,
    win, broodShare, dead, monuments: s.monuments, idleGap: r.idleGap,
    bps: s.bps, upgrades: s.upgrades, upgradeTotal: s.upgradeTotal,
    demands: s.demandsFilled,
  };
}

const grid = process.argv.includes('--quick') ? QUICK : FULL;
const results = [];
let tried = 0;

for (const c of combos(grid)) {
  tried++;
  const r = run('normal', 4242, c);
  const sc = score(r);
  if (!sc) continue;
  results.push({ c, sc });
  process.stderr.write('.');
}
process.stderr.write('\n');

results.sort((a, b) => a.sc.total - b.sc.total);

const topArg = process.argv.indexOf('--top');
const topN = topArg >= 0 ? Number(process.argv[topArg + 1]) || 10 : 10;

console.log('tried ' + tried + ', ' + results.length + ' finished\n');
console.log('score    win    brood%  mon dead   endBps  demands  upgrades  settings');
for (const r of results.slice(0, topN)) {
  console.log(
    r.sc.total.toFixed(2).padStart(5) +
    fmt(r.sc.win).padStart(9) +
    pct(r.sc.broodShare).padStart(8) +
    (r.sc.monuments + '/3').padStart(5) +
    String(r.sc.dead).padStart(5) +
    num(r.sc.bps).padStart(9) +
    String(r.sc.demands).padStart(9) +
    (r.sc.upgrades + '/' + r.sc.upgradeTotal).padStart(10) + '   ' +
    Object.entries(r.c).map(([k, v]) => k + '=' + v).join(' ')
  );
}

if (results.length) {
  console.log('\ntuning block:');
  console.log(JSON.stringify(results[0].c, null, 2));
}
