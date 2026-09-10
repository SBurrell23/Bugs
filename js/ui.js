/* ==========================================================================
   ui.js - everything that touches the DOM.

   Lists are built once and then updated in place. They are only rebuilt when
   the set of visible things actually changes, which is what keeps a 10Hz
   refresh cheap.
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
  const sigs = {};
  const RES = Object.fromEntries(D.RESOURCES.map((r) => [r.id, r]));
  const BLD = Object.fromEntries(D.BUILDINGS.map((b) => [b.id, b]));

  let tip = null;

  /* ====================================================================== *
   * helpers
   * ====================================================================== */

  const bugText = (n) => (n < 1e8 ? F.commas(n) : F.fmt(n));
  const rate = (n) => (Math.abs(n) < 10 ? n.toFixed(1) : F.fmt(n));
  const signed = (n) => (n > 0 ? '+' : '') + rate(n);

  function addFeed(html, cls) {
    const ul = el.feed;
    if (!ul) return;
    const li = document.createElement('li');
    li.innerHTML = html;
    if (cls) li.className = cls;
    ul.insertBefore(li, ul.firstChild);
    while (ul.children.length > 14) ul.removeChild(ul.lastChild);
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
    while (layer.children.length > 4) layer.removeChild(layer.firstChild);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, 4200);
  }

  function spark(x, y, text, cls) {
    const d = document.createElement('div');
    d.className = 'spark' + (cls ? ' ' + cls : '');
    d.textContent = text;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1050);
  }

  /** "120 sap, 40 wax" from a cost object, as plain text. */
  function costText(cost) {
    return Object.keys(cost).map(function (res) {
      const n = F.fmt(cost[res]);
      return n + ' ' + (res === 'bugs' ? 'bugs' : RES[res].name.toLowerCase());
    }).join(', ');
  }

  /**
   * The same, but the resource name is replaced by its icon. Each icon carries
   * data-res so the delegated handler below can name it on hover -- the icons
   * are unlabelled otherwise, and guessing is not a mechanic.
   */
  function costHtml(cost) {
    return Object.keys(cost).map(function (res) {
      const n = F.fmt(cost[res]);
      if (res === 'bugs') return '<span class="cost-part">' + n + ' bugs</span>';
      return '<span class="cost-part">' + n +
        '<img class="cost-icon" data-res="' + res + '" src="' + S.url(RES[res].sprite) +
        '" alt="' + RES[res].name + '"></span>';
    }).join('');
  }

  /* ---------------- tooltip ---------------- */

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
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { if (tip) tip.classList.remove('on'); };

  /**
   * Cost icons sit inside buttons that already have their own tooltip, so
   * hovering one takes the tooltip over and hands it straight back on the way
   * out rather than fighting the parent for it.
   */
  function wireCostIcons() {
    document.addEventListener('mouseover', function (ev) {
      const icon = ev.target.closest && ev.target.closest('.cost-icon[data-res]');
      if (!icon) return;
      const r = RES[icon.dataset.res];
      if (!r) return;
      showTip('<h4>' + r.name + '</h4><p class="tip-flavour">' + r.blurb + '</p>', ev);
    });
    document.addEventListener('mouseout', function (ev) {
      const icon = ev.target.closest && ev.target.closest('.cost-icon[data-res]');
      if (!icon) return;
      let node = icon.parentElement;
      while (node && !node.__tip) node = node.parentElement;
      if (node) showTip(node.__tip(), { clientX: ev.clientX, clientY: ev.clientY });
      else hideTip();
    });
  }

  function wireTip(node, build) {
    node.__tip = build;
    node.addEventListener('mouseenter', (ev) => showTip(build(), ev));
    node.addEventListener('mousemove', moveTip);
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('focus', () => {
      const r = node.getBoundingClientRect();
      showTip(build(), { clientX: r.right, clientY: r.bottom });
    });
    node.addEventListener('blur', hideTip);
  }

  function costLine(cost) {
    const ok = G.canPay(cost);
    const blocked = G.capBlocked(cost);
    let html = '<div class="tip-cost' + (ok ? '' : ' no') + '">' + costHtml(cost) + '</div>';
    if (blocked.length) {
      html += '<p class="tip-flavour">Your ' +
        blocked.map((r) => RES[r].name).join(' and ') +
        ' store is too small to hold that. Buy a bigger one first.</p>';
    }
    return html;
  }

  /* ====================================================================== *
   * the silos
   * ====================================================================== */

  function buildResourceBar() {
    const host = el.resourceBar;
    host.innerHTML = '';
    D.RESOURCES.forEach(function (r) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'res';
      d.dataset.id = r.id;
      d.innerHTML =
        '<span class="res-icon"></span>' +
        '<span class="res-name"></span>' +
        '<span class="res-figs"><span class="res-amount"></span><span class="res-rate"></span></span>' +
        '<span class="res-bar"><span class="res-fill"></span></span>' +
        '<span class="res-tithe"></span>';
      d.querySelector('.res-icon').appendChild(S.make(r.sprite, 30));
      d.querySelector('.res-name').textContent = r.name;
      d.addEventListener('click', function () {
        const t = G.tithe(r.id);
        if (!t) { A.sfx.deny(); return; }
        A.sfx.buy();
        const box = d.getBoundingClientRect();
        spark(box.left + box.width / 2, box.top + 6, '+' + F.fmt(t.bugs));
        refreshAll();
      });
      wireTip(d, function () {
        const ch = G.chain;
        const caps = G.caps();
        const net = ch ? ch.net[r.id] : 0;
        const made = ch ? ch.produced[r.id] : 0;
        const used = ch ? ch.consumed[r.id] : 0;
        return '<div class="tip-kind">Store</div><h4>' + r.name + '</h4>' +
          '<p class="tip-flavour">' + r.blurb + '</p>' +
          '<p>Making <b>' + rate(made) + '</b> a second, using <b>' + rate(used) + '</b>.<br>' +
          'Net <b>' + signed(net) + '</b> a second.</p>' +
          '<p>Holding <b>' + F.commas(G.state.stocks[r.id]) + '</b> of <b>' +
          F.commas(caps[r.id]) + '</b>.</p>' +
          (D.RAW.indexOf(r.id) >= 0 ? '<p class="tip-flavour">You can gather this by hand.</p>' : '') +
          '<p>Click to tithe <b>' + F.fmt(G.titheValue(r.id).amount) + '</b> to the Queen for <b>' +
          F.commas(G.titheValue(r.id).bugs) + '</b> bugs. She pays badly, but she always pays.</p>';
      });
      el['res_' + r.id] = d;
      host.appendChild(d);
    });
  }

  function refreshResourceBar() {
    const st = G.state;
    const ch = G.chain;
    const caps = G.caps();
    D.RESOURCES.forEach(function (r) {
      const d = el['res_' + r.id];
      if (!d) return;
      const have = st.stocks[r.id];
      const cap = caps[r.id];
      const net = ch ? ch.net[r.id] : 0;

      d.querySelector('.res-amount').textContent = F.fmt(have) + ' / ' + F.fmt(cap);
      const rEl = d.querySelector('.res-rate');
      rEl.textContent = signed(net) + '/s';
      rEl.className = 'res-rate' + (net > 0.01 ? '' : net < -0.01 ? ' neg' : ' zero');
      d.querySelector('.res-fill').style.width = Math.min(100, (have / cap) * 100) + '%';

      const t = G.titheValue(r.id);
      d.querySelector('.res-tithe').textContent =
        t.bugs > 0 ? 'tithe +' + F.fmt(t.bugs) : 'empty';

      d.classList.toggle('full', have >= cap - 0.5 && net > 0);
      d.classList.toggle('dry', have < cap * 0.02 && net < -0.01);
    });
  }

  /* ====================================================================== *
   * the chain
   * ====================================================================== */

  function ioChip(resId, amount, dir, short) {
    const r = RES[resId];
    return '<span class="io ' + dir + (short ? ' short' : '') + '">' +
      '<img src="' + S.url(r.sprite) + '" alt="">' + rate(amount) + '</span>';
  }

  function buildBuildings() {
    const host = el.buildingList;
    host.innerHTML = '';
    D.BUILDINGS.forEach(function (b) {
      const d = document.createElement('div');
      d.className = 'bld';
      d.dataset.id = b.id;
      d.innerHTML =
        '<div class="bld-art"></div>' +
        '<div class="bld-body">' +
          '<div class="bld-top"><span class="bld-name"></span><span class="bld-own">0</span></div>' +
          '<div class="bld-io"></div>' +
          '<div class="bld-eff" title="Supply"><div class="bld-eff-fill"></div></div>' +
          '<div class="bld-crewbar" title="Crew"><div class="bld-crew-fill"></div></div>' +
          '<div class="bld-note"></div>' +
        '</div>' +
        '<div class="bld-side">' +
          '<button class="bld-buy" type="button">Build<span class="price"></span></button>' +
          '<div class="crew">' +
            '<div class="crew-fig"><span class="crew-has">0</span>' +
              '<span class="crew-of"> / </span><span class="crew-need">0</span></div>' +
            '<div class="crew-btns" role="group" aria-label="Crew">' +
              '<button type="button" data-d="-10">-10</button>' +
              '<button type="button" data-d="-1">-1</button>' +
              '<button type="button" data-d="1">+1</button>' +
              '<button type="button" data-d="10">+10</button>' +
              '<button type="button" data-d="max">max</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      d.querySelector('.bld-art').appendChild(S.make(b.sprite, 42));
      d.querySelector('.bld-name').textContent = b.name;

      const buy = d.querySelector('.bld-buy');
      buy.addEventListener('click', function () {
        const n = G.buyBuilding(b.id);
        if (n > 0) { A.sfx.buy(); refreshAll(); } else { A.sfx.deny(); }
      });
      wireTip(buy, function () {
        const qty = G.wantQty(b.id);
        const cost = G.buildingCost(b.id, qty);
        const per = G.unitRates(b.id);
        const ins = Object.keys(per.ins).map((k) => rate(per.ins[k]) + ' ' + RES[k].name.toLowerCase());
        const outs = Object.keys(per.outs).map((k) => rate(per.outs[k]) + ' ' + RES[k].name.toLowerCase());
        if (per.bugs) outs.push(rate(per.bugs) + ' bugs');
        const nextCrew = G.crewNeeded(b.id);
        return '<div class="tip-kind">Building' + (qty > 1 ? ' x' + qty : '') + '</div>' +
          '<h4>' + b.name + '</h4>' +
          '<p class="tip-flavour">' + b.blurb + '</p>' +
          '<p>Each one ' +
            (ins.length ? 'takes <b>' + ins.join(' and ') + '</b> a second and ' : '') +
            'makes <b>' + (outs.join(' and ') || 'nothing on its own') + '</b> a second.</p>' +
          '<p>Your ' + b.name + 's want <b>' + F.commas(nextCrew) + '</b> bugs to run at full tilt. ' +
          'Each one you add wants more crew than the last, and crews grow with the ' +
          'size of the colony, so you will never staff everything at once.</p>' +
          costLine(cost);
      });

      d.querySelectorAll('.crew-btns button').forEach(function (t) {
        t.addEventListener('click', function () {
          const moved = t.dataset.d === 'max'
            ? G.assign(b.id, G.crewNeeded(b.id))
            : G.assign(b.id, Number(t.dataset.d));
          if (moved) A.sfx.tick(); else A.sfx.deny();
          refreshAll();
        });
      });

      el['bld_' + b.id] = d;
      host.appendChild(d);
    });
  }

  function refreshBuildings() {
    const st = G.state;
    const ch = G.chain;

    D.BUILDINGS.forEach(function (b) {
      const d = el['bld_' + b.id];
      if (!d) return;

      const unlocked = G.buildingUnlocked(b.id);
      d.classList.toggle('locked', !unlocked);
      if (!unlocked) {
        d.querySelector('.bld-name').textContent = 'Something further down';
        d.querySelector('.bld-io').innerHTML = '';
        d.querySelector('.bld-note').textContent = 'Not yet.';
        d.querySelector('.bld-own').textContent = '';
        d.querySelector('.bld-buy').disabled = true;
        d.querySelector('.bld-buy').querySelector('.price').textContent = '';
        return;
      }

      d.querySelector('.bld-name').textContent = b.name;
      const owned = st.owned[b.id];
      d.querySelector('.bld-own').textContent = owned;

      const r = G.buildingRates(b.id);
      const short = owned > 0 ? G.blockers(b.id) : [];
      const eff = owned > 0 ? r.eff : 1;

      // inputs -> outputs
      const parts = [];
      Object.keys(b.inputs).forEach(function (res) {
        parts.push(ioChip(res, r.ins[res] || 0, 'in', short.indexOf(res) >= 0));
      });
      if (Object.keys(b.inputs).length) parts.push('<span class="io-arrow">&rarr;</span>');
      Object.keys(b.outputs).forEach(function (res) {
        parts.push(ioChip(res, r.outs[res] || 0, 'out'));
      });
      if (b.brood) {
        parts.push('<span class="io out bugs">' + rate(r.bugs) + ' bugs</span>');
      }
      d.querySelector('.bld-io').innerHTML = parts.join('');

      d.querySelector('.bld-eff-fill').style.width = Math.round(eff * 100) + '%';
      d.querySelector('.bld-crew-fill').style.width =
        Math.round(G.staffing(b.id) * 100) + '%';

      const note = d.querySelector('.bld-note');
      const has = st.assigned[b.id] || 0;
      const need = G.crewNeeded(b.id);
      const staff = G.staffing(b.id);
      d.classList.toggle('idle', owned > 0 && has === 0);
      d.classList.toggle('starved', owned > 0 && has > 0 && eff < 0.92);

      d.querySelector('.crew-has').textContent = F.fmt(has);
      d.querySelector('.crew-need').textContent = F.fmt(need);

      if (owned === 0) {
        note.className = 'bld-note';
        note.textContent = 'None yet.';
      } else if (has === 0) {
        note.className = 'bld-note warn';
        note.textContent = 'No crew. Put bugs on it to start.';
      } else if (staff < 0.999) {
        note.className = 'bld-note warn';
        note.textContent = Math.round(staff * 100) + '% crewed' +
          (short.length ? ', short of ' + short.map((x) => RES[x].name.toLowerCase()).join(' and ') : '');
      } else if (short.length) {
        note.className = 'bld-note warn';
        note.textContent = Math.round(eff * 100) + '% - short of ' +
          short.map((x) => RES[x].name.toLowerCase()).join(' and ');
      } else {
        note.className = 'bld-note';
        note.textContent = Math.round(eff * 100) + '% - running clean';
      }

      // buy button
      const qty = G.wantQty(b.id);
      const cost = G.buildingCost(b.id, qty);
      const can = G.canPay(cost);
      const buy = d.querySelector('.bld-buy');
      buy.disabled = false;
      buy.classList.toggle('afford', can);
      buy.childNodes[0].nodeValue = qty > 1 ? 'Build x' + qty : 'Build';
      buy.querySelector('.price').innerHTML = costHtml(cost);

      const idle = G.idleBugs();
      d.querySelectorAll('.crew-btns button').forEach(function (t) {
        const v = t.dataset.d;
        t.disabled = owned === 0 || (v === 'max'
          ? (has >= need || idle <= 0)
          : Number(v) > 0 ? (idle <= 0 || has >= need) : has <= 0);
      });
    });
  }

  /* ====================================================================== *
   * the Queen
   * ====================================================================== */

  function refreshDemands() {
    const st = G.state;
    const sig = st.demands.map((d) => d.id).join(',');
    const host = el.demandList;

    if (sig !== sigs.demands) {
      sigs.demands = sig;
      host.innerHTML = '';
      if (!st.demands.length) {
        host.innerHTML = '<p class="demand-none">Nothing wanted right now. She will think of something.</p>';
      }
      st.demands.forEach(function (dm) {
        const d = document.createElement('div');
        d.className = 'demand';
        d.dataset.id = dm.id;
        d.innerHTML =
          '<div class="demand-top"><span class="demand-title">Order</span>' +
          '<span class="demand-timer"></span></div>' +
          '<div class="needs"></div>' +
          '<div class="demand-foot"><span class="demand-pay"></span>' +
          '<button class="deliver" type="button">Deliver</button></div>';

        const needs = d.querySelector('.needs');
        Object.keys(dm.need).forEach(function (res) {
          const n = document.createElement('div');
          n.className = 'need';
          n.dataset.res = res;
          n.innerHTML = '<span class="need-icon"></span><span class="need-name"></span>' +
            '<span class="need-fig"></span><span class="need-bar"><div></div></span>';
          n.querySelector('.need-icon').appendChild(S.make(RES[res].sprite, 22));
          n.querySelector('.need-name').textContent = RES[res].name;
          needs.appendChild(n);
        });

        d.querySelector('.demand-pay').textContent = '+' + F.commas(dm.reward) + ' bugs';
        d.querySelector('.deliver').addEventListener('click', function () {
          const r = G.deliver(dm.id);
          if (!r) return;
          if (r.done) A.sfx.demandDone();
          else if (r.moved > 0) A.sfx.buy();
          else A.sfx.deny();
          refreshAll();
        });
        host.appendChild(d);
      });
    }

    const now = Date.now();
    Array.prototype.forEach.call(host.children, function (d) {
      if (!d.dataset || !d.dataset.id) return;
      const dm = st.demands.find((x) => x.id === d.dataset.id);
      if (!dm) return;

      const left = (dm.expiresAt - now) / 1000;
      d.querySelector('.demand-timer').textContent = F.clock(left);
      d.classList.toggle('urgent', left < dm.window * 0.3);

      let ready = true;
      Array.prototype.forEach.call(d.querySelectorAll('.need'), function (n) {
        const res = n.dataset.res;
        const want = dm.need[res];
        const got = dm.given[res];
        const have = Math.min(want, got + st.stocks[res]);
        if (got + st.stocks[res] < want) ready = false;
        const fig = n.querySelector('.need-fig');
        fig.textContent = F.fmt(got) + ' / ' + F.fmt(want);
        fig.classList.toggle('done', got >= want);
        n.querySelector('.need-bar div').style.width =
          Math.min(100, (have / want) * 100) + '%';
      });

      d.classList.toggle('ready', ready);
      d.querySelector('.deliver').classList.toggle('ready', ready);
    });

    const streak = st.streak;
    el.streakChip.textContent = 'streak ' + streak +
      (streak > 0 ? '  x' + G.streakMult().toFixed(2) : '');
    el.streakChip.classList.toggle('hot', streak >= 3);
  }

  /* ====================================================================== *
   * upgrades, monuments, awards, stats
   * ====================================================================== */

  const KIND_LABEL = {
    yield: 'Output upgrade', thrift: 'Efficiency upgrade', cap: 'Storage upgrade',
    forage: 'Foraging upgrade', queen: 'Royal favour', global: 'Global upgrade',
  };

  function refreshUpgrades() {
    const list = G.availableUpgrades();
    const sig = list.map((u) => u.id).join(',');
    const host = el.upgradeGrid;

    if (sig !== sigs.upgrades) {
      sigs.upgrades = sig;
      host.innerHTML = '';
      list.forEach(function (u) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'up';
        b.dataset.id = u.id;
        b.appendChild(S.make(u.icon, 30));
        b.addEventListener('click', function () {
          if (G.buyUpgrade(u.id)) {
            A.sfx.upgrade();
            addFeed('Bought <b>' + u.name + '</b>.');
            hideTip();
            refreshAll();
          } else A.sfx.deny();
        });
        wireTip(b, () =>
          '<div class="tip-kind">' + (KIND_LABEL[u.kind] || 'Upgrade') + '</div>' +
          '<h4>' + u.name + '</h4><p>' + u.desc + '</p>' + costLine(u.cost));
        host.appendChild(b);
      });
      el.upgradesEmpty.style.display = list.length ? 'none' : '';
    }

    let ready = 0;
    Array.prototype.forEach.call(host.children, function (b) {
      const u = D.UPGRADES.find((x) => x.id === b.dataset.id);
      if (!u) return;
      const can = G.canPay(u.cost);
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
      visible.forEach(function (m) {
        const owned = !!st.monuments[m.id];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mon' + (owned ? ' owned' : '');
        b.dataset.id = m.id;
        b.innerHTML =
          '<span class="mon-art"></span><span class="mon-body">' +
            '<span class="mon-title"></span><span class="mon-blurb"></span>' +
            '<span class="mon-effect"></span><span class="mon-perk"></span>' +
            '<span class="mon-cost"></span></span>';
        b.querySelector('.mon-art').appendChild(S.make(m.sprite, 66));
        b.querySelector('.mon-title').textContent = m.name;
        b.querySelector('.mon-blurb').textContent = m.blurb;
        b.querySelector('.mon-effect').textContent = m.effect;
        b.querySelector('.mon-perk').textContent = m.extra;
        if (!owned) {
          b.addEventListener('click', function () {
            if (G.buyMonument(m.id)) { hideTip(); refreshAll(); } else A.sfx.deny();
          });
          wireTip(b, () => '<div class="tip-kind">Monument</div><h4>' + m.name + '</h4>' +
            '<p>' + m.effect + '</p><p>' + m.extra + '</p>' + costLine(m.cost));
        }
        host.appendChild(b);
      });
    }

    let ready = 0;
    Array.prototype.forEach.call(host.children, function (b) {
      if (!b.dataset || !b.dataset.id) return;
      const m = D.MONUMENTS.find((x) => x.id === b.dataset.id);
      if (!m) return;
      const cost = b.querySelector('.mon-cost');
      if (!cost) return;
      if (st.monuments[m.id]) {
        cost.classList.remove('no');
        cost.classList.add('raised');
        cost.textContent = 'Raised';
        return;
      }
      const can = G.canPay(m.cost);
      b.classList.toggle('afford', can);
      cost.classList.remove('raised');
      cost.classList.toggle('no', !can);
      cost.innerHTML = costHtml(m.cost);
      if (can) ready++;
    });
    setBadge(el.badgeMonuments, ready);
  }

  function refreshAwards() {
    const st = G.state;
    const got = Object.keys(st.awards).length;
    if (sigs.awards === got) return;
    sigs.awards = got;

    el.awardGrid.innerHTML = '';
    D.ACHIEVEMENTS.forEach(function (a) {
      const has = !!st.awards[a.id];
      const d = document.createElement('div');
      d.className = 'award' + (has ? ' got' : '');
      d.innerHTML = '<div class="award-name"></div><div class="award-desc"></div>';
      d.querySelector('.award-name').textContent = has ? a.name : 'Locked';
      d.querySelector('.award-desc').textContent = a.desc;
      el.awardGrid.appendChild(d);
    });
    el.badgeAwards.textContent = got + '/' + D.ACHIEVEMENTS.length;
    el.badgeAwards.classList.remove('zero');
  }

  function refreshStats() {
    if (!el.panelStats.classList.contains('active')) return;
    const t = G.stats();
    const total = t.broodBugs + t.demandBugs;
    const rows = [
      ['Bugs on hand', bugText(t.bugs)],
      ['Bugs all time', bugText(t.lifetime)],
      ['Hatching per second', rate(t.bps)],
      ['Best per second', rate(t.bestBps)],
      ['From the brood', total ? Math.round(t.broodBugs / total * 100) + '%' : '0%'],
      ['From the Queen', total ? Math.round(t.demandBugs / total * 100) + '%' : '0%'],
      ['From tithes', total ? Math.round(t.titheBugs / (total + t.titheBugs) * 100) + '%' : '0%'],
      ['Bugs at work', F.commas(t.crew) + ' / ' + F.commas(t.crewNeed)],
      ['Idle bugs', F.commas(t.idle)],
      ['Demands filled', F.commas(t.demandsFilled)],
      ['Demands missed', F.commas(t.demandsMissed)],
      ['Best streak', F.commas(t.bestStreak)],
      ['Gathered by hand', bugText(t.foraged)],
      ['Buildings', F.commas(t.buildings)],
      ['Upgrades', t.upgrades + ' / ' + t.upgradeTotal],
      ['Monuments', t.monuments + ' / 3'],
      ['Awards', t.awards + ' / ' + t.awardTotal],
      ['Honey Bugs caught', F.commas(t.goldens)],
      ['Wasps swatted', F.commas(t.waspsSwatted)],
      ['Moths caught', F.commas(t.moths)],
      ['Lost to overflow', bugText(t.wasted)],
      ['Time in the log', F.duration(t.played)],
    ];
    el.statsBody.innerHTML = rows.map((r) =>
      '<div class="stat"><div class="stat-k">' + r[0] + '</div><div class="stat-v">' + r[1] + '</div></div>'
    ).join('');
  }

  /* ====================================================================== *
   * header, forage, status
   * ====================================================================== */

  function refreshHeader() {
    const st = G.state;
    el.bugCount.textContent = bugText(st.bugs);
    el.bugWord.textContent = Math.floor(st.bugs) === 1 ? 'bug' : 'bugs';
    el.bps.textContent = rate(G.bps());
    el.idleCount.textContent = F.commas(G.idleBugs());
    el.crewCount.textContent = F.commas(Math.max(0, Math.floor(st.bugs) - G.idleBugs()));
    el.clickValue.textContent = rate(G.forageValue()) + ' ' + RES[st.forageTarget].name.toLowerCase();

    const frac = Math.min(1, st.bugs / D.GOAL);
    el.goalFill.style.width = (frac * 100).toFixed(2) + '%';
    el.goalFigures.textContent = bugText(st.bugs) + ' / ' + F.commas(D.GOAL);
  }

  function buildForagePicker() {
    const host = el.foragePick;
    host.innerHTML = '';
    D.RAW.forEach(function (id) {
      const r = RES[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'forage-opt';
      b.dataset.res = id;
      b.appendChild(S.make(r.sprite, 20));
      const span = document.createElement('span');
      span.textContent = r.name;
      b.appendChild(span);
      b.addEventListener('click', function () {
        G.setForageTarget(id);
        A.sfx.tick();
        refreshForagePicker();
        refreshHeader();
      });
      host.appendChild(b);
    });
  }

  function refreshForagePicker() {
    Array.prototype.forEach.call(el.foragePick.children, function (b) {
      b.classList.toggle('active', b.dataset.res === G.state.forageTarget);
    });
  }

  function refreshStatus() {
    const st = G.state;
    const now = Date.now();
    const items = [];
    if (st.weather) items.push({ key: 'w' + st.weather.id, w: st.weather });
    st.boons.forEach((b) => items.push({ key: 'b' + b.id, boon: b }));

    const sig = items.map((i) => i.key).join(',');
    if (sig !== sigs.status) {
      sigs.status = sig;
      el.statusStrip.innerHTML = '';
      items.forEach(function (it) {
        const d = document.createElement('div');
        const bad = it.w && !it.w.good;
        d.className = 'status' + (bad ? ' bad' : '');
        d.innerHTML = '<span class="status-name"></span><span class="status-desc"></span>' +
          '<span class="status-time"></span>';
        d.querySelector('.status-name').textContent = it.w ? it.w.name : it.boon.name;
        d.querySelector('.status-desc').textContent = it.w ? it.w.desc : '';
        el.statusStrip.appendChild(d);
      });
    }
    Array.prototype.forEach.call(el.statusStrip.children, function (d, i) {
      const it = items[i];
      if (!it) return;
      const ends = it.w ? it.w.endsAt : it.boon.endsAt;
      d.querySelector('.status-time').textContent = F.clock((ends - now) / 1000);
    });
  }

  /* ====================================================================== *
   * visitors
   * ====================================================================== */

  function describeCache(given) {
    const parts = Object.keys(given).map((k) => F.fmt(given[k]) + ' ' + RES[k].name.toLowerCase());
    if (!parts.length) return 'nothing you had room for';
    return parts.slice(0, 3).join(', ') + (parts.length > 3 ? ' and more' : '');
  }

  function spawnHoney() {
    A.sfx.honeySpawn();
    addFeed('A <b>Honey Bug</b> has surfaced somewhere. Find it.', 'good');
    C.spawnVisitor({
      sprite: 'honeyBug', id: 'honey-visitor', label: 'A Honey Bug. Click it.',
      px: 46, speed: 58, life: 14,
      onCatch(x, y) {
        const r = G.catchHoney();
        A.sfx.honeyCatch();
        if (r.gift) {
          spark(x, y, '+' + F.fmt(r.gift), 'big');
          addFeed('Tribute: <b>' + F.commas(r.gift) + '</b> bugs.', 'good');
          toast('Tribute', F.commas(r.gift) + ' bugs', 'honeyBug');
        } else if (r.given) {
          spark(x, y, 'CACHE', 'big');
          addFeed('A cache: <b>' + describeCache(r.given) + '</b>.', 'good');
          toast('Cache', describeCache(r.given), 'honeyBug');
        } else {
          spark(x, y, r.boon.name.toUpperCase(), 'big');
          addFeed('<b>' + r.boon.name + '</b> - ' + r.boon.desc, 'good');
          toast(r.boon.name, r.boon.desc, 'honeyBug');
        }
        refreshAll();
      },
      onGone() { addFeed('The Honey Bug slipped back under the log.'); },
    });
  }

  function spawnMoth() {
    addFeed('A pale <b>moth</b> is circling the light.', 'good');
    C.spawnVisitor({
      sprite: 'mothPale', id: 'moth-visitor', label: 'A pale moth. Click it.',
      px: 44, speed: 46, life: 16, wander: 0.7,
      onCatch(x, y) {
        const given = G.catchMoth();
        A.sfx.honeyCatch();
        spark(x, y, 'CACHE', 'res');
        addFeed('The moth left <b>' + describeCache(given) + '</b>.', 'good');
        toast('Moonlight visitor', describeCache(given), 'mothPale');
        refreshAll();
      },
      onGone() { addFeed('The moth wandered off towards the moon.'); },
    });
  }

  function spawnWasp() {
    A.sfx.waspSpawn();
    const warded = !!G.state.monuments.mantisTemple;
    addFeed(warded
      ? 'A wasp circles, thinks better of it, and keeps its distance.'
      : 'A <b>wasp</b> is raiding the stores. Swat it.', warded ? '' : 'bad');
    C.spawnVisitor({
      sprite: 'wasp', id: 'wasp-visitor', label: 'A raiding wasp. Click to swat it.',
      px: 42, speed: 108, life: 9, wander: 2.1,
      onCatch(x, y) {
        const r = G.swatWasp();
        A.sfx.waspHit();
        spark(x, y, '+' + F.fmt(r.gift), 'big');
        addFeed('Wasp swatted. It dropped <b>' + describeCache(r.given) + '</b>.', 'good');
        refreshAll();
      },
      onGone() {
        const r = G.waspEscaped();
        if (r.warded) {
          addFeed('The wasp fled the Mantis Temple, dropping <b>' +
            describeCache(r.given) + '</b>.', 'good');
        } else {
          A.sfx.waspSteal();
          const name = r.res ? RES[r.res].name.toLowerCase() : 'something';
          addFeed('The wasp got away with <b>' + F.commas(r.taken) + ' ' + name + '</b>.', 'bad');
          toast('Raided', F.commas(r.taken) + ' ' + name + ' taken', 'wasp', 'bad');
        }
        refreshAll();
      },
    });
  }

  /* ====================================================================== *
   * foraging
   * ====================================================================== */

  function doForage(ev) {
    const before = G.state.forageTarget;
    const r = G.forage();
    A.sfx.forage(r.full);

    el.heroBtn.classList.remove('jolt');
    void el.heroBtn.offsetWidth;
    el.heroBtn.classList.add('jolt');

    const box = el.heroBtn.getBoundingClientRect();
    const x = ev && ev.clientX ? ev.clientX : box.left + box.width / 2;
    const y = ev && ev.clientY ? ev.clientY : box.top + box.height / 2;
    if (r.gain > 0.05) {
      spark(x, y, '+' + F.fmt(r.gain), 'res');
    } else {
      spark(x, y, 'FULL');
    }
    refreshResourceBar();
    refreshHeader();
  }

  /* ====================================================================== *
   * tabs, victory, wiring
   * ====================================================================== */

  function selectTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      const on = t.dataset.panel === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(function (p) {
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
  }

  function showVictory(t) {
    const total = t.broodBugs + t.demandBugs;
    el.victoryLine.textContent =
      'One million bugs, held all at once, ' + F.duration(t.played) + ' after you lifted the log.';
    const rows = [
      ['Time taken', F.duration(t.played)],
      ['Demands filled', F.commas(t.demandsFilled)],
      ['Best streak', F.commas(t.bestStreak)],
      ['From the brood', total ? Math.round(t.broodBugs / total * 100) + '%' : '0%'],
      ['Buildings', F.commas(t.buildings)],
      ['Awards', t.awards + ' / ' + t.awardTotal],
    ];
    el.victoryStats.innerHTML = rows.map((r) =>
      '<div class="stat"><div class="stat-k">' + r[0] + '</div><div class="stat-v">' + r[1] + '</div></div>'
    ).join('');
    el.victory.hidden = false;
    A.sfx.victory();
  }

  function buildGateChain() {
    const host = el.gateChain;
    if (!host) return;
    const seq = ['resSap', 'resHoneydew', 'resPollen', 'resWax'];
    host.innerHTML = '';
    seq.forEach(function (sp, i) {
      if (i) {
        const a = document.createElement('span');
        a.textContent = '>';
        host.appendChild(a);
      }
      host.appendChild(S.make(sp, 26));
    });
    const a = document.createElement('span');
    a.textContent = '> BUGS';
    host.appendChild(a);
  }

  /* ---------------- refresh ---------------- */

  function refreshFast() {
    refreshHeader();
    refreshResourceBar();
    refreshDemands();
    refreshStatus();
  }

  function refreshAll() {
    refreshFast();
    refreshBuildings();
    refreshUpgrades();
    refreshMonuments();
    refreshAwards();
    refreshStats();
    refreshForagePicker();
    C.setPopulation(G.crawlerCount());
  }

  /* ---------------- wiring ---------------- */

  function cache() {
    [
      'brand-bug', 'goal-fill', 'goal-figures', 'bug-count', 'bug-word', 'bps',
      'click-value', 'hero-btn', 'hero-img', 'forage-pick', 'status-strip', 'feed',
      'idle-count', 'crew-count', 'autostaff-btn', 'recall-btn',
      'resource-bar', 'building-list', 'demand-list', 'streak-chip',
      'upgrade-grid', 'upgrades-empty', 'monument-list', 'award-grid', 'stats-body',
      'panel-stats', 'badge-upgrades', 'badge-monuments', 'badge-awards',
      'music-toggle', 'music-vol', 'sfx-toggle',
      'victory', 'victory-line', 'victory-stats', 'victory-btn', 'victory-bug',
      'gate', 'gate-btn', 'gate-bug', 'gate-chain',
      'export-btn', 'import-btn', 'wipe-btn',
    ].forEach(function (id) {
      el[id.replace(/-([a-z])/g, (m, ch) => ch.toUpperCase())] = $(id);
    });
  }

  function wire() {
    el.heroBtn.addEventListener('click', doForage);

    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => selectTab(t.dataset.panel)));

    document.querySelectorAll('.qty').forEach(function (q) {
      q.addEventListener('click', function () {
        G.state.settings.buyQty = q.dataset.qty === 'max' ? 'max' : Number(q.dataset.qty);
        document.querySelectorAll('.qty').forEach((o) => o.classList.toggle('active', o === q));
        refreshBuildings();
      });
    });

    el.musicToggle.addEventListener('click', function () {
      A.music.toggle().then(function () {
        G.state.settings.music = A.music.on;
        syncAudioChips();
      });
    });
    el.musicVol.addEventListener('input', function () {
      const v = Number(el.musicVol.value) / 100;
      A.music.setVolume(v);
      G.state.settings.musicVol = v;
    });
    el.sfxToggle.addEventListener('click', function () {
      const next = !G.state.settings.sfx;
      G.state.settings.sfx = next;
      A.setSfx(next);
      syncAudioChips();
      if (next) A.sfx.tick();
    });

    el.autostaffBtn.addEventListener('click', function () {
      const n = G.autoStaff();
      if (n) { A.sfx.buy(); addFeed('Sent <b>' + F.commas(n) + '</b> idle bugs to work.'); }
      else A.sfx.deny();
      refreshAll();
    });
    el.recallBtn.addEventListener('click', function () {
      const n = G.recallAll();
      if (n) { A.sfx.tick(); addFeed('Called <b>' + F.commas(n) + '</b> bugs off the job.'); }
      refreshAll();
    });

    el.victoryBtn.addEventListener('click', function () { el.victory.hidden = true; });

    el.exportBtn.addEventListener('click', function () {
      const code = G.exportSave();
      if (navigator.clipboard && code) {
        navigator.clipboard.writeText(code)
          .then(() => toast('Save copied', 'Paste it somewhere safe'))
          .catch(() => window.prompt('Copy this save code:', code));
      } else window.prompt('Copy this save code:', code);
    });
    el.importBtn.addEventListener('click', function () {
      const code = window.prompt('Paste a save code:');
      if (!code) return;
      if (G.importSave(code)) { resetSigs(); rebuild(); toast('Save loaded', 'Welcome back'); }
      else toast('That code did not read', 'Nothing was changed');
    });
    el.wipeBtn.addEventListener('click', function () {
      if (!window.confirm('Burn the log? Every bug, building and award is lost for good.')) return;
      G.wipe();
      resetSigs();
      rebuild();
      addFeed('The log is ash. Something is already moving in it.');
    });

    // space forages when nothing else has focus
    document.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space') return;
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA')) return;
      ev.preventDefault();
      doForage();
    });

    window.addEventListener('resize', hideTip);
  }

  function resetSigs() {
    ['upgrades', 'monuments', 'awards', 'demands', 'status'].forEach((k) => { sigs[k] = undefined; });
  }

  function rebuild() {
    buildResourceBar();
    buildBuildings();
    buildForagePicker();
    refreshAll();
  }

  function subscribe() {
    G.on('award', function (a) {
      A.sfx.award();
      toast(a.name, a.desc, 'iconCrown', 'award');
      addFeed('Award: <b>' + a.name + '</b>.', 'good');
    });
    G.on('monument', function (m) {
      A.sfx.monument();
      toast(m.name + ' raised', m.effect, m.sprite);
      addFeed('<b>' + m.name + '</b> stands. ' + m.extra, 'good');
    });
    G.on('tithe', function (e) {
      addFeed('Tithed <b>' + F.fmt(e.amount) + ' ' + RES[e.res].name.toLowerCase() +
        '</b> for <b>' + F.commas(e.bugs) + '</b> bugs.');
    });
    G.on('demandNew', function (d) {
      A.sfx.demandNew();
      const what = Object.keys(d.need).map((r) => F.fmt(d.need[r]) + ' ' + RES[r].name.toLowerCase());
      addFeed('The Queen wants <b>' + what.join(' and ') + '</b>.');
    });
    G.on('demandDone', function (e) {
      addFeed('Order filled for <b>' + F.commas(e.reward) + '</b> bugs. Streak ' + e.streak + '.', 'good');
      toast('Order filled', '+' + F.commas(e.reward) + ' bugs', 'iconScroll');
    });
    G.on('demandMissed', function () {
      A.sfx.deny();
      addFeed('An order expired. The streak is broken.', 'bad');
      toast('Order missed', 'Streak reset', 'iconScroll', 'bad');
    });
    G.on('weather', function (w) {
      A.sfx.milestone();
      addFeed('<b>' + w.name + '</b> - ' + w.desc, w.good ? 'good' : 'bad');
      toast(w.name, w.desc, w.good ? 'iconLeaf' : 'iconGear', w.good ? '' : 'bad');
    });
    G.on('milestone', function (m) {
      A.sfx.milestone();
      addFeed('The count passes <b>' + Math.round(m * 100) + '%</b> of a million.', 'good');
    });
    G.on('honeySpawn', spawnHoney);
    G.on('mothSpawn', spawnMoth);
    G.on('waspSpawn', spawnWasp);
    G.on('victory', showVictory);
  }

  /* ---------------- boot ---------------- */

  function init(offline) {
    cache();
    S.paint(el.brandBug, 'ant', 34);
    S.paint(el.heroImg, 'heroBeetle', 108);
    S.paint(el.gateBug, 'heroBeetle', 92);
    S.paint(el.victoryBug, 'queenBee', 92);
    buildGateChain();

    wire();
    wireCostIcons();
    subscribe();

    const set = G.state.settings;
    el.musicVol.value = Math.round(set.musicVol * 100);
    A.music.setVolume(set.musicVol);
    A.setSfx(set.sfx);
    document.querySelectorAll('.qty').forEach(function (q) {
      const v = q.dataset.qty === 'max' ? 'max' : Number(q.dataset.qty);
      q.classList.toggle('active', v === set.buyQty);
    });
    syncAudioChips();

    rebuild();

    if (offline) {
      addFeed('You were away for <b>' + F.duration(offline.away) + '</b>. The brood kept ' +
        'hatching and banked <b>' + F.commas(offline.gain) + '</b> bugs. No orders were filled.', 'good');
      toast('While you were out', F.commas(offline.gain) + ' bugs from the brood', 'grub');
    } else if (G.state.lifetime <= 25) {
      addFeed('You lift the log. Underneath, an operation is already running.');
      addFeed('Gather sap by hand, then buy a <b>Sap Tapper</b> to do it for you.');
    }
  }

  root.BUGS_UI = { init, refreshAll, refreshFast, toast, addFeed, syncAudioChips };
})(typeof self !== 'undefined' ? self : this);
