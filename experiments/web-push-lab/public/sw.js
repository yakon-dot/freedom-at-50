const LAB_VERSION = "0.2.0";
const DB_NAME = "freedom-web-push-lab";
const STORE_NAME = "events";
const TEST_TITLE = "Freedom Push Lab";
const TEST_BODY = "If you can read this exact sentence, the encrypted payload was decoded.";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function recordEvent(type, detail = {}) {
  const event = { type, detail, at: new Date().toISOString(), swVersion: LAB_VERSION };
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).add(event);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}

  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  windows.forEach(client => client.postMessage({ type: "PUSH_LAB_EVENT", event }));
}

function parsePayload(data) {
  const fallback = { title: TEST_TITLE, body: TEST_BODY, url: self.registration.scope, testId: "unknown", sender: "unknown" };
  if (!data) return { ...fallback, parsed: false, reason: "No payload bytes were delivered" };
  try {
    const parsed = data.json();
    const note = parsed && typeof parsed.notification === "object" ? parsed.notification : {};
    const diagnostics = parsed && typeof parsed.diagnostics === "object" ? parsed.diagnostics : {};
    return {
      title: note.title || parsed.title || fallback.title,
      body: note.body || parsed.body || fallback.body,
      url: note.navigate || parsed.url || fallback.url,
      testId: diagnostics.testId || (note.data && note.data.testId) || "unknown",
      sender: diagnostics.sender || (note.data && note.data.sender) || "unknown",
      parsed: true,
      declarative: parsed.web_push === 8030
    };
  } catch (error) {
    return { ...fallback, parsed: false, reason: error && error.message ? error.message : "Payload was not valid JSON" };
  }
}

function safeDiagnosticText(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 180);
}

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await clients.claim();
    await recordEvent("service-worker-active", { version: LAB_VERSION });
  })());
});

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    const proposed = event.notification || null;
    const proposedData = proposed && proposed.data && typeof proposed.data === "object" ? proposed.data : {};
    const message = proposed ? {
      title: safeDiagnosticText(proposed.title) || TEST_TITLE,
      body: safeDiagnosticText(proposed.body) || TEST_BODY,
      url: self.registration.scope,
      testId: safeDiagnosticText(proposedData.testId) || "unknown",
      sender: safeDiagnosticText(proposedData.sender) || "node-web-push-mutable",
      parsed: true,
      declarative: true
    } : parsePayload(event.data);
    await recordEvent("push-received", {
      testId: message.testId,
      sender: message.sender,
      payloadPresent: !!event.data,
      parsed: message.parsed,
      declarative: !!message.declarative,
      titleMatched: message.title === TEST_TITLE,
      bodyMatched: message.body === TEST_BODY,
      proposedNotificationPresent: !!proposed,
      proposedTitle: proposed ? safeDiagnosticText(proposed.title) : "",
      proposedBody: proposed ? safeDiagnosticText(proposed.body) : "",
      reason: message.reason || ""
    });
    try {
      if (proposed) {
        /* Test C: deliberately minimal replacement, with no optional presentation fields. */
        await self.registration.showNotification(message.title, { body: message.body });
      } else {
        /* Preserve the existing legacy fallback used by Tests A/B on older browsers. */
        await self.registration.showNotification(message.title, {
          body: message.body,
          icon: "/lab-icon.svg",
          badge: "/lab-icon.svg",
          tag: `freedom-push-lab-${message.testId}`,
          data: { url: message.url, testId: message.testId, sender: message.sender }
        });
      }
      await recordEvent("notification-shown-by-worker", {
        testId: message.testId,
        sender: message.sender,
        titleMatched: message.title === TEST_TITLE,
        bodyMatched: message.body === TEST_BODY,
        displayMode: proposed ? "minimal-proposed-notification" : "existing-legacy-notification"
      });
    } catch (error) {
      await recordEvent("notification-display-failed", {
        testId: message.testId,
        sender: message.sender,
        error: String((error && error.name) || "Error"),
        message: String((error && error.message) || "Display failed").slice(0, 120)
      });
    }
  })());
});

self.addEventListener("notificationclick", event => {
  const data = event.notification && event.notification.data ? event.notification.data : {};
  event.notification.close();
  event.waitUntil((async () => {
    await recordEvent("notification-click", {
      testId: data.testId || "unknown",
      sender: data.sender || "unknown"
    });
    const target = new URL(data.url || "/?opened=worker-click", self.location.origin).href;
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("navigate" in client) {
        try { await client.navigate(target); } catch {}
      }
      if ("focus" in client) await client.focus();
      return;
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
