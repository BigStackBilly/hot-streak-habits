// =====================================================================
// BITFRONT — game.js
//
// A pixel-art RTS-flavoured tower defence, in one classic <script> so the
// whole thing runs off a double-clicked file:// URL with no build step
// (same house rule as every sibling app here).
//
// The "RTS" part isn't just the art. Three systems are lifted straight out
// of StarCraft/Warcraft rather than out of tower defence:
//
//   * POWER    - buildings can only be placed inside a reactor's field
//                (pylons), so map control matters, not just tower count.
//   * ECONOMY  - extractors on mineral patches, harvesting over time, and
//                calling waves early converts leftover prep time into cash.
//   * UNITS    - barracks train marines who physically stop creeps on the
//                road, and you can right-click a rally point to move them.
//
// Everything is drawn into a 384x208 pixel buffer and upscaled with
// smoothing off, so the game is genuinely low-resolution rather than
// "pixel-styled" — every sprite is authored per-pixel in sprites.js.
//
// Organised top to bottom as:
//   1. Canvas + scaling
//   2. Small maths helpers
//   3. Game state (one object, reset by newGame)
//   4. Map derivation + terrain pre-render
//   5. Economy, building, power
//   6. Waves + spawning
//   7. Creeps, marines, turrets, projectiles, effects
//   8. Rendering
//   9. Input (mouse / keyboard / touch)
//  10. HUD + overlays + audio
//  11. Main loop
// =====================================================================

// ---------------------------------------------------------------------
// 1. Canvas + scaling
//
// The game renders at a fixed 384x208. On screen it's upscaled by whatever
// whole-number factor fits, because a fractional scale is what makes
// "pixel art" games look like mud.
// ---------------------------------------------------------------------
const VIEW_W = COLS * TILE;   // 384
const VIEW_H = ROWS * TILE;   // 208

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = VIEW_W;
canvas.height = VIEW_H;
ctx.imageSmoothingEnabled = false;

let scale = 3;

function fitCanvas() {
  const wrap = document.getElementById("stage");
  // Leave a little room so the frame border isn't flush with the panel.
  const availW = wrap.clientWidth - 8;
  const availH = Math.max(220, window.innerHeight - 300);
  // Whole-number scaling whenever the map fits at 1x or better — fractional
  // upscaling is what makes pixel art look like mud.
  //
  // Below 1x there's no such choice: a 384px map does not fit on a 375px
  // phone, and clamping to 1x doesn't make it fit, it just hides the right
  // hand column of the map off the edge of the screen. A slightly soft map
  // you can see all of beats a crisp one you can't.
  const fit = Math.min(availW / VIEW_W, availH / VIEW_H);
  scale = fit >= 1 ? Math.floor(fit) : Math.max(0.5, fit);
  canvas.style.width = VIEW_W * scale + "px";
  canvas.style.height = VIEW_H * scale + "px";
  // The comms overlay is sized in CSS pixels, not game pixels, so on a small
  // screen four lines of it would cover a fifth of the map. CSS keys off this
  // to thin the channel down when the map is scaled small.
  document.getElementById("screen").dataset.scale = String(Math.max(1, Math.floor(scale)));
}
window.addEventListener("resize", fitCanvas);

// ---------------------------------------------------------------------
// 2. Maths helpers
// ---------------------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

// Stable per-tile pseudo-random, used to choose terrain variants.
function tileHash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------
// 3. Game state
//
// One mutable object so a restart is `S = freshState()` and nothing can
// survive a new game by accident.
// ---------------------------------------------------------------------
let S;

// Every multiplier the modifiers can touch, at its no-op value. Anything the
// engine scales by a modifier reads it from here, so adding a modifier means
// adding a field and one multiplication — never a branch in the sim.
function neutralMods() {
  return {
    hqHp: 1, turretDamage: 1, enemyHp: 1, enemySpeed: 1, bounty: 1,
    prepTime: 0, earlyBonus: 1, reactorStep: 1, income: 1, clearBonus: 1,
    banned: [], fog: false,
  };
}

// Fold a list of MODIFIERS entries down into one bundle.
function applyModifiers(list) {
  const m = neutralMods();
  for (const mod of list) {
    for (const k of ["hqHp", "turretDamage", "enemyHp", "enemySpeed", "bounty", "earlyBonus", "reactorStep", "income", "clearBonus"]) {
      if (mod[k] !== undefined) m[k] *= mod[k];
    }
    if (mod.prepTime !== undefined) m.prepTime = mod.prepTime;   // absolute, not a multiplier
    if (mod.banned) m.banned = m.banned.concat(mod.banned);
    if (mod.fog) m.fog = true;
  }
  return m;
}

function freshState() {
  return {
    phase: "menu",          // menu | prep | wave | over | won
    paused: false,
    speed: 1,               // 1x or 2x — fast-forward is standard in the genre
    time: 0,                // seconds of simulated time

    minerals: RULES.startMinerals,
    hqHp: RULES.hqHp,
    maxHqHp: RULES.hqHp,

    // Run mode + the modifiers in play. MODS holds every multiplier the
    // simulation reads; in a standard run they're all neutral.
    mode: "standard",          // standard | daily
    dailyId: null,             // "YYYY-MM-DD" when mode is daily
    modifiers: [],
    mods: neutralMods(),
    wave: 0,                // waves completed/current (1-based once started)
    prepLeft: RULES.firstPrepTime,
    waveTime: 0,
    spawnQueue: [],
    leaked: 0,
    kills: 0,
    lowWarned: false,   // so the "HQ won't take much more" line lands once

    buildings: [],
    creeps: [],
    units: [],
    shots: [],
    fx: [],

    // Occupancy grid: null | "path" | "rock" | "hq" | building object.
    grid: [],
    crystals: new Set(),    // "x,y" keys of mineral tiles
    pathTiles: new Set(),

    selectedTool: null,     // key into TOWERS while placing
    selected: null,         // a placed building, when inspecting
    keepBuilding: false,    // shift-held: stay in build mode after placing
    rally: null,            // {x,y} in tiles — where idle marines gather

    hover: { x: -1, y: -1, on: false },
    shake: 0,
    birds: [],          // crows drifting over the pass, purely for company
    birdT: 6,
  };
}

// ---------------------------------------------------------------------
// 4. Map derivation + terrain pre-render
// ---------------------------------------------------------------------

// Walk the waypoint list and mark every tile the road passes through, so
// the painted road and the "can't build here" rule come from one source.
function derivePath() {
  const wp = MAP.waypoints;
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i], b = wp[i + 1];
    const steps = Math.ceil(dist(a.x, a.y, b.x, b.y) * 4);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.floor(lerp(a.x, b.x, t));
      const y = Math.floor(lerp(a.y, b.y, t));
      if (x >= 0 && y >= 0 && x < COLS && y < ROWS) S.pathTiles.add(x + "," + y);
    }
  }
}

function buildGrid() {
  S.grid = [];
  for (let y = 0; y < ROWS; y++) S.grid.push(new Array(COLS).fill(null));
  derivePath();
  for (const key of S.pathTiles) {
    const [x, y] = key.split(",").map(Number);
    S.grid[y][x] = "path";
  }
  for (const r of MAP.rocks) S.grid[r.y][r.x] = "rock";
  for (const c of MAP.crystals) S.crystals.add(c.x + "," + c.y);
  // HQ footprint is 2x2 and permanently blocked.
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) S.grid[MAP.hq.y + dy][MAP.hq.x + dx] = "hq";
}

// The ground never changes, so it's painted once into an offscreen canvas
// and blitted as a single image each frame.
let terrainCanvas = null;

function renderTerrain() {
  terrainCanvas = document.createElement("canvas");
  terrainCanvas.width = VIEW_W;
  terrainCanvas.height = VIEW_H;
  const t = terrainCanvas.getContext("2d");
  t.imageSmoothingEnabled = false;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const onPath = S.pathTiles.has(x + "," + y);
      const set = onPath ? SPR.path : SPR.grass;
      const v = (tileHash(x, y) * set.length) | 0;
      t.drawImage(set[v].canvas, x * TILE, y * TILE);
    }
  }

  // Road edges: a dark line wherever road meets grass. Cheap, and it's what
  // turns "brown tiles" into "a road".
  t.fillStyle = "rgba(18,16,26,0.55)";
  for (const key of S.pathTiles) {
    const [x, y] = key.split(",").map(Number);
    const px = x * TILE, py = y * TILE;
    if (!S.pathTiles.has(x + "," + (y - 1))) t.fillRect(px, py, TILE, 1);
    if (!S.pathTiles.has(x + "," + (y + 1))) t.fillRect(px, py + TILE - 1, TILE, 1);
    if (!S.pathTiles.has(x - 1 + "," + y)) t.fillRect(px, py, 1, TILE);
    if (!S.pathTiles.has(x + 1 + "," + y)) t.fillRect(px + TILE - 1, py, 1, TILE);
  }

  // Scenery. Rocks are real blockers; pines and bones are set dressing.
  for (const b of MAP.bones) drawSpriteTo(t, SPR.bones, b.x * TILE + 8, b.y * TILE + 8);
  for (const r of MAP.rocks) drawSpriteTo(t, SPR.rock, r.x * TILE + 8, r.y * TILE + 12);
  for (const p of MAP.pines) drawSpriteTo(t, SPR.pine, p.x * TILE + 8, p.y * TILE + 16);

  // Enemy spawn marker: a scorched gatepost where the road leaves the map.
  // Which edge that is comes from the first waypoint, since maps can feed
  // creeps in from any side.
  const start = MAP.waypoints[0];
  const sx = start.x < 0 ? 0 : start.x > COLS ? VIEW_W - 3 : start.x * TILE;
  const sy = start.y < 0 ? 0 : start.y > ROWS ? VIEW_H - 3 : start.y * TILE;
  const vertical = start.x < 0 || start.x > COLS;
  t.fillStyle = PAL.k;
  t.fillRect(sx, vertical ? sy - 9 : sy, vertical ? 3 : 18, vertical ? 18 : 3);
  t.fillStyle = PAL.r;
  t.fillRect(sx + (vertical ? 1 : 2), sy + (vertical ? -7 : 1), vertical ? 1 : 14, vertical ? 14 : 1);
}

// Blit a sprite honouring its anchor. `flip` mirrors horizontally.
function drawSpriteTo(c, spr, x, y, flip = false) {
  if (!flip) {
    c.drawImage(spr.canvas, Math.round(x - spr.ax), Math.round(y - spr.ay));
    return;
  }
  c.save();
  c.translate(Math.round(x + spr.ax), Math.round(y - spr.ay));
  c.scale(-1, 1);
  c.drawImage(spr.canvas, 0, 0);
  c.restore();
}

// ---------------------------------------------------------------------
// 5. Economy, building, power
// ---------------------------------------------------------------------

const hqCenter = () => ({ x: MAP.hq.x + 1, y: MAP.hq.y + 1 });

// What a building costs right now. Everything is a flat price except the
// reactor, which gets 20 more expensive for each one already standing —
// that's the brake on covering the entire map in turrets.
function costOf(type) {
  const def = TOWERS[type];
  if (!def.costStep) return def.cost;
  const built = S.buildings.filter((b) => b.type === type).length;
  return def.cost + def.costStep * S.mods.reactorStep * built;
}

function upgradeCost(b) {
  const def = TOWERS[b.type];
  return Math.round(def.cost * 0.7 * b.level);
}

// Shared upgrade curve for every building type.
function statAt(base, level, per = 1.5) {
  return base * Math.pow(per, level - 1);
}

function towerDamage(b) {
  const def = TOWERS[b.type];
  return def.damage ? statAt(def.damage, b.level) * S.mods.turretDamage : 0;
}

function towerRange(b) {
  const def = TOWERS[b.type];
  return def.range ? def.range * (1 + 0.06 * (b.level - 1)) : 0;
}

// A tile is powered if it's inside the HQ field or any reactor's field.
// Recomputed after every build/sell rather than tracked incrementally —
// there are at most a few dozen buildings, so simple beats clever.
function poweredAt(tx, ty) {
  const cx = tx + 0.5, cy = ty + 0.5;
  const hq = hqCenter();
  if (dist(cx, cy, hq.x, hq.y) <= RULES.hqPowerRadius) return true;
  for (const b of S.buildings)
    if (b.type === "reactor" && dist(cx, cy, b.cx, b.cy) <= TOWERS.reactor.powerRadius)
      return true;
  return false;
}

