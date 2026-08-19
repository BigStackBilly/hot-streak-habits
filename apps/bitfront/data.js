// =====================================================================
// BITFRONT — data.js
//
// Every tunable number in the game, and the map itself. Kept apart from
// game.js on purpose: balancing a tower defence is 90% editing tables, and
// it should be possible to do that without scrolling past the renderer.
//
// Distances are in TILES, times are in SECONDS, damage is in HP. game.js
// converts to pixels/frames at the last moment.
//
// Exposes: TILE, COLS, ROWS, MAPS/MAP, TOWERS, CREEPS, WAVES, RULES.
// =====================================================================

const TILE = 16;   // art pixels per tile
const COLS = 24;   // 24 * 16 = 384 px of logical width
const ROWS = 13;   // 13 * 16 = 208 px of logical height

// ---------------------------------------------------------------------
// Global rules
// ---------------------------------------------------------------------
const RULES = {
  startMinerals: 180,
  hqHp: 20,

  // Prep time before wave 1 and between waves. Calling a wave early pays
  // out the unused seconds as minerals, which is the main skill-expression
  // knob in the genre: greedy early calls fund a bigger build.
  firstPrepTime: 30,
  prepTime: 18,
  earlyCallBonusPerSecond: 2,

  // Passive HQ income, so a bad opening is recoverable but slow.
  hqIncomePerSecond: 1.2,

  // Power. Buildings can only be placed inside a power field, which is
  // what stops the map from becoming an undifferentiated turret carpet
  // and gives the reactor a real placement decision.
  hqPowerRadius: 5.5,
  reactorPowerRadius: 4.5,

  sellRefund: 0.6,     // fraction of everything spent on a building
  // Four levels, not three: reactors get more expensive as you build them,
  // so ground runs out. Levelling what you already own has to be able to
  // carry the last five waves on its own.
  upgradeMaxLevel: 4,

  // Armour is flat reduction with a floor, so armoured targets are a
  // rock/paper problem rather than an immunity.
  minDamageFraction: 0.2,
};

