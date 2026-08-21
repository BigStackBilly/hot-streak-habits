// =====================================================================
// BITFRONT — playtest.js
//
// Plays the game. Not a unit test: a scripted commander that opens the
// real sprites.js/data.js/game.js, builds a base, and reports how far it
// got. Every balance number in data.js was tuned against this, so it
// lives in the repo — a claim about difficulty nobody can re-run is just
// a rumour.
//
//   node playtest.js                       both maps, 5 seeded runs each
//   node playtest.js --runs 20             more runs, tighter numbers
//   node playtest.js --map 1               Coldgate only
//   node playtest.js --mods glass,swarm    with modifiers on
//   node playtest.js --verbose             per-wave trace of one run
//
// Exit code is 1 if a map lands outside the band in EXPECT below, so a
// balance change that quietly breaks the run shows up in CI rather than
// three weeks later.
//
// The engine is a browser program with no exports, so it runs here inside
// a vm context with a stub DOM (see fakeDom). The stub only has to be
// good enough to get through load and boot: the simulation itself —
// step(), place(), upgrade() — never touches the canvas, only render()
// does, and render() is never called.
// =====================================================================

const fs = require("fs");
const vm = require("vm");

// ---------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes("--" + name);

const RUNS = Number(arg("runs", 5));
const SEED0 = Number(arg("seed", 1));
const MAP_ARG = arg("map", "all");
const MOD_IDS = (arg("mods", "") || "").split(",").filter(Boolean);
const VERBOSE = has("verbose");

// What the bot is expected to manage, per map index. The bot plays a
// competent-but-unimaginative game: it never calls a wave early, never
// sells, and never re-sites a turret. A human who uses those should beat
// it, which is the point — these bands are the floor, not the target.
//
// Measured over 12 seeds per map: a median of 19 on both, with Coldgate
// winning 1 run in 12 and Ironrun none. The band is deliberately wider
// than that spread — it exists to catch a balance change that breaks the
// run, not to pin the numbers in place.
const EXPECT = [
  { name: "IRONRUN PASS", min: 17, max: 20 },
  { name: "COLDGATE", min: 17, max: 20 },
];

// ---------------------------------------------------------------------
// A DOM that is just barely a DOM
// ---------------------------------------------------------------------

// Every unknown property is a function that is also an object, so the
// engine can call el(x).classList.toggle(...) or read el(x).style.width
// without any of it being real. Assignments are kept, so anything the
// engine writes and reads back still works.
function stub(name) {
  const target = function () { return target; };
  target._name = name;
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === Symbol.toPrimitive) return () => "";
      if (typeof prop === "symbol") return undefined;
      t[prop] = stub(name + "." + String(prop));
      return t[prop];
    },
    set(t, prop, value) { t[prop] = value; return true; },
    apply() { return stub(name + "()"); },
  });
}

function fakeCanvas(w = 384, h = 208) {
  const c = stub("canvas");
  c.width = w;
  c.height = h;
  const ctx = stub("ctx");
  // sprites.js really does read and write pixels, so these two are real.
  ctx.createImageData = (iw, ih) => ({
    width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4),
  });
  ctx.getImageData = (x, y, iw, ih) => ctx.createImageData(iw, ih);
  ctx.putImageData = () => {};
  ctx.getContext = undefined;
  c.getContext = () => ctx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h });
  return c;
}

function fakeDom() {
  const store = new Map();
  const elements = new Map();

  const document = stub("document");
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, id === "game" ? fakeCanvas() : stub("#" + id));
    return elements.get(id);
  };
  document.createElement = (tag) => (tag === "canvas" ? fakeCanvas(1, 1) : stub("<" + tag + ">"));
  document.querySelector = () => stub("query");
  document.querySelectorAll = () => [];
  document.body = stub("body");
  document.addEventListener = () => {};

  const window = stub("window");
  window.innerWidth = 1280;
  window.innerHeight = 800;
  window.addEventListener = () => {};
  window.AudioContext = undefined;         // sfx() bails out; nothing to hear here
  window.webkitAudioContext = undefined;
  window.devicePixelRatio = 1;

  return {
    window, document, console,
    navigator: { clipboard: undefined, userAgent: "playtest" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,        // the engine's own loop never runs
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    Image: function () { return stub("img"); },
  };
}

