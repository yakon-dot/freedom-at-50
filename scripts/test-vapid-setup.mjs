/**
 * Tests for Freedom VAPID local setup helper (no Cloudflare network, no key printing).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const setupPath = path.resolve("cloudflare/freedom-reminders/scripts/setup-vapid-secrets.mjs");
const setupSource = fs.readFileSync(setupPath, "utf8");

/* No private key material committed — not even for blocklists/comparisons. */
assert.equal(/e0Ci5B63Nz8WjPpx180BFVlULOYlmK9rAzdcbOaaoaw/.test(setupSource), false);
assert.equal(/privateKey\s*===\s*["'][A-Za-z0-9_-]{20,}["']/.test(setupSource), false);
assert.match(setupSource, /Upload the existing keys to Cloudflare now/);
assert.match(setupSource, /wrangler", "login"/);
assert.match(setupSource, /Does NOT deploy|will NOT deploy/i);
assert.match(setupSource, /Run this setup again to retry/);
console.log("PASS: setup script has resume + login flow and no private key literals");

const mod = await import(pathToFileURL(setupPath).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "freedom-vapid-"));
process.env.FREEDOM_VAPID_DIR = tmp;
const paths = mod.storePaths(tmp);

const keys = mod.generateKeys();
assert.ok(keys.publicKey && keys.privateKey);
const store = mod.writeLocalStore(
  {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: "mailto:test@example.com",
    adminToken: "test-admin-token"
  },
  paths
);
assert.equal(fs.existsSync(paths.storeFile), true);
assert.equal(fs.existsSync(paths.publicFile), true);
assert.equal(fs.statSync(paths.storeFile).mode & 0o777, 0o600);

const loaded = mod.loadLocalStore(paths.storeFile);
assert.equal(loaded.publicKey, store.publicKey);
assert.equal(loaded.privateKey, store.privateKey);

const marked = mod.markUploaded(loaded, paths);
assert.ok(marked.uploadedAt);
assert.equal(mod.loadLocalStore(paths.storeFile).uploadedAt, marked.uploadedAt);
console.log("PASS: local store write/load/resume metadata");

function scriptedPrompter(answers) {
  const queue = [...answers];
  const log = [];
  return {
    interactive: false,
    log,
    async ask(question) {
      log.push(question);
      if (!queue.length) throw new Error(`No scripted answer for: ${question}`);
      return queue.shift();
    },
    async close() {}
  };
}

/* Resume: decline upload, decline regenerate → keep same keys */
const before = fs.readFileSync(paths.storeFile, "utf8");
const resumePrompter = scriptedPrompter(["n", "n"]);
const resumeResult = await mod.runSetup({ prompter: resumePrompter, paths });
assert.equal(resumeResult.action, "kept-existing");
assert.match(resumePrompter.log[0], /Upload the existing keys to Cloudflare now/);
assert.equal(fs.readFileSync(paths.storeFile, "utf8"), before);
console.log("PASS: resume keeps existing keys without regenerating");

/* First run in fresh dir: create keys, skip upload */
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "freedom-vapid-new-"));
const paths2 = mod.storePaths(tmp2);
const createPrompter = scriptedPrompter(["test@example.com", "n"]);
let stdout = "";
const origLog = console.log;
console.log = (...args) => {
  stdout += args.join(" ") + "\n";
  origLog(...args);
};
try {
  const createdResult = await mod.runSetup({ prompter: createPrompter, paths: paths2 });
  assert.equal(createdResult.action, "created");
} finally {
  console.log = origLog;
}
assert.match(stdout, /Generating a new VAPID key pair/);
assert.match(stdout, /Skipped Cloudflare upload|remain saved on this Mac/);
assert.equal(stdout.includes("privateKey"), false);
const created = JSON.parse(fs.readFileSync(paths2.storeFile, "utf8"));
assert.ok(created.publicKey && created.privateKey);
assert.match(created.subject, /mailto:test@example.com/);
assert.equal(stdout.includes(created.privateKey), false);

/* Second run: offer upload of existing keys; decline both → same key material */
const secondPrompter = scriptedPrompter(["n", "n"]);
stdout = "";
console.log = (...args) => {
  stdout += args.join(" ") + "\n";
  origLog(...args);
};
try {
  const secondResult = await mod.runSetup({ prompter: secondPrompter, paths: paths2 });
  assert.equal(secondResult.action, "kept-existing");
} finally {
  console.log = origLog;
}
assert.match(secondPrompter.log[0], /Upload the existing keys to Cloudflare now/);
assert.match(stdout, /Existing local keys were kept/);
const still = JSON.parse(fs.readFileSync(paths2.storeFile, "utf8"));
assert.equal(still.publicKey, created.publicKey);
assert.equal(still.privateKey, created.privateKey);
assert.equal(stdout.includes(created.privateKey), false);
console.log("PASS: second run offers upload of existing keys without regenerating");

assert.match(setupSource, /Your keys are still saved on this Mac/);
assert.match(setupSource, /without generating a new key pair/);
console.log("PASS: failed-upload retry copy present in setup script");

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(tmp2, { recursive: true, force: true });
console.log("PASS: all vapid setup checks");
