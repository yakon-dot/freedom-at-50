/**
 * Freedom at 50 — monthly reminder Worker.
 * Stores only Web Push subscription endpoints/keys. No accounts, finances, or tracking.
 */
import { buildPushPayload } from "@block65/webcrypto-web-push";

/* Absolute navigate URL is required for iOS Declarative Web Push + reliable taps. */
export const NOTIFICATION = {
  title: "A little nudge",
  body: "Your companion has something for you. Tap to see what’s waiting.",
  /* Query URL (not hash): iOS declarative navigate + openWindow open the PWA reliably. */
  url: "https://yakon-dot.github.io/freedom-at-50/?opened=reminder"
};

/** Declarative Web Push payload (monthly cron + default self-test). */
export function buildPushData(env = {}) {
  const navigate = String(env.NOTIFICATION_URL || NOTIFICATION.url).trim();
  return {
    /* Declarative Web Push (Safari 18.4+ / iOS): system can show + navigate without SW. */
    web_push: 8030,
    notification: {
      title: NOTIFICATION.title,
      body: NOTIFICATION.body,
      navigate
    }
  };
}

/**
 * Classic Web Push JSON for A/B self-test only.
 * No web_push key — forces the service-worker showNotification path on WebKit.
 * Same title/body/url text as the declarative test.
 */
export function buildClassicPushData(env = {}) {
  const url = String(env.NOTIFICATION_URL || NOTIFICATION.url).trim();
  return {
    title: NOTIFICATION.title,
    body: NOTIFICATION.body,
    url
  };
}

export function normalizeTestMode(mode) {
  const m = String(mode || "declarative").trim().toLowerCase();
  return m === "classic" ? "classic" : "declarative";
}

const SUB_PREFIX = "sub:";
const META_LAST = "meta:lastBroadcast";

export function isLastCalendarDayUtc(date = new Date()) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return next.getUTCMonth() !== date.getUTCMonth();
}