function recomputePower() {
  for (const b of S.buildings) {
    b.powered = b.type === "reactor" ? true : poweredAt(b.tx, b.ty);
  }
}

// Why a given tile can't take a given building — returned as a short
// message so the UI can say something useful instead of just refusing.
function placementError(type, tx, ty) {
  const def = TOWERS[type];
  if (S.mods.banned.includes(type)) return TOWERS[type].name + " IS UNAVAILABLE THIS RUN";
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return "OFF MAP";
  const cell = S.grid[ty][tx];
  if (cell === "path") return "CAN'T BUILD ON THE ROAD";
  if (cell === "rock") return "BLOCKED BY ROCK";
  if (cell === "hq") return "THAT'S THE COMMAND CENTER";
  if (cell) return "ALREADY BUILT HERE";
  const onCrystal = S.crystals.has(tx + "," + ty);
  if (def.onCrystal && !onCrystal) return "EXTRACTORS GO ON MINERAL PATCHES";
  if (!def.onCrystal && onCrystal) return "SAVE THAT PATCH FOR AN EXTRACTOR";
  if (type !== "reactor" && !poweredAt(tx, ty)) return "NO POWER — BUILD A REACTOR NEARBY";
  if (S.minerals < costOf(type)) return "NOT ENOUGH MINERALS";
  return null;
}

function place(type, tx, ty) {
  const err = placementError(type, tx, ty);
  if (err) {
    flashInfo(err, true);
    sfx("error");
    return false;
  }
  const def = TOWERS[type];
  const cost = costOf(type);
  S.minerals -= cost;
  const b = {
    type, tx, ty,
    cx: tx + 0.5, cy: ty + 0.5,
    level: 1,
    invested: cost,
    cd: 0,
    angle: type === "gun" || type === "cannon" || type === "frost" ? -Math.PI / 2 : 0,
    recoil: 0,
    powered: true,
    spin: 0,                 // extractor drill animation
    incomeT: 0,
    unitTimers: [],
    built: 0.35,             // seconds of "just built" pop animation
  };
  S.buildings.push(b);
  S.grid[ty][tx] = b;
  recomputePower();

  if (def.kind === "spawner") {
    for (let i = 0; i < def.unitCount; i++) spawnMarine(b, i);
  }

  addFx({ type: "ring", x: b.cx * TILE, y: b.cy * TILE, r: 2, r2: 14, life: 0.35, color: PAL.c });
  sfx("build");

  // Say something about what just went up.
  if (type === "reactor") {
    comms("reactor", { n: S.buildings.filter((x) => x.type === "reactor").length });
  } else if (type === "extractor") {
    comms("extractor");
  } else if (def.kind === "spawner") {
    comms("barracks");
  } else {
    comms("turret", { name: def.name });
  }
  return true;
}

function sell(b) {
  const refund = Math.round(b.invested * RULES.sellRefund);
  S.minerals += refund;
  S.grid[b.ty][b.tx] = null;
  S.buildings.splice(S.buildings.indexOf(b), 1);
  // Marines belong to their barracks; they go when it does.
  S.units = S.units.filter((u) => u.home !== b);
  const litBefore = S.buildings.filter((x) => x.powered).length;
  recomputePower();
  comms("sell", { name: TOWERS[b.type].name, n: refund });
  // Selling a reactor can strand everything that was inside its field —
  // that's a nasty surprise to discover from a turret quietly not firing.
  const wentDark = litBefore - S.buildings.filter((x) => x.powered).length;
  if (wentDark > 0) comms("powerLost", { n: wentDark, s: wentDark === 1 ? "" : "s" }, "bad");
  S.selected = null;
  addFloater(b.cx * TILE, b.cy * TILE - 6, "+" + refund, PAL.Y);
  addFx({ type: "puff", x: b.cx * TILE, y: b.cy * TILE, life: 0.3 });
  sfx("sell");
}

function upgrade(b) {
  const def = TOWERS[b.type];
  if (!def.upgradeable || b.level >= RULES.upgradeMaxLevel) return;
  const cost = upgradeCost(b);
  if (S.minerals < cost) { flashInfo("NOT ENOUGH MINERALS", true); sfx("error"); return; }
  S.minerals -= cost;
  b.invested += cost;
  b.level++;
  b.built = 0.3;
  // A barracks upgrade makes its marines tougher, so heal them to the new max.
  if (def.kind === "spawner") {
    for (const u of S.units) if (u.home === b) { u.maxHp = marineMaxHp(b); u.hp = u.maxHp; }
  }
  addFx({ type: "ring", x: b.cx * TILE, y: b.cy * TILE, r: 2, r2: 16, life: 0.4, color: PAL.Y });
  sfx("upgrade");
  comms("upgrade", { name: def.name, lv: b.level }, "good");
}

// ---------------------------------------------------------------------
// 6. Waves + spawning
// ---------------------------------------------------------------------

// Called once a run's modifiers are known, since HQ HP is set from them.
function beginRun() {
  S.mods = applyModifiers(S.modifiers);
  S.maxHqHp = Math.max(1, Math.round(RULES.hqHp * S.mods.hqHp));
  S.hqHp = S.maxHqHp;
  S.prepLeft = RULES.firstPrepTime;
}

function startWave(calledEarly) {
  if (S.phase !== "prep") return;
  if (calledEarly && S.prepLeft > 0.5) {
    const bonus = Math.round(S.prepLeft * RULES.earlyCallBonusPerSecond * S.mods.earlyBonus);
    S.minerals += bonus;
    const hq = hqCenter();
    addFloater(hq.x * TILE, hq.y * TILE - 20, "+" + bonus, PAL.Y);
    comms("earlyCall", { n: bonus }, "good");
  }
  S.wave++;
  S.phase = "wave";
  S.waveTime = 0;
  S.prepLeft = 0;

  // Flatten the wave definition into a time-ordered spawn queue.
  const def = WAVES[Math.min(S.wave, WAVES.length) - 1];
  S.spawnQueue = [];
  for (const g of def.groups) {
    for (let i = 0; i < g.count; i++) {
      S.spawnQueue.push({ t: (g.at || 0) + i * g.gap, type: g.type });
    }
  }
  S.spawnQueue.sort((a, b) => a.t - b.t);

  const title = waveTitle(S.wave);
  showBanner("WAVE " + S.wave + " — " + title, def.boss);
  comms("wave", { w: S.wave, title }, def.boss ? "bad" : "info");
  if (def.boss) comms("waveBoss", {}, "bad");
  else if (def.groups.some((g) => CREEPS[g.type].flying)) comms("waveAir", {}, "bad");
  sfx(def.boss ? "boss" : "wave");
  saveBest(S.wave);
}

// Waves past the table (there are none right now, but the loop is written to
// survive it) fall back to a generic name rather than "undefined".
function waveTitle(w) {
  return WAVE_NAMES[w - 1] || "THE LAST STAND";
}

function spawnCreep(type) {
  const def = CREEPS[type];
  const scale = hpScale(S.wave);
  const start = MAP.waypoints[0];
  const c = {
    type, def,
    hp: def.hp * scale * S.mods.enemyHp,
    maxHp: def.hp * scale * S.mods.enemyHp,
    speed: def.speed * S.mods.enemySpeed,
    x: start.x, y: start.y,
    wp: 0,
    // Tiles travelled. Used to decide which creep a turret shoots: the one
    // furthest along the route is the one about to hit the HQ.
    progress: 0,
    // Flyers skip every other waypoint, cutting the corners off the road.
    hop: def.flying ? 2 : 1,
    // Lateral jitter so a column of eight grunts isn't one grunt-shaped blob.
    off: rand(-0.28, 0.28),
    slowT: 0, slowAmt: 0,
    flash: 0,
    frame: Math.random() * 10,
    faceLeft: false,
    target: null,          // a marine it has stopped to fight
    atkCd: rand(0, 0.5),
    dead: false,
  };
  if (def.flying) {
    // Wasps enter from the same edge but fly the diagonal to the HQ.
    c.y = start.y + rand(-1.5, 1.5);
  }
  S.creeps.push(c);
}

function waveCleared() {
  const bonus = Math.round((20 + S.wave * 7) * S.mods.clearBonus);
  S.minerals += bonus;
  const hq = hqCenter();
  addFloater(hq.x * TILE, hq.y * TILE - 24, "+" + bonus, PAL.Y);

  if (S.wave >= WAVES.length) {
    S.phase = "won";
    comms("win", {}, "good");
    showResult("BASE HELD", `All ${WAVES.length} waves broken against the wall.`);
    sfx("win");
    return;
  }
  S.phase = "prep";
  S.prepLeft = S.mods.prepTime || RULES.prepTime;
  sfx("cleared");
  comms("cleared", { n: bonus }, "good");
}

// ---------------------------------------------------------------------
// 7. Simulation
// ---------------------------------------------------------------------

function marineMaxHp(barracks) {
  return TOWERS.barracks.unit.hp + TOWERS.barracks.hpPerLevel * (barracks.level - 1);
}

function spawnMarine(barracks, slot) {
  // Walk out of the side facing wherever they're posted, rather than always
  // out of the bottom — otherwise a barracks north of the road spits its
  // marines out the back and they trek around the building.
  const post = S.rally || defaultPost(barracks);
  const dx = post.x - barracks.cx, dy = post.y - barracks.cy;
  const len = Math.hypot(dx, dy) || 1;
  const u = {
    home: barracks, slot,
    x: barracks.cx + (dx / len) * 0.5 + rand(-0.15, 0.15),
    y: barracks.cy + (dy / len) * 0.5,
    hp: marineMaxHp(barracks),
    maxHp: marineMaxHp(barracks),
    cd: rand(0, 0.5),
    frame: Math.random() * 10,
    faceLeft: false,
    dead: false,
  };
  S.units.push(u);
}

// Is this tile part of a horizontal run of road? Used to line marines up
// ALONG the road rather than across it, whichever way it happens to run.
function roadIsHorizontal(tx, ty) {
  const has = (x, y) => S.pathTiles.has(x + "," + y);
  const h = has(tx - 1, ty) || has(tx + 1, ty);
  const v = has(tx, ty - 1) || has(tx, ty + 1);
  return h || !v;   // ties and off-road tiles default to horizontal
}

// A barracks' default post: the nearest tile of road, not "somewhere below
// the building". Marines exist to stand in the way, and a picket parked in
// the grass because the road happened to be north of the door is just three
// wasted marines. Cached on the building — the road never moves.
//
// If there's no road within reach the old behaviour stands (loiter outside
// the door), so a barracks tucked in a far corner doesn't send its marines
// on a hike across the map.
const MAX_POST_DISTANCE = 6;

function defaultPost(b) {
  if (b.post) return b.post;
  let best = null, bd = Infinity;
  for (const key of S.pathTiles) {
    const [x, y] = key.split(",").map(Number);
    const d = dist(b.cx, b.cy, x + 0.5, y + 0.5);
    if (d < bd) { bd = d; best = { tx: x, ty: y }; }
  }
  b.post = best && bd <= MAX_POST_DISTANCE
    ? { x: best.tx + 0.5, y: best.ty + 0.5, horiz: roadIsHorizontal(best.tx, best.ty) }
    : { x: b.cx, y: b.cy + 0.8, horiz: true };
  return b.post;
}

// Where marine `slot` of a barracks should stand: on the rally flag if one is
// set, otherwise its barracks' default post. The three of them spread out
// along the road with a slight stagger, so they read as a line of men holding
// a stretch of it instead of one marine-shaped pile.
function stationFor(u) {
  const post = S.rally || defaultPost(u.home);
  const n = TOWERS.barracks.unitCount;
  const spread = (u.slot - (n - 1) / 2) * 0.55;
  const stagger = u.slot % 2 ? 0.18 : -0.18;
  const s = post.horiz
    ? { x: post.x + spread, y: post.y + stagger }
    : { x: post.x + stagger, y: post.y + spread };
  // Clamped to the map: a barracks on the bottom row would otherwise post its
  // marines just past the edge, where you can't see them.
  s.x = clamp(s.x, 0.4, COLS - 0.4);
  s.y = clamp(s.y, 0.6, ROWS - 0.4);
  return s;
}

