// =====================================================================
// BITFRONT — sprites.js
//
// All of the game's pixel art lives here. There are no image files: every
// sprite is drawn once at startup into a small offscreen canvas, one pixel
// at a time, and then blitted around by game.js. That keeps the whole game
// to a handful of text files you can open over file:// with no build step,
// and it means the art is editable in a text editor like the rest of the code.
//
// Two ways of authoring are used, whichever suits the shape:
//
//   1. Primitives  — px/rect/frame/disc/... calls. Good for the mechanical
//                    stuff (turret pads, buildings) where straight edges and
//                    exact bolt positions matter.
//   2. String art  — rows of palette letters, e.g. "..kRRk..". Good for the
//                    organic stuff (creeps, marines) where a shape is easier
//                    to see than to describe. Short rows are padded, so a
//                    miscounted row shifts art rather than throwing.
//
// Everything is authored at 1 screen pixel = 1 art pixel. The game renders
// into a 384x208 buffer and upscales it with smoothing off, so the chunky
// look comes for free and rotated barrels still read as pixels.
//
// Exposes two globals: PAL (the palette) and SPR (the finished sprites).
// =====================================================================

// ---------------------------------------------------------------------
// 1. Palette
//
// One shared 26-colour palette, keyed by single characters so the string
// art stays readable. Lowercase = the darker shade of a hue, uppercase =
// the brighter one. 'k' is the near-black used for every outline, which is
// what glues the different sprites together into one visual family.
// ---------------------------------------------------------------------
const PAL = {
  k: "#12101a", // outline / near-black
  m: "#2a1c3a", // dark violet, used for shadows on the ground
  1: "#24263a", // metal, darkest
  2: "#3d445e",
  3: "#5f6987",
  4: "#8f9ab8",
  5: "#c9d3e8", // metal, lightest
  6: "#ffffff", // pure white — eyes, sparks, muzzle flash cores
  b: "#24509c", // player blue, dark
  B: "#3f7fe0", // player blue
  c: "#8fd0ff", // player blue, light / energy
  r: "#7a1f2e", // enemy red, dark
  R: "#cf3b3b", // enemy red
  o: "#f08a3c", // orange — cannons, fire
  y: "#d9a52b", // gold, dark
  Y: "#f7e04c", // gold — minerals, lightning
  g: "#2c6b3a", // grass / creep green, dark
  G: "#52b85e", // grass / creep green
  h: "#3f8a49", // grass mid tone
  d: "#1f4b2c", // grass shadow patch
  s: "#6b6257", // neutral stone, dark
  S: "#948a7c", // neutral stone, light
  v: "#5a2fa0", // crystal violet, dark
  V: "#a86bff", // crystal violet
  w: "#e6cbff", // crystal violet, light
  n: "#4d3423", // dirt / wood, dark
  N: "#7d5636", // dirt / wood
  t: "#1c6e75", // teal, dark
  T: "#48c3c9", // teal — frost
};

