// Copies the actual app source files (root of this project) into www/,
// which is what capacitor.config.json points at as webDir. There's no
// build step for this app — this script exists only because Capacitor
// needs a dedicated asset folder, not the whole project root (see the
// README's "Native app wrapping" section for why).

const fs = require("fs");
const path = require("path");

const FILES = ["index.html", "styles.css", "manifest.json", "sw.js", "icon-192.png", "icon-512.png"];

for (const file of FILES) {
  fs.copyFileSync(path.join(__dirname, file), path.join(__dirname, "www", file));
}

console.log(`Synced ${FILES.length} files into www/`);
