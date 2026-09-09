# BUGS

An incremental game about a rotting log and a problem that gets steadily out of hand.
Poke a beetle, collect bugs, spend bugs on more bugs, and keep going until you are
holding **one million** of them at once.

Vanilla JavaScript. No frameworks, no build step, no dependencies.

**Play it:** https://sburrell23.github.io/Bugs/

---

## The shape of the game

| | |
|---|---|
| **Goal** | Hold 1,000,000 bugs at one time |
| **Length** | About two hours at a normal pace |
| **Colonies** | 6 producers you buy over and over |
| **Monuments** | 3 one-off landmarks that multiply everything and change a rule |
| **Upgrades** | 40 permanent improvements |
| **Studies** | 6 timed lab projects |
| **Awards** | 53, each adding a small permanent bonus |

### Things to do at any given moment

The design brief was that the player should never be sitting on their hands. Five
systems overlap so that something is always live:

- **Colonies and upgrades** — the main spending loop.
- **The Lab** — studies take real time, so there is nearly always one on the bench.
- **Honey Bugs** — surface every 70 to 150 seconds and crawl across the screen.
  Catch one for a Frenzy, a Swarm, a Windfall, or a Clicking Fever.
- **Wasps** — raid every three to seven minutes and steal bugs if you let them.
  Swat them and they drop what they were carrying.
- **Awards** — 53 of them, ticking over constantly in the background.

### The three monuments

Each is expensive, permanent, and rewrites part of the game:

- **Mantis Temple** — wasps no longer dare steal from you; they flee and drop their haul.
- **Cicada Chorus** — Honey Bugs surface far more often.
- **Hive Singularity** — every poke draws on the whole colony at once.

---

## How the balance was actually set

The pacing was not guessed. `js/data.js` builds the entire economy from a small
tuning block, and two tools drive it:

```bash
node tools/simulate.js        # play the game headlessly, three player profiles
node tools/tune.js            # sweep the tuning knobs and score the results
node tools/check-balance.js   # assert the pacing still holds (this runs in CI)
```

`simulate.js` models a competent player: every second it ranks everything unlocked
by payback time, buys the best thing it can afford, saves up when the best buy is
out of reach, and stops spending once the finish line is close enough to bank
towards. It plays three profiles — a heavy clicker, a normal player, and someone
who has left the tab open and wandered off.

`tune.js` sweeps the knobs and scores candidates on whether they make a *good*
two-hour game rather than merely a long one: it penalises runs where a colony is
never worth buying, where monuments go unraised, where the player is left with
nothing to buy, or where the first purchase takes so long that the opening feels
dead.

That last penalty mattered. Early sweeps found "slow" by making the late colonies
so inefficient that nobody would ever buy them — technically two hours, but with a
third of the content dead. Scoring on quality instead of duration fixed it.

Current numbers, over five seeds:

```
seed        casual    active      idle   endBps  colonies       mon  idleGap
4242       139m06s    73m55s   301m50s    36447  63/51/40/27/13/6 3/3    6m53s
99         126m34s    72m22s   300m37s     5037  64/51/40/27/13/5 3/3    7m50s
20260909   126m49s    55m25s   305m04s    36292  63/51/40/27/13/6 3/3    5m00s
777        128m26s    72m31s   297m07s    15554  63/51/40/27/13/6 3/3    9m13s
31337      149m20s    91m11s   303m41s    36484  63/50/40/27/13/6 3/3    9m21s

mean casual run: 134m03s
```

`active` is someone clicking four times a second for the first twenty minutes;
`idle` is a tab left open with almost no interaction.

---

## The art

Every sprite is hand-authored pixel art, written as character grids with a named
palette in `art/src/*.sprites.js` and rendered to PNG by `tools/build-sprites.js`,
which writes the PNG chunks itself using only Node's built-in `zlib`.

```bash
node tools/build-sprites.js
```

The renderer validates as it goes: row counts, row widths, reserved transparency,
and every glyph having a palette entry. `assets/img/` is generated output, so
`art/src/` stays the single source of truth. CI re-renders on every push, which
means malformed sprite data fails the build.

All bugs are drawn top-down with the head pointing north, which is what lets the
crawlers rotate to face wherever they are walking.

## The sound

Every sound effect is synthesised at runtime in `js/audio.js` — enveloped
oscillators and filtered noise, no audio files. The click is a square blip that
creeps up in pitch as you build a streak; the wasp is three detuned sawtooths with
an LFO on the frequency; Honey Bugs get a bright arpeggio. The only audio asset is
the looping background track.

Audio only starts after the "Lift the log" gesture, which is what browsers require.

---

## Running it locally

Any static server works. There is a small one included:

```bash
node tools/serve.js 8123
```

Then open http://localhost:8123.

Opening `index.html` straight off disk will not work — the sprite manifest is
fetched, and `file://` blocks that.

## Layout

```
index.html              markup
css/style.css           all styling
js/data.js              every balance number, built from one tuning block
js/format.js            number and time formatting
js/audio.js             synthesised sound effects, music control
js/sprites.js           sprite manifest loading, with placeholder fallback
js/crawlers.js          bugs wandering the screen, and the clickable visitors
js/game.js              state, economy, rules. Touches no DOM.
js/ui.js                everything that touches the DOM
js/main.js              boot order, game loop, autosave
art/src/*.sprites.js    hand-authored pixel art data
tools/build-sprites.js  sprite data to PNG
tools/simulate.js       headless playthrough
tools/tune.js           balance parameter sweep
tools/check-balance.js  pacing regression test, runs in CI
```

## Saving

Progress is kept in `localStorage` and saved every ten seconds. Time away is paid
out at half rate, capped at two hours — the same deal whether you closed the tab or
the browser simply froze it in the background. **Copy save** and **Paste save** on
the Stats tab move a run between browsers.
