#!/usr/bin/env node
/**
 * Freedom reminders — local VAPID secret setup (Mac-friendly).
 *
 * - Generates a brand-new random VAPID key pair when needed.
 * - Never prints the private key.
 * - Saves secrets only on this Mac (outside the git repo).
 * - Safely resumable: re-run uploads existing local keys without regenerating.
 * - Opens browser login when Wrangler is not authenticated.
 * - Does NOT deploy Worker code and does NOT change KV bindings.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = path.resolve(__dirname, "..");
const WORKER_NAME = "freedom-reminders";

export function resolveStoreDir() {
  if (process.env.FREEDOM_VAPID_DIR) return path.resolve(process.env.FREEDOM_VAPID_DIR);
  return path.join(os.homedir(), "Library", "Application Support", "Freedom at 50");
}

export function storePaths(storeDir = resolveStoreDir()) {
  return {
    storeDir,
    storeFile: path.join(storeDir, "vapid-secrets.json"),
    publicFile: path.join(storeDir, "vapid-public-key.txt")
  };
}

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function say(msg) {
  console.log(msg);
}

function run(cmd, args, opts = {}) {
  const capture = !!opts.capture;
  let stdio = "inherit";
  if (opts.input != null) {
    stdio = ["pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"];
  } else if (capture) {
    stdio = ["ignore", "pipe", "pipe"];
  }
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || WORKER_DIR,
    encoding: "utf8",
    stdio,
    input: opts.input,
    env: process.env
  });
  if (opts.allowFail) return result;
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    die(err || `${cmd} ${args.join(" ")} failed`);
  }
  return result;
}

function ensureNodeModules() {
  const pkg = path.join(WORKER_DIR, "node_modules", "web-push");
  if (fs.existsSync(pkg)) return;
  say("Installing a small helper package (one-time)…");
  run("npm", ["install"], { cwd: WORKER_DIR });
}

export function generateKeys() {
  ensureNodeModules();
  const require = createRequire(path.join(WORKER_DIR, "package.json"));
  let webpush;
  try {
    webpush = require("web-push");
  } catch (e) {
    die("Could not load web-push. Run npm install inside cloudflare/freedom-reminders first.");
  }
  const keys = webpush.generateVAPIDKeys();
  if (!keys?.publicKey || !keys?.privateKey) die("Key generation failed.");
  return keys;
}

export function loadLocalStore(storeFile = storePaths().storeFile) {
  if (!fs.existsSync(storeFile)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    if (!parsed?.publicKey || !parsed?.privateKey) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

export function writeLocalStore({ publicKey, privateKey, subject, adminToken }, paths = storePaths()) {
  fs.mkdirSync(paths.storeDir, { recursive: true, mode: 0o700 });
  const payload = {
    createdAt: new Date().toISOString(),
    worker: WORKER_NAME,
    subject,
    adminToken,
    publicKey,
    privateKey,
    note: "Private key for Cloudflare secret VAPID_PRIVATE_KEY only. Never commit or paste into chat."
  };
  fs.writeFileSync(paths.storeFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(paths.storeFile, 0o600);
  fs.writeFileSync(paths.publicFile, `${publicKey}\n`, { mode: 0o600 });
  fs.chmodSync(paths.publicFile, 0o600);
  return payload;
}

export function markUploaded(store, paths = storePaths()) {
  const next = {
    ...store,
    uploadedAt: new Date().toISOString()
  };
  fs.writeFileSync(paths.storeFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.chmodSync(paths.storeFile, 0o600);
  return next;
}

function putSecret(name, value) {
  say(`Uploading secret ${name}…`);
  /* stdin only — value is not placed on argv */
  const result = run("npx", ["wrangler", "secret", "put", name], {
    input: value,
    allowFail: true,
    capture: true
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(err || `Failed to upload secret ${name}`);
  }
}

