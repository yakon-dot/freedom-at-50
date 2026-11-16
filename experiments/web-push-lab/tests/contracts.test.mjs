import assert from "node:assert/strict";
import { test } from "node:test";
import * as webpush from "web-push";
import { buildPushPayload } from "@block65/webcrypto-web-push";
import {
  LAB_VERSION,
  TEST_BODY,
  TEST_TITLE,
  buildDiagnosticPayload,
  safeEndpointProvider,
  validateSubscription
} from "../shared/payload.js";

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function headerValue(headers, name) {
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.replace(/(^|-)([a-z])/g, (_, dash, letter) => `${dash}${letter.toUpperCase()}`)];
}

async function testSubscription() {
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicRaw = await crypto.subtle.exportKey("raw", receiver.publicKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: "https://web.push.apple.com/QAA-test-only-endpoint",
    expirationTime: null,
    keys: { p256dh: toBase64Url(publicRaw), auth: toBase64Url(auth) }
  };
}

test("both sender paths use the same approved diagnostic title and body", () => {
  const a = buildDiagnosticPayload({ appOrigin: "https://push-lab.example", testId: "a", sender: "block65-cloudflare" });
  const b = buildDiagnosticPayload({ appOrigin: "https://push-lab.example", testId: "b", sender: "node-web-push" });
  assert.equal(a.notification.title, TEST_TITLE);
  assert.equal(b.notification.title, TEST_TITLE);
  assert.equal(a.notification.body, TEST_BODY);
  assert.equal(b.notification.body, TEST_BODY);
  assert.equal(a.web_push, 8030);
  assert.equal(b.web_push, 8030);
  assert.equal(a.diagnostics.labVersion, LAB_VERSION);
});

test("test subscription validation does not accept incomplete records", async () => {
  const subscription = await testSubscription();
  assert.equal(validateSubscription(subscription), true);
  assert.equal(validateSubscription({ endpoint: subscription.endpoint }), false);
  assert.equal(safeEndpointProvider(subscription.endpoint), "Apple Push Service");
});

test("Block65 and Node web-push both produce aes128gcm encrypted requests", async () => {
  const subscription = await testSubscription();
  const vapid = webpush.generateVAPIDKeys();
  const data = JSON.stringify(buildDiagnosticPayload({
    appOrigin: "https://push-lab.example",
    testId: "same-test",
    sender: "contract-test"
  }));

  const block65 = await buildPushPayload(
    { data, options: { ttl: 300, urgency: "normal" } },
    subscription,
    { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:test@example.com" }
  );
  assert.equal(headerValue(block65.headers, "content-encoding"), "aes128gcm");
  assert.ok(block65.body.byteLength > data.length);

  const nodeDetails = webpush.generateRequestDetails(subscription, data, {
    vapidDetails: {
      subject: "mailto:test@example.com",
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey
    },
    TTL: 300,
    urgency: "normal",
    contentEncoding: "aes128gcm"
  });
  assert.equal(headerValue(nodeDetails.headers, "content-encoding"), "aes128gcm");
  assert.ok(nodeDetails.body.length > data.length);
});