function damageCreep(c, amount, opts = {}) {
  const armor = Math.max(0, (c.def.armor || 0) - (opts.pierce || 0));
  const dealt = Math.max(amount * RULES.minDamageFraction, amount - armor);
  c.hp -= dealt;
  c.flash = 0.09;
  if (opts.slow) {
    c.slowT = Math.max(c.slowT, opts.slowDuration || 1);
    c.slowAmt = Math.max(c.slowAmt, opts.slow);
  }
  if (c.hp <= 0 && !c.dead) {
    c.dead = true;
    S.kills++;
    if (S.kills % 50 === 0) comms("kills", { n: S.kills }, "good");
    const bounty = Math.round(c.def.bounty * bountyScale(S.wave) * S.mods.bounty);
    S.minerals += bounty;
    addFloater(c.x * TILE, c.y * TILE - 12, "+" + bounty, PAL.Y);
    addFx({
      type: "explosion", x: c.x * TILE, y: c.y * TILE - 5,
      life: c.def.big ? 0.55 : 0.32, size: c.def.big ? 18 : 9,
    });
    if (c.def.big) S.shake = Math.max(S.shake, 4);
    sfx(c.def.big ? "bigboom" : "kill");
  }
  return dealt;
}

function updateCreeps(dt) {
  for (const c of S.creeps) {
    if (c.dead) continue;
    c.frame += dt * 8;
    if (c.flash > 0) c.flash -= dt;
    if (c.slowT > 0) {
      c.slowT -= dt;
      if (c.slowT <= 0) c.slowAmt = 0;
    }

    // Ground creeps stop to fight any marine standing in their way. This is
    // what makes a barracks a wall instead of a damage source.
    if (c.def.melee) {
      if (!c.target || c.target.dead || dist(c.x, c.y, c.target.x, c.target.y) > c.def.melee.range + 0.6) {
        c.target = null;
        let best = Infinity;
        for (const u of S.units) {
          if (u.dead) continue;
          const d = dist2(c.x, c.y, u.x, u.y);
          if (d < best && d <= c.def.melee.range * c.def.melee.range) { best = d; c.target = u; }
        }
      }
    }

    if (c.target && !c.target.dead) {
      c.atkCd -= dt;
      c.faceLeft = c.target.x < c.x;
      if (c.atkCd <= 0) {
        c.atkCd = c.def.melee.rate;
        c.target.hp -= c.def.melee.damage;
        addFx({ type: "spark", x: c.target.x * TILE, y: c.target.y * TILE - 6, life: 0.18, color: PAL.R });
        if (c.target.hp <= 0) {
          c.target.dead = true;
          addFx({ type: "explosion", x: c.target.x * TILE, y: c.target.y * TILE - 5, life: 0.28, size: 7 });
          sfx("unitdown");
          comms("marineDown", {}, "bad", 9000);
        }
      }
      continue; // engaged creeps don't advance
    }

    const speed = c.speed * (1 - c.slowAmt);

    // Follow the route waypoint to waypoint, offset sideways by c.off.
    // Ground creeps take every waypoint; flyers take every second one,
    // which is what makes them arrive early and off-axis.
    const wps = MAP.waypoints;
    const next = Math.min(c.wp + c.hop, wps.length - 1);
    if (c.wp >= wps.length - 1) { leak(c); continue; }
    const target = wps[next];
    // Perpendicular offset keeps the column loose without leaving the road.
    const segDx = target.x - wps[c.wp].x, segDy = target.y - wps[c.wp].y;
    const segLen = Math.hypot(segDx, segDy) || 1;
    const ox = (-segDy / segLen) * c.off, oy = (segDx / segLen) * c.off;
    const tx = target.x + ox, ty = target.y + oy;
    const d = dist(c.x, c.y, tx, ty);
    if (d < 0.12) {
      c.wp = next;
      if (c.wp >= wps.length - 1) leak(c);
      continue;
    }
    const stepLen = Math.min(d, speed * dt);
    c.faceLeft = tx < c.x - 0.01;
    c.x += ((tx - c.x) / d) * stepLen;
    c.y += ((ty - c.y) / d) * stepLen;
    c.progress += stepLen;
  }

  S.creeps = S.creeps.filter((c) => !c.dead);
}

// A creep reaching the HQ: chunk off some HP and vanish.
function leak(c) {
  c.dead = true;
  S.leaked++;
  S.hqHp -= c.def.hqDamage;
  S.shake = Math.max(S.shake, 3 + c.def.hqDamage);
  const hq = hqCenter();
  addFloater(hq.x * TILE, hq.y * TILE - 16, "-" + c.def.hqDamage, PAL.R);
  addFx({ type: "explosion", x: hq.x * TILE, y: hq.y * TILE, life: 0.45, size: 14 });
  sfx("leak");
  if (S.hqHp > 0) {
    comms("leak", { hp: S.hqHp }, "bad");
    // Only nag about the HQ once per wave, at the moment it gets dangerous.
    if (S.hqHp <= 5 && !S.lowWarned) { S.lowWarned = true; comms("low", {}, "bad"); }
  }
  if (S.hqHp <= 0) {
    S.hqHp = 0;
    S.phase = "over";
    comms("lose", {}, "bad");
    showResult("COMMAND CENTER LOST", `You held <b>${S.wave - 1}</b> of ${WAVES.length} waves.`);
    sfx("lose");
  }
}

function updateUnits(dt) {
  for (const u of S.units) {
    if (u.dead) continue;
    u.frame += dt * 8;
    const def = TOWERS.barracks.unit;
    const dmg = statAt(def.damage, u.home.level);

    // Engage the nearest creep within reach of where this marine is posted.
    const station = stationFor(u);
    let target = null, best = Infinity;
    for (const c of S.creeps) {
      if (c.dead || c.def.flying) continue;   // marines can't shoot up
      const d = dist2(u.x, u.y, c.x, c.y);
      if (d < best && d <= def.range * def.range) { best = d; target = c; }
    }

    if (target) {
      u.faceLeft = target.x < u.x;
      u.cd -= dt;
      if (u.cd <= 0) {
        u.cd = def.fireRate;
        damageCreep(target, dmg);
        addFx({ type: "spark", x: lerp(u.x, target.x, 0.5) * TILE, y: lerp(u.y, target.y, 0.5) * TILE - 6, life: 0.12, color: PAL.Y });
        addFx({ type: "tracer", x1: u.x * TILE, y1: u.y * TILE - 7, x2: target.x * TILE, y2: target.y * TILE - 6, life: 0.06, color: PAL[5] });
        sfx("rifle");
      }
    } else {
      // Walk back to the post.
      const d = dist(u.x, u.y, station.x, station.y);
      if (d > 0.1) {
        u.faceLeft = station.x < u.x;
        const step = Math.min(d, def.speed * dt);
        u.x += ((station.x - u.x) / d) * step;
        u.y += ((station.y - u.y) / d) * step;
      }
    }
  }

  // Dead marines free their slot; the barracks starts a respawn timer.
  for (const u of S.units) {
    if (u.dead && !u.counted) {
      u.counted = true;
      u.home.unitTimers.push({ slot: u.slot, t: TOWERS.barracks.unitRespawn });
    }
  }
  S.units = S.units.filter((u) => !u.dead);

  for (const b of S.buildings) {
    if (!b.unitTimers.length) continue;
    for (const timer of b.unitTimers) timer.t -= dt;
    const ready = b.unitTimers.filter((t) => t.t <= 0);
    for (const r of ready) spawnMarine(b, r.slot);
    if (ready.length) b.unitTimers = b.unitTimers.filter((t) => t.t > 0);
  }
}

// Pick what a turret shoots at: of everything in range it can actually
// hurt, the creep that has travelled furthest. "Furthest along" is the
// right default — it kills the thing that's about to reach the HQ.
function acquire(b) {
  const def = TOWERS[b.type];
  const r = towerRange(b);
  let best = null, bestScore = -Infinity;
  for (const c of S.creeps) {
    if (c.dead) continue;
    if (c.def.flying && !def.hitsAir) continue;
    if (dist2(b.cx, b.cy, c.x, c.y) > r * r) continue;
    if (c.progress > bestScore) { bestScore = c.progress; best = c; }
  }
  return best;
}

function updateTowers(dt) {
  for (const b of S.buildings) {
    const def = TOWERS[b.type];
    if (b.built > 0) b.built -= dt;
    if (b.recoil > 0) b.recoil = Math.max(0, b.recoil - dt * 6);

    if (!b.powered) continue;

    if (b.type === "extractor") {
      b.spin += dt * 6;
      b.incomeT += dt;
      if (b.incomeT >= def.incomePeriod) {
        b.incomeT -= def.incomePeriod;
        const amount = Math.round((def.incomeAmount + def.incomePerLevel * (b.level - 1)) * S.mods.income);
        S.minerals += amount;
        addFloater(b.cx * TILE, b.cy * TILE - 10, "+" + amount, PAL.V);
      }
      continue;
    }

    if (def.kind !== "turret") continue;

    b.cd -= dt;
    const target = acquire(b);
    if (!target) continue;

    // Turn to face, then fire when the cooldown is up.
    const want = Math.atan2(target.y - b.cy, target.x - b.cx);
    let diff = want - b.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    b.angle += clamp(diff, -8 * dt, 8 * dt);

    if (b.cd > 0) continue;
    b.cd = def.fireRate;
    b.recoil = 1;
    fire(b, target);
  }
}

function fire(b, target) {
  const def = TOWERS[b.type];
  const dmg = towerDamage(b);
  const muzzle = def.barrel
    ? { x: b.cx * TILE + Math.cos(b.angle) * def.barrel.len, y: b.cy * TILE - 3 + Math.sin(b.angle) * def.barrel.len }
    : { x: b.cx * TILE, y: b.cy * TILE - 8 };

  if (def.projectile === "lightning") {
    // Instant chain. Each hop finds the nearest un-hit creep to the last.
    const hits = [target];
    let cur = target, dmgLeft = dmg;
    for (let i = 1; i < def.chain; i++) {
      let next = null, best = Infinity;
      for (const c of S.creeps) {
        if (c.dead || hits.includes(c)) continue;
        const d = dist2(cur.x, cur.y, c.x, c.y);
        if (d < best && d <= 2.6 * 2.6) { best = d; next = c; }
      }
      if (!next) break;
      hits.push(next);
      cur = next;
    }
    let from = { x: b.cx * TILE, y: b.cy * TILE - 9 };
    for (const h of hits) {
      damageCreep(h, dmgLeft);
      addFx({ type: "bolt", x1: from.x, y1: from.y, x2: h.x * TILE, y2: h.y * TILE - 6, life: 0.14 });
      from = { x: h.x * TILE, y: h.y * TILE - 6 };
      dmgLeft *= def.chainFalloff;
    }
    sfx("tesla");
    return;
  }

  S.shots.push({
    kind: def.projectile,
    x: muzzle.x, y: muzzle.y,
    target,
    // Shells are aimed at the ground, so they can miss a fast creep — which
    // is exactly why the cannon wants a cryo emitter next to it.
    tx: target.x * TILE, ty: target.y * TILE - 5,
    speed: def.projectile === "bullet" ? 260 : def.projectile === "shell" ? 130 : 150,
    dmg,
    def,
    t: 0,
    arc: def.projectile === "shell" ? dist(muzzle.x, muzzle.y, target.x * TILE, target.y * TILE) * 0.22 : 0,
    life: 2.5,
  });
  addFx({ type: "muzzle", x: muzzle.x, y: muzzle.y, life: 0.07, angle: b.angle });
  sfx(def.projectile === "shell" ? "cannon" : def.projectile === "frost" ? "frost" : "gun");
}

