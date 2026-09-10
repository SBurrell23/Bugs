/* ==========================================================================
   main.js - boot order, the game loop, and autosaving.
   ========================================================================== */
(function () {
  'use strict';

  const G = window.BUGS_GAME;
  const A = window.BUGS_AUDIO;
  const S = window.BUGS_SPRITES;
  const C = window.BUGS_CRAWLERS;
  const UI = window.BUGS_UI;
  const D = window.BUGS_DATA;
  const F = window.BUGS_FMT;

  const TICK_MS = 50;          // 20 ticks a second keeps the numbers smooth
  const HEAVY_MS = 400;        // the expensive list refresh
  const SAVE_MS = 10000;
  const FROZEN_AFTER = 5;      // a gap longer than this means the tab was asleep

  function everySprite() {
    const names = ['heroBeetle', 'honeyBug', 'wasp', 'mothPale', 'ant', 'queenBee'];
    D.RESOURCES.forEach((r) => names.push(r.sprite));
    D.BUILDINGS.forEach((b) => names.push(b.sprite));
    D.MONUMENTS.forEach((m) => names.push(m.sprite));
    D.UPGRADES.forEach((u) => { if (u.icon) names.push(u.icon); });
    return Array.from(new Set(names));
  }

  function startLoops() {
    let lastTick = Date.now();

    setInterval(function () {
      const now = Date.now();
      let dt = (now - lastTick) / 1000;
      lastTick = now;

      // If the browser froze our timers, run the chain forward for the missing
      // stretch at the reduced away rate rather than losing it outright.
      if (dt > FROZEN_AFTER) {
        const away = G.runAway(dt);
        if (away && away.gain > 0) {
          UI.addFeed('The tab went quiet for <b>' + F.duration(dt) + '</b>. The brood banked <b>' +
            F.commas(away.gain) + '</b> bugs.', 'good');
        }
        dt = TICK_MS / 1000;
      }

      G.tick(dt);
      UI.refreshFast();
    }, TICK_MS);

    setInterval(UI.refreshAll, HEAVY_MS);
    setInterval(G.save, SAVE_MS);

    window.addEventListener('beforeunload', G.save);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) G.save();
      else A.resume();
    });

    // a cricket somewhere off screen, once the log is busy enough to have one
    setInterval(function () {
      if (!G.state.owned.leafCutter) return;
      if (Math.random() < 0.35) A.sfx.chirp();
    }, 15000);
  }

  function openGate() {
    const gate = document.getElementById('gate');
    const btn = document.getElementById('gate-btn');
    if (!gate || !btn) return;

    btn.addEventListener('click', function () {
      // Everything audio has to start inside a real gesture, which is the
      // only reason this gate exists.
      A.start();
      A.resume();
      A.sfx.welcome();
      if (G.state.settings.music) {
        A.music.play().then(function () { UI.syncAudioChips(); });
      }
      gate.classList.add('gone');
      setTimeout(function () { if (gate.parentNode) gate.parentNode.removeChild(gate); }, 500);
    });
  }

  S.load().then(function () {
    S.preload(everySprite());
    const offline = G.load();
    UI.init(offline);
    C.begin();
    C.setPopulation(G.crawlerCount());
    openGate();
    startLoops();
  });
})();
