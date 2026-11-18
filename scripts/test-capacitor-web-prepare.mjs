/**
 * Verify Capacitor web staging copies the PWA shell without touching root deploy files.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const www = path.join(root, "www");

const prepare = spawnSync(process.execPath, ["scripts/prepare-capacitor-web.mjs"], {
  cwd: root,
  encoding: "utf8"
});
assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
assert.ok(fs.existsSync(path.join(www, "index.html")));
assert.ok(fs.existsSync(path.join(www, "service-worker.js")));
assert.ok(fs.existsSync(path.join(www, "manifest.webmanifest")));
assert.ok(fs.existsSync(path.join(www, "freedom-push-config.js")));
assert.ok(fs.existsSync(path.join(www, "freedom-native-storage.js")));
assert.ok(fs.existsSync(path.join(www, "freedom-native-notifications.js")));
assert.ok(fs.existsSync(path.join(www, "assets", "freedom-logo-horizontal.png")));

const wwwIndex = fs.readFileSync(path.join(www, "index.html"), "utf8");
const rootIndex = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.equal(wwwIndex, rootIndex, "www/index.html must match the PWA root index.html");

const config = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8"));
assert.equal(config.appName, "Freedom");
assert.equal(config.appId, "com.yakondot.freedom");
assert.equal(config.webDir, "www");

assert.equal(fs.existsSync(path.join(root, ".github", "workflows")), false);
assert.ok(fs.existsSync(path.join(root, "service-worker.js")), "PWA service worker must remain at repo root");

console.log("PASS: Capacitor www staging matches PWA root and config is locked");
