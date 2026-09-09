/**
 * data.js - all game content and balance numbers.
 *
 * Everything is built from a small TUNING block so tools/tune.js can sweep the
 * curve and tools/simulate.js can verify the pacing. Loaded as a browser script
 * (window.BUGS_DATA) and required by the tooling.
 *
 * Shape of the economy:
 *   - 6 COLONIES  : ordinary producers you buy over and over
 *   - 3 MONUMENTS : one-off late landmarks that multiply everything
 *   - UPGRADES    : per-colony doublers, click power, global multipliers
 *   - STUDIES     : timed lab research
 *   - ACHIEVEMENTS: each adds a small permanent bonus
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BUGS_DATA = api.build();
  root.BUGS_BUILD = api.build;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_TUNING = {
    goal: 1000000,
    colonyBaseCost: 15,
    colonyBaseBps: 0.034,
    colonyCostRatio: 6.5,
    colonyBpsRatio: 2.95,
    costGrowth: 1.12,
    genUpgradeCostMult: [60, 430, 3400, 24000],
    genUpgradeOwned: [4, 12, 25, 40],
    clickCount: 6,
    clickReq0: 120,
    clickReqRatio: 5.8,
    globalCount: 7,
    globalReq0: 1400,
    globalReqRatio: 4.0,
    globalMult: 1.22,
    achBonus: 0.005,
    studyCount: 6,
    studyReq0: 3000,
    studyReqRatio: 4.2,
    studyMult: 1.12,
    monumentCosts: [55000, 170000, 390000],
    monumentMults: [1.3, 1.38, 1.5],
  };

  const COLONY_TEXT = [
    ['antHill', 'Ant Hill', 'ant',
      'A modest mound of loam. The workers never stop, and never ask why.'],
    ['aphidPasture', 'Aphid Pasture', 'aphid',
      'Herded on tender stems and milked for honeydew. They do not seem to mind.'],
    ['ladybugGrove', 'Ladybug Grove', 'ladybug',
      'Spotted shells drift between the leaves, eating anything smaller than themselves.'],
    ['cricketHollow', 'Cricket Hollow', 'cricket',
      'A damp hollow that sings all night. The chirping turns out to be load-bearing.'],
    ['beetleFoundry', 'Stag Beetle Foundry', 'stagBeetle',
      'Antlered giants haul chitin ingots through the sawdust. Hard hats optional.'],
    ['fireflyReactor', 'Firefly Reactor', 'firefly',
      'Cold light, warm output. Do not look directly into the abdomen.'],
  ];

  const MONUMENT_TEXT = [
    ['mantisTemple', 'Mantis Temple', 'mantis',
      'They fold their arms and wait. Bugs simply arrive. Nobody asks about the acolytes.',
      'Raiding wasps now flee on sight, dropping what they carried.'],
    ['cicadaChorus', 'Cicada Chorus', 'cicada',
      'Seventeen years underground, all of it spent counting. Now they count for you.',
      'Honey Bugs surface far more often.'],
    ['hiveSingularity', 'Hive Singularity', 'queenBee',
      'One mind, ten million bodies. It has begun to make suggestions.',
      'Every poke of the beetle draws on the whole colony at once.'],
  ];

  const CLICK_TEXT = [
    ['Sharpened Fingernail', 'iconMagnifier', 'Mind the splinters.'],
    ['Sap-Sticky Gloves', 'iconHoney', 'Nothing escapes the tack.'],
    ['Brass Tweezers', 'iconMagnifier', 'Surgical, and slightly cruel.'],
    ['Pooter Aspirator', 'iconFlask', 'Do not inhale on the wrong end.'],
    ['Beating Sheet', 'iconLeaf', 'Whack a branch, collect the rain.'],
    ['Mercury Light Trap', 'iconLantern', 'The night comes to you.'],
    ['Pitfall Array', 'iconGear', 'Gravity does the work.'],
    ['Malaise Tent', 'iconCrown', 'An entire flyway, funnelled.'],
  ];

  const GLOBAL_TEXT = [
    ['Loam Tilling', 'iconLeaf', 'Aerated soil. Everything underneath works harder.'],
    ['Pheromone Trails', 'iconFlask', 'Chemical highways. No bug takes a wrong turn again.'],
    ['Rotting Log Annex', 'iconGear', 'You have annexed the log. The log did not object.'],
    ['Humidity Domes', 'iconHoney', 'Warm, wet, and faintly alarming. Output soars.'],
    ['Fungal Symbiosis', 'iconLeaf', 'The mycelium files quarterly reports now.'],
    ['Chitin Reinforcement', 'iconGear', 'Every shell lacquered. Every joint tightened.'],
    ['Brood Optimisation', 'iconSugar', 'Eggs on a schedule. Larvae with quotas.'],
    ['Hive Mind Uplink', 'iconCrown', 'Ten million minds, one shared thought: more.'],
  ];

  const STUDY_TEXT = [
    ['Pitfall Trapping', 45],
    ['Larval Nutrition', 80],
    ['Wing Venation Survey', 130],
    ['Compound Eye Optics', 190],
    ['Exoskeleton Alloys', 260],
    ['Pheromone Cryptography', 340],
    ['Diapause Control', 420],
    ['Swarm Calculus', 500],
  ];

  const SYNERGY_TEXT = [
    ['Field Notes, Volume I', 0.008, 'Each poke also yields 0.8% of your bugs per second.'],
    ['Field Notes, Volume II', 0.02, 'Each poke yields a further 2% of your bugs per second.'],
    ['Field Notes, Volume III', 0.05, 'Each poke yields a further 5% of your bugs per second.'],
  ];

  /** "Foundry" -> "Foundries", "Ant Hill" -> "Ant Hills". */
  function plural(name) {
    return /[^aeiou]y$/.test(name) ? name.slice(0, -1) + 'ies' : name + 's';
  }

  /** Round to something a player would enjoy reading. */
  function pretty(n) {
    if (n < 100) return Math.round(n);
    const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / mag) * mag;
  }

  function build(overrides) {
    const T = Object.assign({}, DEFAULT_TUNING, overrides || {});

    /* ---------------- colonies ---------------- */
    const COLONIES = COLONY_TEXT.map(function (c, i) {
      return {
        id: c[0], name: c[1], sprite: c[2], blurb: c[3], index: i,
        cost: pretty(T.colonyBaseCost * Math.pow(T.colonyCostRatio, i)),
        bps: Number((T.colonyBaseBps * Math.pow(T.colonyBpsRatio, i)).toPrecision(3)),
      };
    });

    /* ---------------- monuments ---------------- */
    const MONUMENTS = MONUMENT_TEXT.map(function (m, i) {
      return {
        id: m[0], name: m[1], sprite: m[2], blurb: m[3], perk: m[4], index: i,
        cost: T.monumentCosts[i],
        mult: T.monumentMults[i],
      };
    });

    /* ---------------- upgrades ---------------- */
    const UPGRADES = [];
    const TIER_LABEL = ['Nursery', 'Warren', 'Dynasty', 'Leviathan'];

    COLONIES.forEach(function (g) {
      T.genUpgradeOwned.forEach(function (owned, i) {
        UPGRADES.push({
          id: g.id + '_t' + i,
          kind: 'gen',
          target: g.id,
          name: g.name + ' ' + TIER_LABEL[i],
          desc: 'Doubles the output of every ' + g.name + '.',
          icon: g.sprite,
          cost: pretty(g.cost * T.genUpgradeCostMult[i]),
          mult: 2,
          req: { gen: g.id, owned: owned },
        });
      });
    });

    for (let i = 0; i < T.clickCount; i++) {
      const req = pretty(T.clickReq0 * Math.pow(T.clickReqRatio, i));
      UPGRADES.push({
        id: 'click' + i, kind: 'click',
        name: CLICK_TEXT[i][0], icon: CLICK_TEXT[i][1],
        desc: 'Doubles bugs per poke. ' + CLICK_TEXT[i][2],
        cost: pretty(req * 1.15), mult: 2, req: { lifetime: req },
      });
    }

    for (let i = 0; i < T.globalCount; i++) {
      const req = pretty(T.globalReq0 * Math.pow(T.globalReqRatio, i));
      const mult = Number((T.globalMult + i * 0.03).toFixed(2));
      UPGRADES.push({
        id: 'global' + i, kind: 'global',
        name: GLOBAL_TEXT[i][0], icon: GLOBAL_TEXT[i][1],
        desc: 'All bug production x' + mult + '. ' + GLOBAL_TEXT[i][2],
        cost: pretty(req * 0.85), mult: mult, req: { lifetime: req },
      });
    }

    SYNERGY_TEXT.forEach(function (u, i) {
      const req = pretty(30000 * Math.pow(9, i));
      UPGRADES.push({
        id: 'synergy' + i, kind: 'synergy', name: u[0], icon: 'iconMagnifier',
        desc: u[2], cost: pretty(req * 1.1), share: u[1], req: { lifetime: req },
      });
    });

    /* ---------------- lab studies ---------------- */
    const STUDIES = [];
    for (let i = 0; i < T.studyCount; i++) {
      const req = pretty(T.studyReq0 * Math.pow(T.studyReqRatio, i));
      const mult = Number((T.studyMult + i * 0.04).toFixed(2));
      STUDIES.push({
        id: 'study' + i, name: STUDY_TEXT[i][0],
        desc: 'Passive output x' + mult + ' once filed.',
        cost: pretty(req * 0.8), seconds: STUDY_TEXT[i][1],
        mult: mult, req: { lifetime: req },
      });
    }

    /* ---------------- achievements ---------------- */
    const ACHIEVEMENTS = [];
    function ach(id, name, desc, test) {
      ACHIEVEMENTS.push({ id: id, name: name, desc: desc, test: test });
    }

    [
      [1, 'First Contact', 'Collect your very first bug.'],
      [100, 'Small Infestation', 'Collect 100 bugs in total.'],
      [1000, 'Noticeable Problem', 'Collect 1,000 bugs in total.'],
      [25000, 'Call An Exterminator', 'Collect 25,000 bugs in total.'],
      [250000, 'Biblical', 'Collect 250,000 bugs in total.'],
      [1000000, 'Seven Figures', 'Collect 1,000,000 bugs in total.'],
      [5000000, 'Beyond Counting', 'Collect 5,000,000 bugs in total.'],
    ].forEach(function (a, i) {
      ach('life' + i, a[1], a[2], function (s) { return s.lifetime >= a[0]; });
    });

    [
      [1, 'Poke', 'Poke the beetle once.'],
      [100, 'Persistent', 'Poke the beetle 100 times.'],
      [1000, 'Repetitive Strain', 'Poke the beetle 1,000 times.'],
      [5000, 'Seek Help', 'Poke the beetle 5,000 times.'],
    ].forEach(function (a, i) {
      ach('clk' + i, a[1], a[2], function (s) { return s.clicks >= a[0]; });
    });

    COLONIES.forEach(function (g) {
      [1, 20, 50, 120].forEach(function (n, i) {
        const title = i === 0
          ? 'First ' + g.name
          : ['', 'A Score of ', 'Fifty ', 'A Legion of '][i] + plural(g.name);
        ach('own_' + g.id + '_' + i, title,
          'Own ' + n + ' ' + (n > 1 ? plural(g.name) : g.name) + '.',
          function (s) { return (s.owned[g.id] || 0) >= n; });
      });
    });

    MONUMENTS.forEach(function (m) {
      ach('mon_' + m.id, m.name, 'Raise the ' + m.name + '.',
        function (s) { return !!s.monuments[m.id]; });
    });

    [
      [1, 'Sweet Tooth', 'Catch a Honey Bug.'],
      [10, 'Sticky Fingers', 'Catch 10 Honey Bugs.'],
      [40, 'Apiarist', 'Catch 40 Honey Bugs.'],
    ].forEach(function (a, i) {
      ach('gold' + i, a[1], a[2], function (s) { return s.goldens >= a[0]; });
    });

    [
      [1, 'Swatted', 'Drive off a raiding wasp.'],
      [20, 'Pest Control', 'Drive off 20 raiding wasps.'],
    ].forEach(function (a, i) {
      ach('wasp' + i, a[1], a[2], function (s) { return s.wasps >= a[0]; });
    });

    [
      [10, 'Shopper', 'Buy 10 upgrades.'],
      [30, 'Collector', 'Buy 30 upgrades.'],
      [55, 'Completionist', 'Buy 55 upgrades.'],
    ].forEach(function (a, i) {
      ach('upg' + i, a[1], a[2], function (s) { return s.upgradeCount >= a[0]; });
    });

    [
      [1, 'Lab Coat', 'File a study.'],
      [3, 'Peer Reviewed', 'File three studies.'],
      [6, 'Tenured', 'File every study.'],
    ].forEach(function (a, i) {
      ach('std' + i, a[1], a[2], function (s) { return s.studiesDone >= a[0]; });
    });

    [
      [50, 'Steady Trickle', 'Reach 50 bugs per second.'],
      [500, 'Torrent', 'Reach 500 bugs per second.'],
      [4000, 'Unstoppable', 'Reach 4,000 bugs per second.'],
    ].forEach(function (a, i) {
      ach('bps' + i, a[1], a[2], function (s) { return s.bps >= a[0]; });
    });

    ach('goal', 'A Million Little Legs', 'Hold 1,000,000 bugs at one time.',
      function (s) { return s.bugs >= T.goal; });

    /* ---------------- honey bug boons ---------------- */
    const BOONS = [
      { id: 'frenzy', name: 'Frenzy', desc: 'All production x7 for 30 seconds.', weight: 32, mult: 7, seconds: 30 },
      { id: 'swarm', name: 'Swarm', desc: 'All production x3 for 90 seconds.', weight: 26, mult: 3, seconds: 90 },
      { id: 'windfall', name: 'Windfall', desc: 'A sudden heap of bugs.', weight: 30 },
      { id: 'digits', name: 'Clicking Fever', desc: 'Poking is x77 for 15 seconds.', weight: 12, clickMult: 77, seconds: 15 },
    ];

    return {
      TUNING: T,
      GOAL: T.goal,
      COST_GROWTH: T.costGrowth,
      ACH_BONUS: T.achBonus,
      COLONIES: COLONIES,
      MONUMENTS: MONUMENTS,
      UPGRADES: UPGRADES,
      STUDIES: STUDIES,
      ACHIEVEMENTS: ACHIEVEMENTS,
      BOONS: BOONS,
    };
  }

  return { build: build, DEFAULT_TUNING: DEFAULT_TUNING };
});
