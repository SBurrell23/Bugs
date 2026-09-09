/**
 * simulate.js - plays the game headlessly so the pacing can be tested.
 *
 * Models a competent player: every second it ranks everything unlocked by
 * payback time (cost divided by the bugs-per-second it adds), buys the best
 * thing it can afford, and saves up when the best buy is still out of reach.
 *
 * Usage: node tools/simulate.js [active|casual|idle|all] [--verbose]
 */
'use strict';

const API = require('../js/data.js');

const PROFILES = {
  active: { cps: (t) => (t < 1200 ? 4 : t < 3600 ? 2 : 0.7), catch: 0.95 },
  casual: { cps: (t) => (t < 1200 ? 1.8 : t < 3600 ? 0.7 : 0.25), catch: 0.7 },
  idle: { cps: () => 0.04, catch: 0.2 },
};

const HONEY_EVERY = 110;
const MAX_SECONDS = 8 * 3600;

function makeState(D) {
  const owned = {};
  const genMult = {};
  D.COLONIES.forEach((g) => { owned[g.id] = 0; genMult[g.id] = 1; });
  return {
    t: 0, bugs: 0, lifetime: 0, clicks: 0,
    owned, genMult, monuments: {},
    globalMult: 1, clickMult: 1, clickShare: 0,
    bought: new Set(), achieved: new Set(),
    studyMult: 1, studiesDone: 0, studyActive: null,
    goldens: 0, wasps: 0, boon: null,
    unlocks: [], buyTimes: [],
  };
}

