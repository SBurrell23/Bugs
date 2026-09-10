/* ==========================================================================
   game.js - state, economy and rules. Knows nothing about the DOM.

   Bugs are labour. They are never spent, only employed, so the population
   counter only ever climbs. Everything is bought with resources, which is
   what the crews produce.

   The two things that grow the population:
     - Brood Chambers, which hatch bugs as long as they are crewed and fed
     - the Queen's orders, which have to be filled by hand
   Neither runs itself, which is what stops the game playing itself while you
   are away from the keyboard.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.BUGS_DATA;
  const CHAIN = root.BUGS_CHAIN;
  const SAVE_KEY = 'bugs.save.v4';

  const OFFLINE_CAP = 15 * 60;   // this is not an idle game; catch-up is small
  const OFFLINE_RATE = 0.4;

  const HONEY_EVERY = [70, 140];
  const WASP_EVERY = [150, 260];
  const MOTH_EVERY = [190, 330];
  const WEATHER_EVERY = [95, 170];

  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const BUILDING = byId(D.BUILDINGS);
  const MONUMENT = byId(D.MONUMENTS);
  const UPGRADE = byId(D.UPGRADES);
  const RESOURCE = byId(D.RESOURCES);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pickIn = (pair) => rnd(pair[0], pair[1]);
  const nowMs = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const handlers = {};
  const on = (n, fn) => (handlers[n] = handlers[n] || []).push(fn);
  const emit = (n, p) => (handlers[n] || []).forEach((fn) => fn(p));

  let s = null;
  let last = null;
  let demandSeq = 1;

  function freshState() {
    const owned = {}, assigned = {}, stocks = {}, filled = {};
    D.BUILDINGS.forEach((b) => { owned[b.id] = 0; assigned[b.id] = 0; });
    D.RESOURCES.forEach((r) => { stocks[r.id] = 0; filled[r.id] = false; });
    return {
      v: 4,
      bugs: D.STARTING_BUGS,
      lifetime: D.STARTING_BUGS,
      forages: 0,
      foraged: 0,
      forageTarget: 'leaf',
      owned, assigned, stocks, filled,
      upgrades: {}, monuments: {}, awards: {},
      demands: [],
      demandsFilled: 0, demandsMissed: 0,
      demandBugs: 0, broodBugs: 0, titheBugs: 0, tithes: 0,
      streak: 0, bestStreak: 0,
      nextDemandIn: 14,
      weather: null,
      boons: [],
      goldens: 0, waspsSwatted: 0, waspsMissed: 0, moths: 0, stolen: 0, wasted: 0,
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
    const yieldM = {}, thriftM = {}, handsM = {}, capM = {};
    let global = 1, forage = 1, queen = 1;
    D.BUILDINGS.forEach((b) => { yieldM[b.id] = 1; thriftM[b.id] = 1; handsM[b.id] = 1; });
    D.RESOURCES.forEach((r) => { capM[r.id] = 1; });

    for (const id in s.upgrades) {
      const u = UPGRADE[id];
      if (!u) continue;
      if (u.kind === 'yield') yieldM[u.target] *= u.mult;
      else if (u.kind === 'thrift') thriftM[u.target] *= (1 - u.save);
      else if (u.kind === 'hands') handsM[u.target] *= (1 - u.save);
      else if (u.kind === 'cap') capM[u.target] *= u.mult;
      else if (u.kind === 'global') global *= u.mult;
      else if (u.kind === 'forage') forage *= u.mult;
      else if (u.kind === 'queen') queen *= u.mult;
    }
    return { yieldM, thriftM, handsM, capM, global, forage, queen };
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

  /* ================================================================== *
   * crews - the heart of it
   * ================================================================== */

  /**
   * Bugs needed to fully crew every one of a building you own. Each extra
   * building needs crewGrowth times as much crew as the one before it, the
   * same way its resource cost climbs, so labour stays scarce as you scale.
   */
  function crewNeeded(id) {
    const n = s.owned[id] || 0;
    if (n <= 0) return 0;
    const b = BUILDING[id];
    const g = D.CREW_GROWTH;
    const raw = b.stage === 0 && s.monuments.cicadaChorus ? 0.67 : 1;
    const total = b.crew * (Math.pow(g, n) - 1) / (g - 1);
    return Math.max(1, Math.ceil(total * upgradeSets().handsM[id] * raw));
  }

  /** 0..1 - the share of its crew a building actually has. */
  function staffing(id) {
    const need = crewNeeded(id);
    if (need <= 0) return 0;
    return clamp((s.assigned[id] || 0) / need, 0, 1);
  }

  const totalAssigned = () =>
    D.BUILDINGS.reduce((a, b) => a + (s.assigned[b.id] || 0), 0);

  const idleBugs = () => Math.max(0, Math.floor(s.bugs) - totalAssigned());

  /** Move bugs on or off a job. Returns how many actually moved. */
  function assign(id, delta) {
    if (!BUILDING[id]) return 0;
    const have = s.assigned[id] || 0;
    let want = delta;
    if (want > 0) {
      want = Math.min(want, idleBugs(), Math.max(0, crewNeeded(id) - have));
    } else {
      want = -Math.min(-want, have);
    }
    if (!want) return 0;
    s.assigned[id] = have + want;
    emit('assigned', { id, delta: want });
    return want;
  }

  function setAssign(id, n) {
    return assign(id, Math.round(n) - (s.assigned[id] || 0));
  }

  /**
   * Spread every idle bug across the jobs that still want crew, in proportion
   * to how short each one is. Convenience, not a strategy: it fills gaps
   * evenly rather than cleverly.
   */
  function autoStaff() {
    let moved = 0;
    for (let pass = 0; pass < 4; pass++) {
      const gaps = D.BUILDINGS
        .map((b) => ({ id: b.id, gap: Math.max(0, crewNeeded(b.id) - (s.assigned[b.id] || 0)) }))
        .filter((x) => x.gap > 0);
      const totalGap = gaps.reduce((a, x) => a + x.gap, 0);
      const spare = idleBugs();
      if (!totalGap || spare <= 0) break;
      for (const x of gaps) {
        const share = Math.floor(spare * (x.gap / totalGap));
        moved += assign(x.id, Math.max(share > 0 ? share : 0, 0));
      }
      // hand out any remainder one at a time
      for (const x of gaps) {
        if (idleBugs() <= 0) break;
        moved += assign(x.id, 1);
      }
    }
    if (moved) emit('autoStaff', moved);
    return moved;
  }

  /** Pull every bug off every job. */
  function recallAll() {
    let moved = 0;
    D.BUILDINGS.forEach((b) => { moved += -assign(b.id, -(s.assigned[b.id] || 0)); });
    emit('recall', moved);
    return moved;
  }

  /** Assignments can exceed need after a building is sold or a perk lands. */
  function trimAssignments() {
    D.BUILDINGS.forEach(function (b) {
      const need = crewNeeded(b.id);
      if ((s.assigned[b.id] || 0) > need) s.assigned[b.id] = need;
    });
    const over = totalAssigned() - Math.floor(s.bugs);
    if (over > 0) {
      let left = over;
      for (const b of D.BUILDINGS) {
        if (left <= 0) break;
        const take = Math.min(left, s.assigned[b.id] || 0);
        s.assigned[b.id] -= take;
        left -= take;
      }
    }
  }

  /* ================================================================== *
   * chain context
   * ================================================================== */

  function context() {
    const u = upgradeSets();
    const boon = boonFlags();
    const hive = s.monuments.hiveSingularity ? MONUMENT.hiveSingularity.mult : 1;

    const actM = {}, yieldM = {}, thriftM = {}, staff = {};
    D.BUILDINGS.forEach((b) => {
      actM[b.id] = boon.all;
      let y = u.yieldM[b.id] * u.global * hive;
      if (b.stage === 0) y *= boon.raw;
      if (s.weather && s.weather.building === b.id) y *= s.weather.mult;
      yieldM[b.id] = y;
      thriftM[b.id] = u.thriftM[b.id];
      staff[b.id] = staffing(b.id);
    });

    return {
      owned: s.owned,
      staff,
      stocks: s.stocks,
      caps: caps(),
      actM, yieldM, thriftM,
      broodYield: D.TUNING.broodYield,
    };
  }

  const outputRates = () => (last || CHAIN.resolve(D, context(), 0.05)).produced;
  const bps = () => (last ? last.bugsRate : 0);

  function buildingRates(id) {
    const b = BUILDING[id];
    const ctx = context();
    const a = (s.owned[id] || 0) * ctx.staff[id] * ctx.actM[id];
    const e = last ? (last.eff[id] || 0) : 0;
    const ins = {}, outs = {};
    for (const res in b.inputs) ins[res] = a * b.inputs[res] * ctx.thriftM[id] * e;
    for (const res in b.outputs) outs[res] = a * b.outputs[res] * ctx.yieldM[id] * e;
    return {
      ins, outs, eff: e, act: a,
      bugs: b.brood ? a * D.TUNING.broodYield * ctx.yieldM[id] * e : 0,
    };
  }

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

  const blockers = (id) => (last ? CHAIN.blockers(D, BUILDING[id], last) : []);

  /* ================================================================== *
   * costs - resources only, because bugs are never spent
   * ================================================================== */

  function buildingCost(id, qty) {
    const b = BUILDING[id];
    const k = s.owned[id];
    const c = caps();
    const out = {};
    for (const res in b.cost) out[res] = 0;
    for (let i = 0; i < qty; i++) {
      const f = Math.pow(D.COST_GROWTH, k + i);
      for (const res in b.cost) {
        out[res] += Math.min(Math.floor(c[res] * 0.75), Math.ceil(b.cost[res] * f));
      }
    }
    return out;
  }

  function canPay(cost) {
    for (const res in cost) if ((s.stocks[res] || 0) < cost[res]) return false;
    return true;
  }

  function pay(cost) {
    for (const res in cost) s.stocks[res] -= cost[res];
  }

  function capBlocked(cost) {
    const c = caps();
    const out = [];
    for (const res in cost) if (cost[res] > c[res]) out.push(res);
    return out;
  }

  function buildingMax(id) {
    let n = 0;
    while (n < 200 && canPay(buildingCost(id, n + 1))) n++;
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
    const prev = D.BUILDINGS[b.index - 1];
    return s.owned[prev.id] > 0;
  }

  function buyBuilding(id, qty) {
    if (!buildingUnlocked(id)) return 0;
    const n = qty === undefined ? wantQty(id) : qty;
    if (n < 1) return 0;
    const cost = buildingCost(id, n);
    if (!canPay(cost)) return 0;
    pay(cost);
    s.owned[id] += n;
    // a new building starts unstaffed; the player decides who moves
    emit('built', { id, qty: n });
    return n;
  }

  function upgradeVisible(u) {
    if (s.upgrades[u.id]) return false;
    if (u.req.lifetime !== undefined) return s.lifetime >= u.req.lifetime;
    if (u.req.building !== undefined) return s.owned[u.req.building] >= u.req.owned;
    return true;
  }

  const availableUpgrades = () => D.UPGRADES.filter(upgradeVisible)
    .sort((a, b) => valueOf(a.cost) - valueOf(b.cost));

  const valueOf = (cost) => {
    let v = 0;
    for (const r in cost) v += cost[r] * (RESOURCE[r] ? RESOURCE[r].value : 1);
    return v;
  };

  function buyUpgrade(id) {
    const u = UPGRADE[id];
    if (!u || s.upgrades[id] || !upgradeVisible(u) || !canPay(u.cost)) return false;
    pay(u.cost);
    s.upgrades[id] = true;
    trimAssignments();
    emit('upgrade', u);
    return true;
  }

  const monumentVisible = (id) =>
    s.monuments[id] || s.lifetime >= (id === 'mantisTemple' ? 3000 : id === 'cicadaChorus' ? 40000 : 200000);

  function buyMonument(id) {
    const m = MONUMENT[id];
    if (!m || s.monuments[id] || !canPay(m.cost)) return false;
    pay(m.cost);
    s.monuments[id] = true;
    trimAssignments();
    emit('monument', m);
    return true;
  }

  /* ================================================================== *
   * foraging
   * ================================================================== */

  function forageValue() {
    const u = upgradeSets();
    const boon = boonFlags();
    const rate = outputRates()[s.forageTarget] || 0;
    return (1.5 + rate * 0.5) * u.forage * boon.raw;
  }

  function forage() {
    const res = s.forageTarget;
    const cap = caps()[res];
    const before = s.stocks[res];
    s.stocks[res] = Math.min(cap, before + forageValue());
    s.forages++;
    const got = s.stocks[res] - before;
    s.foraged += got;
    return { res, gain: got, full: s.stocks[res] >= cap - 0.01 };
  }

  const setForageTarget = (res) => { if (D.RAW.indexOf(res) >= 0) s.forageTarget = res; };

  /* ================================================================== *
   * the Queen
   * ================================================================== */

  const demandSlots = () => D.TUNING.demandSlots + (s.monuments.mantisTemple ? 1 : 0);
  const streakMult = () => Math.min(D.TUNING.streakMax, 1 + s.streak * D.TUNING.streakStep);

  function gainBugs(n, bucket) {
    if (!(n > 0)) return 0;
    s.bugs += n;
    s.lifetime = s.bugs;
    if (bucket) s[bucket] += n;
    return n;
  }

  function makeDemand() {
    const rates = outputRates();
    const u = upgradeSets();
    const c = caps();

    const pool = D.RESOURCES.filter((r) =>
      D.RAW.indexOf(r.id) >= 0 || (rates[r.id] || 0) > 0.03);
    if (!pool.length) return null;

    const count = clamp(1 + Math.floor(Math.random() * Math.min(pool.length, 3)), 1, 3);
    const chosen = [];
    const bag = pool.slice();
    for (let i = 0; i < count && bag.length; i++) {
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
      // Sized on flow OR on storage, whichever is larger, then capped to what a
      // silo can actually hold. An order you cannot physically hold reads as
      // impossible, and reading as impossible is the same as being impossible.
      const byFlow = rate * D.TUNING.demandCover;
      const byStore = c[r.id] * D.TUNING.demandStore;
      const qty = Math.max(raw ? 20 : 8, Math.min(
        Math.floor(c[r.id] * 0.85),
        Math.ceil(Math.max(byFlow, byStore) * rnd(0.75, 1.15) / count)));
      need[r.id] = qty;
      // Sub-linear in quantity. Orders are sized against your output, so a
      // player who spams the cheapest producer would otherwise inflate their
      // own payouts; this makes doubling a pile pay well short of double.
      value += Math.pow(qty, 0.85) * r.value;
    });

    const hive = s.monuments.hiveSingularity ? 1.25 : 1;
    const window = D.TUNING.demandWindow * (s.monuments.hiveSingularity ? 1.5 : 1);
    return {
      id: 'd' + (demandSeq++),
      need,
      given: Object.fromEntries(Object.keys(need).map((k) => [k, 0])),
      reward: Math.ceil(value * D.TUNING.demandPay * u.queen * streakMult() * hive),
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

  function demandRemaining(d) {
    const out = {};
    for (const res in d.need) out[res] = Math.max(0, d.need[res] - d.given[res]);
    return out;
  }

  const demandComplete = (d) => {
    for (const res in d.need) if (d.given[res] < d.need[res]) return false;
    return true;
  };

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
    gainBugs(d.reward, 'demandBugs');
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

  /**
   * Sell surplus to the Queen at a poor rate. Deliberately much worse than
   * filling an order, so it is a valve rather than a strategy, but it means a
   * brimming silo is never a dead end.
   */
  function titheValue(id) {
    const r = RESOURCE[id];
    const amount = Math.min(s.stocks[id], caps()[id] * D.TUNING.titheShare);
    return {
      amount,
      bugs: Math.floor(Math.pow(amount, 0.85) * r.value * D.TUNING.tithePay * upgradeSets().queen),
    };
  }

  function tithe(id) {
    if (!RESOURCE[id]) return null;
    const t = titheValue(id);
    if (t.amount <= 0.5 || t.bugs <= 0) return null;
    s.stocks[id] -= t.amount;
    gainBugs(t.bugs, 'titheBugs');
    s.tithes++;
    emit('tithe', { res: id, amount: t.amount, bugs: t.bugs });
    return t;
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
      const amount = Math.max(r.tier === 0 ? 30 : 10, (rates[r.id] || 0) * scale);
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
    if (boon.cache) out.given = grantCache(45);
    else if (boon.tribute) out.gift = gainBugs(Math.max(bps() * 70, s.bugs * 0.05, 25), 'demandBugs');
    else {
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
    const gift = gainBugs(Math.max(bps() * 10, 15), 'demandBugs');
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
    const ownedList = D.BUILDINGS.filter((b) => s.owned[b.id] > 0);
    const allFull = last && ownedList.length >= 4 &&
      ownedList.every((b) => (last.eff[b.id] || 0) >= 0.995);
    const allCrewed = ownedList.length >= 4 &&
      ownedList.every((b) => staffing(b.id) >= 0.999);
    return {
      lifetime: s.lifetime, bugs: s.bugs, owned: s.owned, monuments: s.monuments,
      filled: s.filled, goldens: s.goldens, wasps: s.waspsSwatted, moths: s.moths,
      demandsFilled: s.demandsFilled, bestStreak: s.bestStreak,
      upgradeCount: Object.keys(s.upgrades).length,
      bps: bps(), allFull, allCrewed, idle: idleBugs(),
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

    const ctx = context();
    const r = CHAIN.resolve(D, ctx, dt);
    last = r;
    s.stocks = r.stocks;

    D.RESOURCES.forEach(function (res) {
      if (r.overflow[res.id] > 0) s.wasted += r.overflow[res.id];
      if (!s.filled[res.id] && s.stocks[res.id] >= ctx.caps[res.id] - 0.01) {
        s.filled[res.id] = true;
      }
    });

    if (r.bugs > 0) gainBugs(r.bugs, 'broodBugs');
    if (r.bugsRate > s.bestBps) s.bestBps = r.bugsRate;

    expireDemands();
    s.nextDemandIn -= dt;
    if (s.nextDemandIn <= 0) {
      s.nextDemandIn = pickIn(D.TUNING.demandEvery);
      spawnDemand();
    }

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
    let crew = 0, need = 0;
    D.BUILDINGS.forEach((b) => { crew += s.assigned[b.id] || 0; need += crewNeeded(b.id); });
    return {
      bugs: s.bugs, lifetime: s.lifetime,
      bps: bps(), bestBps: s.bestBps,
      broodBugs: s.broodBugs, demandBugs: s.demandBugs, titheBugs: s.titheBugs, tithes: s.tithes,
      crew, crewNeed: need, idle: idleBugs(),
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
      if (!out.assigned || typeof out.assigned[b.id] !== 'number') {
        out.assigned = out.assigned || {};
        out.assigned[b.id] = 0;
      }
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
    if (D.RAW.indexOf(out.forageTarget) < 0) out.forageTarget = 'leaf';
    out.lifetime = out.bugs;
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
    trimAssignments();
    last = CHAIN.resolve(D, context(), 0.05);

    const away = Math.max(0, (nowMs() - (raw.lastSeen || nowMs())) / 1000);
    if (away < 60) return null;
    return runAway(away);
  }

  /**
   * Catch-up for time the tab was not running. The chain is stepped forward for
   * real rather than approximated, because a flat rate would ignore the silos
   * filling up and going to waste.
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
      gainBugs(r.bugs * OFFLINE_RATE, 'broodBugs');
    }
    s.stocks = ctx.stocks;
    const gain = s.bugs - before;
    if (gain <= 0) return null;
    s.streak = 0;   // orders do not fill themselves
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
      trimAssignments();
      last = CHAIN.resolve(D, context(), 0.05);
      save();
      return true;
    } catch (e) { return false; }
  }

  root.BUGS_GAME = {
    on, emit,
    load, save, wipe, exportSave, importSave, runAway,
    tick, forage, setForageTarget, forageValue,
    assign, setAssign, autoStaff, recallAll, crewNeeded, staffing, idleBugs,
    buyBuilding, buildingCost, buildingMax, wantQty, buildingUnlocked,
    buyUpgrade, upgradeVisible, availableUpgrades,
    buyMonument, monumentVisible,
    deliver, demandRemaining, demandComplete, demandSlots, streakMult,
    tithe, titheValue,
    catchHoney, catchMoth, swatWasp, waspEscaped,
    caps, context, outputRates, bps, stats, crawlerCount, checkAwards,
    canPay, capBlocked, buildingRates, unitRates, blockers,
    get chain() { return last; },
    get state() { return s; },
    get GOAL() { return D.GOAL; },
  };
})(typeof self !== 'undefined' ? self : this);
