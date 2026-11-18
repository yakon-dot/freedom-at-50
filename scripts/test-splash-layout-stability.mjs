/**
 * Splash logo layout stability contracts for native iOS / safe-area races.
 * Does not change approved animation timing — only asserts settle-before-measure.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8"));
const docs = fs.readFileSync(path.join(root, "native/CAPACITOR-IOS.md"), "utf8");

assert.equal(config.ios.contentInset, "never", "Use edge-to-edge WebView; CSS env() owns safe areas");
assert.match(index, /viewport-fit=cover/);
assert.match(
  index,
  /#freedomSplash\{[^}]*padding:env\(safe-area-inset-top,0px\)/
);
assert.match(index, /whenSplashLayoutReady/);
assert.match(index, /splashLayoutSignature/);
assert.match(index, /function logoTargetPoints/);
assert.match(index, /getBoundingClientRect\(\)/);
/* Animation timing must stay approved — settle happens before play(), not by shortening motion. */
assert.match(index, /ASSEMBLY_MS=1760/);
assert.match(index, /RESOLVE_START_MS=1390/);
assert.match(index, /RESOLVE_END_MS=1740/);
assert.match(index, /whenSplashLayoutReady\(function\(\)\{[\s\S]*?requestAnimationFrame\(play\)/);
assert.match(docs, /contentInset.*never/i);
assert.match(docs, /loading logo|splash/i);

console.log("PASS: splash layout settles before logo measure; Capacitor contentInset is never");