// ---------------------------------------------------------------------
// 2. The little pixel canvas
//
// Sprite is a thin wrapper over an ImageData buffer with just enough
// drawing primitives to author the art. Nothing here is used at runtime —
// once `finish()` has been called the sprite is a plain <canvas> that the
// renderer can drawImage() as fast as any loaded PNG.
// ---------------------------------------------------------------------
class Sprite {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d");
    this.img = this.ctx.createImageData(w, h);
    // Anchor: the point in the sprite that gets lined up with an entity's
    // position. Defaults to the centre; creeps override it to their feet.
    this.ax = w / 2;
    this.ay = h / 2;
  }

  // Set one pixel. `c` is a palette key, a "#rrggbb" string, or null to erase.
  px(x, y, c) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    const i = (y * this.w + x) * 4;
    const d = this.img.data;
    if (c == null || c === ".") {
      d[i + 3] = 0;
      return this;
    }
    const hex = PAL[c] || c;
    d[i] = parseInt(hex.slice(1, 3), 16);
    d[i + 1] = parseInt(hex.slice(3, 5), 16);
    d[i + 2] = parseInt(hex.slice(5, 7), 16);
    d[i + 3] = 255;
    return this;
  }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
    return this;
  }

  // Outline only — one pixel thick.
  frame(x, y, w, h, c) {
    for (let i = 0; i < w; i++) {
      this.px(x + i, y, c);
      this.px(x + i, y + h - 1, c);
    }
    for (let j = 0; j < h; j++) {
      this.px(x, y + j, c);
      this.px(x + w - 1, y + j, c);
    }
    return this;
  }

  hline(x, y, w, c) { return this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { return this.rect(x, y, 1, h, c); }

  // Filled circle. Pixel circles look best when the radius test is nudged
  // by 0.4 — without it the cardinal points stick out as single spikes.
  disc(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= (r + 0.4) * (r + 0.4)) this.px(x, y, c);
      }
    }
    return this;
  }

  ring(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r + 0.4 && d >= r - 0.6) this.px(x, y, c);
      }
    }
    return this;
  }

  // Checkerboard fill, used to blend two tones without a third colour —
  // the oldest trick in the pixel-art book and it keeps the palette tight.
  dither(x, y, w, h, c, phase = 0) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++)
        if (((x + i + y + j) & 1) === phase) this.px(x + i, y + j, c);
    return this;
  }

  // A 2x2 rivet: light top-left, dark bottom-right. Sells "metal" instantly.
  bolt(x, y) {
    this.px(x, y, 5).px(x + 1, y, 4).px(x, y + 1, 3).px(x + 1, y + 1, 1);
    return this;
  }

  // Copy the left half onto the right, mirrored. Every creature in the game
  // is symmetrical, so this halves the authoring work and guarantees the
  // two sides actually line up.
  mirrorX() {
    const half = Math.floor(this.w / 2);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < half; x++) {
        const src = (y * this.w + x) * 4;
        const dst = (y * this.w + (this.w - 1 - x)) * 4;
        for (let k = 0; k < 4; k++) this.img.data[dst + k] = this.img.data[src + k];
      }
    }
    return this;
  }

  // Author from rows of palette letters. Rows shorter than the sprite are
  // padded with transparency and extra rows are ignored, so a typo in the
  // art is a visual glitch rather than a crash.
  rows(lines, ox = 0, oy = 0) {
    for (let y = 0; y < lines.length; y++) {
      const line = lines[y];
      for (let x = 0; x < line.length; x++) {
        const ch = line[x];
        if (ch !== "." && ch !== " ") this.px(ox + x, oy + y, ch);
      }
    }
    return this;
  }

  // Bake the pixel buffer into the canvas. After this the sprite is
  // read-only as far as the game is concerned.
  finish(ax, ay) {
    this.ctx.putImageData(this.img, 0, 0);
    if (ax !== undefined) { this.ax = ax; this.ay = ay; }
    return this;
  }
}

// Small helper so each sprite definition below reads as one expression.
function sprite(w, h, draw, ax, ay) {
  const s = new Sprite(w, h);
  draw(s);
  return s.finish(ax, ay);
}

// ---------------------------------------------------------------------
// 3. Terrain
//
// Ground tiles are 16x16 and come in a few variants each; game.js picks a
// variant per tile from a hash of its coordinates so the map looks
// hand-placed instead of tiled. All of them are seamless at the edges.
// ---------------------------------------------------------------------

