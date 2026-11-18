/**
 * Copy Freedom's static PWA assets into www/ for Capacitor sync.
 * Root files stay the GitHub Pages / PWA source of truth — this folder is native-only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const www = path.join(root, "www");

const ROOT_FILES = [
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "freedom-push-config.js",
  "freedom-native-storage.js",
  "icon-192.png",
  "icon-512.png",
  "companion-select-wallpaper.jpg",
  "overview-wallpaper.png",
  "journey-wallpaper.png",
  "goals-wallpaper.png",
  "pension-wallpaper.png",
  "archive-wallpaper.png",
  "notes-wallpaper.jpg",
  "welcome-wallpaper.jpg",
  "sticky-note.png",
  "patricia-celebration.png",
  "patricia-eyes.png",
  "freedom-mobile-wallpaper.jpg"
];

function rmDirIfExists(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(rel) {
  const from = path.join(root, rel);
  const to = path.join(www, rel);
  assert.ok(fs.existsSync(from), `Missing required web asset: ${rel}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(rel) {
  const from = path.join(root, rel);
  assert.ok(fs.existsSync(from), `Missing required web directory: ${rel}`);
  fs.cpSync(from, path.join(www, rel), { recursive: true });
}

rmDirIfExists(www);
fs.mkdirSync(www, { recursive: true });

for (const file of ROOT_FILES) copyFile(file);
copyDir("assets");

// Marker so native debugging can confirm the staged bundle origin.
fs.writeFileSync(
  path.join(www, ".capacitor-web-source"),
  "Copied from Freedom static PWA root for Capacitor iOS. Do not edit; regenerate with npm run cap:prepare.\n",
  "utf8"
);

console.log(`Prepared Capacitor webDir at ${path.relative(root, www)} (${ROOT_FILES.length} root files + assets/)`);
