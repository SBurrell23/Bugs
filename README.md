# BUGS

A production-chain game about a rotting log. Bugs are your **workforce**, not
your wallet: you never spend one, you assign it. Tap sap and cut leaf, refine
them through six interlocking resources, keep every crew staffed and every
building fed, and fill the Queen's orders until the colony is **one million
bugs** strong.

Vanilla JavaScript. No frameworks, no build step, no dependencies.

**Play it:** https://sburrell23.github.io/Bugs/

---

## The chain

```
Sap Tapper  -> SAP  -> Aphid Pasture -> HONEYDEW -+-> Pollen Gatherer -> POLLEN -> Wax Works -> WAX -+
Leaf Cutter -> LEAF -> Termite Mound -> FUNGUS ---|-------------------------------------------------|-> Brood Chamber -> BUGS
                                                  +-------------------------------------------------+
```

Every building runs at the rate of its **worst-supplied ingredient**, so one
starved input throttles the whole thing. Honeydew feeds both the pollen branch
and the brood, which means the sap chain always has to be overbuilt — that
asymmetry is the central problem you are solving, and it moves every time you
buy an efficiency upgrade.

The graph is a DAG, so the chain can stall but never deadlock: the two raw
harvesters take no inputs and always run.

### Bugs are labour

Every building needs a **crew**, and a half-crewed building works at half speed.
Bugs are never spent, so the population counter only ever climbs.

Crew demand is driven by two things: each extra building needs more crew than
the last, and the whole figure **scales with the size of the colony**, because
a crew is a share of your bugs rather than a fixed headcount. That second part
is load-bearing. Population is an integral over the whole run and reaches a
million; building count is a level and stops around a hundred. Tie crew only to
building count and the two drift three orders of magnitude apart — every
building sits permanently at full crew and assigning bugs stops being a
decision. The exponent is kept below 1 so output still grows as you grow.

In practice you can staff roughly a quarter of what you own. **You never get to
max everything.**

Moving bugs between jobs is free and instant. It is the main thing you do.

### The levers

| Lever | What it does |
|---|---|
| **Crew assignment** | The main dial. Every bug on the sap tap is a bug not in the brood. |
| **Building counts** | Getting the ratios right is the other half of the game. |
| **Silo caps** | Anything produced past the brim is **thrown away**. Overproduction is a real cost. |
| **Foraging** | Gather sap or leaf by hand to plug a gap or finish an order. |
| **Tithing** | Click any silo to sell surplus to the Queen at a poor rate. A full store is never a dead end. |
| **Hands / thrift upgrades** | Need less crew, or eat less input — both rewrite the ratios you just balanced. |

### The Queen

Every 45 to 75 seconds she asks for a bundle sized against your current output.
Fill it for bugs; a streak multiplies the payout up to x2.6, and letting one
expire resets the streak. Deliveries take resources straight out of the silos,
so filling an order and keeping the chain fed are in genuine tension.

**This is why the game cannot be left alone.** Roughly half your bugs come from
orders that only a person can deliver.

---

## How the balance was set

None of it was guessed. `tools/harness.js` loads `js/game.js` itself behind a
virtual clock and a stub `localStorage`, so the simulator **plays the real
game** rather than a copy of it that could drift.

```bash
node tools/simulate.js        # play it headlessly, five player profiles
node tools/tune.js            # sweep the tuning knobs and score the results
node tools/check-balance.js   # assert the pacing still holds (this runs in CI)
```

`tools/player.js` is the headless player. The interesting part is
`idealCounts`, which walks the DAG backwards from the brood to work out how
many of each building a given number of Brood Chambers needs, accounting for
the yield and thrift upgrades already bought — because those change the
ratios. That is what a competent human does, so that is what it models.

Five profiles, over three seeds:

```
seed        normal   brood%   mon  buildings              endBps  idleGap    afk       sloppy
4242        51m57s     52%   2/3  14/12/7/6/7/5/8          748.8    3m07s    never      61m01s
8080        84m39s     46%   2/3  11/12/8/6/8/5/8          374.4   10m02s    never      44m53s
20260909    52m49s     61%   2/3  14/16/8/7/8/6/11          1.0k    3m24s    never      51m32s

mean normal run: 63m08s   (spread 51m57s to 84m39s)
random building takes 89% as long as building to ratio
```