// ---------------------------------------------------------------------
// Load the real engine
// ---------------------------------------------------------------------
function loadGame(seed) {
  const sandbox = fakeDom();
  sandbox.window.self = sandbox.window;
  const ctx = vm.createContext(sandbox);
  vm.runInContext("var window = this.window, document = this.document;", ctx);

  // Deterministic runs: same seed, same wave jitter, same result. Without
  // this a balance change and a lucky roll look identical.
  vm.runInContext(
    `Math.random = (function (a) { return function () {
       a |= 0; a = (a + 0x6D2B79F5) | 0;
       var t = Math.imul(a ^ (a >>> 15), 1 | a);
       t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
       return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
     }; })(${seed});`,
    ctx
  );

  for (const file of ["sprites.js", "data.js", "game.js"]) {
    vm.runInContext(fs.readFileSync(__dirname + "/" + file, "utf8"), ctx, { filename: file });
  }

  // Top-level const/let in a vm script are not properties of the context,
  // so hand the bindings back as the completion value. S is reassigned by
  // newGame(), hence the getter rather than a snapshot.
  return vm.runInContext(
    `({ get S() { return S; },
        MAPS, MODIFIERS, TOWERS, RULES, COLS, ROWS, WAVES,
        setMap, newGame, beginRun, step, place, upgrade,
        placementError, costOf, upgradeCost, towerRange, computeScore, poweredAt })`,
    ctx
  );
}

// ---------------------------------------------------------------------
// The commander
//
// Three habits, in priority order, which is the whole strategy:
//   1. every crystal patch you can power is an extractor, early
//   2. turrets go where they cover the most road, in a mix that answers
//      armour (cannon), air (gun) and crowds (tesla), with cryo to make
//      the rest work
//   3. when there is no ground left, level up what you already own
// It never calls a wave early and never sells. Both are real skills the
// game rewards, and leaving them out is what keeps this a floor.
// ---------------------------------------------------------------------

// Turret mix as a running target: the Nth combat building should be this.
const MIX = ["gun", "cannon", "gun", "frost", "cannon", "tesla", "gun", "cannon", "frost", "tesla"];

// A turret that only clips a corner of the road is worse than the same
// minerals spent levelling one that is already shooting. Without a floor
// here the bot carpets every legal tile, which wins games no human plays.
const MIN_COVERAGE = 4;

// A reactor this far from the road only opens ground nothing can shoot from.
const MAX_REACTOR_ROAD_DISTANCE = 4.5;

