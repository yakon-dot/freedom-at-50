const DB_NAME = "freedom-web-push-lab";
const STORE_NAME = "events";
const LOCAL_LOG_KEY = "freedom-web-push-lab-ui-events-v1";

const state = {
  config: null,
  registration: null,
  subscription: null,
  events: []
};

const $ = selector => document.querySelector(selector);
const versionEl = $("#version");
const checksEl = $("#environmentChecks");
const enableButton = $("#enableButton");
const block65Button = $("#block65Button");
const nodeButton = $("#nodeButton");
const summaryEl = $("#summary");
const eventLogEl = $("#eventLog");
const copyButton = $("#copyButton");
const clearButton = $("#clearButton");

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, char => char.charCodeAt(0));
}

function loadUiEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_LOG_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-30) : [];
  } catch {
    return [];
  }
}

function saveUiEvents() {
  localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(state.events.slice(-30)));
}

function addEvent(type, title, detail, level = "success", extra = {}) {
  state.events.push({ type, title, detail, level, at: new Date().toISOString(), ...extra });
  state.events = state.events.slice(-30);
  saveUiEvents();
  renderEvents();
}

function formatTime(value) {
  try { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return ""; }
}

function renderEvents() {
  eventLogEl.replaceChildren();
  const events = [...state.events].reverse();
  for (const event of events) {
    const item = document.createElement("li");
    item.className = `event ${event.level || "success"}`;
    const dot = document.createElement("span");
    dot.className = "event-dot";
    const copy = document.createElement("span");
    copy.className = "event-copy";
    const title = document.createElement("strong");
    title.textContent = event.title;
    const detail = document.createElement("span");
    detail.textContent = event.detail;
    const time = document.createElement("time");
    time.dateTime = event.at;
    time.textContent = formatTime(event.at);
    copy.append(title, detail);
    item.append(dot, copy, time);
    eventLogEl.append(item);
  }
}

function setSummary(message, level = "neutral") {
  summaryEl.textContent = message;
  summaryEl.className = `summary ${level}`;
}

function renderChecks() {
  const checks = [
    { ok: window.isSecureContext, label: window.isSecureContext ? "Secure HTTPS page" : "HTTPS is required for iPhone push" },
    { ok: "serviceWorker" in navigator && "PushManager" in window, label: "Web Push supported by this browser" },
    { ok: isStandalone(), label: isStandalone() ? "Opened from the Home Screen" : "Add to Home Screen, then open the saved app" },
    { ok: !!(state.registration && state.registration.active), label: state.registration && state.registration.active ? `Test service worker active: ${state.registration.active.scriptURL.split("/").pop()}` : "Test service worker not active yet" },
    { ok: Notification.permission === "granted", pending: Notification.permission === "default", label: `Notification permission: ${Notification.permission}` }
  ];
  checksEl.replaceChildren();
  checks.forEach(check => {
    const row = document.createElement("div");
    row.className = `check ${check.ok ? "ok" : check.pending ? "" : "bad"}`;
    row.textContent = check.label;
    checksEl.append(row);
  });
}

function updateButtons() {
  const ready = !!(state.subscription && state.config && state.config.configured);
  block65Button.disabled = !ready;
  nodeButton.disabled = !ready;
  enableButton.disabled = !state.config || !state.config.publicKey || !("serviceWorker" in navigator);
  if (state.subscription) enableButton.textContent = "Test notifications enabled";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWorkerEvents() {
  try {
    const db = await openDb();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const seen = new Set(state.events.filter(e => e.workerEventKey).map(e => e.workerEventKey));
    for (const record of records) {
      const key = `${record.id}:${record.type}:${record.at}`;
      if (seen.has(key)) continue;
      const labels = {
        "service-worker-active": ["Test service worker activated", `Worker version ${record.swVersion}`],
        "push-received": ["Service worker received decrypted push", record.detail.parsed ? `Payload parsed. Sender: ${record.detail.sender}` : `Payload could not be parsed: ${record.detail.reason || "unknown reason"}`],
        "notification-shown-by-worker": ["Service worker requested the banner", `Title and body matched: ${record.detail.titleMatched && record.detail.bodyMatched ? "yes" : "no"}`],
        "notification-display-failed": ["Notification display failed", `${record.detail.error}: ${record.detail.message}`],
        "notification-click": ["Notification tap reached the service worker", `Sender: ${record.detail.sender}`]
      };
      const [title, detail] = labels[record.type] || [record.type, JSON.stringify(record.detail)];
      state.events.push({
        type: record.type,
        title,
        detail,
        at: record.at,
        level: record.type.includes("failed") ? "error" : record.detail && record.detail.parsed === false ? "warning" : "success",
        workerEventKey: key
      });
    }
    state.events = state.events.slice(-30);
    saveUiEvents();
    renderEvents();
  } catch {}
}

async function enableNotifications() {
  try {
    if (!isStandalone() && /iP(hone|ad|od)/.test(navigator.userAgent)) {
      setSummary("First add this page to the Home Screen and open the saved Push Lab app.", "warning");
      return;
    }
    const permission = await Notification.requestPermission();
    renderChecks();
    if (permission !== "granted") {
      setSummary("Notification permission was not granted.", "warning");
      return;
    }
    state.subscription = await state.registration.pushManager.getSubscription();
    if (!state.subscription) {
      state.subscription = await state.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(state.config.publicKey)
      });
    }
    addEvent("subscribed", "Temporary test subscription ready", "The subscription remains in this Push Lab only and has not been stored by a server.");
    setSummary("Ready. Send Test A, observe it, then return and send Test B.", "success");
    updateButtons();
    renderChecks();
  } catch (error) {
    addEvent("subscription-error", "Could not create the test subscription", String(error && error.message || error), "error");
    setSummary("The temporary test subscription could not be created.", "error");
  }
}

