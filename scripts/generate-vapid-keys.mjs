#!/usr/bin/env node
/**
 * Prefer: cloudflare/freedom-reminders/Setup Reminder Keys.command
 * This helper only prints the public key. Private key is never printed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const workerDir = path.resolve("cloudflare/freedom-reminders");
const require = createRequire(path.join(workerDir, "package.json"));
const webpush = require("web-push");
const keys = webpush.generateVAPIDKeys();
const dir = path.join(os.homedir(), "Library", "Application Support", "Freedom at 50");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const store = path.join(dir, "vapid-secrets.json");
fs.writeFileSync(
  store,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      note: "Private key never print/commit/chat. Use Setup Reminder Keys.command to upload."
    },
    null,
    2
  ),
  { mode: 0o600 }
);
fs.chmodSync(store, 0o600);
fs.writeFileSync(path.join(dir, "vapid-public-key.txt"), `${keys.publicKey}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  publicKey: keys.publicKey,
  savedTo: store,
  note: "Private key written only to the local file above — not printed."
}, null, 2));
