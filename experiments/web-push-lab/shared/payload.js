export const LAB_VERSION = "0.1.1";
export const TEST_TITLE = "Freedom Push Lab";
export const TEST_BODY = "If you can read this exact sentence, the encrypted payload was decoded.";

export function createTestId() {
  return crypto.randomUUID();
}

export function buildDiagnosticPayload({ appOrigin, testId, sender }) {
  const origin = new URL(appOrigin).origin;
  const navigate = new URL("/", origin);
  navigate.searchParams.set("opened", "notification");
  navigate.searchParams.set("test", testId);
  navigate.searchParams.set("sender", sender);

  return {
    web_push: 8030,
    notification: {
      title: TEST_TITLE,
      body: TEST_BODY,
      navigate: navigate.href,
      data: {
        testId,
        sender,
        labVersion: LAB_VERSION
      }
    },
    title: TEST_TITLE,
    body: TEST_BODY,
    url: navigate.href,
    diagnostics: {
      testId,
      sender,
      labVersion: LAB_VERSION
    }
  };
}

export function validateSubscription(subscription) {
  return !!(
    subscription &&
    typeof subscription.endpoint === "string" &&
    subscription.endpoint.startsWith("https://") &&
    subscription.keys &&
    typeof subscription.keys.p256dh === "string" &&
    subscription.keys.p256dh.length > 20 &&
    typeof subscription.keys.auth === "string" &&
    subscription.keys.auth.length > 8
  );
}

export function safeEndpointProvider(endpoint) {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    if (host.includes("apple") || host.endsWith("push.apple.com")) return "Apple Push Service";
    if (host.includes("mozilla")) return "Mozilla Push Service";
    if (host.includes("google") || host.includes("firebase")) return "Google Push Service";
    return "Other push service";
  } catch {
    return "Unknown push service";
  }
}

export function base64UrlByteLength(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - (normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0));
}

export function safeReason(value) {
  const reason = String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
  if (/(https?:\/\/|endpoint=|p256dh|private key|authorization|\bauth=)/i.test(reason)) return "";
  return reason;
}
