// Copies the actual app source files (root of this project) into www/,
// which is what capacitor.config.json points at as webDir. There's no
// build step for this app — this script exists only because Capacitor
// needs a dedicated asset folder, not the whole project root.

const fs = require("fs");
const path = require("path");

const FILES = ["index.html", "styles.css", "manifest.json", "sw.js", "icon-192.png", "icon-512.png"];

// www/ is gitignored (it's a generated copy, not source of truth), so a
// fresh clone/CI checkout won't have it yet — copyFileSync can't create
// the destination directory itself.
fs.mkdirSync(path.join(__dirname, "www"), { recursive: true });

for (const file of FILES) {
  fs.copyFileSync(path.join(__dirname, file), path.join(__dirname, "www", file));
}

console.log(`Synced ${FILES.length} files into www/`);
