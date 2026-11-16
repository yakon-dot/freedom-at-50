import { buildPushPayload } from "@block65/webcrypto-web-push";
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

function safeResponseHeaders(headers) {
  return {
    apnsId: String(headers.get("apns-id") || "").slice(0, 80),
    reason: safeReason(headers.get("reason") || "")
  };
}

function requestHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  return String(headers[name] ?? headers[name.toLowerCase()] ?? "");
}

async function sendWithBlock65(request, env) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, stage: "request", message: "The test request was not valid JSON." }, 400);
  }

  if (!validateSubscription(input.subscription)) {
    return json({ ok: false, stage: "subscription", message: "The test subscription is incomplete." }, 400);
  }

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
      return json({
        labVersion: env.LAB_VERSION || LAB_VERSION,
        publicKey: String(env.VAPID_PUBLIC_KEY || ""),
        nodeSenderUrl: String(env.NODE_SENDER_URL || ""),
        appOrigin: appOrigin(env, request),
        title: TEST_TITLE,
        body: TEST_BODY,
        configured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.NODE_SENDER_URL)
      });
    }

    if (request.method === "POST" && url.pathname === "/api/send/block65") {
      try {
        return await sendWithBlock65(request, env);
      } catch (error) {
        return json({
          ok: false,
          stage: "sender-error",
          sender: "block65-cloudflare",
          message: safeReason(error && error.message) || "The Cloudflare sender failed before Apple accepted the request."
        }, 500);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ ok: false, message: "Not found" }, 404);
    const assetResponse = await env.ASSETS.fetch(request);
    return addAssetHeaders(assetResponse, url.pathname);
  }
};
