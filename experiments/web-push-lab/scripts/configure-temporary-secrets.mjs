import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import * as webpush from "web-push";

const vapid = webpush.generateVAPIDKeys();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const source = randomBytes(12);
const accessCode = Array.from(source, byte => alphabet[byte % alphabet.length]).join("");
const secrets = {
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "https://freedom-web-push-lab.dorothy-yakon.workers.dev/",
  LAB_ACCESS_CODE: accessCode
};

const result = spawnSync(
  "./node_modules/.bin/wrangler",
  ["secret", "bulk", "--config", "cloudflare-worker/wrangler.toml"],
  {
    cwd: new URL("..", import.meta.url),
    input: JSON.stringify(secrets),
    encoding: "utf8",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: "/tmp/freedom-push-lab-wrangler.log",
      WRANGLER_SEND_METRICS: "false"
    }
  }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status || 1);

const accessCodePath = "/tmp/freedom-push-lab-access-code.txt";
writeFileSync(accessCodePath, `${accessCode}\n`, { mode: 0o600 });
chmodSync(accessCodePath, 0o600);
console.log(`Temporary access code saved locally at ${accessCodePath}. The VAPID private key was not written to disk.`);
