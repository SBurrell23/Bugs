/**
 * simulate.js - plays the real game headlessly and reports on the run.
 *
 * Usage: node tools/simulate.js [keen|normal|slack|afk|all] [--trace]
 */
'use strict';

const { makeGame } = require('./harness');
const { makePlayer, PROFILES } = require('./player');

const DT = 0.2;              // seconds of game time per tick
const MAX_SECONDS = 5 * 3600;

const CATCH = { keen: 0.95, normal: 0.8, slack: 0.4, afk: 0, sloppy: 0.6 };

function run(profileName, seed, tuning) {
  const h = makeGame(tuning);
  const { G, D } = h;
  const player = makePlayer(G, D, profileName);
  const catchRate = CATCH[profileName];

  let rng = seed || 12345;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // the UI normally spawns a clickable bug; here the player just sometimes
  // gets to it in time
  G.on('honeySpawn', () => { if (rand() < catchRate) G.catchHoney(); });
  G.on('mothSpawn', () => { if (rand() < catchRate) G.catchMoth(); });
  G.on('waspSpawn', () => { if (rand() < catchRate) G.swatWasp(); else G.waspEscaped(); });

  const marks = {};
  const mark = (k, cond) => { if (marks[k] === undefined && cond) marks[k] = t; };
  const trace = [];
  const buyTimes = [];
  let starvedTicks = 0, totalTicks = 0;
  let lastBuildings = 0;

  let t = 0;
  for (; t < MAX_SECONDS; t += DT) {
    h.advance(DT * 1000);
    G.tick(DT);
    player.step(DT, t);

    const st = G.state;
    const built = D.BUILDINGS.reduce((a, b) => a + st.owned[b.id], 0)
      + Object.keys(st.upgrades).length + Object.keys(st.monuments).length;
    if (built !== lastBuildings) { buyTimes.push(t); lastBuildings = built; }

    totalTicks++;
    const ch = G.chain;
    if (ch) {
      const owned = D.BUILDINGS.filter((b) => st.owned[b.id] > 0);
      if (owned.length && owned.some((b) => (ch.eff[b.id] || 0) < 0.9)) starvedTicks++;
    }

    mark('life1k', st.lifetime >= 1e3);
    mark('life25k', st.lifetime >= 25e3);
    mark('life250k', st.lifetime >= 250e3);
    mark('brood1', st.owned.broodChamber >= 1);
    mark('wax1', st.owned.waxWorks >= 1);
    mark('WIN', st.bugs >= D.GOAL);

    if (trace.length < 4000 && Math.abs(t % 60) < DT) {
      trace.push({
        t, bugs: st.bugs, bps: G.bps(),
        owned: D.BUILDINGS.map((b) => st.owned[b.id]),
        streak: st.streak,
      });
    }

    if (marks.WIN !== undefined) break;
  }

  const st = G.state;
  const stats = G.stats();
  h.restore();

  let prev = 0, idleGap = 0;
  for (const bt of buyTimes) { if (bt - prev > idleGap) idleGap = bt - prev; prev = bt; }
  const tail = t - prev;
  if (tail > idleGap) idleGap = tail;

  return {
    profile: profileName, marks, stats, state: st, D, trace, t,
    idleGap,
    starvedShare: totalTicks ? starvedTicks / totalTicks : 0,
    owned: D.BUILDINGS.map((b) => st.owned[b.id]),
  };
}

/* ---------------- reporting ---------------- */
function fmt(sec) {
  if (sec === undefined) return '  --  ';
  return Math.floor(sec / 60) + 'm' + String(Math.floor(sec % 60)).padStart(2, '0') + 's';
}
function num(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return (n || 0).toFixed(1);
}
const pct = (x) => Math.round(x * 100) + '%';

function report(r, showTrace) {
  const s = r.stats;
  const total = s.broodBugs + s.demandBugs;
  console.log('\n=== ' + r.profile + ' ===');
  console.log('  1k ' + fmt(r.marks.life1k) + ' | 25k ' + fmt(r.marks.life25k) +
    ' | 250k ' + fmt(r.marks.life250k) +
    ' | first Wax Works ' + fmt(r.marks.wax1) + ' | first Brood ' + fmt(r.marks.brood1));
  console.log('  GOAL: ' + (r.marks.WIN === undefined ? 'NOT REACHED in ' + fmt(r.t) : fmt(r.marks.WIN)));
  console.log('  bugs from: brood ' + pct(total ? s.broodBugs / total : 0) +
    ' / demands ' + pct(total ? s.demandBugs / total : 0) +
    '   (' + num(s.broodBugs) + ' + ' + num(s.demandBugs) + ')');
  console.log('  demands ' + s.demandsFilled + ' filled, ' + s.demandsMissed +
    ' missed, best streak ' + s.bestStreak);
  console.log('  buildings ' + r.D.BUILDINGS.map((b, i) =>
    b.name.split(' ')[0] + ':' + r.owned[i]).join('  '));
  console.log('  upgrades ' + s.upgrades + '/' + s.upgradeTotal +
    ' | monuments ' + s.monuments + '/3' +
    ' | awards ' + s.awards + '/' + s.awardTotal);
  console.log('  end ' + num(s.bps) + ' bugs/sec, forages ' + Math.round(s.forages) +
    ', wasted ' + num(s.wasted) + ' to overflow, stolen ' + num(s.stolen));
  console.log('  chain starved ' + pct(r.starvedShare) + ' of ticks' +
    ' | longest gap with no purchase ' + fmt(r.idleGap));

  if (showTrace) {
    console.log('  ' + 'time'.padEnd(7) + 'bugs'.padStart(9) + 'bps'.padStart(9) +
      '  buildings');
    r.trace.forEach((p) => {
      console.log('  ' + fmt(p.t).padEnd(7) + num(p.bugs).padStart(9) +
        num(p.bps).padStart(9) + '  ' + p.owned.join('/'));
    });
  }
}

if (require.main === module) {
  const which = process.argv[2] || 'all';
  const showTrace = process.argv.includes('--trace');
  const names = which === 'all' ? Object.keys(PROFILES) : [which];
  const results = names.map((n) => run(n, 4242));
  results.forEach((r) => report(r, showTrace && names.length === 1));
  console.log('\nTarget: the normal run should land near 60 minutes.');
  console.log('Actual: ' + results.map((r) => r.profile + ' ' + fmt(r.marks.WIN)).join(' | '));
}

module.exports = { run, fmt, num, pct, DT };
