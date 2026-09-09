/*
 * crawlers.sprites.js
 *
 * Hand-authored 24x24 pixel-art sprite data for the bug crawlers.
 *
 * VIEWPOINT: every sprite is top-down (dorsal), head pointing UP (north).
 *            The game rotates them with CSS to steer, so orientation is
 *            consistent and the silhouettes are (near) bilaterally symmetric.
 *
 * FORMAT:    { w, h, palette, rows }
 *            '.' is ALWAYS transparent and never appears in a palette.
 *            Every other glyph in `rows` has an entry in `palette`.
 *
 * RAMP CONVENTION (per material, light source top-left):
 *            k = outline (very dark tint of the body hue, never pure black)
 *            d = shadow      b = base      l = light
 *            h = highlight   e = specular / bright accent
 *            extra keys (n/m/g) are secondary materials, documented inline.
 *
 * Limbs are deliberately drawn one or two ramp steps LIGHTER than the body
 * shadow so they stay legible against the dark loam background instead of
 * sinking into it.
 */

module.exports = {

  /* ------------------------------------------------------------------
   * ANT - warm red-brown. Elbowed antennae, three body segments with a
   * pinched two-node petiole, six long splayed legs: fore pair raked
   * forward, mid pair sideways, hind pair sweeping back past the gaster.
   * ---------------------------------------------------------------- */
  crawlAnt: {
    w: 24, h: 24,
    palette: {
      "k": "#241206",
      "d": "#4d2711",
      "b": "#7d4119",
      "l": "#a75f28",
      "h": "#d28c46",
      "e": "#f6e6c4"
    },
    rows: [
      "........................",
      "......h..........h......",
      ".......b........b.......",
      ".......b........b.......",
      "........b.k..k.b........",
      "...b.....kkkkkk.....b...",
      "....bb...khlbbk...bb....",
      "......b.kelbbdek.b......",
      ".......b.kbbddk.b.......",
      "........bkhlbdkb........",
      "..........klbk..........",
      "........bbklbkbb........",
      "......bb.b.dd.b.bb......",
      "....bb..b..bd..b..bb....",
      ".......b..kkkk..b.......",
      "......b..khlbdk..b......",
      "......b.klhlbbdk.b......",
      ".....b..kllbbddk..b.....",
      "........kblbbddk........",
      ".........kbbddk.........",
      "..........kddk..........",
      "...........kk...........",
      "........................",
      "........................"
    ]
  },

  /* ------------------------------------------------------------------
   * ROACH - glossy chestnut. Broad, flat, low-slung oval of overlapping
   * tegmina with a 1px off-centre wing suture, a wide shield pronotum
   * hiding the head, very long sweeping antennae that run off toward the
   * frame corners, spiny outward-raked legs and a pair of rear cerci.
   * ---------------------------------------------------------------- */
  roach: {
    w: 24, h: 24,
    palette: {
      "k": "#1a0d05",
      "d": "#45230d",
      "b": "#713d17",
      "l": "#9a582c",
      "h": "#c48249",
      "e": "#ecd096"
    },
    rows: [
      ".bbb................bbb.",
      "....bb............bb....",
      "......bb........bb......",
      "........b......b........",
      ".........b....b.........",
      ".l........kddk........l.",
      ".bb......kebbek......bb.",
      "...b...khhllbbddk...b...",
      "....b.khhllbbbdddk.b....",
      ".....bkhllbbbbdddkb.....",
      "......kddddddddddk......",
      "....khhlllbdbbbbdddk....",
      "...khhllllbdbbbbbdddk...",
      "..bkhllllbbdbbbbbdddkb..",
      ".b.klllbbbbdbbbbddddk.b.",
      "b..klbbbbbbdbbbdddddk..b",
      "...klbbbbbbdbbddddddk...",
      "...bkbbbbbdbdddddddkb...",
      "..b.kdbbbbdddddddddk.b..",
      ".b...kdbbbddddddddk...b.",
      "b......kkddddddkk......b",
      ".........d....d.........",
      "........................",
      "........................"
    ]
  },

  /* ------------------------------------------------------------------
   * LADYBUG - scarlet elytra + black. Near-circular dome, a black elytral
   * suture running the full length of the midline, six spots, and a small
   * black pronotum with pale cheek marks over a black head.
   * 'n' = black head / spot / suture material, 'g' = leg material.
   * ---------------------------------------------------------------- */
  crawlLadybug: {
    w: 24, h: 24,
    palette: {
      "k": "#3a0e0b",
      "d": "#8e1a18",
      "b": "#cc2420",
      "l": "#e8483c",
      "h": "#ff8a6a",
      "e": "#fff2df",
      "n": "#150a0b",
      "g": "#8a6252"
    },
    rows: [
      "........................",
      ".........n....n.........",
      "..........enne..........",
      "........nennnnen........",
      ".......nnnnnnnnnn.......",
      ".gg.....khlbbddk.....gg.",
      "...g..khhllndbbddk..g...",
      "....gkhhlllndbbbddkg....",
      "....kehhlllndbbbbddk....",
      "...khhnnlllndbbbnnddk...",
      "...khlnnlllndbbbnnddk...",
      "..gklllllbbndbbbbdddkg..",
      ".g.klllbbbbndbbbbdddk.g.",
      "...klbbbbbbndbbbbbddk...",
      "...kbnnbbbbndbbbbnndk...",
      "....knnbbbbndbbbbnnk....",
      "...gkbbbbbbndbbbbddkg...",
      "..g..kbbnnbndbnnddk..g..",
      ".g....kbnnbndbnndk....g.",
      ".......kdbbndbbdk.......",
      "........kddndddk........",
      "..........kkkk..........",
      "........................",
      "........................"
    ]
  },

  /* ------------------------------------------------------------------
   * SPIDER - cool grey-violet. Compact cephalothorax + pedicel + abdomen,
   * eight legs in four clearly separated pairs (front pair longest and
   * reaching the top of the frame), pale eye pair and a pale dorsal
   * abdomen blaze so it does not vanish on dark ground.
   * ---------------------------------------------------------------- */
  spider: {
    w: 24, h: 24,
    palette: {
      "k": "#1e1a28",
      "d": "#3d364f",
      "b": "#635a7d",
      "l": "#8d84a8",
      "h": "#b8afcf",
      "e": "#efe9fb"
    },
    rows: [
      "...b................b...",
      "...b................b...",
      "...b................b...",
      "....b..............b....",
      ".bb..b....kkkk....b..bb.",
      "...b..b..khlbdk..b..b...",
      "....b..bklebbedkb..b....",
      ".....b..klhlbbdk..b.....",
      "......bbkllbbddkbb......",
      ".........klbbdk.........",
      "..........kddk..........",
      ".........khlbdk.........",
      "........khleebdk........",
      "......bkhleeeeddkb......",
      ".....b.klleeeeddk.b.....",
      "....b..klbbeebbdk..b....",
      "...b..bkbbbeebddkb..b...",
      "..b..b..kbbbdddk..b..b..",
      ".b..b....kddddk....b..b.",
      "...b......kkkk......b...",
      "..b..................b..",
      "..b..................b..",
      "........................",
      "........................"
    ]
  },

  /* ------------------------------------------------------------------
   * GROUND BEETLE - iridescent blue-green-black. Armored oval: distinct
   * head with mandibles and filiform antennae, a wide heart-shaped
   * pronotum, and longitudinally striated elytra split by a central
   * suture. Long running legs.
   * ---------------------------------------------------------------- */
  groundBeetle: {
    w: 24, h: 24,
    palette: {
      "k": "#081713",
      "d": "#215547",
      "b": "#328066",
      "l": "#48ab7e",
      "h": "#7cd3a3",
      "e": "#cdf5dc"
    },
    rows: [
      "....b..............b....",
      ".....bb..........bb.....",
      ".......b..k..k..b.......",
      "........b.kkkk.b........",
      ".bb......kelbek......bb.",
      "...b.....klbbdk.....b...",
      "....b...khlbbddk...b....",
      ".....bkhhllbbbdddkb.....",
      "......khllbbbbdddk......",
      ".......kllbbbbddk.......",
      "........kddddddk........",
      "......khldlddbdbdk......",
      "....bkhdldlddbdbdbkb....",
      "...bkhldldlddbdbdbdkb...",
      ".bb.khldldlddbdbdbdk.bb.",
      "....khldldlddbdbdbdk....",
      "....klbdbdbddbdbdddk....",
      "....bkbdbdbddbdbddkb....",
      "...b.kbdbdbdddddddk.b...",
      "..b...kbdbdddddddk...b..",
      ".b.....kkddddddkk.....b.",
      ".........kkkkkk.........",
      "........................",
      "........................"
    ]
  },

  /* ------------------------------------------------------------------
   * CENTIPEDE - amber-orange. Long segmented ribbon spanning the whole
   * frame, a leg pair on every segment, forcipules and long forward
   * antennae at the head, trailing terminal legs at the tail.
   * ---------------------------------------------------------------- */
  centipede: {
    w: 24, h: 24,
    palette: {
      "k": "#3a1a05",
      "d": "#8a4409",
      "b": "#c46a12",
      "l": "#e8942a",
      "h": "#ffc061",
      "e": "#fff0c8"
    },
    rows: [
      "...bb..............bb...",
      ".....bb..........bb.....",
      ".......b..kkkk..b.......",
      ".........kelbek.........",
      "........klhlbbdk........",
      "......ddkhllbbdkdd......",
      "....dd..kdbbdddk..dd....",
      "......ddkhllbbdkdd......",
      "....dd..kdbbdddk..dd....",
      "......ddkhllbbdkdd......",
      "....dd..kdbbdddk..dd....",
      "......ddkhllbbdkdd......",
      "....dd..kdbbdddk..dd....",
      "......ddkhllbbdkdd......",
      "....dd..kdbbdddk..dd....",
      ".......ddklhbdkdd.......",
      ".....dd..kdbddk..dd.....",
      ".......ddklhbdkdd.......",
      ".....dd..kdbddk..dd.....",
      ".......ddklhbdkdd.......",
      ".....dd..kdbddk..dd.....",
      ".......d.kddddk.d.......",
      "......d...kkkk...d......",
      ".....d............d....."
    ]
  },

  /* ------------------------------------------------------------------
   * TERMITE (soldier) - bone/cream. Pale soft banded abdomen and three
   * pale thoracic segments behind a big darker amber head that carries a
   * pair of curved bright mandibles and short beaded antennae.
   * 'n' = head outline, 'm' = head base, 'g' = mandible / antenna amber.
   * ---------------------------------------------------------------- */
  termite: {
    w: 24, h: 24,
    palette: {
      "k": "#4a3a20",
      "d": "#9a8a62",
      "b": "#cbbb90",
      "l": "#e6d9b4",
      "h": "#f7f0dc",
      "e": "#fffdf2",
      "n": "#2e1c08",
      "m": "#8a5a24",
      "g": "#b8823c"
    },
    rows: [
      "..........g..g..........",
      ".........gg..gg.........",
      "........gg....gg........",
      ".....gg.mmnnnnmm.gg.....",
      ".......gnegmmmmng.......",
      "........ngmmmmmn........",
      "....bb..nmmmmmmn..bb....",
      "......b.nmmmmmmn.b......",
      ".......b.nmmmmn.b.......",
      "........bkhlbdkb........",
      ".........klbbdk.........",
      ".......bbklbbdkbb.......",
      ".....bb..klbbdk..bb.....",
      "....b...bklhbdkb...b....",
      ".......bkhllbbdkb.......",
      "......bkhllbbbddkb......",
      "....bb.kddbbbdddk.bb....",
      ".......kllbbbbddk.......",
      ".......kddbbbdddk.......",
      "........klbbbbdk........",
      "........kddddddk........",
      ".........kdbbdk.........",
      "..........kkkk..........",
      "........................"
    ]
  },

  /* ------------------------------------------------------------------
   * WEEVIL - olive-green. The unmistakable long rostrum projecting from
   * the head, elbowed antennae running down the middle of the snout to
   * pale clubs, a narrow pronotum and a fat rounded elytral dome dotted
   * with pale scales.
   * ---------------------------------------------------------------- */
  weevil: {
    w: 24, h: 24,
    palette: {
      "k": "#1a1f0c",
      "d": "#3d4a1c",
      "b": "#5f7229",
      "l": "#84993c",
      "h": "#b0c463",
      "e": "#e4efb4"
    },
    rows: [
      "...........hd...........",
      "..........khdk..........",
      "..........khdk..........",
      ".........hkhbkh.........",
      ".......hh.khbk.hh.......",
      ".....hh...klbk...hh.....",
      "...ee....klbbdk....ee...",
      ".........kelbek.........",
      "..ll.....klbbdk.....ll..",
      "....ll..khlbbddk..ll....",
      "......lkhllbbbddkl......",
      ".......kllbbbbddk.......",
      "........kddddddk........",
      ".....lkhhllddbbddkl.....",
      "....lkhhlllddbbbddkl....",
      "..llkhllebbddbbebddkll..",
      ".l..khllbbbddbbbbddk..l.",
      "....klelbbbddbbbbedk....",
      "...lkllbbbbddbbbbddkl...",
      "..l..klbbebddbebddk..l..",
      ".l....kbbbdddbdddk....l.",
      ".l.....kdbbddbddk.....l.",
      ".........kkddkk.........",
      "........................"
    ]
  }

};
