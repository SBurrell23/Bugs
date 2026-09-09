/* ==========================================================================
   crawlers.js - the bugs that wander over the screen.

   Two kinds of movers live here:
     - ambient crawlers, which are decoration and ignore the mouse
     - visitors (Honey Bugs and wasps), which you are meant to click

   Every sprite is drawn head-up, so a mover's heading is applied as a
   rotation of (heading + 90 degrees).
   ========================================================================== */
(function (root) {
  'use strict';

  const SPECIES = ['crawlAnt', 'roach', 'crawlLadybug', 'spider', 'groundBeetle',
    'centipede', 'termite', 'weevil'];
  const MAX = 46;

  const layer = () => document.getElementById('crawl-layer');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let crawlers = [];
  let visitors = [];
  let asked = 0;
  let want = 0;
  let enabled = true;
  let running = false;
  let last = 0;

  /* ---------------- ambient crawlers ---------------- */

  function makeCrawler() {
    const S = root.BUGS_SPRITES;
    const el = document.createElement('img');
    el.className = 'crawler';
    el.alt = '';
    el.draggable = false;
    const species = pick(SPECIES);
    const px = Math.round(rnd(18, 30));
    el.src = S.url(species);
    el.width = px;
    el.height = px;

    const w = window.innerWidth, h = window.innerHeight;
    const c = {
      el,
      x: rnd(0, w),
      y: rnd(0, h),
      heading: rnd(0, Math.PI * 2),
      speed: rnd(14, 44),
      wobble: rnd(0.5, 2.2),
      // bugs move in bursts with little pauses, which reads as much more alive
      // than a constant glide
      goFor: rnd(0.8, 3.2),
      restFor: 0,
      scuttle: rnd(7, 13),
      phase: rnd(0, Math.PI * 2),
    };
    (layer() || document.body).appendChild(el);
    return c;
  }

  /**
   * A count that reads as a lively scatter on a laptop would bury the text on a
   * phone, so the requested population is scaled by how much screen there is.
   */
  function fitToScreen(n) {
    const area = window.innerWidth * window.innerHeight;
    const factor = Math.max(0.3, Math.min(1, area / (1280 * 720)));
    return Math.round(n * factor);
  }

  function setPopulation(n) {
    asked = Math.max(0, Math.min(MAX, Math.floor(n)));
    want = fitToScreen(asked);
    if (!enabled) return;
    while (crawlers.length < want) crawlers.push(makeCrawler());
    while (crawlers.length > want) {
      const c = crawlers.pop();
      if (c && c.el.parentNode) c.el.parentNode.removeChild(c.el);
    }
  }

  function clearAll() {
    crawlers.forEach((c) => { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    crawlers = [];
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) clearAll();
    else setPopulation(asked);   // asked, not want: want is already screen-scaled
  }

  function stepCrawler(c, dt, t) {
    const w = window.innerWidth, h = window.innerHeight;

    if (c.restFor > 0) {
      c.restFor -= dt;
      // a resting bug still twitches its heading a little
      c.heading += Math.sin(t * 3 + c.phase) * dt * 0.4;
    } else {
      c.goFor -= dt;
      if (c.goFor <= 0) {
        c.restFor = rnd(0.25, 1.6);
        c.goFor = rnd(0.8, 3.4);
        c.heading += rnd(-1.2, 1.2);
      }
      c.heading += Math.sin(t * c.wobble + c.phase) * dt * 1.5;

      // a small speed oscillation gives the legs an implied gait
      const gait = 1 + Math.sin(t * c.scuttle + c.phase) * 0.28;
      c.x += Math.cos(c.heading) * c.speed * gait * dt;
      c.y += Math.sin(c.heading) * c.speed * gait * dt;

      // turn away from the edges instead of sticking to them
      const m = 26;
      if (c.x < m) c.heading += dt * 3;
      if (c.x > w - m) c.heading += dt * 3;
      if (c.y < m) c.heading += dt * 3;
      if (c.y > h - m) c.heading += dt * 3;
      c.x = Math.max(-30, Math.min(w + 30, c.x));
      c.y = Math.max(-30, Math.min(h + 30, c.y));
    }

    const deg = (c.heading * 180) / Math.PI + 90;
    c.el.style.transform =
      'translate3d(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px,0) rotate(' + deg.toFixed(1) + 'deg)';
  }

  /* ---------------- visitors ---------------- */

  /**
   * Send a clickable bug across the screen.
   * opts: { sprite, id, px, speed, life, onCatch, onGone, wander }
   * Returns a handle with .remove().
   */
  function spawnVisitor(opts) {
    const S = root.BUGS_SPRITES;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'visitor';
    if (opts.id) btn.id = opts.id;
    btn.setAttribute('aria-label', opts.label || 'A bug worth clicking');

    const px = opts.px || 44;
    const img = document.createElement('img');
    img.src = S.url(opts.sprite);
    img.alt = '';
    img.width = px;
    img.height = px;
    img.draggable = false;
    btn.appendChild(img);

    const w = window.innerWidth, h = window.innerHeight;
    // come in from an edge and head roughly across the screen
    const edge = Math.floor(Math.random() * 4);
    const start = [
      { x: rnd(0.1, 0.9) * w, y: -px },
      { x: w + px, y: rnd(0.1, 0.9) * h },
      { x: rnd(0.1, 0.9) * w, y: h + px },
      { x: -px, y: rnd(0.1, 0.9) * h },
    ][edge];

    const target = { x: rnd(0.2, 0.8) * w, y: rnd(0.2, 0.8) * h };

    const v = {
      el: btn,
      x: start.x,
      y: start.y,
      px,
      heading: Math.atan2(target.y - start.y, target.x - start.x),
      speed: opts.speed || 66,
      life: opts.life || 14,
      wander: opts.wander === undefined ? 1.1 : opts.wander,
      phase: rnd(0, Math.PI * 2),
      caught: false,
      onGone: opts.onGone,
    };

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (v.caught) return;
      v.caught = true;
      if (opts.onCatch) opts.onCatch(v.x + px / 2, v.y + px / 2);
      remove(v);
    });

    (layer() || document.body).appendChild(btn);
    visitors.push(v);

    v.remove = () => remove(v);
    return v;
  }

  function remove(v) {
    const i = visitors.indexOf(v);
    if (i >= 0) visitors.splice(i, 1);
    if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
  }

  function stepVisitor(v, dt, t) {
    v.life -= dt;
    if (v.life <= 0) {
      const cb = v.onGone;
      remove(v);
      if (cb) cb();
      return;
    }

    v.heading += Math.sin(t * v.wander + v.phase) * dt * 2.2;

    const w = window.innerWidth, h = window.innerHeight;
    const m = 10;
    if (v.x < m && Math.cos(v.heading) < 0) v.heading = Math.PI - v.heading;
    if (v.x > w - v.px - m && Math.cos(v.heading) > 0) v.heading = Math.PI - v.heading;
    if (v.y < m && Math.sin(v.heading) < 0) v.heading = -v.heading;
    if (v.y > h - v.px - m && Math.sin(v.heading) > 0) v.heading = -v.heading;

    v.x += Math.cos(v.heading) * v.speed * dt;
    v.y += Math.sin(v.heading) * v.speed * dt;
    v.x = Math.max(0, Math.min(w - v.px, v.x));
    v.y = Math.max(0, Math.min(h - v.px, v.y));

    // fade out over the last two seconds so vanishing never feels like a bug
    const fade = v.life < 2 ? Math.max(0.15, v.life / 2) : 1;
    const deg = (v.heading * 180) / Math.PI + 90;
    v.el.style.opacity = fade;
    v.el.style.transform =
      'translate3d(' + v.x.toFixed(1) + 'px,' + v.y.toFixed(1) + 'px,0) rotate(' + deg.toFixed(1) + 'deg)';
  }

  /* ---------------- loop ---------------- */

  function frame(ts) {
    if (!running) return;
    if (!last) last = ts;
    // clamp so a backgrounded tab does not teleport everything on return
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    const t = ts / 1000;

    if (enabled) for (const c of crawlers) stepCrawler(c, dt, t);
    for (let i = visitors.length - 1; i >= 0; i--) stepVisitor(visitors[i], dt, t);

    requestAnimationFrame(frame);
  }

  function begin() {
    if (running) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { setPopulation(asked); }, 250);
  });

  root.BUGS_CRAWLERS = {
    begin, setPopulation, setEnabled, spawnVisitor,
    get population() { return crawlers.length; },
    get enabled() { return enabled; },
    clearVisitors() { visitors.slice().forEach(remove); },
  };
})(typeof self !== 'undefined' ? self : this);