function makeSim(D) {
  const achMult = (s) => 1 + D.ACH_BONUS * s.achieved.size;
  const boonMult = (s) => (s.boon && s.boon.mult ? s.boon.mult : 1);
  const boonClick = (s) => (s.boon && s.boon.clickMult ? s.boon.clickMult : 1);

  function monumentMult(s) {
    let m = 1;
    D.MONUMENTS.forEach((x) => { if (s.monuments[x.id]) m *= x.mult; });
    return m;
  }

  function passiveBps(s) {
    let base = 0;
    for (const g of D.COLONIES) base += s.owned[g.id] * g.bps * s.genMult[g.id];
    return base * s.globalMult * s.studyMult * monumentMult(s) * achMult(s) * boonMult(s);
  }

  function clickValue(s) {
    const flat = s.clickMult * boonClick(s) * s.globalMult * monumentMult(s) * achMult(s);
    return flat + passiveBps(s) * s.clickShare;
  }

  const genCost = (s, g) => Math.ceil(g.cost * Math.pow(D.COST_GROWTH, s.owned[g.id]));

  const colonyUnlocked = (s, g) =>
    g.index === 0 || s.owned[g.id] > 0 || s.lifetime >= g.cost * 0.5;
  const monumentUnlocked = (s, m) =>
    !s.monuments[m.id] && s.lifetime >= m.cost * 0.5;

  function upgradeUnlocked(s, u) {
    if (s.bought.has(u.id)) return false;
    if (u.req.lifetime !== undefined) return s.lifetime >= u.req.lifetime;
    if (u.req.gen !== undefined) return s.owned[u.req.gen] >= u.req.owned;
    return true;
  }

  function options(s, cps) {
    const out = [];
    const bps = passiveBps(s);
    const shared = s.globalMult * s.studyMult * monumentMult(s) * achMult(s) * boonMult(s);

    D.COLONIES.forEach((g) => {
      if (!colonyUnlocked(s, g)) return;
      out.push({ kind: 'colony', ref: g, cost: genCost(s, g), gain: g.bps * s.genMult[g.id] * shared });
    });

    D.MONUMENTS.forEach((m) => {
      if (!monumentUnlocked(s, m)) return;
      out.push({ kind: 'monument', ref: m, cost: m.cost, gain: bps * (m.mult - 1) });
    });

    D.UPGRADES.forEach((u) => {
      if (!upgradeUnlocked(s, u)) return;
      let gain = 0;
      if (u.kind === 'gen') {
        const g = D.COLONIES.find((x) => x.id === u.target);
        gain = s.owned[u.target] * g.bps * s.genMult[u.target] * shared;
      } else if (u.kind === 'global') gain = bps * (u.mult - 1);
      else if (u.kind === 'click') gain = cps * clickValue(s);
      else if (u.kind === 'synergy') gain = cps * bps * u.share;
      out.push({ kind: 'upg', ref: u, cost: u.cost, gain });
    });

    return out.filter((o) => o.gain > 0).map((o) => {
      o.payback = o.cost / o.gain;
      return o;
    });
  }

  function apply(s, o) {
    s.bugs -= o.cost;
    s.buyTimes.push(s.t);
    if (o.kind === 'colony') {
      s.owned[o.ref.id]++;
      if (s.owned[o.ref.id] === 1) s.unlocks.push([s.t, o.ref.name]);
    } else if (o.kind === 'monument') {
      s.monuments[o.ref.id] = true;
      s.unlocks.push([s.t, o.ref.name]);
      if (o.ref.id === 'hiveSingularity') s.clickShare += 0.15;
    } else {
      const u = o.ref;
      s.bought.add(u.id);
      if (u.kind === 'gen') s.genMult[u.target] *= u.mult;
      else if (u.kind === 'global') s.globalMult *= u.mult;
      else if (u.kind === 'click') s.clickMult *= u.mult;
      else if (u.kind === 'synergy') s.clickShare += u.share;
    }
  }

  function checkAchievements(s) {
    const snap = {
      lifetime: s.lifetime, bugs: s.bugs, clicks: s.clicks, owned: s.owned,
      monuments: s.monuments, goldens: s.goldens, wasps: s.wasps,
      upgradeCount: s.bought.size, studiesDone: s.studiesDone, bps: passiveBps(s),
    };
    for (const a of D.ACHIEVEMENTS) {
      if (!s.achieved.has(a.id) && a.test(snap)) s.achieved.add(a.id);
    }
  }

  function run(profileName, seed) {
    const prof = PROFILES[profileName];
    const s = makeState(D);
    let rng = seed || 1234567;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    let nextHoney = HONEY_EVERY * (0.6 + rand() * 0.8);
    let nextWasp = 260 + rand() * 200;
    const marks = {};
    const mark = (k, cond) => { if (marks[k] === undefined && cond) marks[k] = s.t; };

    for (s.t = 0; s.t < MAX_SECONDS; s.t++) {
      if (s.boon && s.t >= s.boon.until) s.boon = null;

      const cps = prof.cps(s.t);
      const earned = passiveBps(s) + cps * clickValue(s);
      s.bugs += earned;
      s.lifetime += earned;
      s.clicks += cps;

      if (s.t >= nextHoney) {
        const rate = s.monuments.cicadaChorus ? 0.55 : 1;
        nextHoney = s.t + HONEY_EVERY * rate * (0.6 + rand() * 0.8);
        if (rand() < prof.catch) {
          s.goldens++;
          const total = D.BOONS.reduce((a, b) => a + b.weight, 0);
          let roll = rand() * total, boon = D.BOONS[0];
          for (const b of D.BOONS) { roll -= b.weight; if (roll <= 0) { boon = b; break; } }
          if (boon.id === 'windfall') {
            const gift = Math.max(s.bugs * 0.08, passiveBps(s) * 60, 12);
            s.bugs += gift; s.lifetime += gift;
          } else {
            s.boon = { mult: boon.mult, clickMult: boon.clickMult, until: s.t + boon.seconds };
          }
        }
      }

      if (s.t >= nextWasp) {
        nextWasp = s.t + 260 + rand() * 200;
        if (rand() < prof.catch || s.monuments.mantisTemple) {
          s.wasps++;
          const drop = passiveBps(s) * 12;
          s.bugs += drop; s.lifetime += drop;
        } else {
          s.bugs -= Math.min(s.bugs * 0.04, passiveBps(s) * 30);
        }
      }

      if (s.studyActive && s.t >= s.studyActive.done) {
        s.studyMult *= s.studyActive.mult;
        s.studiesDone++;
        s.studyActive = null;
      }
      if (!s.studyActive && s.studiesDone < D.STUDIES.length) {
        const next = D.STUDIES[s.studiesDone];
        if (s.lifetime >= next.req.lifetime && s.bugs >= next.cost) {
          s.bugs -= next.cost;
          s.studyActive = { mult: next.mult, done: s.t + next.seconds };
        }
      }

      // Endgame: once the finish line is close enough to simply bank towards,
      // a real player stops spending. Model that.
      const bankSeconds = (D.GOAL - s.bugs) / Math.max(passiveBps(s), 1e-9);
      const banking = s.bugs > D.GOAL * 0.5 && bankSeconds < 240;

      if (!banking) {
        for (let guard = 0; guard < 60; guard++) {
          const opts = options(s, cps);
          if (!opts.length) break;
          const best = opts.reduce((a, b) => (b.payback < a.payback ? b : a));
          const afford = opts.filter((o) => o.cost <= s.bugs);
          if (!afford.length) break;
          const pick = afford.reduce((a, b) => (b.payback < a.payback ? b : a));
          if (pick.payback > best.payback * 2.6) break;
          apply(s, pick);
        }
      }

      checkAchievements(s);

      mark('life1k', s.lifetime >= 1e3);
      mark('life10k', s.lifetime >= 1e4);
      mark('life100k', s.lifetime >= 1e5);
      mark('life1M', s.lifetime >= 1e6);
      mark('bps50', passiveBps(s) >= 50);
      mark('bps500', passiveBps(s) >= 500);
      mark('WIN', s.bugs >= D.GOAL);
      if (marks.WIN !== undefined) break;
    }

    return { s, marks, bps: passiveBps(s) };
  }

  return { run, passiveBps };
}

