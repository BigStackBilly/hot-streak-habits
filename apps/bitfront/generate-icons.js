// =====================================================================
// BITFRONT — generate-icons.js
//
// Writes icon-192.png and icon-512.png from a 16x16 pixel drawing, scaled
// up by an exact integer factor (12x and 32x) so the app icon is the same
// chunky art as the game rather than a blurry resize of it.
//
// Run with:  node generate-icons.js
//
// PNG encoding is done by hand (zlib + CRC32) because the whole point of
// this project is no build step and no dependencies — `npm i canvas` to
// draw sixteen squares would be a bad trade.
// =====================================================================

const fs = require("fs");
const zlib = require("zlib");

// Same palette as sprites.js.
const C = {
  k: "#12101a", 1: "#24263a", 2: "#3d445e", 3: "#5f6987", 4: "#8f9ab8",
  5: "#c9d3e8", 6: "#ffffff", b: "#24509c", B: "#3f7fe0", c: "#8fd0ff",
  y: "#d9a52b", Y: "#f7e04c", g: "#2c6b3a", G: "#52b85e", h: "#3f8a49",
  R: "#cf3b3b", o: "#f08a3c",
};

const W = 16;
const grid = Array.from({ length: W }, () => new Array(W).fill("k"));

const px = (x, y, c) => {
  if (x >= 0 && y >= 0 && x < W && y < W) grid[y][x] = c;
};
const rect = (x, y, w, h, c) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c);
};
const disc = (cx, cy, r, c) => {
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
    if ((x - cx) ** 2 + (y - cy) ** 2 <= (r + 0.4) ** 2) px(x, y, c);
};

// --- the drawing: a gun turret firing, seen from above ---
rect(0, 0, 16, 16, "g");
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y) & 1) px(x, y, "h");
// dirt road across the bottom corner
rect(0, 12, 16, 4, "1");
for (let x = 0; x < 16; x++) px(x, 12, "k");
// two creeps coming up the road
rect(2, 13, 2, 2, "R");
rect(11, 13, 2, 2, "R");
// Turret pad, low on the tile so the barrel has room above it. Kept small
// enough that the silhouette still reads at 32px.
disc(8, 10, 4.5, "2");
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot(x - 8, y - 10);
  if (d <= 4.9 && d >= 4.1) px(x, y, "k");
}
disc(8, 10, 2.5, 3);
// Barrel: a light stripe inside a dark outline, so it stays visible against
// both the grass and the pad.
rect(7, 2, 3, 6, "k");
rect(8, 3, 1, 5, 5);
// Housing, capping the barrel and sitting on the pad
rect(6, 7, 5, 5, "k");
rect(7, 8, 3, 3, 4);
rect(7, 8, 3, 1, 5);
// Muzzle flash
px(8, 0, "Y"); px(7, 1, "o"); px(8, 1, "6"); px(9, 1, "o");
// gold corner brackets so the icon reads as a game at 32px
for (const [cx, cy] of [[0, 0], [15, 0], [0, 15], [15, 15]]) px(cx, cy, "Y");

// --- PNG writer ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(path, size) {
  const s = size / W;                     // exact integer scale
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;                         // filter type 0 for this scanline
    for (let x = 0; x < size; x++) {
      const hex = C[grid[Math.floor(y / s)][Math.floor(x / s)]];
      raw[p++] = parseInt(hex.slice(1, 3), 16);
      raw[p++] = parseInt(hex.slice(3, 5), 16);
      raw[p++] = parseInt(hex.slice(5, 7), 16);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // 8 bits per channel
  ihdr[9] = 2;    // colour type 2 = truecolour, no alpha (app stores hate alpha)
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
  console.log("wrote", path, size + "x" + size);
}

writePng(__dirname + "/icon-192.png", 192);
writePng(__dirname + "/icon-512.png", 512);
writePng(__dirname + "/AppStoreIcon-1024.png", 1024);
