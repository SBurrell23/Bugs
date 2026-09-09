/* format.js - number and time formatting shared by the whole UI */
(function (root) {
  'use strict';

  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];

  /** Short form for big numbers: 1234 -> "1.23K". */
  function fmt(n) {
    if (!isFinite(n)) return '0';
    if (n < 0) return '-' + fmt(-n);
    if (n < 1000) {
      if (n === 0) return '0';
      if (n < 10) return n.toFixed(n < 1 ? 2 : 1).replace(/\.0+$/, '');
      return String(Math.floor(n));
    }
    let tier = 0;
    let v = n;
    while (v >= 1000 && tier < SUFFIX.length - 1) { v /= 1000; tier++; }
    const digits = v < 10 ? 2 : v < 100 ? 1 : 0;
    return v.toFixed(digits) + SUFFIX[tier];
  }

  /** Grouped whole number: 1234567 -> "1,234,567". */
  function commas(n) {
    return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** Rate shown under the counter, where small values still matter. */
  function rate(n) {
    if (n === 0) return '0';
    if (n < 1) return n.toFixed(2);
    if (n < 100) return n.toFixed(1);
    return fmt(n);
  }

  /** 3725 -> "1h 2m", 65 -> "1m 5s", 9 -> "9s". */
  function duration(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }

  /** Compact countdown for progress chips: "0:07". */
  function clock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60);
    return m + ':' + String(sec % 60).padStart(2, '0');
  }

  root.BUGS_FMT = { fmt, commas, rate, duration, clock };
})(typeof self !== 'undefined' ? self : this);