function makeBot(G) {
  const roadTiles = [];

  function cacheRoad() {
    roadTiles.length = 0;
    for (const key of G.S.pathTiles) {
      const [x, y] = key.split(",").map(Number);
      roadTiles.push([x + 0.5, y + 0.5]);
    }
  }

  // How much road a turret on this tile would cover. Tiles the enemy walks
  // through early count slightly more than the last stretch, so the bot
  // doesn't stack everything on the HQ's doorstep.
  function coverage(type, tx, ty) {
    const probe = { type, level: 1, cx: tx + 0.5, cy: ty + 0.5 };
    const r = G.towerRange(probe);
    let n = 0;
    for (const [rx, ry] of roadTiles) {
      if (Math.hypot(rx - probe.cx, ry - probe.cy) <= r) n++;
    }
    return n;
  }

  function bestPlacement(type, score) {
    let best = null, bestScore = -1;
    for (let y = 0; y < G.ROWS; y++) {
      for (let x = 0; x < G.COLS; x++) {
        if (G.placementError(type, x, y)) continue;
        const s = score(x, y);
        if (s > bestScore) { bestScore = s; best = { x, y, score: s }; }
      }
    }
    return best;
  }

  function counts() {
    const c = {};
    for (const b of G.S.buildings) c[b.type] = (c[b.type] || 0) + 1;
    return c;
  }

  // One decision. Returns a short string describing what it did, or null.
  return function think() {
    const S = G.S;
    if (!roadTiles.length) cacheRoad();   // the map is only derived once newGame has run
    const c = counts();
    const afford = (t) => S.minerals >= G.costOf(t);
    const banned = (t) => (S.mods.banned || []).includes(t);

    // 1. Extractors: the economy compounds, so they are worth being greedy
    //    about, but not worth going gunless for wave 1.
    if (afford("extractor") && (c.gun || 0) + (c.cannon || 0) >= 1) {
      const spot = bestPlacement("extractor", () => 1);
      if (spot) { G.place("extractor", spot.x, spot.y); return "extractor"; }
    }

    // 2. A barracks, once, once there is something to protect it.
    if (!banned("barracks") && !c.barracks && afford("barracks") && (c.gun || 0) >= 2) {
      const spot = bestPlacement("barracks", (x, y) => coverage("gun", x, y));
      if (spot) { G.place("barracks", spot.x, spot.y); return "barracks"; }
    }

    // 3. The next turret in the mix, on the tile that covers the most road.
    const combat = (c.gun || 0) + (c.cannon || 0) + (c.frost || 0) + (c.tesla || 0);
    for (let i = 0; i < MIX.length; i++) {
      const type = MIX[(combat + i) % MIX.length];
      if (banned(type) || !afford(type)) continue;
      const spot = bestPlacement(type, (x, y) => coverage(type, x, y));
      if (spot && spot.score >= MIN_COVERAGE) { G.place(type, spot.x, spot.y); return type; }
      break;   // the mix is an order, not a menu: don't skip ahead on cost
    }

    // 4. No ground worth building on. Extend the grid — but only while a
    //    reactor is still cheaper than levelling something, which is what
    //    the reactor cost ramp is for.
    const upgradable = S.buildings
      .filter((b) => b.level < G.RULES.upgradeMaxLevel && G.TOWERS[b.type].upgradeable)
      .sort((a, b) => G.upgradeCost(a) - G.upgradeCost(b));
    const cheapestUpgrade = upgradable[0] ? G.upgradeCost(upgradable[0]) : Infinity;

    if (afford("reactor") && G.costOf("reactor") <= cheapestUpgrade * 1.5) {
      // A reactor is only worth it if it opens ground a turret can shoot
      // the road from. Past that the ramp has priced the map out, which is
      // exactly when levelling up is supposed to take over.
      const spot = bestPlacement("reactor", (x, y) =>
        -Math.min(...roadTiles.map(([rx, ry]) => Math.hypot(rx - x - 0.5, ry - y - 0.5))));
      if (spot && -spot.score <= MAX_REACTOR_ROAD_DISTANCE) {
        G.place("reactor", spot.x, spot.y);
        return "reactor";
      }
    }

    // 5. Level up. Cheapest first: two level-2 turrets beat one level-3.
    if (upgradable.length && S.minerals >= cheapestUpgrade) {
      G.upgrade(upgradable[0]);
      return "upgrade " + G.TOWERS[upgradable[0].type].name;
    }

    return null;
  };
}