function updateShots(dt) {
  for (const s of S.shots) {
    s.life -= dt;
    if (s.life <= 0) { s.done = true; continue; }

    // Bullets and cryo bolts home; shells commit to the ground they were
    // aimed at when fired.
    if (s.kind !== "shell" && s.target && !s.target.dead) {
      s.tx = s.target.x * TILE;
      s.ty = s.target.y * TILE - 5;
    }
    const d = dist(s.x, s.y, s.tx, s.ty);
    const step = s.speed * dt;
    s.t += dt;
    if (d <= step) {
      s.x = s.tx; s.y = s.ty;
      impact(s);
      s.done = true;
      continue;
    }
    s.x += ((s.tx - s.x) / d) * step;
    s.y += ((s.ty - s.y) / d) * step;
  }
  S.shots = S.shots.filter((s) => !s.done);
}

function impact(s) {
  const def = s.def;
  if (def.splash) {
    const r = def.splash;
    addFx({ type: "explosion", x: s.x, y: s.y, life: 0.34, size: r * TILE * 0.8 });
    S.shake = Math.max(S.shake, 1.5);
    for (const c of S.creeps) {
      if (c.dead || c.def.flying) continue;
      const d = dist(c.x * TILE, c.y * TILE - 5, s.x, s.y) / TILE;
      if (d <= r) {
        // Full damage at the centre, 45% at the edge.
        damageCreep(c, s.dmg * lerp(1, 0.45, d / r), { pierce: def.armorPierce || 0 });
      }
    }
    sfx("boom");
    return;
  }
  if (!s.target || s.target.dead) return;
  damageCreep(s.target, s.dmg, {
    slow: def.slow, slowDuration: def.slowDuration, pierce: def.armorPierce || 0,
  });
  addFx({
    type: "spark", x: s.x, y: s.y, life: 0.14,
    color: def.projectile === "frost" ? PAL.T : PAL.Y,
  });
}

// ---------------------------------------------------------------------
// Wildlife
//
// Every so often a few crows cross the pass. They do nothing, can't be shot,
// and cost about twenty lines — but a map where the only thing that ever
// moves is something trying to kill you feels like a spreadsheet.
// ---------------------------------------------------------------------
function updateBirds(dt) {
  S.birdT -= dt;
  if (S.birdT <= 0) {
    S.birdT = rand(18, 34);
    const leftToRight = Math.random() < 0.5;
    const y = rand(1, ROWS - 3);
    const speed = rand(2.2, 3.4) * (leftToRight ? 1 : -1);
    for (let i = 0; i < 2 + ((Math.random() * 3) | 0); i++) {
      S.birds.push({
        x: (leftToRight ? -1 : COLS + 1) - i * rand(0.6, 1.3) * Math.sign(speed),
        y: y + rand(-0.7, 0.7),
        vx: speed,
        flap: Math.random() * 10,
      });
    }
  }
  for (const b of S.birds) {
    b.x += b.vx * dt;
    b.y += Math.sin(S.time * 1.6 + b.flap) * 0.12 * dt;
    b.flap += dt * 7;
  }
  S.birds = S.birds.filter((b) => b.x > -3 && b.x < COLS + 3);
}

function drawBirds() {
  ctx.fillStyle = PAL.k;
  for (const b of S.birds) {
    const x = Math.round(b.x * TILE), y = Math.round(b.y * TILE);
    // Two pixels up or three flat: a wing beat in the cheapest form there is.
    if (Math.sin(b.flap) > 0) {
      ctx.fillRect(x - 2, y - 1, 1, 1);
      ctx.fillRect(x - 1, y, 1, 1);
      ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x + 2, y - 1, 1, 1);
    } else {
      ctx.fillRect(x - 2, y, 5, 1);
    }
  }
}

// ---------------------------------------------------------------------
// Effects: purely cosmetic, all short-lived, all in one list.
// ---------------------------------------------------------------------
function addFx(fx) {
  fx.age = 0;
  fx.total = fx.life;
  S.fx.push(fx);
}

function addFloater(x, y, text, color) {
  addFx({ type: "floater", x, y, text, color, life: 0.9 });
}

function updateFx(dt) {
  for (const f of S.fx) {
    f.age += dt;
    if (f.type === "floater") f.y -= dt * 14;
    if (f.age >= f.total) f.done = true;
  }
  S.fx = S.fx.filter((f) => !f.done);
}

// ---------------------------------------------------------------------
// 8. Rendering
// ---------------------------------------------------------------------