export function broadcastMonthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function subscriptionKey(endpoint) {
  let hash = 2166136261;
  for (let i = 0; i < endpoint.length; i++) {
    hash ^= endpoint.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${SUB_PREFIX}${hex}:${endpoint.length}`;
}

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": "no-store"
    }
  });
}

function cors(origin = "*") {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "access-control-max-age": "86400"
    }
  });
}

function allowedOrigin(env, request) {
  const configured = (env.ALLOWED_ORIGIN || "*").trim();
  if (configured === "*") return "*";
  const reqOrigin = request.headers.get("Origin") || "";
  if (reqOrigin && configured.split(",").map(s => s.trim()).includes(reqOrigin)) return reqOrigin;
  return configured.split(",")[0].trim() || "*";
}

function readVapid(env) {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || "mailto:freedom-at-50-notifications@example.com";
  if (!publicKey || !privateKey) {
    throw new Error("Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY");
  }
  return { publicKey, privateKey, subject };
}

function isValidSubscription(sub) {
  return !!(
    sub &&
    typeof sub.endpoint === "string" &&
    sub.endpoint.startsWith("https://") &&
    sub.keys &&
    typeof sub.keys.p256dh === "string" &&
    typeof sub.keys.auth === "string"
  );
}

async function putSubscription(env, subscription) {
  const key = subscriptionKey(subscription.endpoint);
  const record = {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    },
    updatedAt: new Date().toISOString()
  };
  await env.REMINDERS.put(key, JSON.stringify(record));
  return key;
}

async function deleteSubscription(env, endpoint) {
  if (!endpoint) return false;
  const key = subscriptionKey(endpoint);
  const existing = await env.REMINDERS.get(key);
  if (!existing) {
    /* Fallback: scan prefix if hash scheme changes (rare). */
    let cursor;
    do {
      const page = await env.REMINDERS.list({ prefix: SUB_PREFIX, cursor });
      for (const entry of page.keys) {
        const raw = await env.REMINDERS.get(entry.name);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.endpoint === endpoint) {
            await env.REMINDERS.delete(entry.name);
            return true;
          }
        } catch (e) {}
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return false;
  }
  await env.REMINDERS.delete(key);
  return true;
}

async function getSubscriptionByEndpoint(env, endpoint) {
  const key = subscriptionKey(endpoint);
  const raw = await env.REMINDERS.get(key);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function listSubscriptions(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.REMINDERS.list({ prefix: SUB_PREFIX, cursor });
    for (const entry of page.keys) {
      const raw = await env.REMINDERS.get(entry.name);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (isValidSubscription(parsed)) out.push({ key: entry.name, subscription: parsed });
      } catch (e) {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function sendOne(env, subscription, { mode = "declarative" } = {}) {
  const vapid = readVapid(env);
  const testMode = normalizeTestMode(mode);
  const data =
    testMode === "classic" ? buildClassicPushData(env) : buildPushData(env);
  const message = {
    /* aes128gcm via @block65/webcrypto-web-push@2 — required for Apple Push. */
    data: JSON.stringify(data),
    options: {
      ttl: 60 * 60 * 24 * 7,
      urgency: "normal"
    }
  };
  const payload = await buildPushPayload(message, subscription, vapid);
  const res = await fetch(subscription.endpoint, payload);
  return res;
}

/**
 * Safe push-service diagnostics for /test-self.
 * Never includes endpoints, keys, tokens, or raw bodies with secrets.
 */
export async function pushServiceDiagnostics(res) {
  const pushStatus = res && typeof res.status === "number" ? res.status : 0;
  let pushReason = "";
  try {
    pushReason = String((res.headers && res.headers.get("reason")) || "").trim();
  } catch (e) {}
  if (!pushReason && res && typeof res.clone === "function") {
    try {
      const ct = String((res.headers && res.headers.get("content-type")) || "").toLowerCase();
      const clone = res.clone();
      if (ct.includes("application/json")) {
        const data = await clone.json();
        if (data && typeof data.reason === "string") pushReason = data.reason.trim();
      }
    } catch (e) {}
  }
  pushReason = pushReason.replace(/[\r\n\t]+/g, " ").slice(0, 120);
  /* Scrub only if the reason looks like it embeds secrets, not Apple codes like BadJwtToken. */
  if (/(https?:\/\/|endpoint=|p256dh|private key|vapid [tk]=|authorization:|\bauth=)/i.test(pushReason)) {
    pushReason = "";
  }
  return {
    pushStatus,
    pushAccepted: pushStatus === 201 || pushStatus === 200,
    pushReason
  };
}

async function sendToAll(env, { force = false, now = new Date() } = {}) {
  const monthKey = broadcastMonthKey(now);
  if (!force) {
    const last = await env.REMINDERS.get(META_LAST);
    if (last === monthKey) {
      return { sent: 0, skipped: true, reason: "already_sent", monthKey };
    }
  }
  const subs = await listSubscriptions(env);
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const { key, subscription } of subs) {
    try {
      const res = await sendOne(env, subscription);
      if (res.status === 404 || res.status === 410) {
        await env.REMINDERS.delete(key);
        removed += 1;
      } else if (res.ok || res.status === 201) {
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (e) {
      failed += 1;
    }
  }
  if (!force) {
    await env.REMINDERS.put(META_LAST, monthKey);
  }
  return { sent, removed, failed, skipped: false, monthKey, total: subs.length };
}

async function handleSubscribe(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid JSON" }, 400, origin);
  }
  const subscription = body.subscription || body;
  if (!isValidSubscription(subscription)) {
    return json({ ok: false, error: "Invalid subscription" }, 400, origin);
  }
  const key = await putSubscription(env, subscription);
  return json({ ok: true, key }, 200, origin);
}

async function handleUnsubscribe(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid JSON" }, 400, origin);
  }
  const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
  if (!endpoint || typeof endpoint !== "string") {
    return json({ ok: false, error: "Missing endpoint" }, 400, origin);
  }
  const removed = await deleteSubscription(env, endpoint);
  return json({ ok: true, removed }, 200, origin);
}

async function handleTestSelf(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid JSON" }, 400, origin);
  }
  const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
  if (!endpoint) return json({ ok: false, error: "Missing endpoint" }, 400, origin);
  /* Self-test only: never broadcasts. Optional mode=classic|declarative (default). */
  const mode = normalizeTestMode(body.mode);
  const stored = await getSubscriptionByEndpoint(env, endpoint);
  if (!stored) {
    return json({ ok: false, error: "Subscription not found" }, 404, origin);
  }
  try {
    const res = await sendOne(env, stored, { mode });
    const diag = await pushServiceDiagnostics(res);
    if (res.status === 404 || res.status === 410) {
      await deleteSubscription(env, endpoint);
      return json({ ok: false, error: "Subscription expired", mode, ...diag }, 410, origin);
    }
    if (!res.ok && res.status !== 201) {
      return json({ ok: false, error: "Push service error", mode, ...diag }, 502, origin);
    }
    return json({ ok: true, mode, ...diag }, 200, origin);
  } catch (e) {
    return json({ ok: false, error: "Send failed", mode }, 500, origin);
  }
}

async function handleAdminTest(request, env, origin) {
  const token = env.ADMIN_TOKEN;
  if (!token) return json({ ok: false, error: "Admin test not configured" }, 503, origin);
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${token}`) {
    return json({ ok: false, error: "Unauthorized" }, 401, origin);
  }
  let body = {};
  try {
    body = await request.json();
  } catch (e) {}
  if (body.endpoint) {
    const stored = await getSubscriptionByEndpoint(env, body.endpoint);
    if (!stored) return json({ ok: false, error: "Subscription not found" }, 404, origin);
    const res = await sendOne(env, stored);
    return json({ ok: true, status: res.status }, 200, origin);
  }
  const result = await sendToAll(env, { force: true });
  return json({ ok: true, ...result }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(env, request);
    if (request.method === "OPTIONS") return cors(origin);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "GET" && (path === "/" || path === "/health")) {
      return json({ ok: true, service: "freedom-reminders" }, 200, origin);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, origin);
    }

    try {
      if (path === "/subscribe") return await handleSubscribe(request, env, origin);
      if (path === "/unsubscribe") return await handleUnsubscribe(request, env, origin);
      if (path === "/test-self") return await handleTestSelf(request, env, origin);
      if (path === "/admin/test") return await handleAdminTest(request, env, origin);
      return json({ ok: false, error: "Not found" }, 404, origin);
    } catch (e) {
      return json({ ok: false, error: "Server error" }, 500, origin);
    }
  },

  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime || Date.now());
    if (!isLastCalendarDayUtc(now)) {
      return;
    }
    ctx.waitUntil(sendToAll(env, { force: false, now }));
  }
};

/* Test helpers (Node import without CF runtime) */
export const __test = {
  SUB_PREFIX,
  META_LAST,
  isValidSubscription,
  subscriptionKey,
  isLastCalendarDayUtc,
  broadcastMonthKey,
  NOTIFICATION,
  buildPushData,
  buildClassicPushData,
  normalizeTestMode,
  pushServiceDiagnostics
};
