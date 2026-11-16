import { buildPushPayload } from "@block65/webcrypto-web-push";
import * as webpush from "web-push";
import {
  LAB_VERSION,
  TEST_BODY,
  TEST_TITLE,
  base64UrlByteLength,
  buildDiagnosticPayload,
  createTestId,
  safeEndpointProvider,
  safeReason,
  validateSubscription
} from "../../shared/payload.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  pragma: "no-cache",
  expires: "0"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function appOrigin(env, request) {
  const configured = String(env.APP_ORIGIN || "").trim();
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

function readTestVapid(env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || "").trim();
  const subject = String(env.VAPID_SUBJECT || "mailto:freedom-web-push-lab@example.com").trim();
  if (!publicKey || !privateKey) throw new Error("Test VAPID keys are not configured");
  return { publicKey, privateKey, subject };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function secureEquals(value, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(value || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected || "")))
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  }
  return difference === 0;
}

async function readAuthorizedInput(request, env) {
  const expectedOrigin = appOrigin(env, request);
  const origin = String(request.headers.get("origin") || "");
  if (origin !== expectedOrigin) throw new HttpError(403, "This request did not come from the isolated Push Lab.");

  let input;
  try {
    input = await request.json();
  } catch {
    throw new HttpError(400, "The test request was not valid JSON.");
  }

  if (!env.LAB_ACCESS_CODE || !(await secureEquals(input.accessCode, env.LAB_ACCESS_CODE))) {
    throw new HttpError(403, "The temporary test access code is incorrect.");
  }
  if (!validateSubscription(input.subscription)) {
    throw new HttpError(400, "The test subscription is incomplete.");
  }
  return input;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createSyntheticSubscription() {
  const receiver = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicKey = await crypto.subtle.exportKey("raw", receiver.publicKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: "https://web.push.apple.com/QAA-freedom-push-lab-preflight",
    expirationTime: null,
    keys: {
      p256dh: bytesToBase64Url(publicKey),
      auth: bytesToBase64Url(auth)
    }
  };
}

async function encryptionPreflight(request, env) {
  const expectedOrigin = appOrigin(env, request);
  const origin = String(request.headers.get("origin") || "");
  if (origin !== expectedOrigin) throw new HttpError(403, "This request did not come from the isolated Push Lab.");
  let input;
  try {
    input = await request.json();
  } catch {
    throw new HttpError(400, "The preflight request was not valid JSON.");
  }
  if (!env.LAB_ACCESS_CODE || !(await secureEquals(input.accessCode, env.LAB_ACCESS_CODE))) {
    throw new HttpError(403, "The temporary test access code is incorrect.");
  }

  const vapid = readTestVapid(env);
  const subscription = await createSyntheticSubscription();
  const plaintext = JSON.stringify(buildDiagnosticPayload({
    appOrigin: expectedOrigin,
    testId: "preflight-no-send",
    sender: "preflight"
  }));
  const block65 = await buildPushPayload(
    { data: plaintext, options: { ttl: 300, urgency: "normal" } },
    subscription,
    vapid
  );
  const node = webpush.generateRequestDetails(subscription, plaintext, {
    vapidDetails: vapid,
    TTL: 300,
    urgency: "normal",
    contentEncoding: "aes128gcm"
  });

  return json({
    ok: true,
    sent: false,
    labVersion: env.LAB_VERSION || LAB_VERSION,
    methods: {
      block65Cloudflare: {
        contentEncoding: requestHeader(block65.headers, "content-encoding"),
        encryptedBytes: block65.body.byteLength
      },
      nodeWebPush: {
        contentEncoding: requestHeader(node.headers, "content-encoding"),
        encryptedBytes: node.body.byteLength
      }
    }
  });
}

function safeResponseHeaders(headers) {
  return {
    apnsId: String(headers.get("apns-id") || "").slice(0, 80),
    reason: safeReason(headers.get("reason") || "")
  };
}

function requestHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return String(match ? match[1] : "");
}

async function sendWithBlock65(request, env) {
  const input = await readAuthorizedInput(request, env);
  const vapid = readTestVapid(env);
  const testId = createTestId();
  const sender = "block65-cloudflare";
  const payloadData = buildDiagnosticPayload({
    appOrigin: appOrigin(env, request),
    testId,
    sender
  });
  const plaintext = JSON.stringify(payloadData);
  const encrypted = await buildPushPayload(
    {
      data: plaintext,
      options: { ttl: 300, urgency: "normal" }
    },
    input.subscription,
    vapid
  );

  const started = Date.now();
  const pushResponse = await fetch(input.subscription.endpoint, encrypted);
  const responseHeaders = safeResponseHeaders(pushResponse.headers);
  const accepted = pushResponse.status === 201 || pushResponse.status === 200;

  return json({
    ok: accepted,
    stage: accepted ? "push-service-accepted" : "push-service-rejected",
    testId,
    sender,
    labVersion: env.LAB_VERSION || LAB_VERSION,
    notification: { title: TEST_TITLE, body: TEST_BODY },
    subscription: {
      provider: safeEndpointProvider(input.subscription.endpoint),
      p256dhBytes: base64UrlByteLength(input.subscription.keys.p256dh),
      authBytes: base64UrlByteLength(input.subscription.keys.auth)
    },
    encryption: {
      contentEncoding: requestHeader(encrypted.headers, "content-encoding"),
      contentType: requestHeader(encrypted.headers, "content-type"),
      plaintextBytes: new TextEncoder().encode(plaintext).byteLength,
      encryptedBytes: encrypted.body ? encrypted.body.byteLength : 0,
      ttl: requestHeader(encrypted.headers, "ttl"),
      urgency: requestHeader(encrypted.headers, "urgency")
    },
    pushService: {
      status: pushResponse.status,
      accepted,
      apnsId: responseHeaders.apnsId,
      reason: responseHeaders.reason,
      elapsedMs: Date.now() - started
    }
  }, accepted ? 200 : 502);
}