// A tiny deterministic RNG, so terrain variants are identical on every
// reload without pulling in a seeded-random library.
function lcg(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

// Grass: two greens dithered together, then a few darker clumps and
// lighter blades on top. One variant in eight grows a flower — enough to
// notice, not enough to turn the field into confetti.
function grassTile(variant) {
  return sprite(16, 16, (s) => {
    s.rect(0, 0, 16, 16, "g");
    s.dither(0, 0, 16, 16, "h", variant & 1);
    const rnd = lcg(1013 + variant * 7919);
    // Darker patches first, so blades can sit on top of them.
    for (let i = 0; i < 3; i++) {
      const x = (rnd() * 14) | 0, y = (rnd() * 14) | 0;
      s.px(x, y, "d").px(x + 1, y, "d").px(x, y + 1, "d");
    }
    for (let i = 0; i < 5; i++) {
      const x = (rnd() * 16) | 0, y = (rnd() * 16) | 0;
      s.px(x, y, "G").px(x, y + 1, "h");
    }
    if (variant === 5) {
      s.px(5, 6, "y").px(6, 6, "Y").px(5, 7, "d");
    }
  });
}

// Dirt road: warm browns with grey stones and wheel-rut speckle. The
// stones are deliberately neutral rather than the blue-grey metal ramp —
// blue pebbles in a mud road read as litter.
function pathTile(variant) {
  return sprite(16, 16, (s) => {
    s.rect(0, 0, 16, 16, "n");
    s.dither(0, 0, 16, 16, "N", variant & 1);
    const rnd = lcg(7717 + variant * 104729);
    for (let i = 0; i < 5; i++) {
      const x = (rnd() * 15) | 0, y = (rnd() * 15) | 0;
      s.px(x, y, "S").px(x + 1, y, "s").px(x, y + 1, "s");
    }
    for (let i = 0; i < 8; i++) s.px((rnd() * 16) | 0, (rnd() * 16) | 0, "k");
  });
}

// ---------------------------------------------------------------------
// 4. Map decoration
// ---------------------------------------------------------------------

// A mineral crystal cluster: what extractors get built on top of. One tall
// centre shard flanked by two shorter ones, all sharing a rubble base, so
// it reads as a deposit rather than a plant.
const crystalSprite = sprite(16, 16, (s) => {
  s.rows([
    "................",
    "................",
    ".......kk.......",
    "......kwVk......",
    "......kwVk......",
    "..kk..kwVk..kk..",
    ".kwVk.kwVVk.kwk.",
    ".kwVk.kwVVk.kVk.",
    ".kwVVkkwVVVkkVk.",
    ".kwVVvvwVVVvvVk.",
    ".kvVVvvvVVvvvVk.",
    "..kvvvvvvvvvvk..",
    "...kkvvvvvvkk...",
    ".....kkkkkk.....",
    "................",
    "................",
  ]);
  // Specular hits so the shards look glassy rather than like painted blocks.
  s.px(8, 3, "6").px(3, 7, "6").px(13, 7, "6");
}, 8, 13);

// Boulder — pure blocker, cannot be built on.
const rockSprite = sprite(16, 16, (s) => {
  s.rows([
    "................",
    "................",
    "....kkkkk.......",
    "...k44443kk.....",
    "..k4445333kk....",
    ".k44453332 3k...",
    ".k4453332223k...",
    ".k4533222221k...",
    ".k3332222111k...",
    "..k32221111k....",
    "...kk1111kk.....",
    ".....kkkkk......",
    "................",
    "................",
    "................",
    "................",
  ]);
  s.rect(2, 11, 11, 1, "m");
}, 8, 12);

// Pine tree — pure decoration, overhangs its tile upwards a little.
const pineSprite = sprite(16, 20, (s) => {
  s.rows([
    "................",
    ".......k........",
    "......kGk.......",
    "......kGk.......",
    ".....kGGGk......",
    ".....kGhGk......",
    "....kGGhGGk.....",
    "....kGhhhGk.....",
    "...kGGhhhGGk....",
    "...kGhhghhGk....",
    "..kGGhhghhGGk...",
    "..kGhhgggghGk...",
    ".kGGhhggghhGGk..",
    ".kghhggggghhgk..",
    "..kkkknnkkkkk...",
    "......knk.......",
    "......knk.......",
    ".....kknkk......",
    "................",
    "................",
  ]);
}, 8, 18);

// Skull pile — flavour for the ground near the enemy spawn.
const bonesSprite = sprite(16, 16, (s) => {
  s.rows([
    "................",
    "................",
    "................",
    "................",
    "................",
    "......kkkk......",
    ".....k5555k.....",
    "....k5k55k5k....",
    "....k555555k....",
    "....k5kkkk5k....",
    ".....kk55kk.....",
    "..k5k.kkkk.k5k..",
    ".k555kkkkkk555k.",
    "..kkk......kkk..",
    "................",
    "................",
  ]);
}, 8, 13);

// ---------------------------------------------------------------------
// 5. Player structures
//
// Shared vocabulary so the base looks like one faction built it:
//   - a bolted metal pad with a top highlight and bottom shadow
//   - one accent colour per building type
//   - blue = player, always
// ---------------------------------------------------------------------

// The pad that every turret sits on. `accent` tints the warning stripe so
// the four turret types are still telling apart from above at 1x zoom.
function turretPad(s, accent) {
  s.frame(1, 4, 14, 11, "k");
  s.rect(2, 5, 12, 9, 2);
  s.hline(2, 5, 12, 3);
  s.hline(2, 6, 12, 3);
  s.hline(2, 12, 12, 1);
  s.hline(2, 13, 12, "k");
  s.rect(2, 10, 12, 1, accent);
  s.bolt(3, 7);
  s.bolt(11, 7);
  s.bolt(3, 11);
  s.bolt(11, 11);
  // Recessed mount the barrel pivots in.
  s.disc(8, 9, 3, 1);
  s.ring(8, 9, 3, "k");
  s.disc(8, 9, 2, 3);
  // Ground shadow, one pixel proud of the pad.
  s.hline(2, 15, 12, "m");
}

const gunBase = sprite(16, 16, (s) => turretPad(s, "B"), 8, 12);
const cannonBase = sprite(16, 16, (s) => {
  turretPad(s, "o");
  // Outrigger feet — reads as "heavy artillery" next to the plain gun pad.
  s.rect(0, 8, 2, 4, 1).px(0, 8, "k").px(0, 11, "k");
  s.rect(14, 8, 2, 4, 1).px(15, 8, "k").px(15, 11, "k");
}, 8, 12);
const frostBase = sprite(16, 16, (s) => turretPad(s, "T"), 8, 12);
const teslaBase = sprite(16, 16, (s) => turretPad(s, "V"), 8, 12);

// Reactor: the power pylon. Every other building has to be inside one of
// these (or the HQ's own field) to be placed at all.
const reactorSprite = sprite(16, 16, (s) => {
  s.rows([
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]);
  // Base plinth
  s.frame(2, 10, 12, 5, "k");
  s.rect(3, 11, 10, 3, 2);
  s.hline(3, 11, 10, 3);
  s.hline(3, 13, 10, 1);
  s.bolt(4, 12);
  s.bolt(10, 12);
  // Spire
  s.rows([
    ".......kk.......",
    "......kbBk......",
    "......kbBk......",
    ".....kbBBBk.....",
    ".....kbBBBk.....",
    "....kbBcBBk.....",
    "....kbBcBBk.....",
    "...kbBBcBBBk....",
    "...kbBBBBBBk....",
  ], 0, 1);
  // Energy orb at the top
  s.disc(8, 3, 2, "c");
  s.px(8, 2, 6).px(7, 3, 6);
  s.hline(2, 15, 12, "m");
}, 8, 13);

// Extractor: sits on a crystal patch and turns it into income. A silo full
// of glowing violet ore, with the drill wheel on top drawn by the renderer
// so it can spin.
const extractorSprite = sprite(16, 16, (s) => {
  // Base platform
  s.frame(1, 7, 14, 8, "k");
  s.rect(2, 8, 12, 6, 2);
  s.hline(2, 8, 12, 3);
  s.hline(2, 12, 12, 1);
  s.hline(2, 13, 12, "k");
  s.bolt(3, 10);
  s.bolt(11, 10);
  // Central silo, glowing with whatever it's pulling out of the ground
  s.frame(5, 1, 6, 8, "k");
  s.rect(6, 2, 4, 6, "v");
  s.hline(6, 2, 4, "V");
  s.px(7, 4, "w").px(8, 6, "w").px(7, 7, "V");
  // Cap the drill wheel spins on
  s.frame(4, 0, 8, 2, "k");
  s.rect(5, 0, 6, 1, 4);
  // Feed pipes either side
  s.vline(3, 4, 5, 3).px(3, 3, "k").px(4, 4, 1);
  s.vline(12, 4, 5, 3).px(12, 3, "k").px(11, 4, 1);
  s.hline(2, 15, 12, "m");
}, 8, 13);

// Barracks: trains marines, which walk out and physically body-block creeps.
const barracksSprite = sprite(16, 16, (s) => {
  // Roof
  s.frame(0, 2, 16, 5, "k");
  s.rect(1, 3, 14, 3, "b");
  s.hline(1, 3, 14, "B");
  s.dither(1, 4, 14, 2, "b", 1);
  // Walls
  s.frame(1, 6, 14, 9, "k");
  s.rect(2, 7, 12, 7, 2);
  s.hline(2, 7, 12, 3);
  s.hline(2, 13, 12, 1);
  // Doorway with a lit interior
  s.frame(6, 8, 5, 7, "k");
  s.rect(7, 9, 3, 5, 1);
  s.rect(7, 9, 3, 1, "y");
  // Sandbags either side
  s.rect(2, 11, 3, 3, "N").px(2, 11, "n").px(4, 13, "n");
  s.rect(11, 11, 3, 3, "N").px(13, 11, "n").px(11, 13, "n");
  // Flag pole
  s.vline(2, 0, 3, 4);
  s.rect(3, 0, 4, 3, "B").hline(3, 0, 4, "c");
  s.hline(2, 15, 12, "m");
}, 8, 13);

// HQ / Command Center — sits on a 2x2 footprint but stands 40px tall, so
// it towers over the turrets. It's the thing every creep on the map is
// walking towards, and it should look like it: two flanking towers, a
// blue roof slab, a radar dish, and blast doors with warning lights.
const hqSprite = sprite(32, 40, (s) => {
  s.rect(4, 37, 24, 2, "m");            // ground shadow

  // Flanking towers, drawn first so the main block overlaps them.
  for (const tx of [1, 23]) {
    s.frame(tx, 9, 8, 28, "k");
    s.rect(tx + 1, 10, 6, 26, 2);
    s.vline(tx + 1, 10, 26, 3);
    s.vline(tx + 6, 10, 26, 1);
    s.dither(tx + 2, 12, 4, 22, 1, 0);
    // Blue tower cap
    s.frame(tx - 1, 5, 10, 5, "k");
    s.rect(tx, 6, 8, 3, "b");
    s.hline(tx, 6, 8, "B");
    // Slit window
    s.frame(tx + 2, 15, 4, 4, "k");
    s.rect(tx + 3, 16, 2, 2, "c");
    s.px(tx + 3, 16, 6);
  }

  // Main block
  s.frame(4, 17, 24, 20, "k");
  s.rect(5, 18, 22, 18, 2);
  s.rect(5, 18, 22, 2, 3);
  s.rect(5, 34, 22, 2, 1);
  s.dither(5, 20, 22, 14, 1, 0);

  // Roof slab in faction blue, overhanging the block on both sides.
  s.frame(2, 12, 28, 6, "k");
  s.rect(3, 13, 26, 4, "b");
  s.hline(3, 13, 26, "B");
  s.dither(3, 14, 26, 2, "b", 1);
  // Roof trim stripe
  s.hline(3, 17, 26, 1);

  // Blast doors, split down the middle, with warning lamps.
  s.frame(11, 23, 10, 14, "k");
  s.rect(12, 24, 8, 12, 1);
  s.rect(12, 24, 8, 2, 3);
  s.vline(16, 24, 12, "k");
  s.rect(13, 28, 2, 1, "Y");
  s.rect(18, 28, 2, 1, "Y");
  s.dither(12, 27, 8, 8, 2, 1);

  // Radar dish on the left tower.
  s.ring(5, 3, 3, "k");
  s.disc(5, 3, 2, 4);
  s.px(5, 3, 5).px(5, 1, 6);
  s.vline(5, 4, 2, 3);
  // Antenna mast on the right tower, with a blinking-red tip.
  s.vline(27, 0, 6, 4);
  s.px(27, 0, "R").px(28, 2, 3).px(26, 3, 3);

  // Sandbag berm along the front.
  for (const x of [5, 8, 21, 24]) {
    s.rect(x, 33, 3, 3, "N");
    s.px(x, 33, "n");
    s.px(x + 2, 35, "n");
  }
}, 16, 39);

// ---------------------------------------------------------------------
// 6. Creeps and marines
//
// Authored front-facing (top-down games get away with this: everything is
// slightly tilted towards the camera) and flipped horizontally by the
// renderer when the thing is walking left. Two frames each — the second is
// a one-pixel bob plus swapped legs, which at 8fps reads as a walk cycle.
//
// Anchors are at the feet so a creep's position is where it touches the
// ground, which is what the collision and sorting code wants.
// ---------------------------------------------------------------------

// Grunt: the bread-and-butter enemy. Small red imp with a horned head.
function gruntFrame(step) {
  return sprite(16, 16, (s) => {
    const y = step; // frame 1 sits one pixel lower — a bob, not a bounce
    s.rows([
      "...k.......k....",
      "...kRk...kRk....",
      "....kRk.kRk.....",
      "....krrrrrk.....",
      "...kRR6RR6RRk...",
      "...kRRRRRRRRk...",
      "....kRkkkkRk....",
      "...krrRRRRrrk...",
      "..krRRRRRRRRrk..",
      "..krRRRooRRRrk..",
      "..kkrRRooRRrkk..",
      "....krrrrrrk....",
    ], 0, 1 + y);
    // Legs alternate between the frames.
    if (step === 0) {
      s.rows(["....k1k.k1k.....", "....kk...kk....."], 0, 13);
    } else {
      s.rows(["...k1k...k1k....", "...kk.....kk...."], 0, 13);
    }
    s.rect(4, 15, 8, 1, "m");
  }, 8, 15);
}

// Runner: fast and flimsy. Lean green sprinter, leaning forward.
function runnerFrame(step) {
  return sprite(16, 16, (s) => {
    s.rows([
      "................",
      "................",
      ".....kkkk.......",
      "....kG66Gk......",
      "....kGGGGk......",
      ".....kggk.......",
      "....kGGGGk......",
      "...kGGGGGGk.....",
      "...kgGGGGgk.....",
      "....kgggk.......",
    ], 0, 2 + step);
    if (step === 0) {
      s.rows(["...k1k.k1k......", "..kk.....kk....."], 0, 12);
    } else {
      s.rows(["....k1kk1k......", "...kk....kk....."], 0, 12);
    }
    s.rect(4, 15, 7, 1, "m");
  }, 8, 15);
}

// Brute: slow, armoured, high HP. Wide shoulder plates read as "armour"
// from across the screen, which is the point — you should recognise the
// thing your gun turrets are bad at before it reaches them.
function bruteFrame(step) {
  return sprite(16, 16, (s) => {
    s.rows([
      "..k..........k..",
      "..kk.k4444k.kk..",
      "..k4kk4RR4kk4k..",
      "..k44k4664k44k..",
      "..k444kRRk444k..",
      ".k4444kkkk4444k.",
      ".k43rRRRRRRr34k.",
      ".k43rR4444Rr34k.",
      ".k4rRR4554RRr4k.",
      "..krRRR44RRRrk..",
      "..kkrRRRRRRrkk..",
      "....krrrrrrk....",
    ], 0, 1 + step);
    if (step === 0) {
      s.rows(["...k22k.k22k....", "...kkk...kkk...."], 0, 13);
    } else {
      s.rows(["..k22k...k22k...", "..kkk.....kkk..."], 0, 13);
    }
    s.rect(3, 15, 10, 1, "m");
  }, 8, 15);
}

// Flyer: ignores the road entirely and beelines for the HQ, so it punishes
// a build that has all its anti-air in one corner.
function flyerFrame(step) {
  return sprite(16, 16, (s) => {
    // Wings up on frame 0, down on frame 1.
    if (step === 0) {
      s.rows([
        "..kk........kk..",
        ".kwVk......kVwk.",
        ".kVVVk....kVVVk.",
        "..kVVVk..kVVVk..",
        "...kkVVkkVVkk...",
      ], 0, 0);
    } else {
      s.rows([
        "................",
        "..kk........kk..",
        "...kVwk..kwVk...",
        "....kVVkkVVk....",
        "....kkVVVVkk....",
      ], 0, 1);
    }
    s.rows([
      ".....kvVVvk.....",
      "....kv6VV6vk....",
      "....kvVVVVvk....",
      ".....kvVVvk.....",
      "....kkvvvvkk....",
      "...k1kkvvkk1k...",
      "....k..kk..k....",
    ], 0, 5);
    s.rect(5, 15, 6, 1, "m");
  }, 8, 15);
}

// Boss: 24x24, arrives on waves 10 and 20. Deliberately built out of the
// grunt's shapes at a larger scale so it reads as "the same army, bigger".
function bossFrame(step) {
  return sprite(24, 24, (s) => {
    const y = step;
    // Horns and crown
    s.rows([
      "..k....kkkk....k..",
      "..kRk.kR66Rk.kRk..",
      "..kRRkkRRRRkkRRk..",
      "...kRRRRrrRRRRk...",
      "...kRR6RRRR6RRk...",
      "...kRRRRRRRRRRk...",
      "....kRkkkkkkRk....",
      "....kRRRRRRRRk....",
    ], 3, 1 + y);
    // Torso with orange core
    s.rows([
      "..krrRRRRRRRRrrk..",
      ".krRRRRooooRRRRrk.",
      ".krRRRoo66ooRRRrk.",
      "krRRRRoo66ooRRRRrk",
      "krRRRRRoooooRRRRrk",
      ".krRRRRRoooRRRRRk.",
      "..kkrRRRRRRRRrkk..",
      "....krrrrrrrrk....",
    ], 3, 9 + y);
    // Arms
    s.rect(2, 11 + y, 2, 7, "R").frame(1, 10 + y, 4, 9, "k");
    s.rect(20, 11 + y, 2, 7, "R").frame(19, 10 + y, 4, 9, "k");
    // Legs
    if (step === 0) {
      s.rows(["...k11k....k11k...", "...kkkk....kkkk..."], 3, 18);
    } else {
      s.rows(["..k11k......k11k..", "..kkkk......kkkk.."], 3, 18);
    }
    s.rect(5, 23, 14, 1, "m");
  }, 12, 23);
}

// Marine: the unit a barracks trains. Deliberately tiny next to a brute.
function marineFrame(step) {
  return sprite(16, 16, (s) => {
    s.rows([
      "................",
      "................",
      "................",
      ".....kkkk.......",
      "....kBccBk......",
      "....kB55Bk......",
      "....kbBBbk......",
      "...kBBBBBBk.....",
      "...kBbBBbBk.....",
      "...kBBBBBBk.....",
      "....kbbbbk......",
    ], 0, 1 + step);
    // Rifle, held across the body
    s.rect(9, 8 + step, 4, 1, 1).px(13, 8 + step, "k").px(9, 9 + step, "k");
    if (step === 0) {
      s.rows(["....k1k1k.......", "....kk.kk......."], 0, 13);
    } else {
      s.rows(["...k1k.k1k......", "...kk...kk......"], 0, 13);
    }
    s.rect(4, 15, 7, 1, "m");
  }, 8, 15);
}

// ---------------------------------------------------------------------
// 7. Tiny bitmap font
//
// Floating combat text ("+3", "-12") is drawn with these 3x5 glyphs rather
// than canvas fillText, because at this resolution the browser's font
// rasteriser produces grey mush and these produce pixels.
// ---------------------------------------------------------------------
const GLYPHS = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
  "-": ["000", "000", "111", "000", "000"],
  "$": ["011", "110", "010", "011", "110"],
  "!": ["010", "010", "010", "000", "010"],
};

