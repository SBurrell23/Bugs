/* ==========================================================================
   ui.js - everything that touches the DOM.
   Lists are built once and then updated in place; they are only rebuilt when
   the set of visible things actually changes.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.BUGS_DATA;
  const G = root.BUGS_GAME;
  const A = root.BUGS_AUDIO;
  const S = root.BUGS_SPRITES;
  const C = root.BUGS_CRAWLERS;
  const F = root.BUGS_FMT;

  const $ = (id) => document.getElementById(id);
  const el = {};

  let tip = null;
  let clickStreak = 0;
  let lastClickAt = 0;
  const sigs = {};

  /* ====================================================================== *
   * small helpers
   * ====================================================================== */

  /** Full figures up to eight digits, short form past that. */
  function bugText(n) {
    return n < 1e8 ? F.commas(n) : F.fmt(n);
  }

  function addFeed(html, cls) {
    const ul = el.feed;
    if (!ul) return;
    const li = document.createElement('li');
    li.innerHTML = html;
    if (cls) li.className = cls;
    ul.insertBefore(li, ul.firstChild);
    while (ul.children.length > 12) ul.removeChild(ul.lastChild);
  }

  function toast(title, sub, sprite, cls) {
    const layer = $('toast-layer');
    if (!layer) return;
    const t = document.createElement('div');
    t.className = 'toast' + (cls ? ' ' + cls : '');
    if (sprite) t.appendChild(S.make(sprite, 26));
    const body = document.createElement('div');
    body.innerHTML = '<div class="toast-title"></div>' + (sub ? '<div class="toast-sub"></div>' : '');
    body.querySelector('.toast-title').textContent = title;
    if (sub) body.querySelector('.toast-sub').textContent = sub;
    t.appendChild(body);
    layer.appendChild(t);

    // Awards often land in bunches. Keep the stack short so it never buries
    // the colony list behind it.
    while (layer.children.length > 4) layer.removeChild(layer.firstChild);

    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, 4200);
  }

  function spark(x, y, text, big) {
    const d = document.createElement('div');
    d.className = 'spark' + (big ? ' big' : '');
    d.textContent = text;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1050);
  }

  /* ====================================================================== *
   * tooltip
   * ====================================================================== */

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'tip';
    document.body.appendChild(tip);
    return tip;
  }

  function showTip(html, ev) {
    const t = ensureTip();
    t.innerHTML = html;
    t.classList.add('on');
    moveTip(ev);
  }

  function moveTip(ev) {
    if (!tip) return;
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }

  function hideTip() { if (tip) tip.classList.remove('on'); }

  function wireTip(node, build) {
    node.addEventListener('mouseenter', (ev) => showTip(build(), ev));
    node.addEventListener('mousemove', moveTip);
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('focus', () => {
      const r = node.getBoundingClientRect();
      showTip(build(), { clientX: r.right, clientY: r.bottom });
    });
    node.addEventListener('blur', hideTip);
  }

  const costLine = (cost) =>
    '<div class="tip-cost' + (G.state.bugs >= cost ? '' : ' no') + '">' + F.commas(cost) + ' bugs</div>';

  /* ====================================================================== *
   * colonies
   * ====================================================================== */

  function buildColonies() {
    const host = el.colonyList;
    host.innerHTML = '';
    D.COLONIES.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'colony';
      b.dataset.id = c.id;
      b.innerHTML =
        '<span class="colony-art"></span>' +
        '<span class="colony-body">' +
          '<span class="colony-name"></span>' +
          '<span class="colony-cost"></span>' +
          '<span class="colony-rate"></span>' +
        '</span>' +
        '<span class="colony-owned">0</span>';
      b.querySelector('.colony-art').appendChild(S.make(c.sprite, 40));
      b.addEventListener('click', () => {
        const n = G.buyColony(c.id);
        if (n > 0) {
          A.sfx.buy();
          refreshAll();
        } else {
          A.sfx.deny();
        }
      });
      wireTip(b, () => {
        const owned = G.state.owned[c.id];
        const qty = G.wantQty(c.id);
        const cost = G.colonyCost(c.id, qty);
        const each = G.colonyOutput(c.id);
        return '<div class="tip-kind">Colony</div>' +
          '<h4>' + c.name + '</h4>' +
          '<p class="tip-flavour">' + c.blurb + '</p>' +
          '<p>You own <b>' + owned + '</b>, together making <b>' +
            F.rate(each * owned) + '</b> bugs per second.</p>' +
          '<p>Each one adds <b>' + F.rate(each) + '</b> per second.</p>' +
          (qty > 1 ? '<p>Buying <b>' + qty + '</b>.</p>' : '') +
          costLine(cost);
      });
      el['colony_' + c.id] = b;
      host.appendChild(b);
    });
  }

  function refreshColonies() {
    const st = G.state;
    D.COLONIES.forEach((c) => {
      const b = el['colony_' + c.id];
      if (!b) return;
      const unlocked = G.colonyUnlocked(c.id);
      b.classList.toggle('locked', !unlocked);
      b.disabled = !unlocked;

      if (!unlocked) {
        b.querySelector('.colony-name').textContent = 'Something else';
        b.querySelector('.colony-cost').textContent = 'not yet';
        b.querySelector('.colony-rate').textContent = 'keep collecting';
        b.querySelector('.colony-owned').textContent = '';
        return;
      }

      const qty = G.wantQty(c.id);
      const cost = G.colonyCost(c.id, qty);
      const can = st.bugs >= cost && qty > 0;

      b.classList.toggle('afford', can);
      b.querySelector('.colony-name').textContent = c.name + (qty > 1 ? ' x' + qty : '');
      const costEl = b.querySelector('.colony-cost');
      costEl.textContent = F.fmt(cost);
      costEl.classList.toggle('no', !can);
      b.querySelector('.colony-rate').textContent =
        F.rate(G.colonyOutput(c.id)) + ' per second each';
      b.querySelector('.colony-owned').textContent = st.owned[c.id];
    });
  }

  /* ====================================================================== *
   * upgrades
   * ====================================================================== */

  const KIND_LABEL = {
    gen: 'Colony upgrade',
    click: 'Poke upgrade',
    global: 'Global upgrade',
    synergy: 'Field notes',
  };

  function upgradeTip(u) {
    return '<div class="tip-kind">' + (KIND_LABEL[u.kind] || 'Upgrade') + '</div>' +
      '<h4>' + u.name + '</h4>' +
      '<p>' + u.desc + '</p>' +
      costLine(u.cost);
  }

  function refreshUpgrades() {
    const list = G.availableUpgrades();
    const sig = list.map((u) => u.id).join(',');
    const host = el.upgradeGrid;

    if (sig !== sigs.upgrades) {
      sigs.upgrades = sig;
      host.innerHTML = '';
      list.forEach((u) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'up';
        b.dataset.id = u.id;
        b.appendChild(S.make(u.icon, 30));
        b.addEventListener('click', () => {
          if (G.buyUpgrade(u.id)) {
            A.sfx.upgrade();
            addFeed('Bought <b>' + u.name + '</b>.');
            hideTip();
            refreshAll();
          } else {
            A.sfx.deny();
          }
        });
        wireTip(b, () => upgradeTip(u));
        host.appendChild(b);
      });
      el.upgradesEmpty.style.display = list.length ? 'none' : '';
    }

    let ready = 0;
    const bugs = G.state.bugs;
    Array.prototype.forEach.call(host.children, (b) => {
      const u = D.UPGRADES.find((x) => x.id === b.dataset.id);
      if (!u) return;
      const can = bugs >= u.cost;
      b.classList.toggle('afford', can);
      if (can) ready++;
    });
    setBadge(el.badgeUpgrades, ready);
  }

  function setBadge(node, n) {
    if (!node) return;
    node.textContent = n;
    node.classList.toggle('zero', n === 0);
  }

  /* ====================================================================== *
   * monuments
   * ====================================================================== */

  function refreshMonuments() {
    const st = G.state;
    const visible = D.MONUMENTS.filter((m) => G.monumentVisible(m.id));
    const sig = visible.map((m) => m.id + (st.monuments[m.id] ? '!' : '')).join(',');
    const host = el.monumentList;

    if (sig !== sigs.monuments) {
      sigs.monuments = sig;
      host.innerHTML = '';
      if (!visible.length) {
        host.innerHTML = '<p class="empty">Nothing here yet. Monuments reveal themselves ' +
          'once the colony is large enough to imagine them.</p>';
      }
      visible.forEach((m) => {
        const owned = !!st.monuments[m.id];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mon' + (owned ? ' owned' : '');
        b.dataset.id = m.id;
        b.innerHTML =
          '<span class="mon-art"></span>' +
          '<span class="mon-body">' +
            '<span class="mon-title"></span>' +
            '<span class="mon-blurb"></span>' +
            '<span class="mon-effect"></span>' +
            '<span class="mon-perk"></span>' +
            '<span class="mon-cost"></span>' +
          '</span>';
        b.querySelector('.mon-art').appendChild(S.make(m.sprite, 74));
        b.querySelector('.mon-title').textContent = m.name;
        b.querySelector('.mon-blurb').textContent = m.blurb;
        b.querySelector('.mon-effect').innerHTML =
          'All bug production <b>x' + m.mult + '</b>, permanently.';
        b.querySelector('.mon-perk').textContent = m.perk;
        if (!owned) {
          b.addEventListener('click', () => {
            if (G.buyMonument(m.id)) { hideTip(); refreshAll(); }
            else A.sfx.deny();
          });
        }
        host.appendChild(b);
      });
    }

    let ready = 0;
    Array.prototype.forEach.call(host.children, (b) => {
      if (!b.dataset || !b.dataset.id) return;
      const m = D.MONUMENTS.find((x) => x.id === b.dataset.id);
      if (!m) return;
      const owned = !!st.monuments[m.id];
      // .mon-cost is the permanent hook; state rides on modifier classes so
      // the element can always be found again on the next pass.
      const cost = b.querySelector('.mon-cost');
      if (!cost) return;
      if (owned) {
        cost.classList.remove('no');
        cost.classList.add('raised');
        cost.textContent = 'Raised';
        return;
      }
      const can = st.bugs >= m.cost;
      b.classList.toggle('afford', can);
      cost.classList.remove('raised');
      cost.classList.toggle('no', !can);
      cost.textContent = F.commas(m.cost) + ' bugs';
      if (can) ready++;
    });
    setBadge(el.badgeMonuments, ready);
  }

  /* ====================================================================== *
   * lab
   * ====================================================================== */

  function refreshLab() {
    const st = G.state;

    // the bench
    if (st.bench) {
      const study = D.STUDIES.find((x) => x.id === st.bench.id);
      const left = Math.max(0, (st.bench.endsAt - Date.now()) / 1000);
      const pct = 100 * (1 - left / st.bench.seconds);
      if (sigs.bench !== st.bench.id) {
        sigs.bench = st.bench.id;
        el.labActive.innerHTML =
          '<div class="bench">' +
            '<div class="bench-top"><span class="bench-name"></span><span class="bench-eta"></span></div>' +
            '<div class="bench-track"><div class="bench-fill"></div></div>' +
          '</div>';
        el.labActive.querySelector('.bench-name').textContent = study ? study.name : 'Study';
      }
      const eta = el.labActive.querySelector('.bench-eta');
      const fill = el.labActive.querySelector('.bench-fill');
      if (eta) eta.textContent = F.clock(left);
      if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    } else if (sigs.bench !== null) {
      sigs.bench = null;
      el.labActive.innerHTML = '<div class="bench-idle">The bench is empty. Start a study below.</div>';
    }

    // the list
    const list = G.availableStudies();
    const sig = list.map((x) => x.id + (st.studies[x.id] ? '!' : '')).join(',') + '|' + (st.bench ? '1' : '0');
    if (sig !== sigs.studies) {
      sigs.studies = sig;
      el.studyList.innerHTML = '';
      if (!list.length) {
        el.studyList.innerHTML = '<p class="empty">No studies are within reach yet.</p>';
      }
      list.forEach((x) => {
        const done = !!st.studies[x.id];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'study' + (done ? ' done' : '');
        b.dataset.id = x.id;
        b.innerHTML =
          '<span class="study-body"><span class="study-name"></span><span class="study-desc"></span></span>' +
          '<span class="study-side"><span class="study-cost"></span><span class="study-secs"></span></span>';
        b.querySelector('.study-name').textContent = x.name;
        b.querySelector('.study-desc').textContent = done ? 'Filed. The bonus is permanent.' : x.desc;
        b.querySelector('.study-secs').textContent = done ? '' : F.duration(x.seconds);
        if (!done) {
          b.addEventListener('click', () => {
            if (G.startStudy(x.id)) { refreshAll(); }
            else A.sfx.deny();
          });
        }
        el.studyList.appendChild(b);
      });
    }

    Array.prototype.forEach.call(el.studyList.children, (b) => {
      if (!b.dataset || !b.dataset.id) return;
      const x = D.STUDIES.find((y) => y.id === b.dataset.id);
      if (!x) return;
      const done = !!st.studies[x.id];
      const cost = b.querySelector('.study-cost');
      if (done) { if (cost) cost.textContent = ''; return; }
      const can = st.bugs >= x.cost && !st.bench;
      b.classList.toggle('afford', can);
      cost.className = 'study-cost' + (can ? '' : ' no');
      cost.textContent = F.fmt(x.cost);
    });
  }

  /* ====================================================================== *
   * awards
   * ====================================================================== */

  function refreshAwards() {
    const st = G.state;
    const got = Object.keys(st.awards).length;
    if (sigs.awards === got) return;
    sigs.awards = got;

    el.awardGrid.innerHTML = '';
    D.ACHIEVEMENTS.forEach((a) => {
      const has = !!st.awards[a.id];
      const d = document.createElement('div');
      d.className = 'award' + (has ? ' got' : '');
      d.innerHTML = '<div class="award-name"></div><div class="award-desc"></div>';
      d.querySelector('.award-name').textContent = has ? a.name : 'Locked';
      d.querySelector('.award-desc').textContent = a.desc;
      el.awardGrid.appendChild(d);
    });
    setBadge(el.badgeAwards, got);
    el.badgeAwards.classList.remove('zero');
    el.badgeAwards.textContent = got + '/' + D.ACHIEVEMENTS.length;
  }

  /* ====================================================================== *
   * stats
   * ====================================================================== */

  function refreshStats() {
    if (!el.panelStats.classList.contains('active')) return;
    const t = G.stats();
    const rows = [
      ['Bugs on hand', bugText(t.bugs)],
      ['Bugs all time', bugText(t.lifetime)],
      ['Bugs spent', bugText(t.spent)],
      ['Per second', F.rate(t.bps)],
      ['Best per second', F.rate(t.bestBps)],
      ['Per poke', F.rate(t.clickValue)],
      ['Pokes', F.commas(t.clicks)],
      ['Collected by hand', bugText(t.byHand)],
      ['Global multiplier', 'x' + t.globalMult.toFixed(2)],
      ['Colonies owned', F.commas(t.colonies)],
      ['Upgrades', t.upgrades + ' / ' + t.upgradeTotal],
      ['Monuments', t.monuments + ' / 3'],
      ['Studies filed', t.studies + ' / ' + t.studyTotal],
      ['Awards', t.awards + ' / ' + t.awardTotal],
      ['Honey Bugs caught', F.commas(t.goldens)],
      ['Wasps swatted', F.commas(t.waspsSwatted)],
      ['Bugs lost to wasps', bugText(t.stolen)],
      ['Time in the log', F.duration(t.played)],
    ];
    el.statsBody.innerHTML = rows.map((r) =>
      '<div class="stat"><div class="stat-k">' + r[0] + '</div><div class="stat-v">' + r[1] + '</div></div>'
    ).join('');
  }

  /* ====================================================================== *
   * header, counter, boons
   * ====================================================================== */

  function refreshHeader() {
    const st = G.state;
    const rate = G.bps();

    el.bugCount.textContent = bugText(st.bugs);
    el.bugWord.textContent = Math.floor(st.bugs) === 1 ? 'bug' : 'bugs';
    el.bps.textContent = F.rate(rate);
    el.clickValue.textContent = F.rate(G.clickValue());

    const frac = Math.min(1, st.bugs / D.GOAL);
    el.goalFill.style.width = (frac * 100).toFixed(2) + '%';
    el.goalFigures.textContent = bugText(st.bugs) + ' / ' + F.commas(D.GOAL);
  }

  function refreshBoons() {
    const st = G.state;
    const now = Date.now();
    const sig = st.boons.map((b) => b.id).join(',');
    if (sig !== sigs.boons) {
      sigs.boons = sig;
      el.boonBar.innerHTML = '';
      st.boons.forEach((b) => {
        const d = document.createElement('div');
        d.className = 'boon';
        d.dataset.id = b.id;
        d.innerHTML = '<span class="boon-name"></span><span class="boon-what"></span>' +
          '<span class="boon-time"></span>';
        d.querySelector('.boon-name').textContent = b.name;
        d.querySelector('.boon-what').textContent =
          b.mult ? 'x' + b.mult + ' output' : b.clickMult ? 'x' + b.clickMult + ' per poke' : '';
        el.boonBar.appendChild(d);
      });
    }
    Array.prototype.forEach.call(el.boonBar.children, (d, i) => {
      const b = st.boons[i];
      if (!b) return;
      const t = d.querySelector('.boon-time');
      if (t) t.textContent = F.clock((b.endsAt - now) / 1000);
    });
  }

  /* ====================================================================== *
   * visitors
   * ====================================================================== */

  function spawnHoney() {
    A.sfx.honeySpawn();
    addFeed('A <b>Honey Bug</b> has surfaced somewhere. Find it.', 'good');
    C.spawnVisitor({
      sprite: 'honeyBug',
      id: 'honey-visitor',
      label: 'A Honey Bug. Click it.',
      px: 46,
      speed: 58,
      life: 14,
      onCatch(x, y) {
        const r = G.catchHoney();
        A.sfx.honeyCatch();
        if (r.boon.id === 'windfall') {
          spark(x, y, '+' + F.fmt(r.gift), true);
          addFeed('Windfall: <b>' + F.commas(r.gift) + '</b> bugs at once.', 'good');
          toast('Windfall', F.commas(r.gift) + ' bugs', 'honeyBug');
        } else {
          spark(x, y, r.boon.name.toUpperCase(), true);
          addFeed('<b>' + r.boon.name + '</b> - ' + r.boon.desc, 'good');
          toast(r.boon.name, r.boon.desc, 'honeyBug');
        }
        refreshAll();
      },
      onGone() {
        addFeed('The Honey Bug slipped back under the log.');
      },
    });
  }

  function spawnWasp() {
    A.sfx.waspSpawn();
    const warded = !!G.state.monuments.mantisTemple;
    addFeed(warded
      ? 'A wasp circles, thinks better of it, and keeps its distance.'
      : 'A <b>wasp</b> is raiding the colony. Swat it.', warded ? '' : 'bad');
    C.spawnVisitor({
      sprite: 'wasp',
      id: 'wasp-visitor',
      label: 'A raiding wasp. Click to swat it.',
      px: 42,
      speed: 108,
      life: 9,
      wander: 2.1,
      onCatch(x, y) {
        const drop = G.swatWasp();
        A.sfx.waspHit();
        spark(x, y, '+' + F.fmt(drop), true);
        addFeed('Wasp swatted. It dropped <b>' + F.commas(drop) + '</b> bugs.', 'good');
        refreshAll();
      },
      onGone() {
        const delta = G.waspEscaped();
        if (delta >= 0) {
          addFeed('The wasp fled the Mantis Temple and dropped <b>' +
            F.commas(delta) + '</b> bugs.', 'good');
        } else {
          A.sfx.waspSteal();
          addFeed('The wasp got away with <b>' + F.commas(-delta) + '</b> bugs.', 'bad');
          toast('Raided', F.commas(-delta) + ' bugs taken', 'wasp');
        }
        refreshAll();
      },
    });
  }

  /* ====================================================================== *
   * poking
   * ====================================================================== */

  function poke(ev) {
    const now = performance.now();
    clickStreak = now - lastClickAt < 420 ? Math.min(clickStreak + 1, 8) : 0;
    lastClickAt = now;

    const gain = G.poke();
    A.sfx.click(clickStreak);

    el.heroBtn.classList.remove('jolt');
    void el.heroBtn.offsetWidth;
    el.heroBtn.classList.add('jolt');
    el.bugCount.classList.remove('pop');
    void el.bugCount.offsetWidth;
    el.bugCount.classList.add('pop');

    const r = el.heroBtn.getBoundingClientRect();
    const x = ev && ev.clientX ? ev.clientX : r.left + r.width / 2;
    const y = ev && ev.clientY ? ev.clientY : r.top + r.height / 2;
    spark(x, y, '+' + F.fmt(gain), gain >= 1000);

    refreshHeader();
  }

  /* ====================================================================== *
   * tabs and toggles
   * ====================================================================== */

  function selectTab(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.panel === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    refreshStats();
  }

  function syncAudioChips() {
    const set = G.state.settings;
    el.musicToggle.textContent = 'Music: ' + (A.music.on ? 'on' : 'off');
    el.musicToggle.setAttribute('aria-pressed', A.music.on ? 'true' : 'false');
    el.sfxToggle.textContent = 'Sound: ' + (set.sfx ? 'on' : 'off');
    el.sfxToggle.setAttribute('aria-pressed', set.sfx ? 'true' : 'false');
    if (el.critterToggle) {
      el.critterToggle.textContent = 'Critters: ' + (set.critters ? 'on' : 'off');
      el.critterToggle.setAttribute('aria-pressed', set.critters ? 'true' : 'false');
    }
  }

  /* ====================================================================== *
   * victory
   * ====================================================================== */

  function showVictory(t) {
    el.victoryLine.textContent =
      'One million bugs, held all at once, ' + F.duration(t.played) + ' after you lifted the log.';
    const rows = [
      ['Time taken', F.duration(t.played)],
      ['Bugs all time', bugText(t.lifetime)],
      ['Pokes', F.commas(t.clicks)],
      ['Peak per second', F.rate(t.bestBps)],
      ['Colonies', F.commas(t.colonies)],
      ['Awards', t.awards + ' / ' + t.awardTotal],
    ];
    el.victoryStats.innerHTML = rows.map((r) =>
      '<div class="stat"><div class="stat-k">' + r[0] + '</div><div class="stat-v">' + r[1] + '</div></div>'
    ).join('');
    el.victory.hidden = false;
    A.sfx.victory();
  }

  /* ====================================================================== *
   * refresh
   * ====================================================================== */

  function refreshAll() {
    refreshHeader();
    refreshBoons();
    refreshColonies();
    refreshUpgrades();
    refreshMonuments();
    refreshLab();
    refreshAwards();
    refreshStats();
    C.setPopulation(G.crawlerCount());
  }

  /* ====================================================================== *
   * wiring
   * ====================================================================== */

  function cache() {
    [
      'brand-bug', 'tagline', 'goal-fill', 'goal-figures', 'bug-count', 'bug-word', 'bps',
      'click-value', 'hero-btn', 'hero-img', 'boon-bar', 'feed', 'upgrade-grid',
      'upgrades-empty', 'monument-list', 'lab-active', 'study-list', 'award-grid',
      'stats-body', 'colony-list', 'panel-stats', 'badge-upgrades', 'badge-monuments',
      'badge-awards', 'music-toggle', 'music-vol', 'sfx-toggle', 'critter-toggle',
      'victory', 'victory-line', 'victory-stats', 'victory-btn', 'victory-bug',
      'gate', 'gate-btn', 'gate-bug', 'export-btn', 'import-btn', 'wipe-btn',
    ].forEach((id) => {
      const key = id.replace(/-([a-z])/g, (m, ch) => ch.toUpperCase());
      el[key] = $(id);
    });
  }

  function wire() {
    el.heroBtn.addEventListener('click', poke);

    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => selectTab(t.dataset.panel));
    });

    document.querySelectorAll('.qty').forEach((q) => {
      q.addEventListener('click', () => {
        const v = q.dataset.qty === 'max' ? 'max' : Number(q.dataset.qty);
        G.state.settings.buyQty = v;
        document.querySelectorAll('.qty').forEach((o) => o.classList.toggle('active', o === q));
        refreshColonies();
      });
    });

    el.musicToggle.addEventListener('click', () => {
      A.music.toggle().then(() => {
        G.state.settings.music = A.music.on;
        syncAudioChips();
      });
    });

    el.musicVol.addEventListener('input', () => {
      const v = Number(el.musicVol.value) / 100;
      A.music.setVolume(v);
      G.state.settings.musicVol = v;
    });

    el.sfxToggle.addEventListener('click', () => {
      const next = !G.state.settings.sfx;
      G.state.settings.sfx = next;
      A.setSfx(next);
      syncAudioChips();
      if (next) A.sfx.click(0);
    });

    if (el.critterToggle) {
      el.critterToggle.addEventListener('click', () => {
        const next = !G.state.settings.critters;
        G.state.settings.critters = next;
        C.setEnabled(next);
        if (next) C.setPopulation(G.crawlerCount());
        syncAudioChips();
      });
    }

    el.victoryBtn.addEventListener('click', () => { el.victory.hidden = true; });

    el.exportBtn.addEventListener('click', () => {
      const code = G.exportSave();
      if (navigator.clipboard && code) {
        navigator.clipboard.writeText(code)
          .then(() => toast('Save copied', 'Paste it somewhere safe'))
          .catch(() => window.prompt('Copy this save code:', code));
      } else {
        window.prompt('Copy this save code:', code);
      }
    });

    el.importBtn.addEventListener('click', () => {
      const code = window.prompt('Paste a save code:');
      if (!code) return;
      if (G.importSave(code)) {
        sigs.upgrades = sigs.monuments = sigs.studies = sigs.awards = sigs.boons = undefined;
        sigs.bench = undefined;
        buildColonies();
        refreshAll();
        toast('Save loaded', 'Welcome back');
      } else {
        toast('That code did not read', 'Nothing was changed');
      }
    });

    el.wipeBtn.addEventListener('click', () => {
      if (!window.confirm('Burn the log? Every bug, colony and award is lost for good.')) return;
      G.wipe();
      sigs.upgrades = sigs.monuments = sigs.studies = sigs.awards = sigs.boons = undefined;
      sigs.bench = undefined;
      buildColonies();
      refreshAll();
      addFeed('The log is ash. Something is already moving in it.');
    });

    // keyboard: space pokes when nothing else has focus
    document.addEventListener('keydown', (ev) => {
      if (ev.code !== 'Space') return;
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA')) return;
      ev.preventDefault();
      poke();
    });

    window.addEventListener('resize', () => hideTip());
  }

  function subscribe() {
    G.on('award', (a) => {
      A.sfx.award();
      toast(a.name, a.desc, 'iconCrown', 'award');
      addFeed('Award: <b>' + a.name + '</b>.', 'good');
    });

    G.on('monument', (m) => {
      A.sfx.monument();
      toast(m.name + ' raised', 'All production x' + m.mult, m.sprite);
      addFeed('<b>' + m.name + '</b> stands. ' + m.perk, 'good');
    });

    G.on('studyStarted', (st) => {
      addFeed('Started <b>' + st.name + '</b> on the bench.');
    });

    G.on('studyDone', (st) => {
      A.sfx.study();
      toast('Study filed', st.name, 'iconFlask');
      addFeed('<b>' + st.name + '</b> filed. ' + st.desc, 'good');
    });

    G.on('milestone', (m) => {
      A.sfx.milestone();
      addFeed('The count passes <b>' + Math.round(m * 100) + '%</b> of a million.', 'good');
    });

    G.on('honeySpawn', spawnHoney);
    G.on('waspSpawn', spawnWasp);
    G.on('victory', showVictory);
  }

  /* ====================================================================== *
   * boot
   * ====================================================================== */

  function init(offline) {
    cache();
    S.paint(el.brandBug, 'ant', 34);
    S.paint(el.heroImg, 'heroBeetle', 128);
    S.paint(el.gateBug, 'heroBeetle', 96);
    S.paint(el.victoryBug, 'queenBee', 96);

    buildColonies();
    wire();
    subscribe();

    const set = G.state.settings;
    el.musicVol.value = Math.round(set.musicVol * 100);
    A.music.setVolume(set.musicVol);
    A.setSfx(set.sfx);
    C.setEnabled(set.critters);
    document.querySelectorAll('.qty').forEach((q) => {
      const v = q.dataset.qty === 'max' ? 'max' : Number(q.dataset.qty);
      q.classList.toggle('active', v === set.buyQty);
    });
    syncAudioChips();

    refreshAll();

    if (offline) {
      addFeed('You were away for <b>' + F.duration(offline.away) + '</b>. The colony ' +
        'carried on and banked <b>' + F.commas(offline.gain) + '</b> bugs.', 'good');
      toast('While you were out', F.commas(offline.gain) + ' bugs collected', 'ant');
    } else if (G.state.lifetime === 0) {
      addFeed('You lift the log. Underneath, a beetle regards you without much interest.');
    }
  }

  root.BUGS_UI = { init, refreshAll, refreshHeader, refreshBoons, refreshLab, toast, addFeed, syncAudioChips };
})(typeof self !== 'undefined' ? self : this);