function render() {
  ctx.imageSmoothingEnabled = false;
  ctx.save();

  // Screen shake, in whole pixels so it doesn't blur the art.
  if (S.shake > 0) {
    ctx.translate(Math.round(rand(-S.shake, S.shake)), Math.round(rand(-S.shake, S.shake)));
  }

  ctx.drawImage(terrainCanvas, 0, 0);

  // Mineral patches that don't have an extractor on them yet. Each one
  // twinkles on its own offset cycle, so the unclaimed money on the map keeps
  // quietly asking for attention.
  for (const c of MAP.crystals) {
    const occupied = S.grid[c.y][c.x] && S.grid[c.y][c.x].type === "extractor";
    if (occupied) continue;
    drawSpriteTo(ctx, SPR.crystal, c.x * TILE + 8, c.y * TILE + 14);
    const phase = (S.time * 0.7 + c.x * 0.37 + c.y * 0.21) % 3;
    if (phase < 0.16) {
      ctx.fillStyle = PAL[6];
      const tip = [[4, -8], [8, -11], [12, -8]][(c.x + c.y) % 3];
      ctx.fillRect(c.x * TILE + tip[0], c.y * TILE + 14 + tip[1], 1, 1);
    }
  }

  drawPowerFields();
  drawRangeOverlay();

  // Everything that stands on the ground gets depth-sorted by its feet, so
  // a marine in front of a turret overlaps it correctly.
  const drawables = [];
  const hq = hqCenter();
  drawables.push({ y: (MAP.hq.y + 2) * TILE, draw: drawHQ });
  for (const b of S.buildings) drawables.push({ y: (b.ty + 1) * TILE, draw: () => drawBuilding(b) });
  for (const u of S.units) drawables.push({ y: u.y * TILE, draw: () => drawUnit(u) });
  for (const c of S.creeps) if (!c.def.flying) drawables.push({ y: c.y * TILE, draw: () => drawCreep(c) });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // Flyers are always above the ground layer.
  for (const c of S.creeps) if (c.def.flying) drawCreep(c);

  drawShots();
  drawFx();
  drawBirds();     // above everything: they're in the sky
  drawRally();
  drawGhost();

  ctx.restore();

  // Low-HQ warning vignette, drawn after the shake so it stays put.
  if (S.hqHp > 0 && S.hqHp <= 5 && S.phase === "wave") {
    const pulse = 0.12 + 0.08 * Math.sin(S.time * 6);
    ctx.fillStyle = `rgba(207,59,59,${pulse})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

// While a build tool is active, show the power grid by DARKENING everything
// outside it. Tinting the powered area instead was almost invisible over
// grass — and "the lit part is where you can build" is the read you want in
// the half second before you click.
function drawPowerFields() {
  if (S.mods.fog) return;
  if (!S.selectedTool || S.selectedTool === "reactor") return;
  ctx.save();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (poweredAt(x, y)) {
        ctx.fillStyle = "rgba(63,127,224,0.13)";
      } else {
        ctx.fillStyle = "rgba(11,10,18,0.45)";
      }
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  // Outline each field so it's clear which reactor is covering what.
  ctx.strokeStyle = "rgba(143,208,255,0.6)";
  ctx.lineWidth = 1;
  const hq = hqCenter();
  circle(hq.x * TILE, hq.y * TILE, RULES.hqPowerRadius * TILE);
  for (const b of S.buildings)
    if (b.type === "reactor") circle(b.cx * TILE, b.cy * TILE, TOWERS.reactor.powerRadius * TILE);
  ctx.restore();
}

function circle(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// Range ring for whatever is selected, or for the ghost being placed.
function drawRangeOverlay() {
  if (S.mods.fog) return;
  const show = [];
  if (S.selected && TOWERS[S.selected.type].kind === "turret")
    show.push({ x: S.selected.cx * TILE, y: S.selected.cy * TILE, r: towerRange(S.selected) * TILE, c: "rgba(143,208,255,0.75)" });
  if (S.selected && S.selected.type === "reactor")
    show.push({ x: S.selected.cx * TILE, y: S.selected.cy * TILE, r: TOWERS.reactor.powerRadius * TILE, c: "rgba(143,208,255,0.55)" });
  if (S.selectedTool && S.hover.on) {
    const def = TOWERS[S.selectedTool];
    const r = def.range ? def.range * TILE : def.powerRadius ? def.powerRadius * TILE : def.unit ? def.unit.range * TILE : 0;
    if (r) show.push({ x: S.hover.x * TILE + 8, y: S.hover.y * TILE + 8, r, c: "rgba(255,255,255,0.5)" });
  }
  ctx.save();
  ctx.lineWidth = 1;
  for (const s of show) {
    ctx.fillStyle = "rgba(143,208,255,0.07)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = s.c;
    ctx.setLineDash([3, 3]);
    circle(s.x, s.y, s.r);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawHQ() {
  const hq = hqCenter();
  // The sprite is taller than its 2x2 footprint, so it's anchored to the
  // bottom of the footprint and allowed to overhang upwards.
  drawSpriteTo(ctx, SPR.hq, hq.x * TILE, hq.y * TILE + 17);

  // Radar sweep on the left tower's dish, and a red beacon blinking on the
  // right mast. The base should look like it's manned, not parked.
  const dishX = hq.x * TILE - 11, dishY = hq.y * TILE - 19;
  const sweep = S.time * 2.2;
  ctx.fillStyle = PAL.c;
  ctx.fillRect(Math.round(dishX + Math.cos(sweep) * 3), Math.round(dishY + Math.sin(sweep) * 3), 1, 1);
  ctx.fillStyle = "rgba(143,208,255,0.5)";
  ctx.fillRect(Math.round(dishX + Math.cos(sweep - 0.5) * 3), Math.round(dishY + Math.sin(sweep - 0.5) * 3), 1, 1);
  if (Math.sin(S.time * 3) > 0.6) {
    ctx.fillStyle = PAL.R;
    ctx.fillRect(hq.x * TILE + 11, hq.y * TILE - 22, 1, 1);
  }
  // Health bar above the antenna.
  const w = 26;
  const x = hq.x * TILE - w / 2, y = hq.y * TILE - 32;
  ctx.fillStyle = PAL.k;
  ctx.fillRect(x - 1, y - 1, w + 2, 4);
  ctx.fillStyle = "#3a1520";
  ctx.fillRect(x, y, w, 2);
  const frac = S.hqHp / S.maxHqHp;
  ctx.fillStyle = frac > 0.5 ? PAL.G : frac > 0.25 ? PAL.Y : PAL.R;
  ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), 2);
}

function drawBuilding(b) {
  const def = TOWERS[b.type];
  const px = b.cx * TILE, py = b.cy * TILE;

  // A short squash when built or upgraded, so placements feel physical.
  let squash = 0;
  if (b.built > 0) squash = Math.sin((b.built / 0.35) * Math.PI) * 2;

  ctx.save();
  if (squash) ctx.translate(0, squash);
  drawSpriteTo(ctx, SPR[def.sprite], px, py + 4);
  ctx.restore();

  if (def.kind === "turret") drawTurretHead(b, px, py);
  if (b.type === "reactor" && b.powered) {
    // A pulse of power leaving the orb every couple of seconds, so a line of
    // reactors reads as a live grid rather than street furniture.
    const t = ((S.time * 0.45 + b.tx * 0.13 + b.ty * 0.29) % 1);
    if (t < 0.55) {
      ctx.fillStyle = `rgba(143,208,255,${0.5 * (1 - t / 0.55)})`;
      pixelRing(px, py - 10, lerp(3, 10, t / 0.55));
    }
  }
  if (b.type === "extractor") {
    // Drill wheel on the silo cap: four teeth turning, plus the odd spark
    // of ore coming up the shaft.
    const wx = px, wy = py - 10;
    for (let i = 0; i < 4; i++) {
      const a = b.spin + (i * Math.PI) / 2;
      ctx.fillStyle = i % 2 ? PAL[5] : PAL[3];
      ctx.fillRect(Math.round(wx + Math.cos(a) * 3), Math.round(wy + Math.sin(a) * 3), 2, 1);
    }
    ctx.fillStyle = PAL.k;
    ctx.fillRect(wx - 1, wy - 1, 2, 2);
    if (Math.sin(b.spin) > 0.9) {
      ctx.fillStyle = PAL.w;
      ctx.fillRect(wx, wy - 4, 1, 2);
    }
  }

  // Level pips under the building, centred on it.
  if (b.level > 1) {
    const startX = px - (b.level * 3 - 1) / 2;
    for (let i = 0; i < b.level; i++) {
      const x = Math.round(startX + i * 3);
      ctx.fillStyle = PAL.Y;
      ctx.fillRect(x, py + 6, 2, 2);
      ctx.fillStyle = PAL.k;
      ctx.fillRect(x, py + 8, 2, 1);
    }
  }

  // Unpowered buildings go dark with a blinking warning square.
  if (!b.powered) {
    ctx.fillStyle = "rgba(18,16,26,0.55)";
    ctx.fillRect(b.tx * TILE, b.ty * TILE, TILE, TILE);
    if (Math.sin(S.time * 8) > 0) {
      ctx.fillStyle = PAL.R;
      ctx.fillRect(px - 1, py - 10, 2, 4);
      ctx.fillRect(px - 1, py - 5, 2, 1);
    }
  }

  if (S.selected === b) {
    ctx.strokeStyle = PAL.Y;
    ctx.lineWidth = 1;
    ctx.strokeRect(b.tx * TILE + 0.5, b.ty * TILE + 0.5, TILE - 1, TILE - 1);
  }
}

// Turret heads are drawn with real rotation rather than pre-rendered
// facings. At 16px that reads fine, and it keeps the art file small.
function drawTurretHead(b, px, py) {
  const def = TOWERS[b.type];
  const cy = py - 3;

  if (b.type === "tesla") {
    // A Tesla coil: a stack of copper windings, a mast, and a violet ball
    // that crackles between two states so it never looks static.
    ctx.fillStyle = PAL.k;
    ctx.fillRect(px - 4, cy - 8, 8, 9);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? PAL.o : PAL.y;
      ctx.fillRect(px - 3, cy - 7 + i * 2, 6, 1);
    }
    ctx.fillStyle = PAL[3];
    ctx.fillRect(px - 1, cy - 13, 2, 6);
    // Discharge ball
    ctx.fillStyle = PAL.v;
    ctx.fillRect(px - 3, cy - 17, 6, 5);
    ctx.fillStyle = PAL.V;
    ctx.fillRect(px - 2, cy - 16, 4, 3);
    ctx.fillStyle = PAL[6];
    ctx.fillRect(px - 1, cy - 16, 1, 1);
    // Idle arcs, jumping around the ball.
    if (Math.sin(S.time * 11) > 0.1) {
      ctx.fillStyle = PAL.w;
      const a = S.time * 7;
      ctx.fillRect(Math.round(px + Math.cos(a) * 5), Math.round(cy - 15 + Math.sin(a) * 4), 1, 1);
      ctx.fillRect(Math.round(px + Math.cos(a + 2) * 4), Math.round(cy - 15 + Math.sin(a + 2) * 3), 1, 1);
    }
    return;
  }

  if (b.type === "frost") {
    // A slowly bobbing cryo orb.
    const bob = Math.sin(S.time * 2.5) * 1;
    ctx.fillStyle = PAL.t;
    ctx.fillRect(px - 3, cy - 6 + bob, 6, 6);
    ctx.fillStyle = PAL.T;
    ctx.fillRect(px - 2, cy - 5 + bob, 4, 4);
    ctx.fillStyle = PAL[6];
    ctx.fillRect(px - 2, cy - 5 + bob, 1, 1);
    ctx.fillStyle = PAL.k;
    ctx.fillRect(px - 4, cy - 7 + bob, 8, 1);
    ctx.fillRect(px - 4, cy + bob, 8, 1);
    return;
  }

  const bar = def.barrel;
  const recoil = b.recoil * 2;
  ctx.save();
  ctx.translate(px, cy);
  ctx.rotate(b.angle);
  ctx.translate(-recoil, 0);
  // Housing
  ctx.fillStyle = PAL.k;
  ctx.fillRect(-5, -4, 9, 8);
  ctx.fillStyle = PAL[3];
  ctx.fillRect(-4, -3, 7, 6);
  ctx.fillStyle = PAL[4];
  ctx.fillRect(-4, -3, 7, 2);
  // Barrel(s)
  ctx.fillStyle = PAL.k;
  if (bar.twin) {
    ctx.fillRect(2, -3, bar.len, 2);
    ctx.fillRect(2, 1, bar.len, 2);
    ctx.fillStyle = PAL[bar.color] || bar.color;
    ctx.fillRect(2, -3, bar.len - 1, 1);
    ctx.fillRect(2, 1, bar.len - 1, 1);
  } else {
    ctx.fillRect(2, -bar.w / 2, bar.len, bar.w);
    ctx.fillStyle = PAL[bar.color] || bar.color;
    ctx.fillRect(2, -bar.w / 2 + 1, bar.len - 1, bar.w - 2);
  }
  ctx.restore();
}

function drawCreep(c) {
  const frames = SPR[c.def.sprite];
  const spr = frames[(c.frame | 0) % frames.length];
  const px = c.x * TILE;
  const py = c.y * TILE + (c.def.flying ? Math.sin(S.time * 5 + c.off * 10) * 1.5 - 6 : 0);

  // Cryo tell: a cyan ring plus sparkles, cheaper than tinting the sprite
  // and easier to read in a crowd.
  if (c.slowAmt > 0) {
    ctx.fillStyle = "rgba(72,195,201,0.5)";
    ctx.fillRect(px - 5, py - 1, 10, 2);
    ctx.fillStyle = PAL.T;
    ctx.fillRect(px - 6 + ((S.time * 12) % 12), py - 8, 1, 1);
  }

  drawSpriteTo(ctx, spr, px, py, c.faceLeft);

  // Hit flash: redraw the sprite additively so it blows out to white.
  if (c.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp(c.flash * 8, 0, 1);
    drawSpriteTo(ctx, spr, px, py, c.faceLeft);
    ctx.restore();
  }

  // Health bar, only once damaged.
  if (c.hp < c.maxHp) {
    const w = c.def.big ? 20 : 11;
    const x = Math.round(px - w / 2);
    // Clamped: the road runs along the top of the map, and a boss's bar
    // would otherwise sit above the viewport where you can't read it.
    const y = Math.max(2, Math.round(py - (c.def.big ? 26 : 17)));
    ctx.fillStyle = PAL.k;
    ctx.fillRect(x - 1, y - 1, w + 2, 4);
    ctx.fillStyle = "#3a1520";
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = c.def.big ? PAL.o : PAL.R;
    ctx.fillRect(x, y, Math.max(1, Math.round(w * (c.hp / c.maxHp))), 2);
  }
}

function drawUnit(u) {
  const frames = SPR.marine;
  const spr = frames[(u.frame | 0) % frames.length];
  drawSpriteTo(ctx, spr, u.x * TILE, u.y * TILE, u.faceLeft);
  if (u.hp < u.maxHp) {
    const w = 9;
    const x = Math.round(u.x * TILE - w / 2), y = Math.round(u.y * TILE - 17);
    ctx.fillStyle = PAL.k;
    ctx.fillRect(x - 1, y - 1, w + 2, 3);
    ctx.fillStyle = PAL.G;
    ctx.fillRect(x, y, Math.max(1, Math.round(w * (u.hp / u.maxHp))), 1);
  }
}

function drawShots() {
  for (const s of S.shots) {
    if (s.kind === "bullet") {
      ctx.fillStyle = PAL.Y;
      ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y), 2, 1);
      ctx.fillStyle = PAL[6];
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    } else if (s.kind === "shell") {
      // Fake a lob by lifting the sprite along a sine of its flight.
      const total = dist(s.x, s.y, s.tx, s.ty);
      const lift = Math.sin(clamp(s.t * 2.2, 0, 1) * Math.PI) * s.arc;
      const y = Math.round(s.y - lift);
      ctx.fillStyle = "rgba(18,16,26,0.3)";
      ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y), 3, 1);
      ctx.fillStyle = PAL.k;
      ctx.fillRect(Math.round(s.x) - 2, y - 2, 4, 4);
      ctx.fillStyle = PAL.o;
      ctx.fillRect(Math.round(s.x) - 1, y - 1, 2, 2);
    } else if (s.kind === "frost") {
      ctx.fillStyle = PAL.t;
      ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 2, 4, 4);
      ctx.fillStyle = PAL.T;
      ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 2, 2);
      ctx.fillStyle = PAL[6];
      ctx.fillRect(Math.round(s.x), Math.round(s.y) - 1, 1, 1);
    }
  }
}

function drawFx() {
  for (const f of S.fx) {
    const k = f.age / f.total;    // 0 -> 1 over the effect's life
    if (f.type === "explosion") {
      // Three expanding pixel rings: white core, orange body, dark smoke.
      const r = lerp(2, f.size, k);
      ctx.fillStyle = k < 0.4 ? PAL[6] : k < 0.7 ? PAL.Y : PAL.o;
      pixelRing(f.x, f.y, r * 0.55);
      ctx.fillStyle = k < 0.5 ? PAL.o : PAL.r;
      pixelRing(f.x, f.y, r);
      if (k > 0.4) {
        ctx.fillStyle = "rgba(42,28,58,0.7)";
        pixelRing(f.x, f.y, r * 1.25);
      }
    } else if (f.type === "ring") {
      ctx.fillStyle = f.color;
      pixelRing(f.x, f.y, lerp(f.r, f.r2, k));
    } else if (f.type === "puff") {
      ctx.fillStyle = "rgba(143,154,184," + (1 - k) + ")";
      pixelRing(f.x, f.y, lerp(2, 9, k));
    } else if (f.type === "spark") {
      ctx.fillStyle = f.color;
      const r = lerp(1, 4, k);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + f.x;
        ctx.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r), 1, 1);
      }
    } else if (f.type === "muzzle") {
      ctx.fillStyle = k < 0.5 ? PAL[6] : PAL.Y;
      ctx.fillRect(Math.round(f.x) - 1, Math.round(f.y) - 1, 3, 3);
    } else if (f.type === "tracer") {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.x1, f.y1);
      ctx.lineTo(f.x2, f.y2);
      ctx.stroke();
    } else if (f.type === "bolt") {
      // Jagged lightning: a fixed number of segments jittered perpendicular
      // to the line, redrawn every frame so it crackles.
      ctx.strokeStyle = k < 0.5 ? PAL[6] : PAL.V;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const segs = 5;
      ctx.moveTo(f.x1, f.y1);
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const nx = -(f.y2 - f.y1), ny = f.x2 - f.x1;
        const len = Math.hypot(nx, ny) || 1;
        const j = rand(-2.5, 2.5);
        ctx.lineTo(lerp(f.x1, f.x2, t) + (nx / len) * j, lerp(f.y1, f.y2, t) + (ny / len) * j);
      }
      ctx.lineTo(f.x2, f.y2);
      ctx.stroke();
    } else if (f.type === "floater") {
      const alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      const w = pixelTextWidth(f.text);
      drawPixelText(ctx, f.text, Math.round(f.x - w / 2) + 1, Math.round(f.y) + 1, PAL.k);
      drawPixelText(ctx, f.text, Math.round(f.x - w / 2), Math.round(f.y), f.color);
      ctx.restore();
    }
  }
}

// A one-pixel-thick circle drawn with fillRect, so it stays crisp.
function pixelRing(cx, cy, r) {
  const steps = Math.max(8, Math.round(r * 6));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
  }
}

// The rally flag: where marines gather. Right-click to move it.
function drawRally() {
  if (!S.rally) return;
  const x = Math.round(S.rally.x * TILE), y = Math.round(S.rally.y * TILE);
  ctx.fillStyle = PAL.k;
  ctx.fillRect(x, y - 12, 1, 12);
  ctx.fillStyle = PAL.B;
  ctx.fillRect(x + 1, y - 12, 5, 4);
  ctx.fillStyle = PAL.c;
  ctx.fillRect(x + 1, y - 12, 5, 1);
  ctx.fillStyle = "rgba(63,127,224,0.5)";
  pixelRing(x, y, 3 + Math.sin(S.time * 4));
}

// The translucent building preview under the cursor, green if it can go
// there and red if it can't.
function drawGhost() {
  if (!S.selectedTool || !S.hover.on) return;
  const def = TOWERS[S.selectedTool];
  const { x, y } = S.hover;
  const err = placementError(S.selectedTool, x, y);
  // Tinted tile under the ghost, so valid/invalid is readable at a glance
  // even when the sprite happens to sit on similar colours.
  ctx.fillStyle = err ? "rgba(207,59,59,0.3)" : "rgba(82,184,94,0.3)";
  ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
  ctx.save();
  ctx.globalAlpha = 0.8;
  drawSpriteTo(ctx, SPR[def.sprite], x * TILE + 8, y * TILE + 12);
  ctx.restore();
  ctx.strokeStyle = err ? PAL.R : PAL.G;
  ctx.lineWidth = 1;
  ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
  if (err) {
    ctx.strokeStyle = PAL.R;
    ctx.beginPath();
    ctx.moveTo(x * TILE + 3, y * TILE + 3);
    ctx.lineTo(x * TILE + TILE - 3, y * TILE + TILE - 3);
    ctx.moveTo(x * TILE + TILE - 3, y * TILE + 3);
    ctx.lineTo(x * TILE + 3, y * TILE + TILE - 3);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------
// 9. Input
// ---------------------------------------------------------------------

// Convert a pointer event into tile coordinates.
function eventToTile(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
  return { x, y, inside: x >= 0 && y >= 0 && x < COLS && y < ROWS };
}

canvas.addEventListener("mousemove", (e) => {
  const t = eventToTile(e);
  S.hover.x = t.x;
  S.hover.y = t.y;
  S.hover.on = t.inside;
});
canvas.addEventListener("mouseleave", () => { S.hover.on = false; });

canvas.addEventListener("mousedown", (e) => {
  if (S.phase === "menu" || S.phase === "over" || S.phase === "won") return;
  const t = eventToTile(e);
  if (!t.inside) return;

  if (e.button === 2) {
    // Right click: cancel the build tool, or set the marine rally point.
    if (S.selectedTool) {
      S.selectedTool = null;
      syncBuildBar();
    } else {
      S.rally = { x: t.x + 0.5, y: t.y + 0.5, horiz: roadIsHorizontal(t.x, t.y) };
      flashInfo("MARINES RALLYING");
      sfx("rally");
    }
    return;
  }

  if (S.selectedTool) {
    const ok = place(S.selectedTool, t.x, t.y);
    if (ok && !S.keepBuilding) S.selectedTool = null;
    syncBuildBar();
    syncSelection();
    return;
  }

  // Otherwise: select whatever is on that tile.
  const cell = S.grid[t.y][t.x];
  S.selected = cell && typeof cell === "object" ? cell : null;
  syncSelection();
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------------------------------------------------------------------
// Touch
//
// A finger is not a mouse, so this isn't just "tap = click":
//
//   press        show the ghost under the finger (nothing is committed yet)
//   slide        move it — a fingertip is 8 tiles wide, you need to aim
//   lift         place / select, at the tile you can see
//   hold 450ms   the right-click: set the marine rally flag, or cancel the
//                build tool if one is active
//
// Committing on touchEND rather than touchSTART is what makes all of the
// above possible, and it means a mistap can be slid off before you commit.
// ---------------------------------------------------------------------
const LONG_PRESS_MS = 450;
const TOUCH_SLIDE_PX = 14;
let touchState = null;

function touchOver() {
  return S.phase === "menu" || S.phase === "over" || S.phase === "won";
}

canvas.addEventListener("touchstart", (e) => {
  if (touchOver()) return;
  const touch = e.touches[0];
  const t = eventToTile(touch);
  if (!t.inside) return;
  e.preventDefault();
  S.hover.x = t.x; S.hover.y = t.y; S.hover.on = true;

  touchState = {
    tx: t.x, ty: t.y,
    sx: touch.clientX, sy: touch.clientY,
    consumed: false,
    timer: setTimeout(() => {
      if (!touchState || touchState.consumed) return;
      touchState.consumed = true;     // the lift must not also place
      if (S.selectedTool) {
        S.selectedTool = null;
        S.hover.on = false;
        syncBuildBar();
        flashInfo("BUILD CANCELLED");
      } else {
        S.rally = { x: touchState.tx + 0.5, y: touchState.ty + 0.5, horiz: roadIsHorizontal(touchState.tx, touchState.ty) };
        flashInfo("MARINES RALLYING");
        sfx("rally");
      }
    }, LONG_PRESS_MS),
  };
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  if (!touchState) return;
  const touch = e.touches[0];
  e.preventDefault();
  // Sliding means you're aiming, not holding — drop the long press.
  if (Math.hypot(touch.clientX - touchState.sx, touch.clientY - touchState.sy) > TOUCH_SLIDE_PX) {
    clearTimeout(touchState.timer);
    touchState.timer = null;
  }
  const t = eventToTile(touch);
  if (t.inside) {
    touchState.tx = t.x; touchState.ty = t.y;
    S.hover.x = t.x; S.hover.y = t.y; S.hover.on = true;
  }
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
  if (!touchState) return;
  e.preventDefault();
  clearTimeout(touchState.timer);
  const st = touchState;
  touchState = null;
  S.hover.on = false;
  if (st.consumed || touchOver()) { syncSelection(); return; }

  if (S.selectedTool) {
    const ok = place(S.selectedTool, st.tx, st.ty);
    if (ok && !S.keepBuilding) S.selectedTool = null;
    syncBuildBar();
  } else {
    const cell = S.grid[st.ty][st.tx];
    S.selected = cell && typeof cell === "object" ? cell : null;
  }
  syncSelection();
}, { passive: false });

canvas.addEventListener("touchcancel", () => {
  if (touchState) clearTimeout(touchState.timer);
  touchState = null;
  S.hover.on = false;
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Shift") S.keepBuilding = true;

  if (S.phase === "menu" || S.phase === "over" || S.phase === "won") {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      document.getElementById("ov-btn").click();
    }
    return;
  }

  const key = e.key.toLowerCase();

  // Build hotkeys 1-7, laid out like an RTS build menu.
  const byHotkey = BUILD_ORDER.find((k) => TOWERS[k].hotkey === e.key);
  if (byHotkey && S.mods.banned.includes(byHotkey)) {
    flashInfo(TOWERS[byHotkey].name + " IS UNAVAILABLE THIS RUN", true);
    sfx("error");
    return;
  }
  if (byHotkey) {
    S.selectedTool = S.selectedTool === byHotkey ? null : byHotkey;
    S.selected = null;
    syncBuildBar();
    syncSelection();
    return;
  }

  if (key === "escape") {
    S.selectedTool = null;
    S.selected = null;
    syncBuildBar();
    syncSelection();
  } else if (key === " ") {
    e.preventDefault();
    togglePause();
  } else if (key === "n") {
    startWave(true);
  } else if (key === "f") {
    toggleSpeed();
  } else if (key === "u" && S.selected) {
    upgrade(S.selected);
    syncSelection();
  } else if ((key === "s" || key === "delete" || key === "backspace") && S.selected) {
    sell(S.selected);
    syncSelection();
  } else if (key === "h") {
    showHelp();
  } else if (key === "r" && S.selected === null) {
    S.rally = null;
    flashInfo("RALLY POINT CLEARED");
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") S.keepBuilding = false;
});

// ---------------------------------------------------------------------
// 10. HUD, overlays, audio
// ---------------------------------------------------------------------

const el = (id) => document.getElementById(id);

// Build bar buttons are generated from TOWERS so adding a building type is
// a data change, not a markup change. Each icon is the real sprite, scaled.
function buildBuildBar() {
  const bar = el("build-bar");
  bar.innerHTML = "";
  for (const key of BUILD_ORDER) {
    const def = TOWERS[key];
    const btn = document.createElement("button");
    btn.className = "bld";
    btn.dataset.key = key;

    const icon = document.createElement("canvas");
    icon.width = 16;
    icon.height = 16;
    icon.className = "bld-icon";
    const ic = icon.getContext("2d");
    ic.imageSmoothingEnabled = false;
    ic.drawImage(SPR[def.sprite].canvas, 0, 0);

    const label = document.createElement("span");
    label.className = "bld-name";
    label.textContent = def.name;
    const cost = document.createElement("span");
    cost.className = "bld-cost";
    cost.textContent = def.cost;
    const hot = document.createElement("span");
    hot.className = "bld-hot";
    hot.textContent = def.hotkey;

    btn.append(hot, icon, label, cost);
    btn.addEventListener("click", () => {
      if (S.mods.banned.includes(key)) {
        flashInfo(def.name + " IS UNAVAILABLE THIS RUN", true);
        sfx("error");
        return;
      }
      S.selectedTool = S.selectedTool === key ? null : key;
      S.selected = null;
      syncBuildBar();
      syncSelection();
    });
    btn.addEventListener("mouseenter", () => {
      el("info-line").textContent = def.name + " — " + def.blurb;
      el("info-line").classList.remove("bad");
    });
    bar.appendChild(btn);
  }
}

function syncBuildBar() {
  for (const btn of document.querySelectorAll(".bld")) {
    const key = btn.dataset.key;
    const cost = costOf(key);
    // A modifier can take a building off the table for the whole run; say so
    // in the bar rather than only when the placement is refused.
    const banned = S.mods.banned.includes(key);
    btn.classList.toggle("banned", banned);
    btn.classList.toggle("active", !banned && S.selectedTool === key);
    btn.classList.toggle("broke", !banned && S.minerals < cost);
    // Reactors get pricier as you build them, so the label is live.
    const costEl = btn.querySelector(".bld-cost");
    if (costEl.textContent !== String(cost)) costEl.textContent = cost;
  }
}

// The right-hand inspector for a selected building.
function syncSelection() {
  const panel = el("sel-panel");
  const b = S.selected;
  if (!b) {
    panel.classList.add("empty");
    el("sel-name").textContent = "NOTHING SELECTED";
    el("sel-stats").innerHTML = "<span class='dim'>Click a building to inspect it. Right-click the map to rally your marines.</span>";
    el("sel-upgrade").style.display = "none";
    el("sel-sell").style.display = "none";
    return;
  }
  const def = TOWERS[b.type];
  panel.classList.remove("empty");
  el("sel-name").textContent = def.name + "  L" + b.level + (b.powered ? "" : "  ⚠ NO POWER");

  let stats = "";
  if (def.kind === "turret") {
    const dps = towerDamage(b) / def.fireRate;
    stats += `<b>${towerDamage(b).toFixed(0)}</b> dmg &nbsp; <b>${dps.toFixed(1)}</b> dps &nbsp; <b>${towerRange(b).toFixed(1)}</b> rng`;
    stats += `<br><span class='dim'>${def.hitsAir ? "hits air + ground" : "ground only"}${def.splash ? " · splash" : ""}${def.slow ? " · chills" : ""}${def.chain ? " · chains " + def.chain : ""}</span>`;
  } else if (b.type === "extractor") {
    const amount = Math.round((def.incomeAmount + def.incomePerLevel * (b.level - 1)) * S.mods.income);
    stats += `<b>+${amount}</b> minerals / ${def.incomePeriod}s &nbsp; <span class='dim'>(${(amount / def.incomePeriod).toFixed(2)}/s)</span>`;
  } else if (b.type === "reactor") {
    stats += `<b>${def.powerRadius}</b> tile power field`;
  } else if (def.kind === "spawner") {
    const alive = S.units.filter((u) => u.home === b && !u.dead).length;
    stats += `<b>${alive}/${def.unitCount}</b> marines &nbsp; <b>${statAt(def.unit.damage, b.level).toFixed(0)}</b> dmg &nbsp; <b>${marineMaxHp(b)}</b> hp`;
  }
  // One line of flavour under the numbers — the building's own opinion of
  // itself, which is also the fastest way to remind you what it's for.
  if (def.quip) stats += `<div class='quip'>“${def.quip}”</div>`;
  el("sel-stats").innerHTML = stats;

  const up = el("sel-upgrade");
  if (def.upgradeable && b.level < RULES.upgradeMaxLevel) {
    up.style.display = "";
    up.textContent = `UPGRADE (${upgradeCost(b)})  [U]`;
    up.classList.toggle("broke", S.minerals < upgradeCost(b));
  } else {
    up.style.display = "none";
  }
  const sellBtn = el("sel-sell");
  sellBtn.style.display = "";
  sellBtn.textContent = `SELL (+${Math.round(b.invested * RULES.sellRefund)})  [S]`;
}

let hudTick = 0;

function syncHud(dt) {
  hudTick += dt;
  if (hudTick < 0.08) return;   // ~12 updates/sec is plenty for text
  hudTick = 0;

  el("minerals").textContent = Math.floor(S.minerals);
  el("hq-hp").textContent = S.hqHp + "/" + S.maxHqHp;
  el("hq-fill").style.width = (S.hqHp / S.maxHqHp) * 100 + "%";
  el("wave-label").textContent = Math.max(1, S.wave) + " / " + WAVES.length;
  el("kills").textContent = S.kills;

  // Income readout: passive trickle plus every powered extractor.
  let income = RULES.hqIncomePerSecond;
  for (const b of S.buildings) {
    if (b.type !== "extractor" || !b.powered) continue;
    const def = TOWERS.extractor;
    income += (def.incomeAmount + def.incomePerLevel * (b.level - 1)) / def.incomePeriod;
  }
  el("income").textContent = "+" + income.toFixed(1) + "/s";

  const send = el("send-wave");
  if (S.phase === "prep") {
    const secs = Math.ceil(S.prepLeft);
    el("phase-label").textContent = "PREP " + secs + "s";
    send.textContent = `SEND WAVE ${S.wave + 1} NOW  (+${Math.round(S.prepLeft * RULES.earlyCallBonusPerSecond)})`;
    send.disabled = false;
    // Next wave's composition, so you can plan anti-air before it lands.
    const next = WAVES[Math.min(S.wave, WAVES.length - 1)];
    const kinds = [...new Set(next.groups.map((g) => g.type))];
    const air = kinds.some((k) => CREEPS[k].flying);
    el("next-preview").innerHTML =
      "<b>" + waveTitle(S.wave + 1) + "</b> — " + kinds.map((k) => CREEPS[k].name).join(" · ") +
      (air ? " <span class='air'>⚠ AIR</span>" : "");
  } else if (S.phase === "wave") {
    el("phase-label").textContent = "WAVE " + S.wave;
    send.textContent = "WAVE IN PROGRESS";
    send.disabled = true;
    el("next-preview").textContent = S.creeps.length + " HOSTILES ON THE MAP";
  } else if (S.phase === "menu") {
    // Sitting on the menu is not a defeat — that branch used to catch it and
    // greet you with "DEFEATED / OVERRUN" before you'd played a single wave.
    el("phase-label").textContent = "READY";
    send.textContent = "CHOOSE A MAP";
    send.disabled = true;
    el("next-preview").textContent = MAP.name;
  } else {
    // Run's over, one way or the other — don't leave a live-looking button.
    el("phase-label").textContent = S.phase === "won" ? "VICTORY" : "DEFEATED";
    send.textContent = S.phase === "won" ? "PASS HELD" : "OVERRUN";
    send.disabled = true;
    el("next-preview").textContent = "RUN OVER — " + S.kills + " KILLS";
  }

  syncBuildBar();
  if (S.selected) syncSelection();
}

// ---------------------------------------------------------------------
// Comms
//
// The advisor channel in the bottom-left of the map: short lines from
// whoever is sitting in the Command Center, triggered by things that
// actually happened. Deliberately DOM rather than canvas — this text has to
// be readable, and 384x208 is no place for prose.
//
// Rules that keep it from becoming noise: at most four lines on screen, each
// expires on its own timer, and the same line never repeats back to back.
// ---------------------------------------------------------------------
const COMMS_MAX = 4;
const COMMS_TTL = 6500;
let lastComms = "";
const commsLastAt = {};

// Fill {tokens} from `vars` and drop the line into the channel. `gap` is a
// per-key cooldown in ms, for events that can fire in bursts (three marines
// dying at once shouldn't produce three lines).
function comms(key, vars = {}, tone = "info", gap = 0) {
  const lines = COMMS[key];
  if (!lines) return;
  const now = performance.now();
  if (gap && now - (commsLastAt[key] || -Infinity) < gap) return;
  commsLastAt[key] = now;
  let text = lines[(Math.random() * lines.length) | 0];
  text = text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  if (text === lastComms) return;      // never say the same thing twice running
  lastComms = text;

  const log = el("comms");
  const line = document.createElement("div");
  line.className = "comms-line " + tone;
  line.textContent = text;
  log.appendChild(line);
  while (log.children.length > COMMS_MAX) log.removeChild(log.firstChild);
  setTimeout(() => {
    line.classList.add("out");
    setTimeout(() => line.remove(), 400);
  }, COMMS_TTL);
}

let infoTimer = 0;

function flashInfo(text, bad) {
  const line = el("info-line");
  line.textContent = text;
  line.classList.toggle("bad", !!bad);
  infoTimer = 2.2;
}

function showBanner(text, big) {
  const b = el("banner");
  b.textContent = text;
  b.className = "show" + (big ? " boss" : "");
  setTimeout(() => { b.className = ""; }, 1800);
}

// One result screen for both endings: the score, the run's modifiers, the
// daily streak if this was a daily, and a share button.
function showResult(title, headline) {
  const score = computeScore();
  let extra = "";
  if (S.mode === "daily") {
    const res = recordDaily(score);
    extra = res.recorded
      ? `<p class="res-daily">Daily recorded · 🔥 ${dailyStreak()} day streak</p>`
      : `<p class="res-daily dim">Replay — today's score of ${fmt(res.score)} still stands</p>`;
  }
  const mods = S.modifiers.length
    ? `<p class="res-mods">${S.modifiers.map((m) => m.name).join(" + ")}</p>` : "";
  showOverlay(
    title,
    `<p>${headline}</p>` + mods +
      `<p class="res-score">${fmt(score)}</p>` +
      `<p class="res-stats">Kills <b>${S.kills}</b> &nbsp; Leaks <b>${S.leaked}</b> &nbsp; HQ <b>${S.hqHp}/${S.maxHqHp}</b></p>` +
      extra +
      `<button id="share-btn" class="share">SHARE RESULT</button>`,
    S.mode === "daily" ? "BACK TO MENU" : "PLAY AGAIN"
  );
  const sb = document.getElementById("share-btn");
  if (sb) sb.addEventListener("click", () => copyShare(sb));
}