function diagnosticText(result) {
  const enc = result.encryption || {};
  const push = result.pushService || {};
  return `Apple status ${push.status || "unknown"}; ${enc.contentEncoding || "encoding unknown"}; ${enc.encryptedBytes || 0} encrypted bytes; request ${result.testId || "unknown"}`;
}

async function sendTest(sender) {
  const button = sender === "block65-cloudflare" ? block65Button : nodeButton;
  const label = button.querySelector("strong").textContent;
  const original = label;
  button.disabled = true;
  button.querySelector("strong").textContent = "Sending…";
  setSummary(`${original} is encrypting the test message.`, "neutral");
  try {
    const endpoint = sender === "block65-cloudflare" ? "/api/send/block65" : state.config.nodeSenderUrl;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: state.subscription.toJSON() })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.message || "The sender did not receive an accepted response."), { result });
    addEvent("push-accepted", `${original}: Apple accepted the request`, diagnosticText(result), "success", { diagnostics: result });
    setSummary("Apple accepted the encrypted request. Lock the phone or leave Push Lab open and wait for the banner.", "success");
  } catch (error) {
    const result = error.result || {};
    addEvent("push-rejected", `${original}: send failed`, result.message || error.message || "Unknown error", "error", { diagnostics: result });
    setSummary("The request failed before a usable notification was confirmed.", "error");
  } finally {
    button.querySelector("strong").textContent = original;
    updateButtons();
  }
}

async function clearEvents() {
  state.events = [];
  saveUiEvents();
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const request = tx.objectStore(STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {}
  renderEvents();
  setSummary("Diagnostics cleared. The temporary subscription remains ready.", "neutral");
}

async function copyDiagnostics() {
  const safe = {
    labVersion: state.config && state.config.labVersion,
    userAgent: navigator.userAgent,
    standalone: isStandalone(),
    permission: Notification.permission,
    serviceWorker: state.registration && state.registration.active ? state.registration.active.scriptURL : "inactive",
    events: state.events.map(({ title, detail, level, at, diagnostics }) => ({ title, detail, level, at, diagnostics }))
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(safe, null, 2));
    setSummary("Safe diagnostics copied. They contain no endpoint or subscription keys.", "success");
  } catch {
    setSummary("Safari could not copy the diagnostics automatically.", "warning");
  }
}

async function init() {
  state.events = loadUiEvents();
  renderEvents();

  const opened = new URLSearchParams(location.search);
  if (opened.get("opened") === "notification") {
    addEvent("notification-opened", "Notification opened the Push Lab", `Sender: ${opened.get("sender") || "unknown"}; request: ${opened.get("test") || "unknown"}`);
    setSummary("The notification successfully opened the isolated Push Lab.", "success");
    history.replaceState(null, "", "/?source=homescreen");
  }

  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    state.config = await response.json();
    versionEl.textContent = `Version ${state.config.labVersion || "unknown"}`;
  } catch {
    versionEl.textContent = "Version unavailable";
    setSummary("The Push Lab configuration could not be loaded.", "error");
  }

  if ("serviceWorker" in navigator) {
    try {
      state.registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      await state.registration.update();
      state.subscription = await state.registration.pushManager.getSubscription();
      navigator.serviceWorker.addEventListener("message", async event => {
        if (event.data && event.data.type === "PUSH_LAB_EVENT") await readWorkerEvents();
      });
    } catch (error) {
      addEvent("worker-error", "Test service worker failed", String(error && error.message || error), "error");
    }
  }

  await readWorkerEvents();
  renderChecks();
  updateButtons();
  if (state.config && !state.config.configured) {
    setSummary("Visual preview only. Test-only senders have not been configured or published.", "warning");
  } else if (state.subscription && Notification.permission === "granted") {
    setSummary("Temporary subscription restored. You can run either test.", "success");
  }
}

enableButton.addEventListener("click", enableNotifications);
block65Button.addEventListener("click", () => sendTest("block65-cloudflare"));
nodeButton.addEventListener("click", () => sendTest("node-web-push"));
copyButton.addEventListener("click", copyDiagnostics);
clearButton.addEventListener("click", clearEvents);

init();
