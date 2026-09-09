/**
 * build-sprites.js
 * Reads every art/src/*.sprites.js module, validates the sprite data,
 * and encodes each sprite to a 1x RGBA PNG in assets/img/.
 * No dependencies: PNG chunks are written by hand, zlib is built in.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'art', 'src');
const OUT_DIR = path.join(ROOT, 'assets', 'img');

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // raw scanlines, each prefixed with filter byte 0 (None)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- validation + rasterising ---------- */
function parseHex(hex, where) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex));
  if (!m) throw new Error(`${where}: colour "${hex}" is not #rrggbb`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rasterise(name, sprite) {
  const { w, h, palette, rows } = sprite;
  const where = `sprite "${name}"`;

  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1)
    throw new Error(`${where}: bad w/h (${w}x${h})`);
  if (!Array.isArray(rows)) throw new Error(`${where}: rows is not an array`);
  if (rows.length !== h)
    throw new Error(`${where}: expected ${h} rows, got ${rows.length}`);
  if (Object.prototype.hasOwnProperty.call(palette, '.'))
    throw new Error(`${where}: "." is reserved for transparency and must not be in the palette`);

  const lut = new Map();
  for (const [ch, hex] of Object.entries(palette)) {
    if (ch.length !== 1) throw new Error(`${where}: palette key "${ch}" must be a single character`);
    lut.set(ch, parseHex(hex, `${where} palette["${ch}"]`));
  }

  const rgba = Buffer.alloc(w * h * 4); // zero-filled == transparent
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    if (typeof row !== 'string')
      throw new Error(`${where}: row ${y} is not a string`);
    if (row.length !== w)
      throw new Error(`${where}: row ${y} has ${row.length} chars, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const rgb = lut.get(ch);
      if (!rgb)
        throw new Error(`${where}: row ${y} col ${x} uses glyph "${ch}" which is not in the palette`);
      const o = (y * w + x) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = 255;
    }
  }
  return { rgba, w, h };
}

/* ---------- main ---------- */
function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`No source dir at ${SRC_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.sprites.js')).sort();
  if (!files.length) {
    console.error('No *.sprites.js files found.');
    process.exit(1);
  }

  const manifest = {};
  let count = 0;
  const problems = [];

  for (const file of files) {
    const full = path.join(SRC_DIR, file);
    delete require.cache[require.resolve(full)];
    const mod = require(full);
    for (const [name, sprite] of Object.entries(mod)) {
      try {
        if (manifest[name]) {
          throw new Error('duplicate sprite name, already defined in ' + manifest[name].from);
        }
        const { rgba, w, h } = rasterise(name, sprite);
        const out = path.join(OUT_DIR, `${name}.png`);
        fs.writeFileSync(out, encodePng(w, h, rgba));
        manifest[name] = { file: `assets/img/${name}.png`, w, h, from: file };
        count++;
        console.log(`  ok  ${name.padEnd(16)} ${w}x${h}  ${file}`);
      } catch (err) {
        problems.push(`${file} -> ${err.message}`);
        console.log(`  FAIL ${name.padEnd(16)} ${err.message}`);
      }
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

  console.log(`\n${count} sprite(s) written to assets/img/`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
}

main();