// Draw a short string of glyph characters straight onto a 2D context.
// Used at render time (not baked), because the colour changes per floater.
function drawPixelText(ctx, text, x, y, color) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of String(text)) {
    const g = GLYPHS[ch];
    if (!g) { cx += 4; continue; }
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++)
        if (g[row][col] === "1") ctx.fillRect(cx + col, y + row, 1, 1);
    cx += 4;
  }
  return cx - x - 1;
}

function pixelTextWidth(text) {
  return String(text).length * 4 - 1;
}

// ---------------------------------------------------------------------
// 8. The finished sprite table
// ---------------------------------------------------------------------
const SPR = {
  grass: [0, 1, 2, 3, 4, 5, 6, 7].map(grassTile),
  path: [pathTile(0), pathTile(1), pathTile(2), pathTile(3)],
  crystal: crystalSprite,
  rock: rockSprite,
  pine: pineSprite,
  bones: bonesSprite,

  hq: hqSprite,
  reactor: reactorSprite,
  extractor: extractorSprite,
  barracks: barracksSprite,
  gun: gunBase,
  cannon: cannonBase,
  frost: frostBase,
  tesla: teslaBase,

  grunt: [gruntFrame(0), gruntFrame(1)],
  runner: [runnerFrame(0), runnerFrame(1)],
  brute: [bruteFrame(0), bruteFrame(1)],
  flyer: [flyerFrame(0), flyerFrame(1)],
  boss: [bossFrame(0), bossFrame(1)],
  marine: [marineFrame(0), marineFrame(1)],
};