// ---------------------------------------------------------------------
// The maps
//
// A map is pure data: a road described as waypoints, where the HQ sits, and
// where the scenery is. Everything else (which tiles are road, what's
// buildable, where creeps walk, how the ground is painted) is derived from
// this at load, so the two can never disagree — see derivePath/buildGrid.
//
// Rules a map has to follow, checked by validate-maps.js:
//   - waypoint segments are axis-aligned, and the first one starts offscreen
//   - the last waypoint sits directly outside the HQ's 2x2 footprint
//   - nothing (HQ, rock, crystal) sits on a road tile
// ---------------------------------------------------------------------
const MAPS = [
  {
    name: "IRONRUN PASS",

    // Creeps enter offscreen left and snake to the HQ door.
    waypoints: [
      { x: -1.5, y: 1.5 },
      { x: 5.5, y: 1.5 },
      { x: 5.5, y: 6.5 },
      { x: 11.5, y: 6.5 },
      { x: 11.5, y: 2.5 },
      { x: 18.5, y: 2.5 },
      { x: 18.5, y: 10.5 },
      { x: 10.5, y: 10.5 },
    ],

    // HQ occupies a 2x2 block; its top-left tile is given here. The last
    // waypoint sits just outside its east wall.
    hq: { x: 8, y: 9 },

    // Mineral patches. An extractor is built directly on top of one.
    crystals: [
      { x: 2, y: 4 },
      { x: 8, y: 3 },
      { x: 14, y: 9 },
      { x: 21, y: 7 },
      { x: 3, y: 11 },
    ],

    // Unbuildable scenery.
    rocks: [
      { x: 7, y: 8 }, { x: 13, y: 4 }, { x: 20, y: 1 },
      { x: 16, y: 12 }, { x: 1, y: 8 },
    ],

    // Pure decoration — drawn, never collided with.
    pines: [
      { x: 0, y: 5 }, { x: 0, y: 6 }, { x: 23, y: 3 }, { x: 22, y: 12 },
      { x: 6, y: 12 }, { x: 15, y: 0 }, { x: 2, y: 0 }, { x: 12, y: 8 },
      { x: 23, y: 9 },
    ],
    bones: [{ x: 1, y: 2 }, { x: 3, y: 0 }],
  },

  {
    name: "COLDGATE",
    // Measured against the scripted bot in validate/playtest runs, Coldgate
    // is the kinder of the two: 51 tiles of road versus Ironrun's 45 buys
    // more seconds under fire than the extra rock and the missing fifth
    // mineral patch take away. Said plainly in the blurb rather than tuned
    // out — a gentler second map is useful, a dishonest one isn't.
    blurb: "A longer road, only four mineral patches, and flanks broken up by rock. Those extra seconds under fire make it the kinder of the two — a good place to learn the matchups.",

    // Creeps enter offscreen RIGHT here — the mirror of Ironrun, which is
    // most of what makes it feel like a different place before you've
    // thought about it.
    waypoints: [
      { x: 24.5, y: 1.5 },
      { x: 5.5, y: 1.5 },
      { x: 5.5, y: 5.5 },
      { x: 18.5, y: 5.5 },
      { x: 18.5, y: 9.5 },
      { x: 7.5, y: 9.5 },
    ],

    hq: { x: 5, y: 9 },

    crystals: [
      { x: 1, y: 3 },
      { x: 9, y: 3 },
      { x: 21, y: 7 },
      { x: 12, y: 11 },
    ],

    // More rock than Ironrun, and deliberately placed on the tiles you most
    // want a turret on — the long straights would otherwise be a shooting
    // gallery you could solve with one cluster of guns.
    // Rock is the whole point of this map. Ironrun's long straights let you
    // solve a lane with one dense cluster of guns; here the tiles flanking
    // each straight are broken up, so cover has to be spread along the road
    // rather than stacked on the best corner.
    rocks: [
      { x: 8, y: 2 }, { x: 14, y: 2 }, { x: 11, y: 2 }, { x: 18, y: 2 },
      { x: 12, y: 0 }, { x: 17, y: 0 }, { x: 20, y: 0 },
      { x: 7, y: 4 }, { x: 13, y: 4 }, { x: 17, y: 4 },
      { x: 6, y: 6 }, { x: 14, y: 6 }, { x: 2, y: 7 },
      { x: 11, y: 7 }, { x: 16, y: 7 },
      { x: 10, y: 8 }, { x: 15, y: 8 }, { x: 21, y: 11 },
    ],

    pines: [
      { x: 0, y: 0 }, { x: 1, y: 6 }, { x: 23, y: 12 }, { x: 2, y: 12 },
      { x: 22, y: 4 }, { x: 10, y: 3 }, { x: 13, y: 12 }, { x: 0, y: 11 },
    ],
    bones: [{ x: 23, y: 2 }, { x: 22, y: 0 }],
  },
];

// The map currently being played. Reassigned by setMap() from the menu, so
// it's a let — everything downstream reads MAP.* and re-derives on newGame().
let MAP = MAPS[0];

function setMap(i) {
  MAP = MAPS[Math.max(0, Math.min(MAPS.length - 1, i))] || MAPS[0];
}