// ---------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------
function playRun(seed, mapIdx, modIds, verbose) {
  const G = loadGame(seed);

  G.setMap(mapIdx);
  G.newGame();
  G.S.modifiers = modIds.map((id) => {
    const m = G.MODIFIERS.find((m) => m.id === id);
    if (!m) { console.error(`unknown modifier "${id}"`); process.exit(2); }
    return m;
  });
  G.beginRun();
  G.S.phase = "prep";

  const bot = makeBot(G);

  const STEP = 1 / 60;
  const MAX_STEPS = 60 * 60 * 45;      // 45 minutes of game time is a hang
  let steps = 0, lastWave = 0;
  const trace = [];

  while (steps < MAX_STEPS) {
    // The bot thinks 4x a second. Faster is not smarter, just slower to run.
    if (steps % 15 === 0) { let acted; do { acted = bot(); } while (acted && G.S.minerals > 0); }

    G.step(STEP);
    steps++;

    if (verbose && G.S.wave !== lastWave) {
      lastWave = G.S.wave;
      trace.push(`  wave ${String(G.S.wave).padStart(2)} · hq ${G.S.hqHp}/${G.S.maxHqHp}` +
                 ` · ${G.S.buildings.length} buildings · ${Math.round(G.S.minerals)} min`);
    }
    if (G.S.phase === "over" || G.S.phase === "won") break;
  }

  const S = G.S;
  const composition = {};
  for (const b of S.buildings) composition[b.type] = (composition[b.type] || 0) + 1;

  return {
    seed,
    map: G.MAPS[mapIdx].name,
    composition,
    won: S.phase === "won",
    hung: steps >= MAX_STEPS,
    cleared: S.phase === "won" ? G.WAVES.length : Math.max(0, S.wave - 1),
    hqHp: S.hqHp,
    maxHqHp: S.maxHqHp,
    kills: S.kills,
    leaked: S.leaked,
    buildings: S.buildings.length,
    score: G.computeScore(),
    trace,
  };
}

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const mapIdxs = MAP_ARG === "all" ? EXPECT.map((_, i) => i) : [Number(MAP_ARG)];
let failures = 0;

if (MOD_IDS.length) console.log(`modifiers: ${MOD_IDS.join(", ")}\n`);

for (const mapIdx of mapIdxs) {
  const results = [];
  for (let i = 0; i < RUNS; i++) results.push(playRun(SEED0 + i, mapIdx, MOD_IDS, VERBOSE));

  const name = results[0].map;
  console.log(name);
  for (const r of results) {
    const outcome = r.hung ? "HUNG" : r.won ? "HELD THE PASS" : `overrun on wave ${r.cleared + 1}`;
    console.log(
      `  seed ${String(r.seed).padEnd(3)} cleared ${String(r.cleared).padStart(2)}/20` +
      ` · hq ${String(r.hqHp).padStart(2)}/${r.maxHqHp} · ${String(r.kills).padStart(3)} kills` +
      ` · ${String(r.leaked).padStart(2)} leaked · ${String(r.buildings).padStart(2)} bld` +
      ` · score ${String(r.score).padStart(6)} · ${outcome}`
    );
    if (VERBOSE) {
      console.log(r.trace.join("\n"));
      console.log("    built: " + Object.entries(r.composition)
        .map(([t, n]) => `${n}x ${t}`).join(", "));
    }
    if (r.hung) failures++;
  }

  const cleared = results.map((r) => r.cleared);
  const wins = results.filter((r) => r.won).length;
  const med = median(cleared);
  console.log(
    `  → median wave ${med} (${Math.min(...cleared)}-${Math.max(...cleared)})` +
    ` · ${wins}/${results.length} runs held the pass` +
    ` · median score ${median(results.map((r) => r.score)).toLocaleString("en-US")}`
  );

  // Only the un-modified game has a band: modifiers are meant to move it.
  if (!MOD_IDS.length) {
    const band = EXPECT[mapIdx];
    if (med < band.min || med > band.max) {
      failures++;
      console.log(`  ✗ expected a median of ${band.min}-${band.max}, got ${med}`);
    }
  }
  console.log("");
}

if (failures) {
  console.log(`FAILED — ${failures} problem(s)`);
  process.exit(1);
}
console.log(MOD_IDS.length ? "Done." : "Balance within expected bands.");