function showOverlay(title, body, btnText) {
  el("ov-title").textContent = title;
  el("ov-body").innerHTML = body;
  el("ov-btn").textContent = btnText;
  el("overlay").classList.add("show");
}

function hideOverlay() {
  el("overlay").classList.remove("show");
}

const HELP_HTML = `
<div class="help">
  <p class="briefing">Ironrun Pass, third winter. One road in, and everything on it wants the Command Center at the end. There is no relief column. There is a mineral seam, a power grid, and whatever you can build before the next horn.</p>
  <p><b>You are holding Ironrun Pass.</b> Creeps walk the road from the west gate to your Command Center. Every one that arrives takes a bite out of it — 20 bites and you're done.</p>
  <p><b>POWER.</b> You can only build inside a power field. The HQ projects one; <b>REACTORS</b> project more. Push reactors out to claim ground, and don't sell one with turrets inside it.</p>
  <p><b>MINERALS.</b> Kills pay, but not enough. Put <b>EXTRACTORS</b> on the purple crystal patches early. Calling a wave in before the timer pays out the leftover seconds.</p>
  <p><b>MATCHUPS.</b> Siege cannons splash hard but can't hit the wasps that fly straight over the road. Gun turrets hit anything but bounce off brute armour. Cryo emitters make everything else work. Tesla coils want a crowd.</p>
  <p><b>MARINES.</b> A barracks trains three, and they physically stop ground creeps. They garrison the nearest stretch of road on their own; right-click anywhere to move the rally flag instead — park them in a choke and the whole wave stalls under your guns.</p>
  <p class="keys">1-7 build &nbsp;·&nbsp; ESC cancel &nbsp;·&nbsp; SHIFT hold to keep building &nbsp;·&nbsp; U upgrade &nbsp;·&nbsp; S sell &nbsp;·&nbsp; N send wave &nbsp;·&nbsp; F fast-forward &nbsp;·&nbsp; SPACE pause &nbsp;·&nbsp; H help</p>
  <p class="keys">ON TOUCH: press to aim, slide to adjust, lift to build &nbsp;·&nbsp; hold to drop the rally flag</p>
</div>`;

