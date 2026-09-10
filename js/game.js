/* ==========================================================================
   game.js - state, economy and rules. Knows nothing about the DOM.

   Bugs come from two places, and the split is deliberate:
     - Brood Chambers, which tick along on their own
     - the Queen's demands, which have to be filled by hand
   The demands are the larger share, which is what stops the game from
   playing itself while you are away from the keyboard.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.BUGS_DATA;
  const CHAIN = root.BUGS_CHAIN;
  const SAVE_KEY = 'bugs.save.v3';

  const OFFLINE_CAP = 15 * 60;   // this is not an idle game; catch-up is small
  const OFFLINE_RATE = 0.4;

  const HONEY_EVERY = [70, 140];
  const WASP_EVERY = [150, 260];
  const MOTH_EVERY = [190, 330];
  const WEATHER_EVERY = [95, 170];

  const STARTING_BUGS = 25;

  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const BUILDING = byId(D.BUILDINGS);
  const MONUMENT = byId(D.MONUMENTS);
  const UPGRADE = byId(D.UPGRADES);
  const RESOURCE = byId(D.RESOURCES);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pickIn = (pair) => rnd(pair[0], pair[1]);
  const nowMs = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- events ---------------- */
  const handlers = {};
  const on = (n, fn) => (handlers[n] = handlers[n] || []).push(fn);
  const emit = (n, p) => (handlers[n] || []).forEach((fn) => fn(p));

  /* ---------------- state ---------------- */
  let s = null;
  let last = null;      // most recent chain result, for the UI
  let demandSeq = 1;

  function freshState() {
    const owned = {}, throttle = {}, stocks = {}, filled = {};
    D.BUILDINGS.forEach((b) => { owned[b.id] = 0; throttle[b.id] = 1; });
    D.RESOURCES.forEach((r) => { stocks[r.id] = 0; filled[r.id] = false; });
    return {
      v: 3,
      bugs: STARTING_BUGS,
      lifetime: STARTING_BUGS,
      spent: 0,
      forages: 0,
      foraged: 0,
      forageTarget: 'sap',
      owned, throttle, stocks, filled,
      upgrades: {}, monuments: {}, awards: {},
      demands: [],
      demandsFilled: 0,
      demandsMissed: 0,
      demandBugs: 0,
      broodBugs: 0,
      streak: 0,
      bestStreak: 0,
      nextDemandIn: 16,
      weather: null,
      boons: [],
      goldens: 0, waspsSwatted: 0, waspsMissed: 0, moths: 0, stolen: 0,
      wasted: 0,
      milestones: {},
      bestBps: 0,
      won: false, wonAt: null,
      startedAt: nowMs(), lastSeen: nowMs(), playedMs: 0,
      honeyIn: rnd(50, 90),
      waspIn: pickIn(WASP_EVERY),
      mothIn: pickIn(MOTH_EVERY),
      weatherIn: rnd(70, 120),
      settings: { music: true, musicVol: 0.45, sfx: true, buyQty: 1 },
    };
  }

  /* ================================================================== *
   * multipliers
   * ================================================================== */

  function upgradeSets() {
    const yieldM = {}, thriftM = {}, capM = {};
    let global = 1, forage = 1, queen = 1;
    D.BUILDINGS.forEach((b) => { yieldM[b.id] = 1; thriftM[b.id] = 1; });
    D.RESOURCES.forEach((r) => { capM[r.id] = 1; });

    for (const id in s.upgrades) {
      const u = UPGRADE[id];
      if (!u) continue;
      if (u.kind === 'yield') yieldM[u.target] *= u.mult;
      else if (u.kind === 'thrift') thriftM[u.target] *= (1 - u.save);
      else if (u.kind === 'cap') capM[u.target] *= u.mult;
      else if (u.kind === 'global') global *= u.mult;
      else if (u.kind === 'forage') forage *= u.mult;
      else if (u.kind === 'queen') queen *= u.mult;
    }
    return { yieldM, thriftM, capM, global, forage, queen };
  }

  function boonFlags() {
    let raw = 1, all = 1;
    for (const b of s.boons) {
      if (b.raw) raw *= b.raw;
      if (b.all) all *= b.all;
    }
    return { raw, all };
  }

  function caps() {
    const u = upgradeSets();
    const out = {};
    D.RESOURCES.forEach((r) => { out[r.id] = Math.round(r.cap * u.capM[r.id]); });
    return out;
  }

  /** Everything the chain resolver needs, assembled from state. */
  function context() {
    const u = upgradeSets();
    const boon = boonFlags();
    const hive = s.monuments.hiveSingularity ? MONUMENT.hiveSingularity.mult : 1;
    const harvest = s.monuments.cicadaChorus ? 1.33 : 1;

    const actM = {}, yieldM = {}, thriftM = {};
    D.BUILDINGS.forEach((b) => {
      actM[b.id] = u.global * hive * boon.all;

      let y = u.yieldM[b.id];
      const raw = b.stage === 0;
      if (raw) y *= harvest * boon.raw;
      if (s.weather && s.weather.building === b.id) y *= s.weather.mult;
      yieldM[b.id] = y;

      thriftM[b.id] = u.thriftM[b.id];
    });

    return {
      owned: s.owned,
      throttle: s.throttle,
      stocks: s.stocks,
      caps: caps(),
      actM, yieldM, thriftM,
      broodYield: D.TUNING.broodYield,
    };
  }

  /** Gross output rate per resource right now, used to size demands. */
  function outputRates() {
    const r = last || CHAIN.resolve(D, context(), 0.05);
    return r.produced;
  }

  const bps = () => (last ? last.bugsRate : 0);

  /**
   * What one building type is actually moving right now, after throttle,
   * multipliers and starvation. The UI shows these on the building card.
   */
  function buildingRates(id) {
    const b = BUILDING[id];
    const ctx = context();
    const th = s.throttle[id] === undefined ? 1 : s.throttle[id];
    const a = (s.owned[id] || 0) * th * ctx.actM[id];
    const e = last ? (last.eff[id] || 0) : 0;
    const ins = {}, outs = {};
    for (const res in b.inputs) ins[res] = a * b.inputs[res] * ctx.thriftM[id] * e;
    for (const res in b.outputs) outs[res] = a * b.outputs[res] * ctx.yieldM[id] * e;
    return {
      ins, outs, eff: e, act: a,
      bugs: b.brood ? a * D.TUNING.broodYield * ctx.yieldM[id] * e : 0,
    };
  }

  /** What a single extra unit would add, at full supply. Used in tooltips. */
  function unitRates(id) {
    const b = BUILDING[id];
    const ctx = context();
    const ins = {}, outs = {};
    for (const res in b.inputs) ins[res] = b.inputs[res] * ctx.actM[id] * ctx.thriftM[id];
    for (const res in b.outputs) outs[res] = b.outputs[res] * ctx.actM[id] * ctx.yieldM[id];
    return {
      ins, outs,
      bugs: b.brood ? D.TUNING.broodYield * ctx.actM[id] * ctx.yieldM[id] : 0,
    };
  }

  /** Which of a building's inputs are the ones holding it back. */
  function blockers(id) {
    if (!last) return [];
    return CHAIN.blockers(D, BUILDING[id], last);
  }

  /* ================================================================== *
   * costs and buying
   * ================================================================== */

  /**
   * Bug costs climb steeply, and that is the brake on the whole game. The
   * resource part of a cost is a stockpile gate rather than a brake, so it
   * climbs gently AND is clamped to half of what the silo can currently hold.
   * Without that clamp a late building eventually asks for more of a resource
   * than can physically be stored, and quietly becomes unbuyable.
   */
  function buildingCost(id, qty) {
    const b = BUILDING[id];
    const k = s.owned[id];
    const c = caps();
    const out = {};
    for (const res in b.cost) out[res] = 0;
    for (let i = 0; i < qty; i++) {
      const bugF = Math.pow(D.COST_GROWTH, k + i);
      const resF = Math.pow(D.RESOURCE_COST_GROWTH, k + i);
      for (const res in b.cost) {
        if (res === 'bugs') {
          out.bugs += Math.ceil(b.cost.bugs * bugF);
        } else {
          const ceiling = Math.floor(c[res] * 0.5);
          out[res] += Math.min(ceiling, Math.ceil(b.cost[res] * resF));
        }
      }
    }
    return out;
  }

  /**
   * Resources in a cost that simply will not fit in the silo you have. The UI
   * uses this to say "your store is too small" instead of "you cannot afford".
   */
  function capBlocked(cost) {
    const c = caps();
    const out = [];
    for (const res in cost) {
      if (res === 'bugs') continue;
      if (cost[res] > c[res]) out.push(res);
    }
    return out;
  }

  function canPay(cost) {
    for (const res in cost) {
      const have = res === 'bugs' ? s.bugs : s.stocks[res];
      if (have < cost[res]) return false;
    }
    return true;
  }

  function pay(cost) {
    for (const res in cost) {
      if (res === 'bugs') { s.bugs -= cost[res]; s.spent += cost[res]; }
      else s.stocks[res] -= cost[res];
    }
  }

  function buildingMax(id) {
    let n = 0;
    while (n < 500 && canPay(buildingCost(id, n + 1))) n++;
    return n;
  }

  function wantQty(id) {
    const q = s.settings.buyQty;
    return q === 'max' ? Math.max(1, buildingMax(id)) : q;
  }

  function buildingUnlocked(id) {
    const b = BUILDING[id];
    if (s.owned[id] > 0) return true;
    if (b.index <= 1) return true;
    // it shows up once you could plausibly be thinking about it
    return s.lifetime >= b.cost.bugs * 0.5;
  }

  function buyBuilding(id, qty) {
    if (!buildingUnlocked(id)) return 0;
    const n = qty === undefined ? wantQty(id) : qty;
    if (n < 1) return 0;
    const cost = buildingCost(id, n);
    if (!canPay(cost)) return 0;
    pay(cost);
    s.owned[id] += n;
    emit('built', { id, qty: n });
    return n;
  }

  function setThrottle(id, v) {
    s.throttle[id] = clamp(v, 0, 1);
    emit('throttle', { id, v: s.throttle[id] });
  }

  function upgradeVisible(u) {
    if (s.upgrades[u.id]) return false;
    if (u.req.lifetime !== undefined) return s.lifetime >= u.req.lifetime;
    if (u.req.building !== undefined) return s.owned[u.req.building] >= u.req.owned;
    return true;
  }

  const availableUpgrades = () =>
    D.UPGRADES.filter(upgradeVisible).sort((a, b) => (a.cost.bugs || 0) - (b.cost.bugs || 0));

  function buyUpgrade(id) {
    const u = UPGRADE[id];
    if (!u || s.upgrades[id] || !upgradeVisible(u) || !canPay(u.cost)) return false;
    pay(u.cost);
    s.upgrades[id] = true;
    emit('upgrade', u);
    return true;
  }

  const monumentVisible = (id) =>
    s.monuments[id] || s.lifetime >= MONUMENT[id].cost.bugs * 0.3;

  function buyMonument(id) {
    const m = MONUMENT[id];
    if (!m || s.monuments[id] || !canPay(m.cost)) return false;
    pay(m.cost);
    s.monuments[id] = true;
    emit('monument', m);
    return true;
  }

  /* ================================================================== *
   * foraging - the click
   * ================================================================== */

  function forageValue() {
    const u = upgradeSets();
    const boon = boonFlags();
    // Hand gathering scales with the log so it never stops being useful, but a
    // click is worth a few seconds of output, not a firehose. The silo cap
    // limits it further, which is what stops click-spam being a strategy.
    const rate = outputRates()[s.forageTarget] || 0;
    return (1.5 + rate * 0.5) * u.forage * boon.raw;
  }

  function forage() {
    const res = s.forageTarget;
    const cap = caps()[res];
    const gain = forageValue();
    const before = s.stocks[res];
    s.stocks[res] = Math.min(cap, before + gain);
    s.forages++;
    s.foraged += s.stocks[res] - before;
    return { res, gain: s.stocks[res] - before, full: s.stocks[res] >= cap };
  }

  function setForageTarget(res) {
    if (D.RAW.indexOf(res) >= 0) s.forageTarget = res;
  }

  /* ================================================================== *
   * the Queen's demands
   * ================================================================== */

  const demandSlots = () => (s.monuments.mantisTemple ? 2 : 1);
  const streakMult = () =>
    Math.min(D.TUNING.streakMax, 1 + s.streak * D.TUNING.streakStep);

  function makeDemand() {
    const rates = outputRates();
    const u = upgradeSets();

    const pool = D.RESOURCES.filter(function (r) {
      if (D.RAW.indexOf(r.id) >= 0) return true;          // always forageable
      return (rates[r.id] || 0) > 0.03;
    });
    if (!pool.length) return null;

    // ask for more kinds of thing as the operation grows
    const reach = pool.length;
    const count = clamp(1 + Math.floor(Math.random() * Math.min(reach, 3)), 1, 3);

    const chosen = [];
    const bag = pool.slice();
    for (let i = 0; i < count && bag.length; i++) {
      // weight toward the deeper resources, which are the interesting asks
      const weights = bag.map((r) => 1 + r.tier * 0.9);
      let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
      let idx = 0;
      for (; idx < bag.length; idx++) { roll -= weights[idx]; if (roll <= 0) break; }
      chosen.push(bag.splice(Math.min(idx, bag.length - 1), 1)[0]);
    }

    const need = {};
    let value = 0;
    chosen.forEach(function (r) {
      const raw = D.RAW.indexOf(r.id) >= 0;
      const rate = Math.max(rates[r.id] || 0, raw ? 0.6 : 0.05);
      const qty = Math.max(raw ? 12 : 5,
        Math.ceil(rate * D.TUNING.demandCover * rnd(0.65, 1.25) / count));
      need[r.id] = qty;
      value += qty * r.value;
    });

    const hive = s.monuments.hiveSingularity ? 1.25 : 1;
    const window = D.TUNING.demandWindow * (s.monuments.hiveSingularity ? 1.5 : 1);
    const reward = Math.ceil(value * D.TUNING.demandPay * u.queen * streakMult() * hive);

    return {
      id: 'd' + (demandSeq++),
      need,
      given: Object.fromEntries(Object.keys(need).map((k) => [k, 0])),
      reward,
      window,
      expiresAt: nowMs() + window * 1000,
    };
  }

  function spawnDemand() {
    if (s.demands.length >= demandSlots()) return;
    const d = makeDemand();
    if (!d) return;
    s.demands.push(d);
    emit('demandNew', d);
  }

  const demandRemaining = (d) => {
    const out = {};
    for (const res in d.need) out[res] = Math.max(0, d.need[res] - d.given[res]);
    return out;
  };

  const demandComplete = (d) => {
    for (const res in d.need) if (d.given[res] < d.need[res]) return false;
    return true;
  };

  /** Push whatever is in the silos into a demand. Partial deliveries count. */
  function deliver(id) {
    const d = s.demands.find((x) => x.id === id);
    if (!d) return null;

    let moved = 0;
    for (const res in d.need) {
      const want = d.need[res] - d.given[res];
      if (want <= 0) continue;
      const take = Math.min(want, s.stocks[res]);
      if (take <= 0) continue;
      s.stocks[res] -= take;
      d.given[res] += take;
      moved += take;
    }

    if (!demandComplete(d)) {
      if (moved > 0) emit('demandPartial', { demand: d, moved });
      return { done: false, moved };
    }

    s.demands = s.demands.filter((x) => x.id !== d.id);
    s.bugs += d.reward;
    s.lifetime += d.reward;
    s.demandBugs += d.reward;
    s.demandsFilled++;
    s.streak++;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    emit('demandDone', { demand: d, reward: d.reward, streak: s.streak });
    return { done: true, reward: d.reward, moved };
  }

  function expireDemands() {
    const t = nowMs();
    const gone = s.demands.filter((d) => d.expiresAt <= t);
    if (!gone.length) return;
    s.demands = s.demands.filter((d) => d.expiresAt > t);
    gone.forEach(function (d) {
      s.demandsMissed++;
      s.streak = 0;
      emit('demandMissed', d);
    });
  }

  /* ================================================================== *
   * visitors and weather
   * ================================================================== */

  function rollBoon() {
    const total = D.BOONS.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * total;
    for (const b of D.BOONS) { r -= b.weight; if (r <= 0) return b; }
    return D.BOONS[0];
  }

  function grantCache(scale) {
    const rates = outputRates();
    const c = caps();
    const given = {};
    D.RESOURCES.forEach(function (r) {
      const amount = Math.max(r.tier === 0 ? 25 : 8, (rates[r.id] || 0) * scale);
      const before = s.stocks[r.id];
      s.stocks[r.id] = Math.min(c[r.id], before + amount);
      const got = s.stocks[r.id] - before;
      if (got > 0.5) given[r.id] = got;
    });
    return given;
  }

  function catchHoney() {
    s.goldens++;
    const boon = rollBoon();
    const out = { boon };
    if (boon.cache) {
      out.given = grantCache(45);
    } else if (boon.tribute) {
      const gift = Math.max(bps() * 70, s.bugs * 0.06, 40);
      s.bugs += gift; s.lifetime += gift;
      out.gift = gift;
    } else {
      s.boons.push({
        id: boon.id, name: boon.name, raw: boon.raw, all: boon.all,
        endsAt: nowMs() + boon.seconds * 1000,
      });
    }
    emit('boon', out);
    return out;
  }

  function catchMoth() {
    s.moths++;
    const given = grantCache(30);
    emit('moth', { given });
    return given;
  }

  function swatWasp() {
    s.waspsSwatted++;
    const given = grantCache(22);
    const gift = Math.max(bps() * 12, 25);
    s.bugs += gift; s.lifetime += gift;
    emit('wasp', { swatted: true, given, gift });
    return { given, gift };
  }

  function waspEscaped() {
    if (s.monuments.mantisTemple) {
      const given = grantCache(14);
      emit('wasp', { swatted: false, warded: true, given });
      return { warded: true, given };
    }
    s.waspsMissed++;
    // a wasp takes from the fullest silo, which is the one you could spare least
    let worst = null;
    D.RESOURCES.forEach(function (r) {
      if (!worst || s.stocks[r.id] > s.stocks[worst.id]) worst = r;
    });
    const taken = worst ? s.stocks[worst.id] * 0.35 : 0;
    if (worst) s.stocks[worst.id] -= taken;
    s.stolen += taken;
    s.streak = Math.max(0, s.streak - 1);
    emit('wasp', { swatted: false, res: worst && worst.id, taken });
    return { res: worst && worst.id, taken };
  }

  function rollWeather() {
    const usable = D.WEATHER.filter((w) => (s.owned[w.building] || 0) > 0);
    if (!usable.length) return;
    const w = usable[Math.floor(Math.random() * usable.length)];
    s.weather = {
      id: w.id, name: w.name, desc: w.desc, good: w.good,
      building: w.building, mult: w.mult,
      endsAt: nowMs() + w.seconds * 1000,
    };
    emit('weather', s.weather);
  }

  /* ================================================================== *
   * awards
   * ================================================================== */

  function snapshot() {
    let allFull = false;
    if (last) {
      const owned = D.BUILDINGS.filter((b) => s.owned[b.id] > 0);
      allFull = owned.length >= 4 && owned.every((b) => (last.eff[b.id] || 0) >= 0.995);
    }
    return {
      lifetime: s.lifetime, bugs: s.bugs, owned: s.owned, monuments: s.monuments,
      filled: s.filled, goldens: s.goldens, wasps: s.waspsSwatted, moths: s.moths,
      demandsFilled: s.demandsFilled, bestStreak: s.bestStreak,
      upgradeCount: Object.keys(s.upgrades).length,
      bps: bps(), allFull,
    };
  }

  function checkAwards() {
    const snap = snapshot();
    for (const a of D.ACHIEVEMENTS) {
      if (!s.awards[a.id] && a.test(snap)) {
        s.awards[a.id] = true;
        emit('award', a);
      }
    }
  }

  /* ================================================================== *
   * the tick
   * ================================================================== */

  let awardClock = 0;

  function tick(dt) {
    if (!s) return;
    dt = Math.max(0, Math.min(dt, 1));

    if (s.boons.length) {
      const t = nowMs();
      const n = s.boons.length;
      s.boons = s.boons.filter((b) => b.endsAt > t);
      if (s.boons.length !== n) emit('boonsChanged');
    }
    if (s.weather && nowMs() >= s.weather.endsAt) {
      emit('weatherEnd', s.weather);
      s.weather = null;
    }

    // resolve the chain
    const ctx = context();
    const r = CHAIN.resolve(D, ctx, dt);
    last = r;
    s.stocks = r.stocks;

    const c = ctx.caps;
    D.RESOURCES.forEach(function (res) {
      if (r.overflow[res.id] > 0) s.wasted += r.overflow[res.id];
      if (!s.filled[res.id] && s.stocks[res.id] >= c[res.id] - 0.01) {
        s.filled[res.id] = true;
      }
    });

    if (r.bugs > 0) {
      s.bugs += r.bugs;
      s.lifetime += r.bugs;
      s.broodBugs += r.bugs;
    }
    if (r.bugsRate > s.bestBps) s.bestBps = r.bugsRate;

    // demands
    expireDemands();
    s.nextDemandIn -= dt;
    if (s.nextDemandIn <= 0) {
      s.nextDemandIn = pickIn(D.TUNING.demandEvery);
      spawnDemand();
    }

    // visitors
    s.honeyIn -= dt;
    if (s.honeyIn <= 0) {
      s.honeyIn = pickIn(HONEY_EVERY) * (s.monuments.cicadaChorus ? 0.55 : 1);
      emit('honeySpawn');
    }
    s.waspIn -= dt;
    if (s.waspIn <= 0) { s.waspIn = pickIn(WASP_EVERY); emit('waspSpawn'); }
    s.mothIn -= dt;
    if (s.mothIn <= 0) { s.mothIn = pickIn(MOTH_EVERY); emit('mothSpawn'); }

    s.weatherIn -= dt;
    if (s.weatherIn <= 0) {
      s.weatherIn = pickIn(WEATHER_EVERY);
      if (!s.weather) rollWeather();
    }

    // goal
    const frac = s.bugs / D.GOAL;
    [0.1, 0.25, 0.5, 0.75, 0.9].forEach(function (m) {
      if (frac >= m && !s.milestones[m]) { s.milestones[m] = true; emit('milestone', m); }
    });
    if (!s.won && s.bugs >= D.GOAL) {
      s.won = true;
      s.wonAt = nowMs();
      emit('victory', stats());
    }

    awardClock += dt;
    if (awardClock >= 0.25) { awardClock = 0; checkAwards(); }

    s.playedMs += dt * 1000;
    s.lastSeen = nowMs();
  }

  /* ================================================================== *
   * stats and persistence
   * ================================================================== */

  function stats() {
    return {
      bugs: s.bugs, lifetime: s.lifetime, spent: s.spent,
      bps: bps(), bestBps: s.bestBps,
      broodBugs: s.broodBugs, demandBugs: s.demandBugs,
      forages: s.forages, foraged: s.foraged,
      demandsFilled: s.demandsFilled, demandsMissed: s.demandsMissed,
      streak: s.streak, bestStreak: s.bestStreak, streakMult: streakMult(),
      goldens: s.goldens, waspsSwatted: s.waspsSwatted, waspsMissed: s.waspsMissed,
      moths: s.moths, stolen: s.stolen, wasted: s.wasted,
      awards: Object.keys(s.awards).length, awardTotal: D.ACHIEVEMENTS.length,
      upgrades: Object.keys(s.upgrades).length, upgradeTotal: D.UPGRADES.length,
      monuments: Object.keys(s.monuments).length,
      buildings: D.BUILDINGS.reduce((a, b) => a + s.owned[b.id], 0),
      played: s.playedMs / 1000,
      won: s.won, wonAt: s.wonAt,
    };
  }

  const crawlerCount = () => {
    const total = D.BUILDINGS.reduce((a, b) => a + s.owned[b.id], 0);
    return Math.min(44, 6 + Math.floor(Math.sqrt(total) * 2.7));
  };

  function save() {
    try {
      s.lastSeen = nowMs();
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      return true;
    } catch (e) { return false; }
  }

  function migrate(raw) {
    const base = freshState();
    const out = Object.assign(base, raw);
    out.settings = Object.assign(base.settings, raw.settings || {});
    D.BUILDINGS.forEach((b) => {
      if (typeof out.owned[b.id] !== 'number') out.owned[b.id] = 0;
      if (typeof out.throttle[b.id] !== 'number') out.throttle[b.id] = 1;
    });
    D.RESOURCES.forEach((r) => {
      if (typeof out.stocks[r.id] !== 'number') out.stocks[r.id] = 0;
    });
    ['upgrades', 'monuments', 'awards', 'filled'].forEach((k) => { out[k] = out[k] || {}; });
    Object.keys(out.upgrades).forEach((k) => { if (!UPGRADE[k]) delete out.upgrades[k]; });
    Object.keys(out.monuments).forEach((k) => { if (!MONUMENT[k]) delete out.monuments[k]; });
    out.boons = Array.isArray(out.boons) ? out.boons.filter((b) => b && b.endsAt > nowMs()) : [];
    out.demands = Array.isArray(out.demands) ? out.demands.filter((d) => d && d.need) : [];
    if (out.weather && out.weather.endsAt <= nowMs()) out.weather = null;
    if (D.RAW.indexOf(out.forageTarget) < 0) out.forageTarget = 'sap';
    return out;
  }

  function load() {
    let raw = null;
    try {
      const txt = localStorage.getItem(SAVE_KEY);
      if (txt) raw = JSON.parse(txt);
    } catch (e) { raw = null; }

    if (!raw) { s = freshState(); last = CHAIN.resolve(D, context(), 0.05); return null; }
    s = migrate(raw);
    last = CHAIN.resolve(D, context(), 0.05);

    const away = Math.max(0, (nowMs() - (raw.lastSeen || nowMs())) / 1000);
    if (away < 60) return null;
    return runAway(away);
  }

  /**
   * Catch-up for time the tab was not running. The chain is stepped forward
   * for real rather than approximated, because a static rate would ignore the
   * silos filling up and going to waste.
   */
  function runAway(seconds) {
    const paid = Math.min(seconds, OFFLINE_CAP);
    if (paid < 60) return null;
    const before = s.bugs;
    const step = 2;
    const ctx = context();
    for (let t = 0; t < paid; t += step) {
      const r = CHAIN.resolve(D, ctx, step);
      ctx.stocks = r.stocks;
      s.bugs += r.bugs * OFFLINE_RATE;
      s.lifetime += r.bugs * OFFLINE_RATE;
      s.broodBugs += r.bugs * OFFLINE_RATE;
    }
    s.stocks = ctx.stocks;
    const gain = s.bugs - before;
    if (gain <= 0) return null;
    // demands do not fill themselves, and the streak is long cold
    s.streak = 0;
    return { away: seconds, seconds: paid, gain };
  }

  function wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    s = freshState();
    last = CHAIN.resolve(D, context(), 0.05);
  }

  const exportSave = () => {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); }
    catch (e) { return ''; }
  };

  function importSave(text) {
    try {
      const raw = JSON.parse(decodeURIComponent(escape(atob(String(text).trim()))));
      if (!raw || typeof raw.bugs !== 'number') return false;
      s = migrate(raw);
      last = CHAIN.resolve(D, context(), 0.05);
      save();
      return true;
    } catch (e) { return false; }
  }

  root.BUGS_GAME = {
    on, emit,
    load, save, wipe, exportSave, importSave, runAway,
    tick, forage, setForageTarget, forageValue,
    buyBuilding, buildingCost, buildingMax, wantQty, buildingUnlocked, setThrottle,
    buyUpgrade, upgradeVisible, availableUpgrades,
    buyMonument, monumentVisible,
    deliver, demandRemaining, demandComplete, demandSlots, streakMult,
    catchHoney, catchMoth, swatWasp, waspEscaped,
    caps, context, outputRates, bps, stats, crawlerCount, checkAwards, canPay, capBlocked,
    buildingRates, unitRates, blockers,
    get chain() { return last; },
    get state() { return s; },
    get GOAL() { return D.GOAL; },
  };
})(typeof self !== 'undefined' ? self : this);
