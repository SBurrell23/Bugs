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

  const TICK_MS = 50;          // 20 ticks a second keeps the counter smooth
  const HEAVY_MS = 400;        // the expensive list refresh
  const SAVE_MS = 10000;
  const FROZEN_AFTER = 5;      // a gap longer than this means the tab was asleep

  function everySprite() {
    const names = ['heroBeetle', 'honeyBug', 'wasp', 'mothPale'];
    D.COLONIES.forEach((c) => names.push(c.sprite));
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

      // If the browser froze our timers, pay the missing stretch out at the
      // same reduced rate a reload would give, rather than losing it or
      // handing over a full-rate windfall.
      if (dt > FROZEN_AFTER) {
        const gain = G.creditAway(dt);
        if (gain > 0) {
          UI.addFeed('The tab went quiet for <b>' + window.BUGS_FMT.duration(dt) +
            '</b>. The colony banked <b>' + window.BUGS_FMT.commas(gain) + '</b> bugs.', 'good');
        }
        dt = TICK_MS / 1000;
      }

      G.tick(dt);
      UI.refreshHeader();
      UI.refreshBoons();
      UI.refreshLab();
    }, TICK_MS);

    setInterval(UI.refreshAll, HEAVY_MS);
    setInterval(G.save, SAVE_MS);

    window.addEventListener('beforeunload', G.save);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) G.save();
      else A.resume();
    });

    // a cricket somewhere off screen, once you actually have crickets
    setInterval(function () {
      if (!G.state.owned.cricketHollow) return;
      if (Math.random() < 0.4) A.sfx.chirp();
    }, 14000);
  }

  function openGate() {
    const gate = document.getElementById('gate');
    const btn = document.getElementById('gate-btn');
    if (!gate || !btn) return;

    btn.addEventListener('click', function () {
      // Everything audio has to start inside a real gesture, which is why the
      // gate exists at all.
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
