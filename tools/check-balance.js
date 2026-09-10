/**
 * check-balance.js - a regression test for the game's pacing and fairness.
 *
 * Asserts the things that make this the game we designed rather than merely a
 * game that finishes:
 *   - a normal run takes about an hour
 *   - bugs come from BOTH the brood and the Queen
 *   - leaving the tab alone does NOT win, at any timescale
 *   - poor chain balancing costs you real time, but is still winnable
 *   - no cost can ever exceed what a silo is able to hold
 *
 * Exits non-zero on failure so CI can gate on it.
 */
'use strict';

const { run, fmt, num, pct } = require('./simulate');
const API = require('../js/data.js');

const D = API.build();
const SEEDS = [4242, 8080, 20260909];

const B = {
  normalMin: 42 * 60,
  normalMax: 88 * 60,
  broodShareMin: 0.3,
  broodShareMax: 0.7,
  maxIdleGap: 6 * 60,
  minEndBps: 800,
  maxEndBps: 30000,
  minOwned: 5,
};

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + ' -- ' + detail); };

/* ---------- static check: nothing may cost more than a silo can hold ------ */
const capMult = {};
D.RESOURCES.forEach((r) => { capMult[r.id] = 1; });
D.UPGRADES.filter((u) => u.kind === 'cap').forEach((u) => { capMult[u.target] *= u.mult; });
const maxCap = {};
D.RESOURCES.forEach((r) => { maxCap[r.id] = r.cap * capMult[r.id]; });

D.MONUMENTS.forEach(function (m) {
  for (const res in m.cost) {
    if (res === 'bugs') continue;
    check('monument cost fits in a silo', m.cost[res] <= maxCap[res],
      m.name + ' wants ' + m.cost[res] + ' ' + res + ' but the largest store holds ' + maxCap[res]);
  }
});
D.BUILDINGS.forEach(function (b) {
  for (const res in b.cost) {
    if (res === 'bugs') continue;
    check('building base cost fits in a silo', b.cost[res] <= maxCap[res] * 0.5,
      b.name + ' wants ' + b.cost[res] + ' ' + res);
  }
});

/* ---------- the runs ---------- */
console.log('Balance check over ' + SEEDS.length + ' seeds\n');
console.log('seed        normal   brood%   mon  buildings              endBps  idleGap    afk       sloppy');

const normalTimes = [];

for (const seed of SEEDS) {
  const normal = run('normal', seed);
  const afk = run('afk', seed);
  const sloppy = run('sloppy', seed);

  const s = normal.stats;
  const total = s.broodBugs + s.demandBugs;
  const broodShare = total ? s.broodBugs / total : 0;
  const win = normal.marks.WIN;

  console.log(
    String(seed).padEnd(10) +
    fmt(win).padStart(8) +
    pct(broodShare).padStart(8) +
    (s.monuments + '/3').padStart(6) + '  ' +
    normal.owned.join('/').padEnd(22) +
    num(s.bps).padStart(8) +
    fmt(normal.idleGap).padStart(9) +
    (afk.marks.WIN === undefined ? '  never' : '  ' + fmt(afk.marks.WIN)).padStart(9) +
    fmt(sloppy.marks.WIN).padStart(12)
  );

  const tag = 'seed ' + seed;
  check(tag + ': a normal run finishes', win !== undefined, 'never reached one million');
  if (win === undefined) continue;
  normalTimes.push(win);

  check(tag + ': a normal run takes about an hour',
    win >= B.normalMin && win <= B.normalMax,
    'finished in ' + fmt(win) + ', wanted ' + fmt(B.normalMin) + ' to ' + fmt(B.normalMax));

  check(tag + ': both income sources matter',
    broodShare >= B.broodShareMin && broodShare <= B.broodShareMax,
    'the brood supplied ' + pct(broodShare) + ' of all bugs');

  check(tag + ': leaving the tab alone does not win',
    afk.marks.WIN === undefined,
    'an idle run finished in ' + fmt(afk.marks.WIN));

  check(tag + ': poor balancing costs real time',
    sloppy.marks.WIN === undefined || sloppy.marks.WIN > win * 1.1,
    'sloppy play finished in ' + fmt(sloppy.marks.WIN) + ' against ' + fmt(win));

  check(tag + ': poor balancing is still winnable',
    sloppy.marks.WIN !== undefined,
    'a sloppy run never finished, which is too punishing');

  check(tag + ': every building is worth owning',
    normal.owned.every((n) => n >= B.minOwned),
    'owned ' + normal.owned.join('/') + ' -- something is dead content');

  check(tag + ': all three monuments get raised', s.monuments === 3,
    'only raised ' + s.monuments);

  check(tag + ': there is always something to buy',
    normal.idleGap <= B.maxIdleGap,
    'went ' + fmt(normal.idleGap) + ' with nothing worth buying');

  check(tag + ': the last stretch is still a push',
    s.bps >= B.minEndBps && s.bps <= B.maxEndBps,
    'final output was ' + Math.round(s.bps) + ' per second');
}

if (normalTimes.length) {
  const avg = normalTimes.reduce((a, b) => a + b, 0) / normalTimes.length;
  console.log('\nmean normal run: ' + fmt(avg));
}

if (failures.length) {
  console.error('\n' + failures.length + ' balance problem(s):');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}

console.log('\nBalance looks good.');