// ---------------------------------------------------------------------
// Buildings
//
// `kind` drives behaviour in game.js:
//   turret   - acquires a target and shoots
//   support  - reactor (power) and extractor (income), no weapon
//   spawner  - barracks, trains marines that hold the line
//
// Upgrades follow one shared curve (see upgradeCost / statAt in game.js):
// each level costs 70% of base and multiplies damage by 1.5.
// ---------------------------------------------------------------------
const TOWERS = {
  reactor: {
    name: "REACTOR",
    kind: "support",
    cost: 30,
    // Each reactor costs 20 more than the last (see costOf in game.js).
    // Without this the correct play is to carpet the whole map in turrets;
    // with it, ground is finite and upgrading what you have competes with
    // sprawling outwards.
    costStep: 20,
    hotkey: "1",
    sprite: "reactor",
    blurb: "Projects a power field. Everything else must be built inside one. Each one costs more than the last.",
    quip: "Hums. Do not lick.",
    powerRadius: RULES.reactorPowerRadius,
    upgradeable: false,
  },

  extractor: {
    name: "EXTRACTOR",
    kind: "support",
    cost: 60,
    hotkey: "2",
    sprite: "extractor",
    blurb: "Built on a mineral patch. Steady income — pays for itself in ~50s.",
    quip: "Chews rock, spits money.",
    onCrystal: true,           // may ONLY be placed on a crystal tile
    incomeAmount: 5,
    incomePeriod: 4,           // +5 minerals every 4s at level 1
    upgradeable: true,
    incomePerLevel: 3,         // +3 per level, so L3 pays 11 per period
  },

  gun: {
    name: "GUN TURRET",
    kind: "turret",
    cost: 50,
    hotkey: "3",
    sprite: "gun",
    blurb: "Cheap, fast, single target. Hits air. Struggles against armour.",
    quip: "Cheap, loud, and everywhere. The backbone.",
    damage: 5,
    fireRate: 0.42,            // seconds between shots
    range: 3.2,
    hitsAir: true,
    projectile: "bullet",
    barrel: { len: 7, w: 2, twin: true, color: 3 },
    upgradeable: true,
  },

  cannon: {
    name: "SIEGE CANNON",
    kind: "turret",
    cost: 90,
    hotkey: "4",
    sprite: "cannon",
    blurb: "Slow shells, splash damage, ignores armour well. GROUND ONLY.",
    quip: "Point it at the ground, never at the sky.",
    damage: 22,
    fireRate: 1.7,
    range: 4.0,
    hitsAir: false,
    splash: 1.3,
    armorPierce: 3,            // subtracted from the target's armour
    projectile: "shell",
    barrel: { len: 9, w: 4, twin: false, color: 2 },
    upgradeable: true,
  },

  frost: {
    name: "CRYO EMITTER",
    kind: "turret",
    cost: 70,
    hotkey: "5",
    sprite: "frost",
    blurb: "Chills everything it hits — 45% slower. Barely scratches them.",
    quip: "Nothing dies to it. Everything dies because of it.",
    damage: 3,
    fireRate: 0.9,
    range: 3.0,
    hitsAir: true,
    slow: 0.45,
    slowDuration: 1.6,
    projectile: "frost",
    barrel: { len: 5, w: 3, twin: false, color: "T" },
    upgradeable: true,
  },

  tesla: {
    name: "TESLA COIL",
    kind: "turret",
    cost: 120,
    hotkey: "6",
    sprite: "tesla",
    blurb: "Lightning arcs to 3 targets. Great on packs, needs the pack.",
    quip: "Worth every mineral the moment they bunch up.",
    damage: 10,
    fireRate: 1.15,
    range: 3.0,
    hitsAir: true,
    chain: 3,
    chainFalloff: 0.65,        // each hop does 65% of the previous hop
    projectile: "lightning",
    barrel: null,              // coil doesn't rotate, it just arcs
    upgradeable: true,
  },

  barracks: {
    name: "BARRACKS",
    kind: "spawner",
    cost: 100,
    hotkey: "7",
    sprite: "barracks",
    blurb: "Trains 3 marines that block the road. They respawn when killed.",
    quip: "Three men who would rather be anywhere else.",
    unitCount: 3,
    unitRespawn: 7,
    unit: { hp: 34, damage: 4, fireRate: 0.7, range: 1.9, speed: 2.4 },
    hpPerLevel: 14,
    upgradeable: true,
  },
};

