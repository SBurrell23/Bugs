/* ==========================================================================
   sprites.js - loads the pixel art manifest and hands out image URLs.
   If a sprite is missing the game still runs: a small placeholder is drawn
   on a canvas instead, so a half-built art folder never breaks anything.
   ========================================================================== */
(function (root) {
  'use strict';

  const BASE = 'assets/img/';
  let manifest = {};
  const cache = new Map();
  const placeholders = new Map();

  function placeholder(name) {
    if (placeholders.has(name)) return placeholders.get(name);
    const size = 32;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    // deterministic hue from the name so different sprites look different
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    g.fillStyle = 'hsl(' + h + ',38%,26%)';
    g.beginPath();
    g.ellipse(size / 2, size / 2, size * 0.3, size * 0.38, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'hsl(' + h + ',44%,58%)';
    g.lineWidth = 2;
    g.stroke();
    const url = c.toDataURL();
    placeholders.set(name, url);
    return url;
  }

  /** URL for a sprite, or a generated stand-in. */
  function url(name) {
    if (cache.has(name)) return cache.get(name);
    const entry = manifest[name];
    const u = entry ? entry.file : placeholder(name);
    cache.set(name, u);
    return u;
  }

  function size(name) {
    const e = manifest[name];
    return e ? { w: e.w, h: e.h } : { w: 32, h: 32 };
  }

  function has(name) { return !!manifest[name]; }

  /** Point an existing <img> at a sprite. */
  function paint(imgEl, name, px) {
    if (!imgEl) return;
    imgEl.src = url(name);
    if (px) { imgEl.width = px; imgEl.height = px; }
    imgEl.alt = '';
  }

  /** Build a fresh <img> for a sprite. */
  function make(name, px, cls) {
    const el = document.createElement('img');
    el.src = url(name);
    el.alt = '';
    el.draggable = false;
    if (px) { el.width = px; el.height = px; }
    if (cls) el.className = cls;
    return el;
  }

  /** Warm the browser cache so nothing pops in mid-game. */
  function preload(names) {
    names.forEach((n) => { const i = new Image(); i.src = url(n); });
  }

  function load() {
    return fetch(BASE + 'manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((m) => { manifest = m || {}; return manifest; });
  }

  root.BUGS_SPRITES = { load, url, size, has, paint, make, preload, get manifest() { return manifest; } };
})(typeof self !== 'undefined' ? self : this);
