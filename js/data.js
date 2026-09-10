/**
 * data.js - all game content and balance numbers.
 *
 * Bugs are LABOUR, not money.
 * ---------------------------
 * You never spend a bug. The population only ever grows, and the goal is a
 * population of one million. What bugs do is WORK: every building needs a crew
 * to run, and a building with half a crew runs at half speed. Moving bugs
 * between jobs is free, instant, and the main thing you actually do.
 *
 * Everything is bought with RESOURCES, which is what the crews produce:
 *
 *   Sap Tapper  -> SAP  -> Aphid Pasture -> HONEYDEW -+-> Pollen Gatherer -> POLLEN -> Wax Works -> WAX -+
 *   Leaf Cutter -> LEAF -> Termite Mound -> FUNGUS ---|-------------------------------------------------|-> Brood Chamber -> BUGS
 *                                                     +-------------------------------------------------+
 *
 * Honeydew feeds both the pollen branch and the brood, so the sap side always
 * has to be over-crewed. That asymmetry is the problem you are solving, and it
 * moves every time you buy an upgrade or the weather turns.
 *
 * Crew demand grows geometrically with how many of a building you own, the same
 * way its resource cost does, so bugs stay scarce instead of becoming free the
 * moment the population takes off.
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
    startingBugs: 12,
    costGrowth: 1.13,       // resource cost per extra building
    crewGrowth: 1.055,      // crew demand per extra building
    // A crew is a SHARE of the colony, not a fixed headcount: running the same
    // works with ten times the bugs takes more hands to coordinate. Population
    // is an integral over the whole run while crew demand is a level, so
    // without this the two drift orders of magnitude apart and staffing stops
    // being a decision. Kept below 1 so output still grows as you grow.
    crewPopExp: 0.7,
    broodYield: 52,         // bugs a second from one fully crewed Brood Chamber
    demandEvery: [30, 50],
    demandWindow: 110,
    demandCover: 30,
    demandStore: 0.34,
    demandSlots: 2,
    demandPay: 3.2,         // bugs per point of resource value delivered
    streakStep: 0.16,
    streakMax: 2.6,
    tithePay: 0.8,
    titheShare: 0.25,
    capBase: 1.0,
    upgradeCostMult: 1.0,
  };

  const RESOURCE_DEFS = [
    ['sap', 'Sap', 'resSap', 0, 420, 1.0,
      'Tapped straight from the log. Sticky, plentiful, and the base of everything.'],
    ['leaf', 'Leaf', 'resLeaf', 0, 420, 1.0,
      'Cut and carried home in pieces. The other thing you can always get more of.'],
    ['honeydew', 'Honeydew', 'resHoneydew', 1, 300, 4.0,
      'Refined sap. Feeds the brood, and fuels every bee you own.'],
    ['fungus', 'Fungus', 'resFungus', 1, 300, 4.0,
      'Grown on chewed leaf in the dark. Nobody asks what else is in there.'],
    ['pollen', 'Pollen', 'resPollen', 2, 260, 6.5,
      'Gathered on the wing, which costs honeydew to go and do.'],
    ['wax', 'Wax', 'resWax', 3, 240, 15.0,
      'Secreted, scraped and stacked. The most expensive thing in the log.'],
  ];

  /**
   * crew - bugs needed to fully staff the FIRST one of these. Each further
   *        building needs crewGrowth times as much crew as the last.
   * cost - resources for the first one, growing by costGrowth thereafter.
   */
  const BUILDING_DEFS = [
    {
      id: 'sapTapper', name: 'Sap Tapper', sprite: 'ant', stage: 0,
      crew: 2, cost: { leaf: 20 },
      inputs: {}, outputs: { sap: 0.9 },
      blurb: 'Ants chew a wound in the bark and hold it open. The log does not enjoy this.',
    },
    {
      id: 'leafCutter', name: 'Leaf Cutter', sprite: 'leafcutter', stage: 0,
      crew: 2, cost: { sap: 20 },
      inputs: {}, outputs: { leaf: 0.8 },
      blurb: 'A column of ants carrying green flags home, all day, without discussion.',
    },
    {
      id: 'aphidPasture', name: 'Aphid Pasture', sprite: 'aphid', stage: 1,
      crew: 5, cost: { sap: 130, leaf: 60 },
      inputs: { sap: 1.5 }, outputs: { honeydew: 1.0 },
      blurb: 'Aphids drink sap and make something sweeter. You are, technically, a dairy farmer.',
    },
    {
      id: 'termiteMound', name: 'Termite Mound', sprite: 'termiteWorker', stage: 1,
      crew: 5, cost: { leaf: 130, sap: 60 },
      inputs: { leaf: 1.4 }, outputs: { fungus: 0.9 },
      blurb: 'Leaf goes in, gets chewed, and is left to go interesting in the dark.',
    },
    {
      id: 'pollenGatherer', name: 'Pollen Gatherer', sprite: 'honeyBee', stage: 2,
      crew: 9, cost: { honeydew: 150, leaf: 120 },
      inputs: { honeydew: 0.5 }, outputs: { pollen: 0.9 },
      blurb: 'Bees will fly a long way for you, but not on an empty stomach.',
    },
    {
      id: 'waxWorks', name: 'Wax Works', sprite: 'waxScale', stage: 3,
      crew: 14, cost: { pollen: 180, fungus: 110 },
      inputs: { pollen: 1.2 }, outputs: { wax: 0.6 },
      blurb: 'Scale insects sit very still and secrete. It is slow, and there is no hurrying it.',
    },
    {
      id: 'broodChamber', name: 'Brood Chamber', sprite: 'grub', stage: 4,
      crew: 22, cost: { wax: 130, honeydew: 200 },
      inputs: { honeydew: 0.8, fungus: 0.7, wax: 0.4 }, outputs: {},
      brood: true,
      blurb: 'Warm, humid and full of grubs. Every bug you will ever have starts here.',
    },
  ];

  const MONUMENT_DEFS = [
    {
      id: 'mantisTemple', name: 'Mantis Temple', sprite: 'mantis',
      cost: { fungus: 260, wax: 110 },
      mult: 1.0, perk: 'wards',
      effect: 'Raiding wasps flee on sight and drop what they were carrying.',
      extra: 'The Queen runs three orders at once from now on.',
      blurb: 'They fold their arms and wait. Nobody asks about the acolytes.',
    },
    {
      id: 'cicadaChorus', name: 'Cicada Chorus', sprite: 'cicada',
      cost: { wax: 300, honeydew: 420 },
      mult: 1.0, perk: 'harvest',
      effect: 'Sap Tappers and Leaf Cutters need a third less crew.',
      extra: 'Honey Bugs surface far more often.',
      blurb: 'Seventeen years underground, all of it spent counting. Now they count for you.',
    },
    {
      id: 'hiveSingularity', name: 'Hive Singularity', sprite: 'queenBee',
      cost: { wax: 700, fungus: 800, pollen: 650 },
      mult: 1.45, perk: 'hive',
      effect: 'Every building in the log produces 45% more from the same crew.',
      extra: 'Orders last half again as long and pay a quarter more.',
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
    const S = T.upgradeCostMult;

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
     * Everything is paid for in resources, because bugs are never spent.
     *   yield  - more output from the same crew
     *   hands  - needs less crew, which frees bugs for elsewhere
     *   thrift - eats less input, which rewrites the ratios
     *   cap    - a bigger silo
     *   forage - better hand gathering
     *   queen  - orders pay more
     *   global - everything produces more
     */
    const UPGRADES = [];
    const add = (u) => UPGRADES.push(Object.assign({ cost: {}, req: {} }, u));
    const scale = function (cost) {
      const out = {};
      for (const k in cost) out[k] = pretty(cost[k] * S);
      return out;
    };

    const YIELD_STEPS = [
      { owned: 4, mult: 1.30, m: 0.30, label: 'Deeper Cuts' },
      { owned: 14, mult: 1.35, m: 0.95, label: 'Second Shift' },
      { owned: 34, mult: 1.40, m: 2.60, label: 'Full Flood' },
    ];
    const HANDS_STEPS = [
      { owned: 8, save: 0.18, m: 0.55, label: 'Practised Hands' },
      { owned: 26, save: 0.20, m: 1.90, label: 'Muscle Memory' },
    ];
    const THRIFT_STEPS = [
      { owned: 10, save: 0.16, m: 0.70, label: 'Careful Hands' },
      { owned: 30, save: 0.18, m: 2.20, label: 'Nothing Wasted' },
    ];

    // Every cost below is expressed as a multiple of that resource's BASE silo.
    // Silos go up x2 then x2.5, so anything at or under 4x base is reachable,
    // and a cost can never outrun what a silo is physically able to hold.
    const capOf = {};
    RESOURCES.forEach(function (r) { capOf[r.id] = r.cap; });
    const silos = function (spec) {
      const c = {};
      for (const k in spec) c[k] = capOf[k] * spec[k];
      return scale(c);
    };

    BUILDINGS.forEach(function (b) {
      // an upgrade is priced in whatever that building already deals in
      const base = Object.keys(b.cost)[0];
      const priceIn = function (m) {
        const spec = {};
        spec[base] = m;
        return silos(spec);
      };

      YIELD_STEPS.forEach(function (st, i) {
        add({
          id: b.id + '_y' + i, kind: 'yield', target: b.id, icon: 'iconSpeed',
          name: b.name + ': ' + st.label,
          desc: b.name + ' produces ' + Math.round((st.mult - 1) * 100) + '% more from the same crew.',
          mult: st.mult, cost: priceIn(st.m), req: { building: b.id, owned: st.owned },
        });
      });
      HANDS_STEPS.forEach(function (st, i) {
        add({
          id: b.id + '_h' + i, kind: 'hands', target: b.id, icon: 'iconMagnifier',
          name: b.name + ': ' + st.label,
          desc: b.name + ' needs ' + Math.round(st.save * 100) + '% less crew, freeing bugs for elsewhere.',
          save: st.save, cost: priceIn(st.m), req: { building: b.id, owned: st.owned },
        });
      });
      if (Object.keys(b.inputs).length) {
        THRIFT_STEPS.forEach(function (st, i) {
          add({
            id: b.id + '_t' + i, kind: 'thrift', target: b.id, icon: 'iconGear',
            name: b.name + ': ' + st.label,
            desc: b.name + ' needs ' + Math.round(st.save * 100) + '% less of everything it eats.',
            save: st.save, cost: priceIn(st.m), req: { building: b.id, owned: st.owned },
          });
        });
      }
    });

    RESOURCES.forEach(function (r, i) {
      [{ mult: 2.0, m: 0.70 }, { mult: 2.5, m: 1.50 }].forEach(function (st, j) {
        const c = {};
        c[r.id] = r.cap * st.m;
        add({
          id: 'cap_' + r.id + '_' + j, kind: 'cap', target: r.id, icon: 'iconSilo',
          name: 'Bigger ' + r.name + ' Store',
          desc: r.name + ' storage x' + st.mult + '. Anything made past the brim is lost.',
          mult: st.mult, cost: scale(c),
          req: { lifetime: pretty(400 * Math.pow(3.2, i * 0.5 + j * 1.5)) },
        });
      });
    });

    [
      ['Bare Hands', 1.6, { sap: 0.15, leaf: 0.15 }, 200],
      ['Cupped Leaf', 1.7, { sap: 0.7, leaf: 0.7 }, 2000],
      ['Bark Scoop', 1.8, { honeydew: 1.1, fungus: 1.1 }, 16000],
      ['Swarm Call', 1.6, { wax: 2.2 }, 120000],
    ].forEach(function (u, i) {
      add({
        id: 'forage' + i, kind: 'forage', icon: 'iconLeaf',
        name: u[0], desc: 'Gathering by hand yields x' + u[1] + '.',
        mult: u[1], cost: silos(u[2]), req: { lifetime: u[3] },
      });
    });

    [
      ['Wax Seal', 1.30, { wax: 0.8 }, 6000],
      ['Royal Ledger', 1.35, { wax: 1.9, honeydew: 1.4 }, 45000],
      ['Standing Order', 1.40, { wax: 3.1, fungus: 2.4 }, 320000],
    ].forEach(function (u, i) {
      add({
        id: 'queen' + i, kind: 'queen', icon: 'iconScroll',
        name: u[0], desc: 'The Queen pays ' + Math.round((u[1] - 1) * 100) + '% more for every order.',
        mult: u[1], cost: silos(u[2]), req: { lifetime: u[3] },
      });
    });

    [
      ['Warm Spell', 1.20, { fungus: 1.0, sap: 1.4 }, 12000],
      ['Deep Galleries', 1.25, { fungus: 2.4, wax: 1.6 }, 90000],
      ['Perfect Humidity', 1.30, { wax: 3.2, pollen: 2.8 }, 600000],
    ].forEach(function (u, i) {
      add({
        id: 'global' + i, kind: 'global', icon: 'iconLantern',
        name: u[0], desc: 'Every building in the log produces ' + Math.round((u[1] - 1) * 100) + '% more.',
        mult: u[1], cost: silos(u[2]), req: { lifetime: u[3] },
      });
    });

    /* ---------------- achievements ---------------- */
    const ACHIEVEMENTS = [];
    const ach = (id, name, desc, test) => ACHIEVEMENTS.push({ id, name, desc, test });

    [
      [100, 'Small Infestation', 'Reach a population of 100.'],
      [2500, 'Noticeable Problem', 'Reach a population of 2,500.'],
      [40000, 'Call An Exterminator', 'Reach a population of 40,000.'],
      [300000, 'Biblical', 'Reach a population of 300,000.'],
      [1000000, 'Seven Figures', 'Reach a population of 1,000,000.'],
    ].forEach(function (a, i) {
      ach('life' + i, a[1], a[2], (s) => s.lifetime >= a[0]);
    });

    BUILDINGS.forEach(function (b) {
      [1, 12, 40].forEach(function (n, i) {
        ach('own_' + b.id + '_' + i,
          (i === 0 ? 'First ' + b.name : (i === 1 ? 'A Dozen ' : 'Forty ') + b.name + 's'),
          'Run ' + n + ' ' + b.name + (n > 1 ? 's' : '') + '.',
          (s) => (s.owned[b.id] || 0) >= n);
      });
    });

    RESOURCES.forEach(function (r) {
      ach('full_' + r.id, r.name + ' To The Brim',
        'Fill your ' + r.name + ' store completely.', (s) => !!s.filled[r.id]);
    });

    [
      [1, 'First Order', "Fill one of the Queen's orders."],
      [10, 'Reliable', 'Fill ten orders.'],
      [30, 'Purveyor', 'Fill thirty orders.'],
    ].forEach(function (a, i) {
      ach('dem' + i, a[1], a[2], (s) => s.demandsFilled >= a[0]);
    });

    [
      [5, 'On A Roll', 'Fill five orders in a row.'],
      [12, 'Unbroken', 'Fill twelve orders in a row.'],
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

    ach('fullcrew', 'Fully Staffed',
      'Have every building you own crewed to the last bug at once.', (s) => s.allCrewed);
    ach('balanced', 'Nothing Starving',
      'Have every building you own running at its full rate at once.', (s) => s.allFull);
    ach('idle', 'Standing Army', 'Have 50,000 bugs with nothing to do.', (s) => s.idle >= 50000);
    ach('bps', 'Steady Hatch', 'Hatch 500 bugs a second.', (s) => s.bps >= 500);
    ach('goal', 'A Million Little Legs', 'Reach a population of 1,000,000.', (s) => s.bugs >= T.goal);

    const BOONS = [
      { id: 'flow', name: 'Sap Flow', desc: 'Raw harvesting doubled for 45 seconds.', weight: 24, raw: 2, seconds: 45 },
      { id: 'hum', name: 'Warm Hum', desc: 'Every building produces double for 40 seconds.', weight: 22, all: 2, seconds: 40 },
      { id: 'cache', name: 'Cache', desc: 'A sudden delivery of raw materials.', weight: 28, cache: true },
      { id: 'tribute', name: 'Tribute', desc: 'A wave of new bugs, on the house.', weight: 26, tribute: true },
    ];

    const WEATHER = [
      { id: 'run', name: 'Sap Run', desc: 'Sap Tappers produce double.', good: true, seconds: 70, building: 'sapTapper', mult: 2 },
      { id: 'bloom', name: 'Bloom', desc: 'Pollen Gatherers produce double.', good: true, seconds: 70, building: 'pollenGatherer', mult: 2 },
      { id: 'damp', name: 'Damp Spell', desc: 'Termite Mounds produce double.', good: true, seconds: 70, building: 'termiteMound', mult: 2 },
      { id: 'drought', name: 'Drought', desc: 'Sap Tappers produce 45% less.', good: false, seconds: 55, building: 'sapTapper', mult: 0.55 },
      { id: 'wilt', name: 'Wilt', desc: 'Leaf Cutters produce 45% less.', good: false, seconds: 55, building: 'leafCutter', mult: 0.55 },
      { id: 'chill', name: 'Cold Snap', desc: 'Pollen Gatherers produce half as much.', good: false, seconds: 55, building: 'pollenGatherer', mult: 0.5 },
    ];

    return {
      TUNING: T,
      GOAL: T.goal,
      STARTING_BUGS: T.startingBugs,
      COST_GROWTH: T.costGrowth,
      CREW_GROWTH: T.crewGrowth,
      CREW_POP_EXP: T.crewPopExp,
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
