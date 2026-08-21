// =====================================================================
// BITFRONT — sync-www.js
//
// Capacitor wants one folder that is exactly the app. The game's source
// sits at the root of this folder next to the README, the design docs and
// the dev scripts, and none of those belong in a shipped binary — so this
// copies the shell into www/ and nothing else.
//
//   node sync-www.js          rebuild www/
//   npm run sync              rebuild www/, then npx cap sync
//
// SHELL is the same list as `SHELL` in sw.js and the same list as the zip
// command in release/ITCH.md. Add a file to the game and it has to go in
// all three, or it will be missing in exactly one place: offline, on
// device, or on itch.
// =====================================================================

const fs = require("fs");
const path = require("path");

const SHELL = [
  "index.html",
  "styles.css",
  "sprites.js",
  "data.js",
  "game.js",
  "manifest.json",
  "sw.js",
  "icon-192.png",
  "icon-512.png",
];

const out = path.join(__dirname, "www");

// Start clean, or a file deleted from SHELL lingers in the build forever.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let bytes = 0;
for (const file of SHELL) {
  const from = path.join(__dirname, file);
  if (!fs.existsSync(from)) {
    console.error(`✗ ${file} is in SHELL but not on disk`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(out, file));
  bytes += fs.statSync(from).size;
}

// The service worker is a browser convenience. Inside a Capacitor shell the
// files are already local, and a stale cache is a support ticket, so leave
// the registration out of the native build.
const indexPath = path.join(out, "index.html");
const html = fs.readFileSync(indexPath, "utf8");
const stripped = html.replace(
  /if \("serviceWorker" in navigator[\s\S]*?\n}/,
  "/* service worker intentionally not registered in the native build */"
);
if (stripped === html) {
  console.warn("⚠ could not find the service worker registration to strip — check index.html");
} else {
  fs.writeFileSync(indexPath, stripped);
}

console.log(`www/ ← ${SHELL.length} files, ${(bytes / 1024).toFixed(1)} KB`);
