import http from "node:http";
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

const PORT = Number(process.env.PORT || 8788);
const APP_ORIGIN = String(process.env.APP_ORIGIN || "http://localhost:8787").replace(/\/$/, "");
const PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:freedom-web-push-lab@example.com").trim();

function corsHeaders(origin) {
  const allowed = origin === APP_ORIGIN ? origin : APP_ORIGIN;
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0"
  };
}

function sendJson(res, status, data, origin = APP_ORIGIN) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function responseHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const direct = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(direct) ? direct.join(", ") : String(direct || "");
}

async function sendWithNodeWebPush(subscription) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) throw new Error("Test VAPID keys are not configured");
  const testId = createTestId();
  const sender = "node-web-push";
  const data = buildDiagnosticPayload({ appOrigin: APP_ORIGIN, testId, sender });
  const plaintext = JSON.stringify(data);
  const details = webpush.generateRequestDetails(subscription, plaintext, {
    vapidDetails: { subject: SUBJECT, publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY },
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
  const accepted = pushResponse.status === 201 || pushResponse.status === 200;

  return {
    ok: accepted,
    stage: accepted ? "push-service-accepted" : "push-service-rejected",
    testId,
    sender,
    labVersion: LAB_VERSION,
    notification: { title: TEST_TITLE, body: TEST_BODY },
    subscription: {
      provider: safeEndpointProvider(subscription.endpoint),
      p256dhBytes: base64UrlByteLength(subscription.keys.p256dh),
      authBytes: base64UrlByteLength(subscription.keys.auth)
    },
    encryption: {
      contentEncoding: responseHeader(details.headers, "content-encoding"),
      contentType: responseHeader(details.headers, "content-type"),
      plaintextBytes: Buffer.byteLength(plaintext),
      encryptedBytes: details.body ? details.body.length : 0,
      ttl: responseHeader(details.headers, "ttl"),
      urgency: responseHeader(details.headers, "urgency")
    },
    pushService: {
      status: pushResponse.status,
      accepted,
      apnsId: responseHeader(pushResponse.headers, "apns-id").slice(0, 80),
      reason: safeReason(responseHeader(pushResponse.headers, "reason")),
      elapsedMs: Date.now() - started
    }
  };
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "");
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      sender: "node-web-push",
      labVersion: LAB_VERSION,
      configured: !!(PUBLIC_KEY && PRIVATE_KEY)
    }, origin);
    return;
  }

  if (req.method === "POST" && url.pathname === "/send") {
    if (origin && origin !== APP_ORIGIN) {
      sendJson(res, 403, { ok: false, stage: "origin", message: "This test request came from the wrong preview app." }, origin);
      return;
    }
    try {
      const input = await readJson(req);
      if (!validateSubscription(input.subscription)) {
        sendJson(res, 400, { ok: false, stage: "subscription", message: "The test subscription is incomplete." }, origin);
        return;
      }
      const result = await sendWithNodeWebPush(input.subscription);
      sendJson(res, result.ok ? 200 : 502, result, origin);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        stage: "sender-error",
        sender: "node-web-push",
        message: safeReason(error && error.message) || "The Node sender failed before Apple accepted the request."
      }, origin);
    }
    return;
  }

  sendJson(res, 404, { ok: false, message: "Not found" }, origin);
});

server.listen(PORT, () => {
  console.log(`Freedom Web Push Lab Node sender listening on port ${PORT}`);
});