// Order shown in the build bar.
const BUILD_ORDER = ["reactor", "extractor", "gun", "cannon", "frost", "tesla", "barracks"];

// ---------------------------------------------------------------------
// Enemies
//
// `hqDamage` is how much of the HQ's 20 HP a leak costs, so a single brute
// getting through hurts far more than a stray runner.
// ---------------------------------------------------------------------
const CREEPS = {
  grunt: {
    name: "GRUNT", sprite: "grunt",
    hp: 24, speed: 1.7, armor: 0, bounty: 3, hqDamage: 1,
    melee: { damage: 6, rate: 1.0, range: 0.9 },
  },
  runner: {
    name: "RUNNER", sprite: "runner",
    hp: 14, speed: 3.3, armor: 0, bounty: 2, hqDamage: 1,
    melee: { damage: 3, rate: 0.8, range: 0.9 },
  },
  brute: {
    name: "BRUTE", sprite: "brute",
    hp: 95, speed: 1.05, armor: 4, bounty: 9, hqDamage: 3,
    melee: { damage: 14, rate: 1.3, range: 1.0 },
  },
  flyer: {
    name: "WASP", sprite: "flyer",
    hp: 30, speed: 2.1, armor: 1, bounty: 4, hqDamage: 1,
    // Flying means: cuts every other corner off the road (so it arrives
    // sooner and from an awkward angle), can't be blocked by marines, and
    // can't be touched by siege cannons. It does NOT mean a straight line
    // to the HQ — that version made an air wave an unavoidable loss if your
    // guns happened to be on the wrong side of the map.
    flying: true,
    melee: null,
  },
  boss: {
    name: "WARLORD", sprite: "boss",
    hp: 950, speed: 0.9, armor: 8, bounty: 90, hqDamage: 8,
    big: true,
    melee: { damage: 22, rate: 1.4, range: 1.2 },
  },
};

// ---------------------------------------------------------------------
// Waves
//
// 20 waves, then the game is won. Each wave is a list of groups; a group
// sends `count` of one creep type every `gap` seconds, and groups start
// `at` seconds into the wave (so overlapping groups are just two groups
// with the same `at`).
//
// Health scales with a shared curve rather than per-wave numbers, so
// re-tuning difficulty is one line: hpScale().
// ---------------------------------------------------------------------
const WAVES = [
  { groups: [{ type: "grunt", count: 8, gap: 1.0 }] },
  { groups: [{ type: "grunt", count: 12, gap: 0.85 }] },
  { groups: [
      { type: "grunt", count: 8, gap: 0.9 },
      { type: "runner", count: 6, gap: 0.5, at: 5 },
  ] },
  { groups: [{ type: "runner", count: 16, gap: 0.45 }] },
  { groups: [
      { type: "grunt", count: 10, gap: 0.7 },
      { type: "brute", count: 4, gap: 2.2, at: 3 },
  ] },
  // First air wave. Deliberately mixed with grunts: it should teach you that
  // cannons can't shoot up, not end the run for finding out.
  { groups: [
      { type: "flyer", count: 8, gap: 0.9 },
      { type: "grunt", count: 6, gap: 0.8, at: 2 },
  ] },
  { groups: [
      { type: "grunt", count: 16, gap: 0.5 },
      { type: "brute", count: 6, gap: 2.0, at: 4 },
  ] },
  { groups: [
      { type: "runner", count: 14, gap: 0.4 },
      { type: "flyer", count: 8, gap: 0.9, at: 4 },
  ] },
  { groups: [{ type: "brute", count: 10, gap: 1.4 }] },
  { groups: [
      { type: "boss", count: 1, gap: 1 },
      { type: "grunt", count: 12, gap: 0.6, at: 3 },
  ], boss: true },
  { groups: [
      { type: "grunt", count: 20, gap: 0.45 },
      { type: "runner", count: 10, gap: 0.4, at: 6 },
  ] },
  { groups: [{ type: "flyer", count: 16, gap: 0.55 }] },
  { groups: [
      { type: "brute", count: 12, gap: 1.2 },
      { type: "runner", count: 12, gap: 0.4, at: 5 },
  ] },
  { groups: [{ type: "grunt", count: 26, gap: 0.35 }] },
  { groups: [
      { type: "brute", count: 10, gap: 1.3 },
      { type: "flyer", count: 12, gap: 0.7, at: 4 },
  ] },
  { groups: [
      { type: "runner", count: 18, gap: 0.35 },
      { type: "brute", count: 10, gap: 1.3, at: 4 },
  ] },
  { groups: [{ type: "flyer", count: 22, gap: 0.45 }] },
  { groups: [
      { type: "brute", count: 14, gap: 1.1 },
      { type: "grunt", count: 20, gap: 0.4, at: 3 },
  ] },
  { groups: [
      { type: "brute", count: 16, gap: 1.0 },
      { type: "flyer", count: 16, gap: 0.55, at: 4 },
  ] },
  { groups: [
      { type: "boss", count: 2, gap: 6 },
      { type: "brute", count: 12, gap: 1.2, at: 5 },
      { type: "grunt", count: 20, gap: 0.4, at: 8 },
  ], boss: true },
];