async function sendWithNodeWebPush(request, env) {
  const input = await readAuthorizedInput(request, env);
  const vapid = readTestVapid(env);
  const testId = createTestId();
  const sender = "node-web-push";
  const payloadData = buildDiagnosticPayload({
    appOrigin: appOrigin(env, request),
    testId,
    sender
  });
  const plaintext = JSON.stringify(payloadData);
  const details = webpush.generateRequestDetails(input.subscription, plaintext, {
    vapidDetails: vapid,
    TTL: 300,
    urgency: "normal",
    contentEncoding: "aes128gcm"
  });

  const started = Date.now();
  const pushResponse = await fetch(details.endpoint, {
    method: details.method,
    headers: details.headers,
    body: details.body
  });
  const responseHeaders = safeResponseHeaders(pushResponse.headers);
  const accepted = pushResponse.status === 201 || pushResponse.status === 200;

  return json({
    ok: accepted,
    stage: accepted ? "push-service-accepted" : "push-service-rejected",
    testId,
    sender,
    labVersion: env.LAB_VERSION || LAB_VERSION,
    notification: { title: TEST_TITLE, body: TEST_BODY },
    subscription: {
      provider: safeEndpointProvider(input.subscription.endpoint),
      p256dhBytes: base64UrlByteLength(input.subscription.keys.p256dh),
      authBytes: base64UrlByteLength(input.subscription.keys.auth)
    },
    encryption: {
      contentEncoding: requestHeader(details.headers, "content-encoding"),
      contentType: requestHeader(details.headers, "content-type"),
      plaintextBytes: new TextEncoder().encode(plaintext).byteLength,
      encryptedBytes: details.body ? details.body.byteLength : 0,
      ttl: requestHeader(details.headers, "ttl"),
      urgency: requestHeader(details.headers, "urgency")
    },
    pushService: {
      status: pushResponse.status,
      accepted,
      apnsId: responseHeaders.apnsId,
      reason: responseHeaders.reason,
      elapsedMs: Date.now() - started
    }
  }, accepted ? 200 : 502);
}

async function addAssetHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  headers.set("x-freedom-push-lab-version", LAB_VERSION);
  if (pathname === "/sw.js") headers.set("service-worker-allowed", "/");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/config") {
      const origin = appOrigin(env, request);
      return json({
        labVersion: env.LAB_VERSION || LAB_VERSION,
        publicKey: String(env.VAPID_PUBLIC_KEY || ""),
        nodeSenderUrl: new URL("/api/send/node-web-push", origin).href,
        appOrigin: origin,
        title: TEST_TITLE,
        body: TEST_BODY,
        configured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.LAB_ACCESS_CODE)
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        labVersion: env.LAB_VERSION || LAB_VERSION,
        isolatedWorker: true,
        subscriptionStorage: false,
        broadcastEndpoint: false,
        configured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.LAB_ACCESS_CODE),
        methods: ["block65-cloudflare", "node-web-push"]
      });
    }

    if (request.method === "POST" && url.pathname === "/api/preflight") {
      try {
        return await encryptionPreflight(request, env);
      } catch (error) {
        return json({
          ok: false,
          sent: false,
          stage: error instanceof HttpError ? "request-rejected" : "preflight-error",
          message: safeReason(error && error.message) || "The non-sending encryption preflight failed."
        }, error instanceof HttpError ? error.status : 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/send/block65") {
      try {
        return await sendWithBlock65(request, env);
      } catch (error) {
        return json({
          ok: false,
          stage: error instanceof HttpError ? "request-rejected" : "sender-error",
          sender: "block65-cloudflare",
          message: safeReason(error && error.message) || "The Cloudflare sender failed before Apple accepted the request."
        }, error instanceof HttpError ? error.status : 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/send/node-web-push") {
      try {
        return await sendWithNodeWebPush(request, env);
      } catch (error) {
        return json({
          ok: false,
          stage: error instanceof HttpError ? "request-rejected" : "sender-error",
          sender: "node-web-push",
          message: safeReason(error && error.message) || "The Node web-push sender failed before Apple accepted the request."
        }, error instanceof HttpError ? error.status : 500);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ ok: false, message: "Not found" }, 404);
    const assetResponse = await env.ASSETS.fetch(request);
    return addAssetHeaders(assetResponse, url.pathname);
  }
};
