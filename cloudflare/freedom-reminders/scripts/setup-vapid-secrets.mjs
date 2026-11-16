#!/usr/bin/env node
/**
 * Freedom reminders — local VAPID secret setup (Mac-friendly).
 *
 * - Generates a brand-new VAPID key pair (never reuses old keys).
 * - Never prints the private key.
 * - Saves secrets only on this Mac (outside the git repo).
 * - Optionally uploads secrets to the existing Worker via Wrangler.
 * - Does NOT deploy Worker code and does NOT change KV bindings.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = path.resolve(__dirname, "..");
const WORKER_NAME = "freedom-reminders";
const STORE_DIR = path.join(os.homedir(), "Library", "Application Support", "Freedom at 50");
const STORE_FILE = path.join(STORE_DIR, "vapid-secrets.json");
const PUBLIC_ONLY_FILE = path.join(STORE_DIR, "vapid-public-key.txt");

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function say(msg) {
  console.log(msg);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || WORKER_DIR,
    encoding: "utf8",
    stdio: opts.input != null ? ["pipe", "pipe", "pipe"] : "inherit",
    input: opts.input,
    env: process.env
  });
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

async function generateKeys() {
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
  /* Hard safety: never accept the historically exposed private key material. */
  if (keys.privateKey === "e0Ci5B63Nz8WjPpx180BFVlULOYlmK9rAzdcbOaaoaw") {
    die("Generated key collided with a blocked value — re-run the script.");
  }
  return keys;
}

function writeLocalStore({ publicKey, privateKey, subject, adminToken }) {
  fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  const payload = {
    createdAt: new Date().toISOString(),
    worker: WORKER_NAME,
    subject,
    adminToken,
    publicKey,
    privateKey,
    note: "Private key for Cloudflare secret VAPID_PRIVATE_KEY only. Never commit or paste into chat."
  };
  fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(STORE_FILE, 0o600);
  fs.writeFileSync(PUBLIC_ONLY_FILE, `${publicKey}\n`, { mode: 0o600 });
  fs.chmodSync(PUBLIC_ONLY_FILE, 0o600);
}

function putSecret(name, value) {
  say(`Uploading secret ${name}…`);
  /* stdin only — value is not placed on argv */
  run("npx", ["wrangler", "secret", "put", name], { input: value });
}

async function ask(rl, question) {
  const answer = (await rl.question(question)).trim().toLowerCase();
  return answer;
}

async function main() {
  say("");
  say("Freedom reminder keys — local setup");
  say("-----------------------------------");
  say(`Worker: ${WORKER_NAME}`);
  say("This will NOT deploy code and will NOT change your KV binding.");
  say("");

  if (!fs.existsSync(path.join(WORKER_DIR, "wrangler.toml"))) {
    die("wrangler.toml not found. Run this from the Freedom project (scripts folder intact).");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (fs.existsSync(STORE_FILE)) {
      const reuse = await ask(
        rl,
        "Keys already exist on this Mac. Generate a completely new pair? (y/N): "
      );
      if (reuse !== "y" && reuse !== "yes") {
        say("Kept existing local keys. Nothing was uploaded.");
        say(`Public key file: ${PUBLIC_ONLY_FILE}`);
        return;
      }
    }

    let subject = (await rl.question(
      "Contact email for VAPID (or press Return for a placeholder): "
    )).trim();
    if (!subject) subject = "mailto:freedom-at-50-notifications@example.com";
    if (!subject.startsWith("mailto:")) subject = `mailto:${subject}`;

    say("Generating a new VAPID key pair…");
    const { publicKey, privateKey } = await generateKeys();
    const adminToken = crypto.randomBytes(24).toString("base64url");
    writeLocalStore({ publicKey, privateKey, subject, adminToken });

    say("");
    say("Saved on this Mac only (private key not shown):");
    say(`  ${STORE_FILE}`);
    say(`Public key also copied to:`);
    say(`  ${PUBLIC_ONLY_FILE}`);
    say("");

    const upload = await ask(
      rl,
      "Upload these secrets to Cloudflare Worker “freedom-reminders” now? (y/N): "
    );
    if (upload !== "y" && upload !== "yes") {
      say("");
      say("Skipped Cloudflare upload. When you are ready, run this script again and choose Yes,");
      say("or paste the values from the local file into Cloudflare → Workers → freedom-reminders");
      say("→ Settings → Variables and Secrets (mark each as Encrypted).");
      say("");
      say("Do not paste the private key into chat, email, or GitHub.");
      return;
    }

    say("");
    say("If a browser window opens, sign in to Cloudflare and approve access.");
    run("npx", ["wrangler", "whoami"]);
    putSecret("VAPID_PUBLIC_KEY", publicKey);
    putSecret("VAPID_PRIVATE_KEY", privateKey);
    putSecret("VAPID_SUBJECT", subject);
    putSecret("ADMIN_TOKEN", adminToken);

    say("");
    say("✓ Secrets uploaded to freedom-reminders.");
    say("✓ KV binding and Worker code were not changed.");
    say("✓ No deploy was run.");
    say("");
    say("Next (later): put the public key from vapid-public-key.txt into freedom-push-config.js,");
    say("then approve a Worker deploy separately.");
  } finally {
    rl.close();
  }
}

main().catch(err => {
  die(err?.message || String(err));
});