// Every wave gets a name. It costs nothing and turns "wave 14" into a thing
// that happened to you — the names are ordered to track the difficulty curve,
// so reading the list tells you roughly how the run goes.
const WAVE_NAMES = [
  "FIRST PROBE",
  "SCOUTING PARTY",
  "RABBLE AND RUNNERS",
  "FAST AND LOUD",
  "HEAVY ESCORT",
  "WINGS OVER THE PASS",
  "THE PUSH",
  "SKIRMISH LINE",
  "ARMOURED COLUMN",
  "WARLORD KRUUG",
  "THE TIDE",
  "BLACK SWARM",
  "HAMMER AND NAILS",
  "RATS IN THE WALLS",
  "IRON AND WING",
  "OVERRUN",
  "SKY BURIAL",
  "THE LONG MARCH",
  "EVERYTHING THEY HAVE",
  "KRUUG AND VOSK",
];

// ---------------------------------------------------------------------
// Flavour text
//
// COMMS is the voice of whoever is sitting in the Command Center watching
// you work: laconic, unimpressed, occasionally worried. Each event has
// several variants so a long run doesn't loop, and `{tokens}` are filled in
// by comms() in game.js.
//
// Rule for writing these: say something the player doesn't already know from
// the HUD, or say it with a shrug. "Reactor online" is wallpaper; "Power's
// up. Build in the light." teaches the power rule again for free.
// ---------------------------------------------------------------------
const COMMS = {
  start: [
    "Ironrun Pass. Third winter. You know the job.",
    "Grid's cold and the road's clear. Won't last.",
  ],
  reactor: [
    "Reactor online. Build in the light.",
    "Grid extended. That's {n} reactors humming.",
    "Power's up. Next one costs more, mind.",
  ],
  extractor: [
    "Drill's biting. Ore inbound.",
    "Extractor seated on the patch. It pays for itself in a minute.",
  ],
  turret: [
    "{name} emplaced.",
    "{name} online. Firing arc looks clear.",
    "Gun crew reports {name} ready.",
  ],
  barracks: [
    "Barracks up. Three marines, no volunteers.",
    "Marines heading for the road. Right-click to move them.",
  ],
  upgrade: [
    "{name} retrofitted. Level {lv}.",
    "Upgrade complete — {name} hits harder now.",
  ],
  sell: [
    "{name} stripped. Salvage +{n}.",
    "Scrapped the {name}. Got {n} back for it.",
  ],
  // {s} is a plural suffix filled in by the caller — "1 building" reads badly
  // enough to be worth the extra token.
  powerLost: [
    "Grid dropped — {n} building{s} went dark. They won't fire like that.",
    "We just lost power to {n} emplacement{s}. Fix it.",
  ],
  wave: [
    "Wave {w} inbound: {title}.",
    "Contact. {title}.",
    "{title}. Here they come.",
  ],
  waveAir: [
    "Air contacts — they cut the corners. Cannons can't help you.",
    "Wings on the scope. Get something that shoots up.",
  ],
  waveBoss: [
    "Something big just came through the gate.",
    "Warlord on the road. Everything you've got.",
  ],
  cleared: [
    "Pass is clear. Salvage +{n}.",
    "Wave broken. +{n} off the field.",
    "Quiet again. Spend it before the next one.",
  ],
  leak: [
    "They're on the walls! Command Center at {hp}.",
    "One got through. HQ integrity {hp}.",
  ],
  low: [
    "HQ won't take much more of that.",
    "Structural failure imminent. Hold the line.",
  ],
  marineDown: [
    "Marine down.",
    "We lost one on the road.",
    "Man down. Replacement's training.",
  ],
  kills: [
    "{n} confirmed kills.",
    "That's {n} of them in the dirt.",
  ],
  earlyCall: [
    "Calling them in early. Bold. +{n}.",
    "Early call — {n} minerals says you're ready.",
  ],
  win: ["Pass held. Go home."],
  lose: ["Command Center is gone. Fall back."],
};