export function isWranglerAuthenticated() {
  const result = spawnSync("npx", ["wrangler", "whoami"], {
    cwd: WORKER_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  return result.status === 0;
}

function ensureWranglerAuth() {
  if (isWranglerAuthenticated()) {
    say("Cloudflare account: already signed in.");
    run("npx", ["wrangler", "whoami"]);
    return;
  }
  say("");
  say("Not signed in to Cloudflare. Opening a browser window to log in…");
  say("Approve access in the browser, then return here.");
  run("npx", ["wrangler", "login"]);
  if (!isWranglerAuthenticated()) {
    throw new Error("Cloudflare login did not complete. Run this setup again when ready.");
  }
  run("npx", ["wrangler", "whoami"]);
}

async function uploadSecrets(store) {
  ensureWranglerAuth();
  putSecret("VAPID_PUBLIC_KEY", store.publicKey);
  putSecret("VAPID_PRIVATE_KEY", store.privateKey);
  putSecret("VAPID_SUBJECT", store.subject || "mailto:freedom-at-50-notifications@example.com");
  putSecret("ADMIN_TOKEN", store.adminToken || crypto.randomBytes(24).toString("base64url"));
}

function yes(answer, defaultYes = false) {
  if (answer === "" || answer == null) return defaultYes;
  const v = String(answer).trim().toLowerCase();
  return v === "y" || v === "yes";
}

/** Default Y only in an interactive Terminal; piped/automated runs must answer explicitly. */
export function defaultYesForPrompt(stdin = process.stdin) {
  return stdin.isTTY === true;
}

/**
 * Interactive Terminal uses readline. Piped input reads all lines up front so
 * multi-step prompts work reliably in tests and automation.
 */
export function createPrompter({ stdin = process.stdin, stdout = process.stdout, lines } = {}) {
  const interactive = stdin.isTTY === true && lines == null;
  if (!interactive) {
    const queue = Array.isArray(lines)
      ? [...lines]
      : fs.readFileSync(0, "utf8").split(/\r?\n/);
    return {
      interactive: false,
      async ask(question, { raw = false } = {}) {
        stdout.write(question);
        const line = queue.length ? queue.shift() : "";
        stdout.write(`${line}\n`);
        return raw ? line.trim() : line.trim().toLowerCase();
      },
      async close() {}
    };
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  return {
    interactive: true,
    async ask(question, { raw = false } = {}) {
      const line = await rl.question(question);
      return raw ? line.trim() : line.trim().toLowerCase();
    },
    async close() {
      rl.close();
    }
  };
}

async function promptSubject(prompter, existing) {
  if (existing) return existing;
  let subject = await prompter.ask(
    "Contact email for VAPID (or press Return for a placeholder): ",
    { raw: true }
  );
  if (!subject) subject = "mailto:freedom-at-50-notifications@example.com";
  if (!subject.startsWith("mailto:")) subject = `mailto:${subject}`;
  return subject;
}

async function createNewLocalKeys(prompter, paths) {
  const subject = await promptSubject(prompter);
  say("Generating a new VAPID key pair…");
  const { publicKey, privateKey } = generateKeys();
  const adminToken = crypto.randomBytes(24).toString("base64url");
  const store = writeLocalStore({ publicKey, privateKey, subject, adminToken }, paths);
  say("");
  say("Saved on this Mac only (private key not shown):");
  say(`  ${paths.storeFile}`);
  say("Public key also copied to:");
  say(`  ${paths.publicFile}`);
  return store;
}

async function maybeUpload(prompter, store, paths) {
  const uploadQ = defaultYesForPrompt()
    ? "Upload these secrets to Cloudflare Worker “freedom-reminders” now? (Y/n): "
    : "Upload these secrets to Cloudflare Worker “freedom-reminders” now? (y/N): ";
  const upload = await prompter.ask(uploadQ);
  if (!yes(upload, defaultYesForPrompt())) {
    say("");
    say("Skipped Cloudflare upload. Your keys remain saved on this Mac.");
    say("Run this setup again anytime to upload the same keys (no need to regenerate).");
    say("Do not paste the private key into chat, email, or GitHub.");
    return false;
  }
  try {
    say("");
    await uploadSecrets(store);
    markUploaded(store, paths);
    say("");
    say("✓ Secrets uploaded to freedom-reminders.");
    say("✓ KV binding and Worker code were not changed.");
    say("✓ No deploy was run.");
    say("");
    say("Next (later): put the public key from vapid-public-key.txt into freedom-push-config.js,");
    say("then approve a Worker deploy separately.");
    return true;
  } catch (err) {
    say("");
    say(`✗ Upload did not finish: ${err.message || err}`);
    say("Your keys are still saved on this Mac. Run this setup again to retry the upload");
    say("without generating a new key pair.");
    return false;
  }
}

export async function runSetup({ prompter, paths = storePaths() } = {}) {
  say("");
  say("Freedom reminder keys — local setup");
  say("-----------------------------------");
  say(`Worker: ${WORKER_NAME}`);
  say("This will NOT deploy code and will NOT change your KV binding.");
  say("");

  if (!fs.existsSync(path.join(WORKER_DIR, "wrangler.toml"))) {
    die("wrangler.toml not found. Run this from the Freedom project (scripts folder intact).");
  }

  const ownedPrompter = !prompter;
  const p = prompter || createPrompter();
  try {
    let store = loadLocalStore(paths.storeFile);

    if (store) {
      say("Keys already exist on this Mac (private key not shown).");
      say(`  ${paths.storeFile}`);
      if (store.uploadedAt) say(`Last successful Cloudflare upload: ${store.uploadedAt}`);
      say("");
      const uploadExistingQ = defaultYesForPrompt()
        ? "Upload the existing keys to Cloudflare now? (Y/n): "
        : "Upload the existing keys to Cloudflare now? (y/N): ";
      const uploadExisting = await p.ask(uploadExistingQ);
      if (yes(uploadExisting, defaultYesForPrompt())) {
        try {
          say("");
          await uploadSecrets(store);
          markUploaded(store, paths);
          say("");
          say("✓ Secrets uploaded to freedom-reminders.");
          say("✓ KV binding and Worker code were not changed.");
          say("✓ No deploy was run.");
          return { action: "uploaded-existing" };
        } catch (err) {
          say("");
          say(`✗ Upload did not finish: ${err.message || err}`);
          say("Your existing keys are unchanged on this Mac. Run this setup again to retry.");
        }
      } else {
        say("Skipped upload. Existing local keys were kept.");
      }

      const regen = await p.ask("Generate a completely new key pair instead? (y/N): ");
      if (!yes(regen, false)) {
        say("No changes made. Existing local keys were kept.");
        return { action: "kept-existing" };
      }
      store = await createNewLocalKeys(p, paths);
      say("");
      await maybeUpload(p, store, paths);
      return { action: "regenerated" };
    }

    store = await createNewLocalKeys(p, paths);
    say("");
    await maybeUpload(p, store, paths);
    return { action: "created" };
  } finally {
    if (ownedPrompter) await p.close();
  }
}

async function main() {
  await runSetup();
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(err => {
    die(err?.message || String(err));
  });
}
