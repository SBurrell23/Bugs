/* ==========================================================================
   game.js - state, economy and rules. Knows nothing about the DOM.
   The UI listens for events and reads the derived getters.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.BUGS_DATA;
  const SAVE_KEY = 'bugs.save.v2';
  const OFFLINE_CAP = 2 * 3600;   // seconds of catch-up we are willing to pay out
  const OFFLINE_RATE = 0.5;       // and at what fraction of full output

  const HONEY_MIN = 68, HONEY_MAX = 152;   // seconds between Honey Bugs
  const WASP_MIN = 210, WASP_MAX = 400;    // seconds between wasp raids
  const MILESTONES = [0.1, 0.25, 0.5, 0.75, 0.9];

  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const COLONY = byId(D.COLONIES);
  const MONUMENT = byId(D.MONUMENTS);
  const UPGRADE = byId(D.UPGRADES);
  const STUDY = byId(D.STUDIES);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const nowMs = () => Date.now();

  /* ---------------- events ---------------- */
  const handlers = {};
  function on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); }
  function emit(name, payload) { (handlers[name] || []).forEach((fn) => fn(payload)); }

  /* ---------------- state ---------------- */
  let s = null;

  function freshState() {
    const owned = {};
    D.COLONIES.forEach((c) => (owned[c.id] = 0));
    return {
      v: 2,
      bugs: 0,
      lifetime: 0,
      spent: 0,
      clicks: 0,
      byHand: 0,
      owned,
      upgrades: {},
      monuments: {},
      awards: {},
      studies: {},
      bench: null,
      boons: [],
      goldens: 0,
      waspsSwatted: 0,
      waspsMissed: 0,
      stolen: 0,
      milestones: {},
      bestBps: 0,
      won: false,
      wonAt: null,
      startedAt: nowMs(),
      lastSeen: nowMs(),
      playedMs: 0,
      honeyIn: rnd(45, 90),
      waspIn: rnd(WASP_MIN, WASP_MAX),
      settings: { music: true, musicVol: 0.45, sfx: true, critters: true, buyQty: 1 },
    };
  }

  /* ---------------- multipliers ---------------- */

  function awardMult() {
    return 1 + D.ACH_BONUS * Object.keys(s.awards).length;
  }

  function monumentMult() {
    let m = 1;
    for (const id in s.monuments) if (MONUMENT[id]) m *= MONUMENT[id].mult;
    return m;
  }

  function studyMult() {
    let m = 1;
    for (const id in s.studies) if (STUDY[id]) m *= STUDY[id].mult;
    return m;
  }

  function upgradeMults() {
    // built fresh rather than cached: there are only a few dozen upgrades and
    // this keeps loading a save trivially correct.
    const gen = {};
    D.COLONIES.forEach((c) => (gen[c.id] = 1));
    let global = 1, click = 1, share = 0;
    for (const id in s.upgrades) {
      const u = UPGRADE[id];
      if (!u) continue;
      if (u.kind === 'gen') gen[u.target] *= u.mult;
      else if (u.kind === 'global') global *= u.mult;
      else if (u.kind === 'click') click *= u.mult;
      else if (u.kind === 'synergy') share += u.share;
    }
    if (s.monuments.hiveSingularity) share += 0.15;
    return { gen, global, click, share };
  }

  function boonMult() {
    let m = 1;
    for (const b of s.boons) if (b.mult) m *= b.mult;
    return m;
  }

  function boonClickMult() {
    let m = 1;
    for (const b of s.boons) if (b.clickMult) m *= b.clickMult;
    return m;
  }

  /** Passive output, in bugs per second. */
  function bps() {
    const u = upgradeMults();
    let base = 0;
    for (const c of D.COLONIES) base += s.owned[c.id] * c.bps * u.gen[c.id];
    return base * u.global * studyMult() * monumentMult() * awardMult() * boonMult();
  }

  /** Output of a single colony, for the tooltip. */
  function colonyOutput(id) {
    const c = COLONY[id];
    const u = upgradeMults();
    return c.bps * u.gen[id] * u.global * studyMult() * monumentMult() * awardMult() * boonMult();
  }

  /** Bugs gained per poke. */
  function clickValue() {
    const u = upgradeMults();
    const flat = u.click * boonClickMult() * u.global * monumentMult() * awardMult();
    return flat + bps() * u.share;
  }

  /* ---------------- costs ---------------- */

  function colonyCost(id, qty) {
    const c = COLONY[id];
    const g = D.COST_GROWTH;
    const k = s.owned[id];
    let total = 0;
    for (let i = 0; i < qty; i++) total += Math.ceil(c.cost * Math.pow(g, k + i));
    return total;
  }

  /** How many of a colony we could buy right now. */
  function colonyMax(id) {
    const c = COLONY[id];
    const g = D.COST_GROWTH;
    let n = 0, total = 0, k = s.owned[id];
    for (;;) {
      const next = Math.ceil(c.cost * Math.pow(g, k + n));
      if (total + next > s.bugs || n >= 5000) break;
      total += next;
      n++;
    }
    return n;
  }

  /** The quantity implied by the current buy-amount setting. */
  function wantQty(id) {
    const q = s.settings.buyQty;
    return q === 'max' ? Math.max(1, colonyMax(id)) : q;
  }

  /* ---------------- unlocks ---------------- */

  function colonyUnlocked(id) {
    const c = COLONY[id];
    return c.index === 0 || s.owned[id] > 0 || s.lifetime >= c.cost * 0.45;
  }

  function monumentVisible(id) {
    const m = MONUMENT[id];
    return s.monuments[id] || s.lifetime >= m.cost * 0.35;
  }

  function upgradeVisible(u) {
    if (s.upgrades[u.id]) return false;
    if (u.req.lifetime !== undefined) return s.lifetime >= u.req.lifetime;
    if (u.req.gen !== undefined) return s.owned[u.req.gen] >= u.req.owned;
    return true;
  }

  function availableUpgrades() {
    return D.UPGRADES.filter(upgradeVisible)
      .sort((a, b) => a.cost - b.cost);
  }

  function studyVisible(st) {
    return s.studies[st.id] || s.lifetime >= st.req.lifetime;
  }

  function availableStudies() {
    return D.STUDIES.filter(studyVisible);
  }

  /* ---------------- actions ---------------- */

  function poke() {
    const gain = clickValue();
    s.bugs += gain;
    s.lifetime += gain;
    s.byHand += gain;
    s.clicks++;
    return gain;
  }

  function buyColony(id, qty) {
    if (!colonyUnlocked(id)) return 0;
    const n = qty === undefined ? wantQty(id) : qty;
    if (n < 1) return 0;
    const cost = colonyCost(id, n);
    if (cost > s.bugs) return 0;
    s.bugs -= cost;
    s.spent += cost;
    s.owned[id] += n;
    emit('bought', { kind: 'colony', id, qty: n, cost });
    return n;
  }

  function buyUpgrade(id) {
    const u = UPGRADE[id];
    if (!u || s.upgrades[id] || !upgradeVisible(u)) return false;
    if (u.cost > s.bugs) return false;
    s.bugs -= u.cost;
    s.spent += u.cost;
    s.upgrades[id] = true;
    emit('bought', { kind: 'upgrade', id, cost: u.cost, name: u.name });
    return true;
  }

  function buyMonument(id) {
    const m = MONUMENT[id];
    if (!m || s.monuments[id]) return false;
    if (m.cost > s.bugs) return false;
    s.bugs -= m.cost;
    s.spent += m.cost;
    s.monuments[id] = true;
    emit('monument', m);
    return true;
  }

  function startStudy(id) {
    const st = STUDY[id];
    if (!st || s.studies[id] || s.bench) return false;
    if (!studyVisible(st)) return false;
    if (st.cost > s.bugs) return false;
    s.bugs -= st.cost;
    s.spent += st.cost;
    s.bench = { id, endsAt: nowMs() + st.seconds * 1000, seconds: st.seconds };
    emit('studyStarted', st);
    return true;
  }

  /* ---------------- honey bugs and wasps ---------------- */

  function rollBoon() {
    const total = D.BOONS.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * total;
    for (const b of D.BOONS) { r -= b.weight; if (r <= 0) return b; }
    return D.BOONS[0];
  }

  /** Called by the UI when the player catches a Honey Bug. */
  function catchHoney() {
    s.goldens++;
    const boon = rollBoon();
    let gift = 0;
    if (boon.id === 'windfall') {
      gift = Math.max(s.bugs * 0.08, bps() * 60, 15);
      s.bugs += gift;
      s.lifetime += gift;
    } else {
      s.boons.push({
        id: boon.id,
        name: boon.name,
        mult: boon.mult,
        clickMult: boon.clickMult,
        endsAt: nowMs() + boon.seconds * 1000,
      });
    }
    emit('boon', { boon, gift });
    return { boon, gift };
  }

  /** Called by the UI when the player swats a wasp in time. */
  function swatWasp() {
    s.waspsSwatted++;
    const drop = Math.max(bps() * 12, 20);
    s.bugs += drop;
    s.lifetime += drop;
    emit('wasp', { swatted: true, amount: drop });
    return drop;
  }

  /** Called by the UI when a wasp leaves unswatted. */
  function waspEscaped() {
    // Once the Mantis Temple stands, wasps do not dare take anything.
    if (s.monuments.mantisTemple) {
      const drop = Math.max(bps() * 6, 10);
      s.bugs += drop;
      s.lifetime += drop;
      emit('wasp', { swatted: false, warded: true, amount: drop });
      return drop;
    }
    s.waspsMissed++;
    const loss = Math.min(s.bugs * 0.04, Math.max(bps() * 25, 5));
    s.bugs = Math.max(0, s.bugs - loss);
    s.stolen += loss;
    emit('wasp', { swatted: false, amount: -loss });
    return -loss;
  }

  function honeyInterval() {
    const factor = s.monuments.cicadaChorus ? 0.55 : 1;
    return rnd(HONEY_MIN, HONEY_MAX) * factor;
  }

  /* ---------------- awards ---------------- */

  function snapshot() {
    return {
      lifetime: s.lifetime,
      bugs: s.bugs,
      clicks: s.clicks,
      owned: s.owned,
      monuments: s.monuments,
      goldens: s.goldens,
      wasps: s.waspsSwatted,
      upgradeCount: Object.keys(s.upgrades).length,
      studiesDone: Object.keys(s.studies).length,
      bps: bps(),
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

  /* ---------------- the tick ---------------- */

  let awardClock = 0;

  function tick(dt) {
    if (!s) return;
    dt = Math.max(0, Math.min(dt, 1));

    // boons expire
    if (s.boons.length) {
      const t = nowMs();
      const before = s.boons.length;
      s.boons = s.boons.filter((b) => b.endsAt > t);
      if (s.boons.length !== before) emit('boonsChanged');
    }

    // passive income
    const rate = bps();
    if (rate > 0) {
      const gain = rate * dt;
      s.bugs += gain;
      s.lifetime += gain;
    }
    if (rate > s.bestBps) s.bestBps = rate;

    // the bench
    if (s.bench && nowMs() >= s.bench.endsAt) {
      const st = STUDY[s.bench.id];
      s.studies[s.bench.id] = true;
      s.bench = null;
      if (st) emit('studyDone', st);
    }

    // visitors
    s.honeyIn -= dt;
    if (s.honeyIn <= 0) {
      s.honeyIn = honeyInterval();
      emit('honeySpawn');
    }
    s.waspIn -= dt;
    if (s.waspIn <= 0) {
      s.waspIn = rnd(WASP_MIN, WASP_MAX);
      emit('waspSpawn');
    }

    // goal milestones and the win
    const frac = s.bugs / D.GOAL;
    for (const m of MILESTONES) {
      if (frac >= m && !s.milestones[m]) {
        s.milestones[m] = true;
        emit('milestone', m);
      }
    }
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

  /* ---------------- stats ---------------- */

  function stats() {
    const u = upgradeMults();
    return {
      bugs: s.bugs,
      lifetime: s.lifetime,
      spent: s.spent,
      clicks: s.clicks,
      byHand: s.byHand,
      bps: bps(),
      bestBps: s.bestBps,
      clickValue: clickValue(),
      played: s.playedMs / 1000,
      goldens: s.goldens,
      waspsSwatted: s.waspsSwatted,
      waspsMissed: s.waspsMissed,
      stolen: s.stolen,
      awards: Object.keys(s.awards).length,
      awardTotal: D.ACHIEVEMENTS.length,
      upgrades: Object.keys(s.upgrades).length,
      upgradeTotal: D.UPGRADES.length,
      studies: Object.keys(s.studies).length,
      studyTotal: D.STUDIES.length,
      monuments: Object.keys(s.monuments).length,
      colonies: D.COLONIES.reduce((a, c) => a + s.owned[c.id], 0),
      globalMult: u.global * studyMult() * monumentMult() * awardMult(),
      won: s.won,
      wonAt: s.wonAt,
    };
  }

  /** Crawler population reflects how big the infestation actually is. */
  function crawlerCount() {
    const total = D.COLONIES.reduce((a, c) => a + s.owned[c.id], 0);
    return Math.min(44, 5 + Math.floor(Math.sqrt(total) * 2.6));
  }

  /* ---------------- persistence ---------------- */

  function save() {
    try {
      s.lastSeen = nowMs();
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      return true;
    } catch (e) {
      return false;
    }
  }

  function migrate(raw) {
    const base = freshState();
    const out = Object.assign(base, raw);
    out.settings = Object.assign(base.settings, raw.settings || {});
    // make sure every colony exists, even if the roster changed
    D.COLONIES.forEach((c) => { if (typeof out.owned[c.id] !== 'number') out.owned[c.id] = 0; });
    // drop anything that no longer exists in the data
    ['upgrades', 'monuments', 'studies', 'awards'].forEach((k) => {
      out[k] = out[k] || {};
    });
    Object.keys(out.upgrades).forEach((k) => { if (!UPGRADE[k]) delete out.upgrades[k]; });
    Object.keys(out.monuments).forEach((k) => { if (!MONUMENT[k]) delete out.monuments[k]; });
    Object.keys(out.studies).forEach((k) => { if (!STUDY[k]) delete out.studies[k]; });
    if (out.bench && !STUDY[out.bench.id]) out.bench = null;
    out.boons = Array.isArray(out.boons) ? out.boons.filter((b) => b && b.endsAt > nowMs()) : [];
    return out;
  }

  /** Returns an offline report, or null if there was nothing to catch up on. */
  function load() {
    let raw = null;
    try {
      const txt = localStorage.getItem(SAVE_KEY);
      if (txt) raw = JSON.parse(txt);
    } catch (e) {
      raw = null;
    }

    if (!raw) { s = freshState(); return null; }
    s = migrate(raw);

    const away = Math.max(0, (nowMs() - (raw.lastSeen || nowMs())) / 1000);
    if (away < 60) return null;

    const seconds = Math.min(away, OFFLINE_CAP);
    const gain = bps() * seconds * OFFLINE_RATE;
    if (gain <= 0) return null;

    s.bugs += gain;
    s.lifetime += gain;
    return { away, seconds, gain };
  }

  /**
   * Credit a stretch of real time the tab was not ticking, at the same
   * reduced rate a reload would pay out. Returns the bugs added.
   */
  function creditAway(seconds) {
    const paid = Math.min(Math.max(0, seconds), OFFLINE_CAP);
    const gain = bps() * paid * OFFLINE_RATE;
    if (gain > 0) { s.bugs += gain; s.lifetime += gain; }
    return gain;
  }

  function wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    s = freshState();
  }

  function exportSave() {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); }
    catch (e) { return ''; }
  }

  function importSave(text) {
    try {
      const raw = JSON.parse(decodeURIComponent(escape(atob(String(text).trim()))));
      if (!raw || typeof raw.bugs !== 'number') return false;
      s = migrate(raw);
      save();
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- api ---------------- */
  root.BUGS_GAME = {
    on, emit,
    load, save, wipe, exportSave, importSave,
    tick, poke, creditAway,
    buyColony, buyUpgrade, buyMonument, startStudy,
    catchHoney, swatWasp, waspEscaped,
    bps, clickValue, colonyOutput,
    colonyCost, colonyMax, wantQty,
    colonyUnlocked, monumentVisible, upgradeVisible, availableUpgrades,
    studyVisible, availableStudies,
    stats, crawlerCount, checkAwards,
    get state() { return s; },
    get GOAL() { return D.GOAL; },
  };
})(typeof self !== 'undefined' ? self : this);
