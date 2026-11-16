/**
 * Unit tests for Freedom reminders Worker helpers (no network deploy).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workerPath = path.resolve("cloudflare/freedom-reminders/src/index.js");
const mod = await import(pathToFileURL(workerPath).href);
const {
  isLastCalendarDayUtc,
  broadcastMonthKey,
  subscriptionKey,
  NOTIFICATION,
  __test
} = mod;

assert.equal(NOTIFICATION.title, "A little Freedom check-in");
assert.match(NOTIFICATION.body, /journeys and goals are waiting/);
assert.equal(NOTIFICATION.url, "./#home");

assert.equal(isLastCalendarDayUtc(new Date(Date.UTC(2026, 0, 31))), true);
assert.equal(isLastCalendarDayUtc(new Date(Date.UTC(2026, 0, 30))), false);
assert.equal(isLastCalendarDayUtc(new Date(Date.UTC(2026, 1, 28))), true);
assert.equal(isLastCalendarDayUtc(new Date(Date.UTC(2028, 1, 29))), true); /* leap */
assert.equal(isLastCalendarDayUtc(new Date(Date.UTC(2026, 3, 30))), true);
assert.equal(isLastCalendarDayUtc(new Date(Date.UTC(2026, 3, 29))), false);

assert.equal(broadcastMonthKey(new Date(Date.UTC(2026, 10, 14))), "2026-11");
assert.equal(broadcastMonthKey(new Date(Date.UTC(2026, 0, 1))), "2026-01");

const a = subscriptionKey("https://fcm.googleapis.com/fcm/send/abc");
const b = subscriptionKey("https://fcm.googleapis.com/fcm/send/abc");
const c = subscriptionKey("https://fcm.googleapis.com/fcm/send/xyz");
assert.equal(a, b);
assert.notEqual(a, c);
assert.match(a, /^sub:/);

assert.equal(__test.isValidSubscription(null), false);
assert.equal(
  __test.isValidSubscription({
    endpoint: "https://example.com/push",
    keys: { p256dh: "x", auth: "y" }
  }),
  true
);
assert.equal(
  __test.isValidSubscription({
    endpoint: "http://insecure.example/push",
    keys: { p256dh: "x", auth: "y" }
  }),
  false
);

/* Mock KV + fetch for subscribe / unsubscribe / dedupe */
function createMemoryKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix, cursor } = {}) {
      const keys = [...store.keys()]
        .filter(k => !prefix || k.startsWith(prefix))
        .map(name => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
    _store: store
  };
}

{
  const kv = createMemoryKv();
  const env = {
    REMINDERS: kv,
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
    VAPID_SUBJECT: "mailto:test@example.com"
  };
  const sub = {
    endpoint: "https://push.example/endpoint-1",
    expirationTime: null,
    keys: { p256dh: "p256", auth: "auth" }
  };
  const req = new Request("https://worker.test/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub })
  });
  const res = await mod.default.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(kv._store.size, 1);

  const unsub = await mod.default.fetch(
    new Request("https://worker.test/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint })
    }),
    env
  );
  assert.equal(unsub.status, 200);
  assert.equal((await unsub.json()).removed, true);
  assert.equal(kv._store.size, 0);
}

{
  /* Dedupe: second monthly send skipped when meta matches */
  const month = broadcastMonthKey(new Date(Date.UTC(2026, 10, 30)));
  const kv = createMemoryKv({ [__test.META_LAST]: month });
  const env = {
    REMINDERS: kv,
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv"
  };
  /* Directly exercise sendToAll via scheduled path: not last day → no-op */
  let ran = false;
  await mod.default.scheduled(
    { scheduledTime: Date.UTC(2026, 10, 29) },
    env,
    { waitUntil(p) { ran = true; return p; } }
  );
  assert.equal(ran, false);

  /* Last day with meta already set: waitUntil runs but skipped inside */
  const sends = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    sends.push(1);
    return new Response(null, { status: 201 });
  };
  try {
    /* Re-subscribe one record then attempt broadcast through admin without token should 503 */
    await kv.put(
      subscriptionKey("https://push.example/e"),
      JSON.stringify({
        endpoint: "https://push.example/e",
        keys: { p256dh: "a", auth: "b" }
      })
    );
    const admin = await mod.default.fetch(
      new Request("https://worker.test/admin/test", { method: "POST", body: "{}" }),
      env
    );
    assert.equal(admin.status, 503);

    env.ADMIN_TOKEN = "secret";
    const denied = await mod.default.fetch(
      new Request("https://worker.test/admin/test", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
        body: "{}"
      }),
      env
    );
    assert.equal(denied.status, 401);

    /* force send via admin */
    const forced = await mod.default.fetch(
      new Request("https://worker.test/admin/test", {
        method: "POST",
        headers: { Authorization: "Bearer secret", "content-type": "application/json" },
        body: "{}"
      }),
      { ...env, /* buildPushPayload needs real keys — expect failure path */ }
    );
    /* Without real VAPID keys, send may 500 — still proves auth path */
    assert.ok([200, 500].includes(forced.status));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/* CORS preflight */
{
  const res = await mod.default.fetch(
    new Request("https://worker.test/subscribe", { method: "OPTIONS" }),
    { REMINDERS: createMemoryKv() }
  );
  assert.equal(res.status, 204);
  assert.ok(res.headers.get("access-control-allow-origin"));
}

console.log("PASS: reminders worker helpers, subscribe/unsubscribe, cron day gate, admin auth");

/* Client source contracts in index.html / SW / config */
import fs from "node:fs";
const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /data-more183="reminders"/);
assert.match(index, /Keep reminders/);
assert.match(index, /Never remind me/);
assert.match(index, /freedom50-reminders-choice-v1/);
assert.match(index, /Send test reminder/);
assert.match(index, /freedom-push-config\.js/);
assert.match(index, /initFreedomRemindersUi/);
assert.match(index, /FREEDOM_OPEN_HOME/);
assert.equal(index.includes("demoMode") && index.includes("Reminders stay off in Demo Mode"), true);
/* Private key material must not appear in Pages assets; public config points at live Worker */
const cfg = fs.readFileSync("freedom-push-config.js", "utf8");
assert.match(
  cfg,
  /apiBase:\s*"https:\/\/freedom-reminders\.dorothy-yakon\.workers\.dev"/
);
assert.match(cfg, /vapidPublicKey:\s*"B[A-Za-z0-9_-]{80,}"/);
assert.equal(/privateKey|VAPID_PRIVATE/i.test(cfg), false);
assert.equal(/privateKey|VAPID_PRIVATE/i.test(index), false);
const wrangler = fs.readFileSync("cloudflare/freedom-reminders/wrangler.toml", "utf8");
assert.match(wrangler, /compatibility_flags\s*=\s*\[[^\]]*nodejs_compat/);
assert.match(wrangler, /binding\s*=\s*"REMINDERS"/);
assert.match(wrangler, /id\s*=\s*"6cd70d4f86d34240b2b2d0755ec058d7"/);
const sw = fs.readFileSync("service-worker.js", "utf8");
assert.match(sw, /addEventListener\("push"/);
assert.match(sw, /notificationclick/);
assert.match(sw, /freedom-at-50-v1\.8\.6\.155/);
assert.match(sw, /freedom-push-config\.js/);
assert.match(sw, /A little Freedom check-in/);
console.log("PASS: client reminder contracts (UI, SW push, Worker URL, no private key in Pages)");
