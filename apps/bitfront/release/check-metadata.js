// =====================================================================
// BITFRONT — release/check-metadata.js
//
// Checks the two things that have actually failed an upload before, rather
// than everything that could theoretically be wrong:
//
//   1. Store text that is over a hard length limit. `deliver` rejects the
//      whole submission for one character over on subtitle or keywords,
//      and the error does not say which field.
//   2. An alpha channel in the App Store icon. Apple refuses the upload,
//      and the submit job then sits there for hours before saying so.
//
// The strings here are the source of truth for STORE.md — change them
// here, re-run, then paste.
//
//   node release/check-metadata.js
// =====================================================================

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

// --- the metadata itself -------------------------------------------------

const FIELDS = [
  { field: "App Store name", limit: 30, value: "Bitfront" },
  { field: "App Store subtitle", limit: 30, value: "Hold the pass, pixel by pixel" },
  {
    field: "App Store keywords", limit: 100,
    value: "tower defense,RTS,strategy,pixel art,base building,turrets,daily,offline,retro,waves",
  },
  {
    field: "Promotional text", limit: 170,
    value: "Twenty waves. One road. Build a power grid, mine the seams, and put " +
           "something in the way before the horn goes. New seeded challenge every day.",
  },
  { field: "Play title", limit: 30, value: "Bitfront" },
  {
    field: "Play short description", limit: 80,
    value: "A pixel-art RTS tower defence. Hold the pass for twenty waves.",
  },
];

let failures = 0;

console.log("Store text");
for (const { field, limit, value } of FIELDS) {
  const n = value.length;
  const ok = n <= limit;
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${String(n).padStart(3)}/${limit}  ${field}`);
  if (!ok) console.log(`      ${n - limit} character(s) too long: "${value}"`);
}

// Keywords have a second trap: App Store Connect counts the commas, and a
// space after a comma is a wasted character rather than a separator.
const keywords = FIELDS.find((f) => f.field === "App Store keywords").value;
if (/,\s/.test(keywords)) {
  failures++;
  console.log("  ✗ keywords contain a space after a comma — those count toward the 100");
}

// --- icons ---------------------------------------------------------------

// PNG colour type lives at byte 25 of the IHDR chunk. 4 and 6 carry alpha,
// which is what Apple rejects.
function pngInfo(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

const ICONS = [
  { file: "AppStoreIcon-1024.png", size: 1024, alphaAllowed: false },
  { file: "icon-512.png", size: 512, alphaAllowed: true },
  { file: "icon-192.png", size: 192, alphaAllowed: true },
];

console.log("\nIcons");
for (const { file, size, alphaAllowed } of ICONS) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    failures++;
    console.log(`  ✗ ${file} is missing`);
    continue;
  }
  const { width, height, colorType } = pngInfo(full);
  const hasAlpha = colorType === 4 || colorType === 6;
  const problems = [];
  if (width !== size || height !== size) problems.push(`is ${width}x${height}, expected ${size}x${size}`);
  if (hasAlpha && !alphaAllowed) problems.push("has an alpha channel — Apple will refuse the upload");

  if (problems.length) {
    failures++;
    console.log(`  ✗ ${file}: ${problems.join("; ")}`);
  } else {
    console.log(`  ✓ ${file} ${width}x${height}, ${hasAlpha ? "alpha" : "no alpha"}`);
  }
}

// --- required pages ------------------------------------------------------

console.log("\nRequired pages");
for (const page of ["privacy.html", "support.html"]) {
  const full = path.join(__dirname, page);
  if (fs.existsSync(full)) {
    console.log(`  ✓ ${page}`);
  } else {
    failures++;
    console.log(`  ✗ ${page} is missing — both stores require a privacy policy URL`);
  }
}

console.log(failures ? `\nFAILED — ${failures} problem(s)` : "\nMetadata ready to paste.");
process.exit(failures ? 1 : 0);
