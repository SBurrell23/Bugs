/* Renders every sprite at 4x on the game's loam background, as one PNG.
   Purely a review aid: node tools/contact-sheet.js [out.png] */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.join(__dirname, '..', 'art', 'src');
const OUT = process.argv[2] || path.join(__dirname, '..', 'sprite-sheet.png');
const SCALE = 4, PAD = 10, COLS = 7;
const BG = [0x1a, 0x12, 0x09];

const T = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body), 0);
  return Buffer.concat([l, body, c]); }

const sprites = [];
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.sprites.js')).sort()) {
  const mod = require(path.join(SRC, f));
  for (const [name, s] of Object.entries(mod)) sprites.push({ name, s });
}
sprites.sort((a, b) => b.s.w - a.s.w || a.name.localeCompare(b.name));

const cell = Math.max(...sprites.map((x) => Math.max(x.s.w, x.s.h))) * SCALE + PAD * 2;
const rows = Math.ceil(sprites.length / COLS);
const W = COLS * cell, H = rows * cell;

const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { px[i * 3] = BG[0]; px[i * 3 + 1] = BG[1]; px[i * 3 + 2] = BG[2]; }

sprites.forEach((entry, i) => {
  const { s } = entry;
  const ox = (i % COLS) * cell + Math.floor((cell - s.w * SCALE) / 2);
  const oy = Math.floor(i / COLS) * cell + Math.floor((cell - s.h * SCALE) / 2);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const ch = s.rows[y][x];
    if (ch === '.') continue;
    const hex = s.palette[ch];
    const n = parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
      const o = ((oy + y * SCALE + dy) * W + ox + x * SCALE + dx) * 3;
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
    }
  }
});

const stride = W * 3;
const raw = Buffer.alloc((stride + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log(sprites.length + ' sprites -> ' + OUT + '  (' + W + 'x' + H + ')');
console.log(sprites.map((x) => x.name).join(', '));