// ---------------------------------------------------------------------
// Run modifiers
//
// Each one is a small bundle of multipliers the simulation reads at the
// point of use, so a modifier is data rather than a special case in the
// engine. Two are rolled for the Daily Challenge; the rest of the time
// every multiplier is 1.
//
// Design rule: a modifier must change what you BUILD, not just how big the
// numbers are. "Enemies have more HP" is a difficulty slider; "reactors cost
// double, so you defend one choke instead of three" is a different game.
// ---------------------------------------------------------------------
const MODIFIERS = [
  {
    id: "glass", name: "GLASS CANNON",
    blurb: "HQ has 10 HP. Turrets hit 40% harder.",
    hqHp: 0.5, turretDamage: 1.4,
  },
  {
    id: "ironrain", name: "IRON RAIN",
    blurb: "Everything out there has 25% more HP — and is worth 30% more.",
    enemyHp: 1.25, bounty: 1.3,
  },
  {
    id: "shortfuse", name: "SHORT FUSE",
    blurb: "8 seconds between waves. Calling early pays double.",
    prepTime: 8, earlyBonus: 2,
  },
  {
    id: "gridstrain", name: "GRID STRAIN",
    blurb: "Each reactor costs 40 more than the last. Pick your ground.",
    reactorStep: 2,
  },
  {
    id: "leanseam", name: "LEAN SEAM",
    blurb: "Extractors yield 40% less. Clearing a wave pays 60% more.",
    income: 0.6, clearBonus: 1.6,
  },
  {
    id: "noreserves", name: "NO RESERVES",
    blurb: "No barracks. Nothing stands in the road but your guns.",
    banned: ["barracks"],
  },
  {
    id: "swarm", name: "SWARM",
    blurb: "They come 15% faster with 15% less HP. Splash earns its keep.",
    enemySpeed: 1.15, enemyHp: 0.85,
  },
  {
    id: "fog", name: "FOG OF WAR",
    blurb: "No range circles, no power overlay. Build by eye.",
    fog: true,
  },
];

// Enemy HP multiplier for a given wave number (1-based). Quadratic term so
// the back half of the run actually threatens a maxed-out base.
function hpScale(wave) {
  const w = wave - 1;
  return 1 + 0.15 * w + 0.011 * w * w;
}

// Bounties grow much more slowly than HP — that squeeze is what forces
// extractors early instead of coasting on kill income.
function bountyScale(wave) {
  return 1 + 0.05 * (wave - 1);
}