/* ---------------- reporting ---------------- */
function fmt(sec) {
  if (sec === undefined) return ' -- ';
  return Math.floor(sec / 60) + 'm' + String(Math.floor(sec % 60)).padStart(2, '0') + 's';
}
function num(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toFixed(1);
}

function report(D, name, verbose) {
  const sim = makeSim(D);
  const { s, marks, bps } = sim.run(name);

  console.log('\n=== ' + name + ' ===');
  console.log('  1k ' + fmt(marks.life1k) + ' | 10k ' + fmt(marks.life10k) +
    ' | 100k ' + fmt(marks.life100k) + ' | 1M lifetime ' + fmt(marks.life1M));
  console.log('  50 bugs/sec ' + fmt(marks.bps50) + ' | 500 bugs/sec ' + fmt(marks.bps500));
  console.log('  GOAL (hold 1,000,000): ' + (marks.WIN === undefined ? 'NOT REACHED' : fmt(marks.WIN)));
  console.log('  end state: ' + num(bps) + ' bugs/sec, lifetime ' + num(s.lifetime) +
    ', upgrades ' + s.bought.size + '/' + D.UPGRADES.length +
    ', achievements ' + s.achieved.size + '/' + D.ACHIEVEMENTS.length +
    ', studies ' + s.studiesDone + '/' + D.STUDIES.length +
    ', honey bugs ' + s.goldens);
  console.log('  colonies: ' + D.COLONIES.map((g) => g.name.split(' ')[0] + ':' + s.owned[g.id]).join('  '));
  console.log('  milestones: ' + s.unlocks.map((u) => u[1].split(' ')[0] + '@' + fmt(u[0])).join(', '));

  // Longest stretch with no purchase of any kind -- our "nothing to do" metric.
  let prev = 0, worst = 0, worstAt = 0;
  for (const t of s.buyTimes) {
    if (t - prev > worst) { worst = t - prev; worstAt = prev; }
    prev = t;
  }
  const tail = (marks.WIN || s.t) - prev;
  if (tail > worst) { worst = tail; worstAt = prev; }
  console.log('  longest stretch with nothing to buy: ' + fmt(worst) + ' (from ' + fmt(worstAt) + ')');

  if (verbose) {
    let prevU = 0, gaps = [];
    for (const u of s.unlocks) { gaps.push([u[1], u[0] - prevU]); prevU = u[0]; }
    gaps.forEach((g) => console.log('     gap before ' + g[0] + ': ' + fmt(g[1])));
  }
  return { win: marks.WIN, idle: worst };
}

if (require.main === module) {
  const D = API.build();
  const which = process.argv[2] || 'all';
  const verbose = process.argv.includes('--verbose');
  const names = which === 'all' ? Object.keys(PROFILES) : [which];
  const res = names.map((n) => report(D, n, verbose));
  console.log('\nTarget: the casual run should land near 120 minutes (7200s).');
  console.log('Actual: ' + names.map((n, i) => n + ' ' + fmt(res[i].win)).join(' | '));
}

module.exports = { makeSim, PROFILES, fmt, num };