- **normal** finishes in about an hour, which is the target.
- **brood%** is the share of bugs from the passive brood rather than from
  orders. It sits near 50%, so neither system is decoration.
- **afk** never finishes, at any timescale. It misses every order and dies at
  one Sap Tapper. That is the design working.
- **sloppy** buys by gut feel instead of by ratio, then mashes Auto-assign the
  way a careless player would. It takes **281% as long**. Once labour is
  genuinely scarce, building things you cannot crew is expensive.

`check-balance.js` asserts all of that plus a static check that no cost can
ever exceed what a silo is able to hold, and it gates every deploy.

### What the checks caught

All of these were invisible in play and obvious in the numbers:

- **The boredom metric.** A player reported sitting with maxed sap and leaf and
  nothing to do. The old metric measured time between purchases, which never
  catches "silos full, waiting on the Queen". Tracing the opening showed seven
  minutes where nothing at all was affordable. The gate now measures the real
  thing: raw silos brimming, nothing buyable, no order fillable, and nowhere
  left to put a bug.
- **Costs that outran storage.** The Hive Singularity once wanted 1,400 wax
  when the largest possible wax store held 950. Every static cost is now
  asserted against maximum silo capacity, including the silo upgrades
  themselves — a store upgrade you cannot afford with the store you have is a
  dead end.
- **A payout exploit.** Orders are sized against your output, so spamming the
  cheapest producer inflated your own rewards. Payouts are now sub-linear in
  quantity and the value ladder is much steeper toward the refined resources.

---

## The art

Every sprite is hand-authored pixel art, written as character grids with a
named palette in `art/src/*.sprites.js` and rendered to PNG by
`tools/build-sprites.js`, which writes the PNG chunks itself using only Node's
built-in `zlib`.

```bash
node tools/build-sprites.js   # art/src -> assets/img
node tools/contact-sheet.js   # one big preview of everything
```

The renderer validates as it goes: row counts, row widths, reserved
transparency, palette coverage, and duplicate sprite names across files. CI
re-renders on every push, so malformed sprite data fails the build.

All bugs are drawn top-down with the head pointing north, which is what lets
the crawlers rotate to face wherever they are walking.

## The sound

Every sound effect is synthesised at runtime in `js/audio.js` — enveloped
oscillators and filtered noise, no audio files. Foraging is a wet scrape that
goes flat and dull when the silo is already full; the wasp is three detuned
sawtooths with an LFO on the frequency; filling an order is the brightest sound
in the game. The only audio asset is the looping background track.

Audio only starts after the "Lift the log" gesture, which is what browsers
require.

---

## Running it locally

```bash
node tools/serve.js 8123
```

Then open http://localhost:8123. Opening `index.html` off disk will not work —
the sprite manifest is fetched, and `file://` blocks that.

## Layout

```
index.html              markup
css/style.css           all styling
js/data.js              every balance number, built from one tuning block
js/chain.js             resolves one tick of the production chain. Pure, and
                        shared byte-for-byte with the simulator.
js/game.js              state, economy, rules. Touches no DOM.
js/ui.js                everything that touches the DOM
js/crawlers.js          bugs wandering the screen, and the clickable visitors
js/audio.js             synthesised sound effects, music control
js/sprites.js           sprite manifest loading, with placeholder fallback
js/format.js            number and time formatting
js/main.js              boot order, game loop, autosave
art/src/*.sprites.js    hand-authored pixel art data
tools/harness.js        loads the real game headlessly
tools/player.js         a headless player that balances by ratio
tools/simulate.js       playthrough reporting
tools/tune.js           balance parameter sweep
tools/check-balance.js  pacing and fairness gate, runs in CI
tools/build-sprites.js  sprite data to PNG
tools/contact-sheet.js  preview sheet of every sprite
```

## Saving

Progress is kept in `localStorage` and saved every ten seconds. Time away runs
the chain forward for real at 40% for at most 15 minutes — orders are never
filled while you are gone, and the streak is cold when you come back. This is
not an idle game.

## Known rough edges

- Run length still moves with order luck, though much less than it did: 56 to
  62 minutes across seeds, mean 60.
- Only one or two of the three monuments get raised in a typical run. The third
  wants full silos and often arrives after the goal does.
