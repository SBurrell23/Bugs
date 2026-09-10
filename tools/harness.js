/**
 * harness.js - runs the real game headlessly.
 *
 * Rather than reimplementing the rules (which would drift from the game and
 * make every balance number a lie), this loads js/game.js itself behind a
 * virtual clock and a stub localStorage. Whatever the simulator measures is
 * what the browser does.
 */
'use strict';

const path = require('path');

const SRC = ['data.js', 'chain.js', 'game.js'].map((f) =>
  path.join(__dirname, '..', 'js', f));

const realNow = Date.now;

/**
 * Build a fresh, isolated game instance.
 * @param tuning optional overrides for the balance block in data.js
 */
function makeGame(tuning) {
  // wipe the module cache so each run starts from clean state
  SRC.forEach((f) => { delete require.cache[require.resolve(f)]; });

  const g = global;
  g.self = g;

  let clock = realNow();
  Date.now = () => clock;

  const store = {};
  g.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  g.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
  g.atob = (str) => Buffer.from(str, 'base64').toString('binary');

  const api = require(SRC[0]);
  g.BUGS_DATA = api.build(tuning);
  require(SRC[1]);
  require(SRC[2]);

  const G = g.BUGS_GAME;
  const D = g.BUGS_DATA;
  G.load();

  return {
    G, D,
    advance(ms) { clock += ms; },
    get now() { return clock; },
    restore() { Date.now = realNow; },
  };
}

module.exports = { makeGame };
