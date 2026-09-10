/* ==========================================================================
   audio.js - every sound effect is synthesised at runtime with WebAudio.
   Nothing is loaded from disk except the looping background track.
   The context is only created after a real user gesture, which is what
   browsers require before any audio may start.
   ========================================================================== */
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let sfxOn = true;
  let ready = false;

  const musicEl = () => document.getElementById('music');

  /* ---------------- plumbing ---------------- */

  function start() {
    if (ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    // one second of white noise, reused by every percussive sound
    const len = Math.floor(ctx.sampleRate);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    ready = true;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  const now = () => (ctx ? ctx.currentTime : 0);
  const live = () => ready && sfxOn && ctx;

  /**
   * A single enveloped oscillator note.
   * opts: { type, freq, to, dur, gain, delay, detune, curve }
   */
  function tone(o) {
    if (!live()) return;
    const t = now() + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to && o.to !== o.freq) {
      if (o.curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.dur);
      else osc.frequency.linearRampToValueAtTime(Math.max(1, o.to), t + o.dur);
    }
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);

    const peak = o.gain === undefined ? 0.18 : o.gain;
    const attack = Math.min(0.012, o.dur * 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  /**
   * Filtered noise, for ticks, thuds and wing rustle.
   * opts: { dur, freq, q, gain, delay, type, to }
   */
  function noise(o) {
    if (!live()) return;
    const t = now() + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;

    const flt = ctx.createBiquadFilter();
    flt.type = o.type || 'bandpass';
    flt.frequency.setValueAtTime(o.freq || 1400, t);
    if (o.to) flt.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t + o.dur);
    flt.Q.value = o.q === undefined ? 1.1 : o.q;

    const g = ctx.createGain();
    const peak = o.gain === undefined ? 0.12 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.008, o.dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    src.connect(flt).connect(g).connect(master);
    src.start(t);
    src.stop(t + o.dur + 0.02);
  }

  /** A run of notes. freqs in Hz, step in seconds. */
  function arp(freqs, step, o) {
    o = o || {};
    freqs.forEach((f, i) => tone({
      type: o.type || 'triangle',
      freq: f,
      to: o.slide ? f * o.slide : f,
      dur: o.dur || 0.13,
      gain: o.gain === undefined ? 0.14 : o.gain,
      delay: (o.delay || 0) + i * step,
    }));
  }

  /* ---------------- the sound set ---------------- */

  // Pentatonic-ish ladder so anything built from it stays consonant.
  const SCALE = [392, 440, 494, 587, 659, 784, 880, 988, 1175, 1319];

  const S = {
    /** Poking the beetle. Pitch creeps up with a fast streak so it feels alive. */
    click(streak) {
      const step = Math.min(streak || 0, 7);
      const base = 300 + step * 26;
      tone({ type: 'square', freq: base, to: base * 0.62, dur: 0.055, gain: 0.1, curve: 'exp' });
      noise({ dur: 0.035, freq: 2600 + step * 130, q: 0.7, gain: 0.055 });
    },

    /** A small confirmation tick, for toggles and throttles. */
    tick() {
      tone({ type: 'square', freq: 660, dur: 0.03, gain: 0.05 });
    },

    /**
     * Gathering by hand. A wet scrape rather than a click, and it goes flat
     * and dull when the silo is already full.
     */
    forage(full) {
      if (full) {
        tone({ type: 'square', freq: 150, to: 120, dur: 0.09, gain: 0.06, curve: 'exp' });
        return;
      }
      noise({ dur: 0.09, freq: 1500, to: 520, q: 1.6, gain: 0.075 });
      tone({ type: 'triangle', freq: 300, to: 430, dur: 0.07, gain: 0.07 });
    },

    /** The Queen posts a new order. Two clear notes, like a bell in a hall. */
    demandNew() {
      tone({ type: 'sine', freq: 587, dur: 0.28, gain: 0.1 });
      tone({ type: 'sine', freq: 880, dur: 0.36, gain: 0.09, delay: 0.14 });
    },

    /** An order filled. The payoff sound, so it is the brightest one here. */
    demandDone() {
      arp([523, 659, 784, 1047], 0.06, { type: 'triangle', dur: 0.34, gain: 0.14 });
      tone({ type: 'sine', freq: 262, to: 523, dur: 0.5, gain: 0.11, curve: 'exp' });
      noise({ dur: 0.3, freq: 4800, to: 1400, q: 0.6, gain: 0.05 });
    },

    /** Buying a building. */
    buy() {
      tone({ type: 'square', freq: 330, dur: 0.07, gain: 0.1 });
      tone({ type: 'square', freq: 494, dur: 0.1, gain: 0.1, delay: 0.06 });
      noise({ dur: 0.05, freq: 900, q: 1.4, gain: 0.05, delay: 0.02 });
    },

    /** Buying an upgrade: a touch brighter and longer than a colony. */
    upgrade() {
      arp([523, 659, 784], 0.06, { type: 'triangle', dur: 0.16, gain: 0.13 });
      noise({ dur: 0.09, freq: 3200, to: 900, q: 0.8, gain: 0.045 });
    },

    /** Raising a monument: low swell plus a rising figure. */
    monument() {
      tone({ type: 'sine', freq: 82, to: 164, dur: 0.9, gain: 0.2, curve: 'exp' });
      tone({ type: 'sawtooth', freq: 110, to: 220, dur: 0.7, gain: 0.05, curve: 'exp' });
      arp([392, 494, 587, 784, 988], 0.11, { type: 'triangle', dur: 0.4, gain: 0.12, delay: 0.14 });
    },

    /** Filing a study: a soft two-part bell. */
    study() {
      tone({ type: 'sine', freq: 880, dur: 0.5, gain: 0.13 });
      tone({ type: 'sine', freq: 1320, dur: 0.38, gain: 0.06, delay: 0.02 });
      tone({ type: 'sine', freq: 587, dur: 0.6, gain: 0.08, delay: 0.1 });
    },

    /** An award. Short, warm, unmistakable. */
    award() {
      arp([659, 880, 1175], 0.08, { type: 'sine', dur: 0.34, gain: 0.12 });
      tone({ type: 'sine', freq: 440, dur: 0.5, gain: 0.07, delay: 0.02 });
    },

    /** A Honey Bug surfaces. Glittery, draws the eye. */
    honeySpawn() {
      arp([1175, 1319, 1568], 0.07, { type: 'sine', dur: 0.3, gain: 0.09 });
    },

    /** Catching a Honey Bug. */
    honeyCatch() {
      arp([784, 988, 1175, 1568, 1976], 0.055, { type: 'triangle', dur: 0.3, gain: 0.13 });
      noise({ dur: 0.22, freq: 5200, to: 1600, q: 0.6, gain: 0.05 });
      tone({ type: 'sine', freq: 196, to: 392, dur: 0.4, gain: 0.1, curve: 'exp' });
    },

    /** A wasp arrives. Angry, detuned buzz. */
    waspSpawn() {
      if (!live()) return;
      const t = now();
      [92, 95, 139].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        lfo.type = 'sine';
        lfo.frequency.value = 22 + i * 5;
        lfoGain.gain.value = 13;
        lfo.connect(lfoGain).connect(osc.frequency);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.055, t + 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
        osc.connect(g).connect(master);
        osc.start(t); lfo.start(t);
        osc.stop(t + 0.9); lfo.stop(t + 0.9);
      });
    },

    /** Swatting a wasp. */
    waspHit() {
      noise({ dur: 0.14, freq: 1800, to: 200, q: 0.5, gain: 0.16, type: 'lowpass' });
      tone({ type: 'square', freq: 150, to: 55, dur: 0.16, gain: 0.13, curve: 'exp' });
    },

    /** A wasp got away with some of your bugs. */
    waspSteal() {
      tone({ type: 'sawtooth', freq: 320, to: 90, dur: 0.5, gain: 0.11, curve: 'exp' });
      noise({ dur: 0.4, freq: 700, to: 180, q: 0.9, gain: 0.06 });
    },

    /** Cannot afford it. */
    deny() {
      tone({ type: 'square', freq: 128, to: 96, dur: 0.12, gain: 0.08, curve: 'exp' });
    },

    /** Passing a milestone on the goal bar. */
    milestone() {
      arp([523, 784], 0.09, { type: 'triangle', dur: 0.3, gain: 0.1 });
    },

    /** One million bugs. */
    victory() {
      const line = [392, 494, 587, 784, 988, 1175, 1568];
      arp(line, 0.13, { type: 'triangle', dur: 0.7, gain: 0.14 });
      arp(line.map((f) => f * 0.5), 0.13, { type: 'square', dur: 0.7, gain: 0.05 });
      tone({ type: 'sine', freq: 98, to: 196, dur: 2.2, gain: 0.18, curve: 'exp' });
      noise({ dur: 1.6, freq: 6000, to: 900, q: 0.5, gain: 0.05, delay: 0.3 });
    },

    /** Idle atmosphere: a cricket somewhere off screen. */
    chirp() {
      if (!live()) return;
      const f = SCALE[3 + Math.floor(Math.random() * 4)] * 2;
      for (let i = 0; i < 3; i++) {
        noise({ dur: 0.035, freq: f, q: 22, gain: 0.03, delay: i * 0.055 });
      }
    },

    /** Offline catch-up on load. */
    welcome() {
      arp([392, 587, 784], 0.1, { type: 'sine', dur: 0.45, gain: 0.1 });
    },
  };

  /* ---------------- music ---------------- */

  const music = {
    on: false,
    volume: 0.45,

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      const el = musicEl();
      if (el) el.volume = this.volume;
    },

    play() {
      const el = musicEl();
      if (!el) return Promise.resolve(false);
      el.volume = this.volume;
      const p = el.play();
      this.on = true;
      return (p && p.catch ? p.catch(() => { this.on = false; return false; }) : Promise.resolve(true))
        .then(() => this.on);
    },

    pause() {
      const el = musicEl();
      if (el) el.pause();
      this.on = false;
    },

    toggle() { return this.on ? (this.pause(), Promise.resolve(false)) : this.play(); },
  };

  root.BUGS_AUDIO = {
    start, resume, sfx: S, music,
    setSfx(v) { sfxOn = !!v; },
    get sfxOn() { return sfxOn; },
    get ready() { return ready; },
  };
})(typeof self !== 'undefined' ? self : this);