function showHelp() {
  if (S.phase === "wave" || S.phase === "prep") S.paused = true;
  syncPauseButton();
  showOverlay("FIELD MANUAL", HELP_HTML, "BACK TO THE WALL");
  el("ov-btn").onclick = () => {
    hideOverlay();
    S.paused = false;
    syncPauseButton();
    el("ov-btn").onclick = defaultOverlayAction;
  };
}

function defaultOverlayAction() {
  hideOverlay();
  if (S.phase === "menu") {
    S.mode = "standard";
    S.modifiers = [];
    beginRun();
    S.phase = "prep";
    flashInfo("BUILD A REACTOR, THEN TURRETS INSIDE ITS FIELD");
    comms("start");
  } else {
    // A finished run goes back to the menu rather than straight into another
    // one, so you can switch maps without reloading the page.
    newGame();
    showMenu();
  }
}

function togglePause() {
  if (S.phase !== "wave" && S.phase !== "prep") return;
  S.paused = !S.paused;
  syncPauseButton();
}

function syncPauseButton() {
  el("btn-pause").textContent = S.paused ? "▶ RESUME" : "⏸ PAUSE";
  el("btn-pause").classList.toggle("active", S.paused);
}

function toggleSpeed() {
  S.speed = S.speed === 1 ? 2 : 1;
  el("btn-speed").textContent = S.speed + "×";
  el("btn-speed").classList.toggle("active", S.speed === 2);
}

// --- persistence: just the best wave reached, like an arcade cabinet ---
// ---------------------------------------------------------------------
// Score, and the Daily Challenge
//
// A run needed a NUMBER. "You lost on wave 14" is a verdict; "14,850" is
// something to beat, and it's what makes a daily challenge worth playing at
// all — everyone gets the same map and the same two modifiers, so the only
// variable left is how well you played it.
//
// Everything here is local: the seed is the date, so every player gets the
// same run with no server, no accounts and no leaderboard to host.
// ---------------------------------------------------------------------
const DAILY_KEY = "bitfront.daily.v1";

// Waves cleared dominate; HP left is the tiebreaker that rewards not leaking;
// leftover minerals are worth little, so hoarding isn't a strategy. Each
// modifier adds 8%, so a hard daily scores higher than an easy one.
function computeScore() {
  const cleared = S.phase === "won" ? WAVES.length : Math.max(0, S.wave - 1);
  const base =
    cleared * 1000 +
    S.hqHp * 250 +
    S.kills * 5 +
    Math.floor(S.minerals * 0.5) -
    S.leaked * 100;
  return Math.max(0, Math.round(base * (1 + 0.08 * S.modifiers.length)));
}

const todayId = () => new Date().toISOString().slice(0, 10);

// Thousands separators, fixed rather than locale-dependent. toLocaleString()
// renders 9332 as "9.332" in a Dutch locale, which in a share card people
// paste publicly reads as nine-point-three.
function fmt(n) {
  // Written as a loop rather than a lookahead regex on purpose: this file
  // is edited by scripts, and a backslash class is one escaping layer away
  // from silently becoming /B(?=(d{3})+(?!d))/, which matches nothing.
  const digits = String(Math.round(n));
  let out = "";
  for (let k = 0; k < digits.length; k++) {
    if (k > 0 && (digits.length - k) % 3 === 0) out += ",";
    out += digits[k];
  }
  return out;
}

