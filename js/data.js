/**
 * data.js - all game content and balance numbers.
 *
 * The economy is a production chain, not a pile of multipliers:
 *
 *   Sap Tapper  -> SAP  -> Aphid Pasture -> HONEYDEW -+-> Pollen Gatherer -> POLLEN -> Wax Works -> WAX -+
 *   Leaf Cutter -> LEAF -> Termite Mound -> FUNGUS ---|-------------------------------------------------|-> Brood Chamber -> BUGS
 *                                                     +-------------------------------------------------+
 *
 * HONEYDEW feeds both the pollen branch and the brood, so the sap chain has to
 * be overbuilt. That is the central balancing problem the player is solving.
 * The graph is a DAG, so the chain can stall but never deadlock: the two raw
 * harvesters take no inputs and always run.
 *
 * Everything is built from one TUNING block so tools/tune.js can sweep the
 * curve and tools/simulate.js can verify the pacing.
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
    costGrowth: 1.155,
    // Resource costs climb far more gently than bug costs. If they matched,
    // the stockpile a late building demands would exceed what a silo can ever
    // hold and the building would become quietly unbuyable.
    resourceCostGrowth: 1.06,
    broodYield: 22,         // bugs per second per Brood Chamber
    demandEvery: [46, 74],  // seconds between the Queen's demands
    demandWindow: 105,      // seconds allowed to fill one
    demandCover: 30,        // a demand asks for this many seconds of your output
    demandPay: 4,           // bugs per point of resource value delivered
    streakStep: 0.16,       // each consecutive fill adds this to the payout
    streakMax: 2.6,
    capBase: 1.0,           // scales every storage cap
    upgradeCostMult: 1.0,
  };

  /* ------------------------------------------------------------------ *
   * RESOURCES
   * `value` is what a unit is worth when the Queen pays for it, and is
   * what the demand generator uses to keep rewards proportionate.
   * ------------------------------------------------------------------ */
  const RESOURCE_DEFS = [
    ['sap', 'Sap', 'resSap', 0, 420, 1.0,
      'Tapped straight from the log. Sticky, plentiful, and the base of everything.'],
    ['leaf', 'Leaf', 'resLeaf', 0, 420, 1.0,
      'Cut and carried home in pieces. The other thing you can always get more of.'],
    ['honeydew', 'Honeydew', 'resHoneydew', 1, 300, 2.6,
      'Refined sap. Feeds the brood, and fuels every bee you own.'],
    ['fungus', 'Fungus', 'resFungus', 1, 300, 2.5,
      'Grown on chewed leaf in the dark. Nobody asks what else is in there.'],
    ['pollen', 'Pollen', 'resPollen', 2, 260, 2.3,
      'Gathered on the wing, which costs honeydew to go and do.'],
    ['wax', 'Wax', 'resWax', 3, 240, 5.6,
      'Secreted, scraped and stacked. The most expensive thing in the log.'],
  ];

  /* ------------------------------------------------------------------ *
   * BUILDINGS
   * stage is the topological order the tick resolves them in. Each one
   * costs bugs plus, from the third onwards, a stock of the very resource
   * it is about to start eating.
   * ------------------------------------------------------------------ */
  const BUILDING_DEFS = [
    {
      id: 'sapTapper', name: 'Sap Tapper', sprite: 'ant', stage: 0,
      cost: { bugs: 15 },
      inputs: {}, outputs: { sap: 0.8 },
      blurb: 'Ants chew a wound in the bark and keep it open. The log does not enjoy this.',
    },
    {
      id: 'leafCutter', name: 'Leaf Cutter', sprite: 'leafcutter', stage: 0,
      cost: { bugs: 22 },
      inputs: {}, outputs: { leaf: 0.7 },
      blurb: 'A column of ants carrying green flags home, all day, without discussion.',
    },
    {
      id: 'aphidPasture', name: 'Aphid Pasture', sprite: 'aphid', stage: 1,
      cost: { bugs: 90, sap: 60 },
      inputs: { sap: 1.5 }, outputs: { honeydew: 1.0 },
      blurb: 'Aphids drink sap and make something sweeter. You are, technically, a dairy farmer.',
    },
    {
      id: 'termiteMound', name: 'Termite Mound', sprite: 'termiteWorker', stage: 1,
      cost: { bugs: 120, leaf: 70 },
      inputs: { leaf: 1.4 }, outputs: { fungus: 0.9 },
      blurb: 'Leaf goes in, gets chewed, and is left to go interesting in the dark.',
    },
    {
      id: 'pollenGatherer', name: 'Pollen Gatherer', sprite: 'honeyBee', stage: 2,
      cost: { bugs: 340, honeydew: 90 },
      inputs: { honeydew: 0.5 }, outputs: { pollen: 0.9 },
      blurb: 'Bees will fly a long way for you, but not on an empty stomach.',
    },
    {
      id: 'waxWorks', name: 'Wax Works', sprite: 'waxScale', stage: 3,
      cost: { bugs: 900, pollen: 120 },
      inputs: { pollen: 1.2 }, outputs: { wax: 0.6 },
      blurb: 'Scale insects sit very still and secrete. It is slow, and there is no hurrying it.',
    },
    {
      id: 'broodChamber', name: 'Brood Chamber', sprite: 'grub', stage: 4,
      cost: { bugs: 2200, wax: 90 },
      inputs: { honeydew: 0.8, fungus: 0.7, wax: 0.4 }, outputs: {},
      brood: true,
      blurb: 'Warm, humid and full of grubs. Every bug you will ever have starts here.',
    },
  ];

  /* ------------------------------------------------------------------ *
   * MONUMENTS - three one-off landmarks that each change a rule
   * ------------------------------------------------------------------ */
  const MONUMENT_DEFS = [
    {
      id: 'mantisTemple', name: 'Mantis Temple', sprite: 'mantis',
      cost: { bugs: 30000, fungus: 260 },
      mult: 1.0, perk: 'wards',
      effect: 'Raiding wasps flee on sight and drop what they were carrying.',
      extra: 'The Queen runs two demands at once from now on.',
      blurb: 'They fold their arms and wait. Nobody asks about the acolytes.',
    },
    {
      id: 'cicadaChorus', name: 'Cicada Chorus', sprite: 'cicada',
      cost: { bugs: 120000, wax: 220 },
      mult: 1.0, perk: 'harvest',
      effect: 'Every Sap Tapper and Leaf Cutter works a third harder.',
      extra: 'Honey Bugs surface far more often.',
      blurb: 'Seventeen years underground, all of it spent counting. Now they count for you.',
    },
    {
      id: 'hiveSingularity', name: 'Hive Singularity', sprite: 'queenBee',
      cost: { bugs: 360000, wax: 420 },
      mult: 1.45, perk: 'hive',
      effect: 'Every building in the log runs 45% harder.',
      extra: 'Demands last half again as long and pay a quarter more.',
      blurb: 'One mind, ten million bodies. It has begun to make suggestions.',
    },
  ];

  function pretty(n) {
    if (n < 100) return Math.round(n);
    const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / mag) * mag;
  }

  function build(overrides) {
    const T = Object.assign({}, DEFAULT_TUNING, overrides || {});

    const RESOURCES = RESOURCE_DEFS.map(function (r, i) {
      return {
        id: r[0], name: r[1], sprite: r[2], tier: r[3],
        cap: Math.round(r[4] * T.capBase), value: r[5], blurb: r[6], index: i,
      };
    });

    const BUILDINGS = BUILDING_DEFS.map(function (b, i) {
      return Object.assign({}, b, {
        index: i,
        outputs: Object.assign({}, b.outputs),
        inputs: Object.assign({}, b.inputs),
        cost: Object.assign({}, b.cost),
        broodYield: b.brood ? T.broodYield : 0,
      });
    });

    const MONUMENTS = MONUMENT_DEFS.map(function (m, i) {
      return Object.assign({}, m, { index: i, cost: Object.assign({}, m.cost) });
    });

    /* ---------------- upgrades ----------------
     * yield  - a building produces more per second
     * thrift - a building eats less input, which changes the whole ratio
     * cap    - a silo holds more
     * forage - hand gathering yields more
     * queen  - demands pay more
     * global - every building works harder
     */
    const UPGRADES = [];
    const add = (u) => UPGRADES.push(Object.assign({ cost: {}, req: {} }, u));

    const YIELD_STEPS = [
      { owned: 5, mult: 1.30, costMult: 16, label: 'Deeper Cuts' },
      { owned: 18, mult: 1.35, costMult: 130, label: 'Second Shift' },
      { owned: 45, mult: 1.40, costMult: 900, label: 'Full Flood' },
    ];
    const THRIFT_STEPS = [
      { owned: 10, save: 0.16, costMult: 70, label: 'Careful Hands' },
      { owned: 30, save: 0.18, costMult: 520, label: 'Nothing Wasted' },
    ];

    BUILDINGS.forEach(function (b) {
      YIELD_STEPS.forEach(function (st, i) {
        add({
          id: b.id + '_y' + i, kind: 'yield', target: b.id, icon: 'iconSpeed',
          name: b.name + ': ' + st.label,
          desc: b.name + ' produces ' + Math.round((st.mult - 1) * 100) + '% more.',
          mult: st.mult,
          cost: { bugs: pretty((b.cost.bugs || 20) * st.costMult) },
          req: { building: b.id, owned: st.owned },
        });
      });
      if (Object.keys(b.inputs).length) {
        THRIFT_STEPS.forEach(function (st, i) {
          add({
            id: b.id + '_t' + i, kind: 'thrift', target: b.id, icon: 'iconGear',
            name: b.name + ': ' + st.label,
            desc: b.name + ' needs ' + Math.round(st.save * 100) + '% less of everything it eats.',
            save: st.save,
            cost: { bugs: pretty((b.cost.bugs || 20) * st.costMult) },
            req: { building: b.id, owned: st.owned },
          });
        });
      }
    });

    RESOURCES.forEach(function (r, i) {
      [{ mult: 2.0, costMult: 1 }, { mult: 2.5, costMult: 9 }].forEach(function (st, j) {
        add({
          id: 'cap_' + r.id + '_' + j, kind: 'cap', target: r.id, icon: 'iconSilo',
          name: 'Bigger ' + r.name + ' Store',
          desc: r.name + ' storage x' + st.mult + '. Anything produced past the cap is lost.',
          mult: st.mult,
          cost: { bugs: pretty(300 * Math.pow(3.2, i * 0.55) * st.costMult) },
          req: { lifetime: pretty(700 * Math.pow(3.0, i * 0.55) * st.costMult) },
        });
      });
    });

    [
      ['Bare Hands', 1.5, 60, 220],
      ['Cupped Leaf', 1.6, 900, 3200],
      ['Bark Scoop', 1.7, 9000, 30000],
      ['Swarm Call', 1.5, 70000, 240000],
    ].forEach(function (u, i) {
      add({
        id: 'forage' + i, kind: 'forage', icon: 'iconMagnifier',
        name: u[0], desc: 'Gathering by hand yields x' + u[1] + '.',
        mult: u[1], cost: { bugs: u[2] }, req: { lifetime: u[3] },
      });
    });

    [
      ['Wax Seal', 1.30, 2600, 9000],
      ['Royal Ledger', 1.35, 26000, 90000],
      ['Standing Order', 1.40, 200000, 700000],
    ].forEach(function (u, i) {
      add({
        id: 'queen' + i, kind: 'queen', icon: 'iconScroll',
        name: u[0], desc: 'The Queen pays ' + Math.round((u[1] - 1) * 100) + '% more for every demand.',
        mult: u[1], cost: { bugs: u[2] }, req: { lifetime: u[3] },
      });
    });

    [
      ['Warm Spell', 1.20, 5000, 18000],
      ['Deep Galleries', 1.25, 45000, 160000],
      ['Perfect Humidity', 1.30, 320000, 1100000],
    ].forEach(function (u, i) {
      add({
        id: 'global' + i, kind: 'global', icon: 'iconLantern',
        name: u[0], desc: 'Every building in the log works ' + Math.round((u[1] - 1) * 100) + '% harder.',
        mult: u[1], cost: { bugs: u[2] }, req: { lifetime: u[3] },
      });
    });

    if (T.upgradeCostMult !== 1) {
      UPGRADES.forEach(function (u) {
        if (u.cost.bugs) u.cost = Object.assign({}, u.cost, { bugs: pretty(u.cost.bugs * T.upgradeCostMult) });
      });
    }

    /* ---------------- achievements ---------------- */
    const ACHIEVEMENTS = [];
    const ach = (id, name, desc, test) => ACHIEVEMENTS.push({ id, name, desc, test });

    [
      [100, 'Small Infestation', 'Collect 100 bugs in total.'],
      [2500, 'Noticeable Problem', 'Collect 2,500 bugs in total.'],
      [40000, 'Call An Exterminator', 'Collect 40,000 bugs in total.'],
      [300000, 'Biblical', 'Collect 300,000 bugs in total.'],
      [1000000, 'Seven Figures', 'Collect 1,000,000 bugs in total.'],
    ].forEach(function (a, i) {
      ach('life' + i, a[1], a[2], (s) => s.lifetime >= a[0]);
    });

    BUILDINGS.forEach(function (b) {
      [1, 15, 50].forEach(function (n, i) {
        ach('own_' + b.id + '_' + i,
          (i === 0 ? 'First ' + b.name : (i === 1 ? 'Fifteen ' : 'Fifty ') + b.name + 's'),
          'Run ' + n + ' ' + b.name + (n > 1 ? 's' : '') + '.',
          (s) => (s.owned[b.id] || 0) >= n);
      });
    });

    RESOURCES.forEach(function (r) {
      ach('full_' + r.id, r.name + ' To The Brim',
        'Fill your ' + r.name + ' store completely.', (s) => !!s.filled[r.id]);
    });

    [
      [1, 'First Order', "Fill one of the Queen's demands."],
      [10, 'Reliable', 'Fill ten demands.'],
      [30, 'Purveyor', 'Fill thirty demands.'],
    ].forEach(function (a, i) {
      ach('dem' + i, a[1], a[2], (s) => s.demandsFilled >= a[0]);
    });

    [
      [5, 'On A Roll', 'Fill five demands in a row.'],
      [12, 'Unbroken', 'Fill twelve demands in a row.'],
    ].forEach(function (a, i) {
      ach('streak' + i, a[1], a[2], (s) => s.bestStreak >= a[0]);
    });

    [
      [1, 'Sweet Tooth', 'Catch a Honey Bug.'],
      [12, 'Sticky Fingers', 'Catch twelve Honey Bugs.'],
    ].forEach(function (a, i) {
      ach('gold' + i, a[1], a[2], (s) => s.goldens >= a[0]);
    });

    [
      [1, 'Swatted', 'Drive off a raiding wasp.'],
      [15, 'Pest Control', 'Drive off fifteen raiding wasps.'],
    ].forEach(function (a, i) {
      ach('wasp' + i, a[1], a[2], (s) => s.wasps >= a[0]);
    });

    ach('moth', 'Moonlight Visitor', 'Catch a pale moth.', (s) => s.moths >= 1);

    [
      [8, 'Tinkerer', 'Buy eight upgrades.'],
      [24, 'Engineer', 'Buy twenty-four upgrades.'],
    ].forEach(function (a, i) {
      ach('upg' + i, a[1], a[2], (s) => s.upgradeCount >= a[0]);
    });

    MONUMENTS.forEach(function (m) {
      ach('mon_' + m.id, m.name, 'Raise the ' + m.name + '.', (s) => !!s.monuments[m.id]);
    });

    ach('balanced', 'Nothing Starving',
      'Have every building you own running at its full rate at once.', (s) => s.allFull);
    ach('bps', 'Steady Hatch', 'Reach 500 bugs per second.', (s) => s.bps >= 500);
    ach('goal', 'A Million Little Legs', 'Hold 1,000,000 bugs at one time.', (s) => s.bugs >= T.goal);

    /* ---------------- honey bug boons ---------------- */
    const BOONS = [
      { id: 'flow', name: 'Sap Flow', desc: 'Raw harvesting doubled for 45 seconds.', weight: 24, raw: 2, seconds: 45 },
      { id: 'hum', name: 'Warm Hum', desc: 'Every building works twice as hard for 40 seconds.', weight: 22, all: 2, seconds: 40 },
      { id: 'cache', name: 'Cache', desc: 'A sudden delivery of raw materials.', weight: 28, cache: true },
      { id: 'tribute', name: 'Tribute', desc: 'A heap of bugs, on the house.', weight: 26, tribute: true },
    ];

    /* ---------------- weather ----------------
     * Periodic swings the player has to notice and build around.
     */
    const WEATHER = [
      { id: 'run', name: 'Sap Run', desc: 'Sap Tappers are twice as productive.', good: true, seconds: 70, building: 'sapTapper', mult: 2 },
      { id: 'bloom', name: 'Bloom', desc: 'Pollen Gatherers are twice as productive.', good: true, seconds: 70, building: 'pollenGatherer', mult: 2 },
      { id: 'damp', name: 'Damp Spell', desc: 'Termite Mounds are twice as productive.', good: true, seconds: 70, building: 'termiteMound', mult: 2 },
      { id: 'drought', name: 'Drought', desc: 'Sap Tappers produce 45% less.', good: false, seconds: 55, building: 'sapTapper', mult: 0.55 },
      { id: 'wilt', name: 'Wilt', desc: 'Leaf Cutters produce 45% less.', good: false, seconds: 55, building: 'leafCutter', mult: 0.55 },
      { id: 'chill', name: 'Cold Snap', desc: 'Pollen Gatherers produce half as much.', good: false, seconds: 55, building: 'pollenGatherer', mult: 0.5 },
    ];

    return {
      TUNING: T,
      GOAL: T.goal,
      COST_GROWTH: T.costGrowth,
      RESOURCE_COST_GROWTH: T.resourceCostGrowth,
      RESOURCES: RESOURCES,
      BUILDINGS: BUILDINGS,
      MONUMENTS: MONUMENTS,
      UPGRADES: UPGRADES,
      ACHIEVEMENTS: ACHIEVEMENTS,
      BOONS: BOONS,
      WEATHER: WEATHER,
      RAW: ['sap', 'leaf'],
      STAGES: 5,
    };
  }

  return { build: build, DEFAULT_TUNING: DEFAULT_TUNING };
});
