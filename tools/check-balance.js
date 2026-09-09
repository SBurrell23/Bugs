/**
 * check-balance.js - a regression test for the game's pacing.
 *
 * Runs the headless player over several seeds and asserts the run still looks
 * like the game we designed: it finishes, it takes roughly two hours, no
 * colony is dead content, all three monuments get raised, and the player is
 * never left staring at a screen with nothing to buy.
 *
 * Exits non-zero on failure, so CI can gate on it.
 */
'use strict';

const API = require('../js/data.js');
const { makeSim, fmt } = require('./simulate.js');

const D = API.build();
const sim = makeSim(D);
const SEEDS = [4242, 99, 20260909, 777, 31337];

const BOUNDS = {
  casualMin: 70 * 60,
  casualMax: 170 * 60,
  activeMin: 30 * 60,
  idleMax: 8 * 3600,
  maxIdleGap: 10 * 60,
  minEndBps: 800,
  maxEndBps: 40000,
};

const failures = [];
const note = [];

function longestGap(s, win) {
  let prev = 0, worst = 0;
  for (const t of s.buyTimes) { if (t - prev > worst) worst = t - prev; prev = t; }
  const tail = (win || s.t) - prev;
  return Math.max(worst, tail);
}

function check(label, ok, detail) {
  if (!ok) failures.push(label + ' -- ' + detail);
  return ok;
}

console.log('Balance check over ' + SEEDS.length + ' seeds\n');
console.log('seed        casual    active      idle   endBps  colonies       mon  idleGap');

for (const seed of SEEDS) {
  const casual = sim.run('casual', seed);
  const active = sim.run('active', seed);
  const idle = sim.run('idle', seed);

  const win = casual.marks.WIN;
  const owned = D.COLONIES.map((g) => casual.s.owned[g.id]);
  const monuments = Object.keys(casual.s.monuments).length;
  const gap = longestGap(casual.s, win);

  console.log(
    String(seed).padEnd(10) +
    fmt(win).padStart(8) +
    fmt(active.marks.WIN).padStart(10) +
    fmt(idle.marks.WIN).padStart(10) +
    String(Math.round(casual.bps)).padStart(9) + '  ' +
    owned.join('/').padEnd(16) +
    (monuments + '/3').padStart(4) +
    fmt(gap).padStart(9)
  );

  const tag = 'seed ' + seed;
  check(tag + ': casual run finishes', win !== undefined, 'never reached one million');
  if (win === undefined) continue;

  check(tag + ': casual run is about two hours',
    win >= BOUNDS.casualMin && win <= BOUNDS.casualMax,
    'finished in ' + fmt(win) + ', wanted ' + fmt(BOUNDS.casualMin) + ' to ' + fmt(BOUNDS.casualMax));

  check(tag + ': heavy clicking is not a shortcut past the whole game',
    active.marks.WIN >= BOUNDS.activeMin,
    'active finished in ' + fmt(active.marks.WIN));

  check(tag + ': a hands-off run still finishes',
    idle.marks.WIN !== undefined && idle.marks.WIN <= BOUNDS.idleMax,
    'idle finished in ' + fmt(idle.marks.WIN));

  check(tag + ': every colony is worth owning',
    owned.every((n) => n >= 5),
    'owned ' + owned.join('/') + ' -- something is dead content');

  check(tag + ': all three monuments get raised', monuments === 3,
    'only raised ' + monuments);

  check(tag + ': there is always something to buy',
    gap <= BOUNDS.maxIdleGap,
    'went ' + fmt(gap) + ' with nothing worth buying');

  check(tag + ': the last million is still a real push',
    casual.bps >= BOUNDS.minEndBps && casual.bps <= BOUNDS.maxEndBps,
    'final output was ' + Math.round(casual.bps) + ' per second');

  note.push(win);
}

// content coverage, checked once
const best = sim.run('casual', 4242);
const upgradeShare = best.s.bought.size / D.UPGRADES.length;
check('a decent share of the upgrades get bought', upgradeShare >= 0.35,
  'only ' + Math.round(upgradeShare * 100) + '% were worth buying');

if (note.length) {
  const avg = note.reduce((a, b) => a + b, 0) / note.length;
  console.log('\nmean casual run: ' + fmt(avg));
}

if (failures.length) {
  console.error('\n' + failures.length + ' balance problem(s):');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}

console.log('\nBalance looks good.');