// Deterministic PRNG so "today" is the same run for everybody.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Today's map + two distinct modifiers, derived from the date alone.
function dailySetup(id) {
  const seed = Number(id.replace(/-/g, ""));
  const rnd = mulberry32(seed);
  const mapIndex = Math.floor(rnd() * MAPS.length);
  const pool = MODIFIERS.slice();
  const picked = [];
  for (let i = 0; i < 2 && pool.length; i++) {
    picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return { mapIndex, modifiers: picked };
}

function loadDaily() {
  try { return JSON.parse(localStorage.getItem(DAILY_KEY)) || {}; }
  catch (e) { return {}; }
}

function saveDaily(d) {
  localStorage.setItem(DAILY_KEY, JSON.stringify(d));
}

// Record a finished daily. Only the FIRST attempt of a day scores — replays
// are allowed (losing your whole day to one misclick is miserable) but they
// don't overwrite the result or the streak.
function recordDaily(score) {
  const d = loadDaily();
  const id = S.dailyId;
  d.scores = d.scores || {};
  if (d.scores[id] !== undefined) return { recorded: false, score: d.scores[id] };
  d.scores[id] = score;

  // A streak survives if the last recorded day was yesterday.
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  d.streak = d.last === yesterday ? (d.streak || 0) + 1 : 1;
  d.best = Math.max(d.best || 0, score);
  d.last = id;
  saveDaily(d);
  return { recorded: true, score };
}

function dailyStreak() {
  const d = loadDaily();
  if (!d.last) return 0;
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  // A streak that missed a day is already broken, even before you play.
  return (d.last === todayId() || d.last === y) ? (d.streak || 0) : 0;
}

// Wordle-style result, small enough to paste anywhere. This is also the only
// marketing this game has, so it says what the run was, not just the number.
function shareText() {
  const cleared = S.phase === "won" ? WAVES.length : Math.max(0, S.wave - 1);
  const full = Math.round((S.hqHp / S.maxHqHp) * 8);
  const bar = "█".repeat(full) + "░".repeat(8 - full);
  const lines = [
    "BITFRONT " + (S.mode === "daily" ? "Daily " + S.dailyId : MAP.name),
    (S.mode === "daily" ? MAP.name + " · " : "") +
      (S.modifiers.length ? S.modifiers.map((m) => m.name).join(" + ") : "NO MODIFIERS"),
    "Wave " + cleared + "/" + WAVES.length + "  HQ " + bar,
    "Score " + fmt(computeScore()) + (S.mode === "daily" && dailyStreak() ? "  · streak " + dailyStreak() : ""),
  ];
  return lines.join(String.fromCharCode(10));
}

function copyShare(btn) {
  const text = shareText();
  const done = () => { btn.textContent = "COPIED!"; setTimeout(() => { btn.textContent = "SHARE RESULT"; }, 1600); };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

// file:// and plain http aren't secure contexts, and this game is meant to
// run off a double-clicked file — so there has to be a non-clipboard path.
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { window.prompt("Copy your result:", text); }
  ta.remove();
}

const BEST_KEY = "bitfront.best.v1";
const MUTE_KEY = "bitfront.mute.v1";
const MAP_KEY = "bitfront.map.v1";

// ---------------------------------------------------------------------
// Map selection
//
// Rendered into the menu overlay from MAPS, so adding a third map is a data
// change with no UI work. Best-wave records are kept per map — beating wave
// 14 on Coldgate says nothing about your Ironrun run.
// ---------------------------------------------------------------------
function mapPickerHtml() {
  return `<div class="mapsel">` + MAPS.map((m, i) => {
    const best = Number(localStorage.getItem(BEST_KEY + "." + i) || 0);
    return `<button class="mapbtn${MAPS.indexOf(MAP) === i ? " active" : ""}" data-map="${i}">
      <span class="mapbtn-name">${m.name}</span>
      <span class="mapbtn-best">${best ? "BEST WAVE " + best : "UNPLAYED"}</span>
    </button>`;
  }).join("") + `</div>`;
}

// Wire the picker up after the overlay's innerHTML has been replaced.
function bindMapPicker() {
  for (const btn of document.querySelectorAll(".mapbtn")) {
    btn.addEventListener("click", () => {
      setMap(Number(btn.dataset.map));
      localStorage.setItem(MAP_KEY, btn.dataset.map);
      newGame();                       // re-derives the grid and terrain
      showMenu();                      // redraw the picker with the new selection
    });
  }
}

function dailyPanelHtml() {
  const id = todayId();
  const setup = dailySetup(id);
  const d = loadDaily();
  const doneToday = d.scores && d.scores[id] !== undefined;
  const streak = dailyStreak();
  return `<div class="daily">
    <div class="daily-head">
      <span class="daily-title">DAILY CHALLENGE</span>
      <span class="daily-streak">${streak ? "🔥 " + streak + " DAY STREAK" : "NO STREAK"}</span>
    </div>
    <div class="daily-body">
      <b>${MAPS[setup.mapIndex].name}</b> · ${setup.modifiers.map((m) => m.name).join(" + ")}
      <div class="daily-mods">${setup.modifiers.map((m) => m.blurb).join(" ")}</div>
    </div>
    <button id="daily-btn" class="daily-go">${doneToday ? "TODAY: " + fmt(d.scores[id]) + " — REPLAY (UNSCORED)" : "PLAY TODAY'S RUN"}</button>
  </div>`;
}

// Start the daily: same map, same modifiers, same everything, for everyone.
function startDaily() {
  const id = todayId();
  const setup = dailySetup(id);
  setMap(setup.mapIndex);
  newGame();
  S.mode = "daily";
  S.dailyId = id;
  S.modifiers = setup.modifiers;
  beginRun();
  hideOverlay();
  S.phase = "prep";
  flashInfo("DAILY: " + setup.modifiers.map((m) => m.name).join(" + "));
  comms("start");
  syncBuildBar();
}

function showMenu() {
  showOverlay(
    "BITFRONT",
    `<p class="tag">Hold the pass. Pixel by pixel.</p>` + dailyPanelHtml() + mapPickerHtml() +
      `<p class="mapblurb">${MAP.blurb || "The original pass. A long snaking road and five mineral patches."}</p>` +
      HELP_HTML,
    "DEPLOY"
  );
  bindMapPicker();
  const db = document.getElementById("daily-btn");
  if (db) db.addEventListener("click", startDaily);
}

function saveBest(wave) {
  const key = BEST_KEY + "." + MAPS.indexOf(MAP);
  const best = Number(localStorage.getItem(key) || 0);
  if (wave > best) localStorage.setItem(key, String(wave));
  showBest();
}

function showBest() {
  const best = Number(localStorage.getItem(BEST_KEY + "." + MAPS.indexOf(MAP)) || 0);
  el("best").textContent = best ? "BEST WAVE " + best : "NO RUNS YET";
}

// --- audio: tiny WebAudio blips, no files ---
let audioCtx = null;
let muted = localStorage.getItem(MUTE_KEY) === "1";

function sfx(name) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { return; }
  if (audioCtx.state === "suspended") audioCtx.resume();

  // [waveform, startHz, endHz, seconds, gain]
  const P = {
    gun: ["square", 660, 220, 0.05, 0.05],
    rifle: ["square", 880, 400, 0.035, 0.035],
    cannon: ["sawtooth", 180, 60, 0.16, 0.11],
    frost: ["sine", 1200, 500, 0.12, 0.06],
    tesla: ["sawtooth", 1400, 200, 0.14, 0.07],
    boom: ["triangle", 140, 40, 0.22, 0.12],
    bigboom: ["triangle", 90, 30, 0.5, 0.18],
    kill: ["square", 300, 120, 0.07, 0.05],
    build: ["square", 300, 700, 0.13, 0.08],
    upgrade: ["square", 500, 1100, 0.18, 0.08],
    sell: ["square", 700, 300, 0.12, 0.07],
    error: ["sawtooth", 150, 110, 0.14, 0.08],
    leak: ["sawtooth", 300, 80, 0.3, 0.14],
    wave: ["square", 400, 800, 0.22, 0.09],
    boss: ["sawtooth", 120, 220, 0.6, 0.14],
    cleared: ["sine", 700, 1300, 0.26, 0.09],
    unitdown: ["square", 240, 90, 0.14, 0.07],
    rally: ["sine", 900, 1200, 0.09, 0.05],
    win: ["sine", 500, 1600, 0.7, 0.12],
    lose: ["sawtooth", 320, 60, 0.9, 0.14],
  }[name];
  if (!P) return;

  const [type, f0, f1, dur, gain] = P;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), audioCtx.currentTime + dur);
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

// ---------------------------------------------------------------------
// 11. Main loop
//
// Fixed 60Hz logic steps with an accumulator, so 2x speed is literally
// "run two steps per frame" and nothing in the simulation has to know
// about frame rate. Long stalls (tab switch) are clamped, not caught up.
// ---------------------------------------------------------------------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();

function frame(now) {
  const wall = Math.min(0.25, (now - last) / 1000);
  last = now;

  const running = (S.phase === "prep" || S.phase === "wave") && !S.paused;
  if (running) {
    acc += wall * S.speed;
    let steps = 0;
    while (acc >= STEP && steps < 12) {
      step(STEP);
      acc -= STEP;
      steps++;
    }
  } else {
    acc = 0;
  }

  // Cosmetics keep ticking while paused so the UI doesn't look frozen.
  S.time += wall;
  if (S.shake > 0) S.shake = Math.max(0, S.shake - wall * 14);
  if (infoTimer > 0) {
    infoTimer -= wall;
    if (infoTimer <= 0) {
      el("info-line").textContent = "1-7 to build · right-click to rally marines · H for the field manual";
      el("info-line").classList.remove("bad");
    }
  }

  render();
  syncHud(wall);
  requestAnimationFrame(frame);
}

function step(dt) {
  if (S.phase === "prep") {
    S.minerals += RULES.hqIncomePerSecond * dt;
    S.prepLeft -= dt;
    if (S.prepLeft <= 0) startWave(false);
    updateTowers(dt);   // extractors keep earning between waves
    updateUnits(dt);
    updateBirds(dt);
    updateFx(dt);
    return;
  }

  S.waveTime += dt;
  S.minerals += RULES.hqIncomePerSecond * dt;

  // Release everything whose spawn time has come.
  while (S.spawnQueue.length && S.spawnQueue[0].t <= S.waveTime) {
    spawnCreep(S.spawnQueue.shift().type);
  }

  updateCreeps(dt);
  updateUnits(dt);
  updateTowers(dt);
  updateShots(dt);
  updateBirds(dt);
  updateFx(dt);

  if (S.phase === "wave" && !S.spawnQueue.length && !S.creeps.length) waveCleared();
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
function newGame() {
  S = freshState();
  document.querySelector(".mapname").textContent = MAP.name;
  el("comms").innerHTML = "";
  lastComms = "";
  buildGrid();
  renderTerrain();
  recomputePower();
  syncBuildBar();
  syncSelection();
  syncPauseButton();
  el("btn-speed").textContent = "1×";
  el("btn-speed").classList.remove("active");
}

function boot() {
  setMap(Number(localStorage.getItem(MAP_KEY) || 0));
  newGame();
  buildBuildBar();
  syncSelection();
  fitCanvas();
  showBest();

  el("btn-pause").onclick = togglePause;
  el("btn-speed").onclick = toggleSpeed;
  el("btn-help").onclick = showHelp;
  el("btn-sound").onclick = () => {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    el("btn-sound").textContent = muted ? "🔇" : "🔊";
    if (!muted) sfx("build");
  };
  el("btn-sound").textContent = muted ? "🔇" : "🔊";
  el("send-wave").onclick = () => startWave(true);
  el("sel-upgrade").onclick = () => { if (S.selected) { upgrade(S.selected); syncSelection(); } };
  el("sel-sell").onclick = () => { if (S.selected) { sell(S.selected); syncSelection(); } };
  el("ov-btn").onclick = defaultOverlayAction;

  showMenu();

  requestAnimationFrame((t) => { last = t; frame(t); });
}

boot();
