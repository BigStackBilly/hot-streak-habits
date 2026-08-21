// =====================================================================
// BITFRONT — validate-maps.js
//
// Checks every map in data.js against the rules the engine quietly assumes.
// Break one of these and the game doesn't throw — it just misbehaves in a
// way that's tedious to spot: creeps clipping diagonally across grass, a
// crystal you can never reach because the road is on top of it, an HQ the
// last waypoint doesn't actually touch.
//
// Run with:  node validate-maps.js
// =====================================================================

const fs = require("fs");
const vm = require("vm");

// data.js is a plain script with no exports, so run it in a sandbox and
// pull the globals out. That way the validator checks the REAL file rather
// than a copy of the numbers that can drift away from it.
// Note: top-level const/let in a vm script do NOT become properties of the
// context, so the bindings are handed back as the script's completion value.
const ctx = vm.createContext({ console });
const source = fs.readFileSync(__dirname + "/data.js", "utf8");
const { MAPS, COLS, ROWS, WAVES, CREEPS, WAVE_NAMES } =
  vm.runInContext(source + ";({ MAPS, COLS, ROWS, WAVES, CREEPS, WAVE_NAMES });", ctx);

let failures = 0;
const fail = (map, msg) => { failures++; console.log(`  ✗ [${map}] ${msg}`); };

// Same derivation the engine uses, so the validator sees the tiles the game
// will actually paint and block on.
function pathTiles(map) {
  const set = new Set();
  const wp = map.waypoints;
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i], b = wp[i + 1];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.floor(a.x + (b.x - a.x) * t);
      const y = Math.floor(a.y + (b.y - a.y) * t);
      if (x >= 0 && y >= 0 && x < COLS && y < ROWS) set.add(x + "," + y);
    }
  }
  return set;
}

for (const map of MAPS) {
  const name = map.name;
  const road = pathTiles(map);
  const wp = map.waypoints;

  // 1. Segments must be axis-aligned: creeps walk straight lines between
  //    waypoints, so a diagonal segment would have them cross open grass.
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i], b = wp[i + 1];
    if (a.x !== b.x && a.y !== b.y) fail(name, `segment ${i} is diagonal (${a.x},${a.y})->(${b.x},${b.y})`);
    if (a.x === b.x && a.y === b.y) fail(name, `segment ${i} has zero length`);
  }

  // 2. Creeps must enter from offscreen, or they pop into existence.
  const s = wp[0];
  if (s.x >= 0 && s.x <= COLS && s.y >= 0 && s.y <= ROWS) fail(name, `spawn (${s.x},${s.y}) is not offscreen`);

  // 3. Every waypoint after the first has to be on the board.
  for (let i = 1; i < wp.length; i++) {
    const p = wp[i];
    if (p.x < 0 || p.y < 0 || p.x > COLS || p.y > ROWS) fail(name, `waypoint ${i} (${p.x},${p.y}) is off the board`);
  }

  // 4. The HQ is a 2x2 block, on the board, and clear of the road.
  const hqTiles = [];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) hqTiles.push([map.hq.x + dx, map.hq.y + dy]);
  for (const [x, y] of hqTiles) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) fail(name, `HQ tile (${x},${y}) is off the board`);
    if (road.has(x + "," + y)) fail(name, `HQ tile (${x},${y}) sits on the road`);
  }

  // 5. The final waypoint must touch the HQ, or creeps "arrive" in a field.
  const last = wp[wp.length - 1];
  const touches = hqTiles.some(([x, y]) => Math.abs(x + 0.5 - last.x) <= 1.01 && Math.abs(y + 0.5 - last.y) <= 1.01);
  if (!touches) fail(name, `final waypoint (${last.x},${last.y}) is not adjacent to the HQ at (${map.hq.x},${map.hq.y})`);

  // 6. Scenery must not sit on the road or on the HQ, and not overlap itself.
  const seen = new Map();
  for (const kind of ["crystals", "rocks"]) {
    for (const p of map[kind] || []) {
      const key = p.x + "," + p.y;
      if (p.x < 0 || p.y < 0 || p.x >= COLS || p.y >= ROWS) fail(name, `${kind} (${key}) is off the board`);
      if (road.has(key)) fail(name, `${kind} (${key}) sits on the road`);
      if (hqTiles.some(([x, y]) => x === p.x && y === p.y)) fail(name, `${kind} (${key}) sits under the HQ`);
      if (seen.has(key)) fail(name, `${kind} (${key}) overlaps ${seen.get(key)}`);
      seen.set(key, kind);
    }
  }

  // 7. Decoration is allowed anywhere except the road, where it looks like
  //    scenery growing out of a highway.
  for (const kind of ["pines", "bones"]) {
    for (const p of map[kind] || []) {
      if (road.has(p.x + "," + p.y)) fail(name, `${kind} (${p.x},${p.y}) is drawn on the road`);
    }
  }

  // 8. A map with no buildable ground next to its road is unplayable.
  let nearRoad = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (road.has(x + "," + y)) continue;
      if (hqTiles.some(([hx, hy]) => hx === x && hy === y)) continue;
      if ((map.rocks || []).some((r) => r.x === x && r.y === y)) continue;
      if ((map.crystals || []).some((c) => c.x === x && c.y === y)) continue;
      for (const key of road) {
        const [rx, ry] = key.split(",").map(Number);
        if (Math.hypot(rx - x, ry - y) <= 3.2) { nearRoad++; break; }
      }
    }
  }
  if (nearRoad < 40) fail(name, `only ${nearRoad} buildable tiles within turret range of the road`);

  // Report the shape of the map for eyeballing, not as a pass/fail.
  let len = 0;
  for (let i = 0; i < wp.length - 1; i++) len += Math.hypot(wp[i + 1].x - wp[i].x, wp[i + 1].y - wp[i].y);
  console.log(`${name}: road ${len.toFixed(1)} tiles · ${road.size} road tiles · ${nearRoad} buildable in range · ${(map.crystals || []).length} patches · ${(map.rocks || []).length} rocks`);
}

// The wave table is shared by every map, so check it once.
for (let i = 0; i < WAVES.length; i++) {
  for (const g of WAVES[i].groups) {
    if (!CREEPS[g.type]) { failures++; console.log(`  ✗ wave ${i + 1} references unknown creep "${g.type}"`); }
    if (!(g.count > 0) || !(g.gap > 0)) { failures++; console.log(`  ✗ wave ${i + 1} group has a bad count/gap`); }
  }
}
if (WAVE_NAMES.length !== WAVES.length) {
  failures++;
  console.log(`  ✗ ${WAVES.length} waves but ${WAVE_NAMES.length} wave names`);
}

console.log(failures ? `\nFAILED — ${failures} problem(s)` : "\nAll maps valid.");
process.exit(failures ? 1 : 0);
