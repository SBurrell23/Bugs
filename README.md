# BUGS

A production-chain game about a rotting log. Tap sap and cut leaf, refine them
through six interlocking resources, keep the whole chain fed, and fill the
Queen's orders until you are holding **one million bugs** at once.

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

### The levers

| Lever | What it does |
|---|---|
| **Building counts** | The main dial. Getting the ratios right is the game. |
| **Throttles** | Every building runs at 0, half or full. Choke one branch to feed another. |
| **Silo caps** | Anything produced past the brim is **thrown away**. Overproduction is a real cost. |
| **Foraging** | Gather sap or leaf by hand to plug a gap or finish an order. |
| **Thrift upgrades** | Make a building eat less, which rewrites the ratios you just balanced. |

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
4242        68m26s     51%   3/3  34/29/23/19/18/22/43      2.7k    3m25s    never      91m41s
8080        69m13s     54%   3/3  36/30/22/19/24/18/42      2.6k    2m29s    never     115m11s
20260909    66m02s     52%   3/3  32/24/22/19/21/21/43      2.7k    3m46s    never     102m08s
```

- **normal** finishes in about an hour, which is the target.
- **brood%** is the share of bugs from the passive brood rather than from
  orders. It sits near 50%, so neither system is decoration.
- **afk** never finishes, at any timescale. It misses every order and dies at
  one Sap Tapper. That is the design working.
- **sloppy** buys by gut feel instead of by ratio. It still wins, but takes
  40-70% longer and throws away millions of resources to overflow. Bad
  balancing is punished, not fatal.

`check-balance.js` asserts all of that plus a static check that no cost can
ever exceed what a silo is able to hold, and it gates every deploy.

### Two bugs that check caught

Both were invisible in play and obvious in the numbers:

- The Hive Singularity wanted 1,400 wax when the largest possible wax store
  held 950. It was simply unbuyable.
- Resource costs grew at the same rate as bug costs, so Brood Chamber #20
  needed more wax than could physically be stored. Every profile stopped at
  exactly 19 — a wall, not a choice. Resource costs now climb gently and are
  clamped to half the current silo, so they gate without ever blocking.

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
