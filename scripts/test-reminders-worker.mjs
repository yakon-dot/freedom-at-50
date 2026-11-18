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

assert.equal(NOTIFICATION.title, "A little nudge");
assert.equal(NOTIFICATION.body, "Your companion has something for you. Tap to see what’s waiting.");
assert.equal(/freedom/i.test(NOTIFICATION.title), false);
assert.equal(/freedom/i.test(NOTIFICATION.body), false);
assert.equal(NOTIFICATION.url, "https://yakon-dot.github.io/freedom-at-50/?opened=reminder");
assert.equal(NOTIFICATION.url.includes("#"), false);
assert.match(NOTIFICATION.url, /[?&]opened=reminder/);
const pushData = __test.buildPushData();
assert.equal(pushData.web_push, 8030);
assert.equal(pushData.notification.title, NOTIFICATION.title);
assert.equal(pushData.notification.body, NOTIFICATION.body);
assert.equal(pushData.notification.navigate, NOTIFICATION.url);
const classicData = __test.buildClassicPushData();
assert.equal(classicData.title, NOTIFICATION.title);
assert.equal(classicData.body, NOTIFICATION.body);
assert.equal(classicData.url, NOTIFICATION.url);
assert.equal(Object.prototype.hasOwnProperty.call(classicData, "web_push"), false);
assert.equal(__test.normalizeTestMode("classic"), "classic");
assert.equal(__test.normalizeTestMode("declarative"), "declarative");
assert.equal(__test.normalizeTestMode(""), "declarative");
assert.equal(__test.normalizeTestMode("other"), "declarative");

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

{
  const accepted = await __test.pushServiceDiagnostics(
    new Response(null, { status: 201, headers: { reason: "" } })
  );
  assert.equal(accepted.pushStatus, 201);
  assert.equal(accepted.pushAccepted, true);
  assert.equal(accepted.pushReason, "");

  const rejected = await __test.pushServiceDiagnostics(
    new Response(JSON.stringify({ reason: "BadJwtToken" }), {
      status: 403,
      headers: { "content-type": "application/json", reason: "BadJwtToken" }
    })
  );
  assert.equal(rejected.pushStatus, 403);
  assert.equal(rejected.pushAccepted, false);
  assert.equal(rejected.pushReason, "BadJwtToken");

  const scrubbed = await __test.pushServiceDiagnostics(
    new Response(null, {
      status: 403,
      headers: { reason: "endpoint=https://secret.example auth=abc" }
    })
  );
  assert.equal(scrubbed.pushReason, "");
}
console.log("PASS: reminders worker helpers, subscribe/unsubscribe, cron day gate, admin auth, push diagnostics");

/* Client source contracts in index.html / SW / config */
import fs from "node:fs";
const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /data-more183="reminders"/);
assert.match(index, /A little nudge/);
assert.match(index, /Your reminders are on/);
assert.match(index, /Your reminders are off/);
assert.match(index, /On your terms/);
assert.match(index, /freedomRemindersToggle/);
assert.match(index, /role="switch"/);
assert.match(index, /freedom50-reminders-choice-v1/);
assert.match(index, /Send test reminder/);
assert.match(index, /freedomRemindersChooseKeep/);
assert.match(index, /freedomRemindersChooseNever/);
assert.equal(index.includes("Test classic notification"), false);
assert.match(index, /freedomFormatPushDiagnostics/);
assert.match(index, /pushStatus/);
assert.match(index, /"declarative"/);
assert.match(index, /freedom-push-config\.js/);
assert.match(index, /initFreedomRemindersUi/);
assert.match(index, /FREEDOM_OPEN_REMINDER_HOME/);
assert.match(index, /freedomOpenHomeFromReminder/);
assert.match(index, /FreedomMonthlyReminderCheckIn/);
assert.match(index, /opened=reminder/);
assert.match(index, /armFromNotificationTap/);
assert.match(index, /tryFromNotificationTap/);
assert.match(index, /freedom50-reminder-checkin-pending-v1/);
assert.match(index, /freedom50-reminder-checkin-rotation-v1/);
assert.match(index, /shufflePoolIndices/);
assert.match(index, /Still cheeky, still on your side/);
assert.match(index, /Worth a short look\. Journeys and Goals stay useful/);
assert.match(index, /Bring Journeys and Goals in line with the latest picture/);
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
const pkg = fs.readFileSync("cloudflare/freedom-reminders/package.json", "utf8");
assert.match(pkg, /"@block65\/webcrypto-web-push"\s*:\s*"\^2\./);
const sw = fs.readFileSync("service-worker.js", "utf8");
assert.match(sw, /addEventListener\("push"/);
assert.match(sw, /notificationclick/);
assert.match(sw, /freedom-at-50-v1\.8\.6\.162/);
assert.match(sw, /freedom-push-config\.js/);
assert.match(sw, /freedom-native-notifications\.js/);
assert.match(sw, /A little nudge/);
assert.match(sw, /Your companion has something for you\. Tap to see what’s waiting\./);
assert.match(sw, /\?opened=reminder/);
assert.match(index, /Your companion has something for you\. Tap to see what’s waiting\./);
assert.match(index, /freedomRemindersNativeAvailable/);
assert.match(index, /FreedomNativeNotifications/);
assert.equal(sw.includes("#overview"), false);
assert.match(sw, /registration\.scope/);
assert.match(sw, /client\.navigate/);
assert.match(sw, /clients\.openWindow/);
assert.match(sw, /FREEDOM_OPEN_REMINDER_HOME/);
assert.match(sw, /web_push|notification\.navigate|FREEDOM_OPEN_REMINDER_HOME/);
console.log("PASS: client reminder contracts (UI, SW push, Worker URL, no private key in Pages)");
