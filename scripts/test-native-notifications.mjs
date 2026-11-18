/**
 * Native iOS monthly reminders — local notifications contracts + schedule helpers.
 * PWA Web Push / Worker paths stay separate; this only covers the Capacitor branch.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const nativeSrc = fs.readFileSync(path.join(root, "freedom-native-notifications.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-capacitor-web.mjs"), "utf8");
const capAppSpm = fs.readFileSync(
  path.join(root, "ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift"),
  "utf8"
);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(index, /freedom-native-notifications\.js/);
assert.match(index, /freedomRemindersNativeAvailable/);
assert.match(index, /FreedomNativeNotifications\.enableMonthlyReminders/);
assert.match(index, /FreedomNativeNotifications\.disableMonthlyReminders/);
assert.match(index, /FreedomNativeNotifications\.sendTestReminder/);
assert.match(index, /FreedomNativeNotifications\.refreshIfEnabled/);
assert.match(index, /reason:"native-local"/);
assert.match(index, /isNativeLocal:freedomRemindersNativeAvailable/);
assert.match(sw, /freedom-native-notifications\.js/);
assert.match(sw, /freedom-at-50-v1\.8\.6\.162/);
assert.match(prepare, /freedom-native-notifications\.js/);
assert.equal(
  !!pkg.dependencies["@capacitor/local-notifications"],
  true,
  "local-notifications dependency required for native reminders"
);
assert.match(capAppSpm, /import LocalNotificationsPlugin/);
assert.match(capAppSpm, /LocalNotificationsPlugin\.self/);
assert.match(nativeSrc, /A little nudge/);
assert.match(nativeSrc, /Your companion has something for you\. Tap to see what’s waiting\./);
assert.match(nativeSrc, /freedomOpened/);
assert.match(nativeSrc, /allowWhileIdle/);
assert.match(nativeSrc, /registerPlugin\("LocalNotifications"\)/);
assert.equal(/@capacitor\/push-notifications|PushNotifications\.|registerPlugin\("PushNotifications"\)/.test(nativeSrc), false, "Native path must stay local, not APNs");
assert.equal(
  index.includes("freedomSubscribePush()") && index.includes("freedomRemindersNativeAvailable()"),
  true
);
console.log("PASS: source contracts for native local notifications");

function loadApi(capacitorMock) {
  const sandbox = {
    window: {},
    globalThis: {},
    console,
    Date,
    Error,
    Math,
    Number,
    Array,
    Object,
    String,
    Promise,
    setTimeout,
    clearTimeout
  };
  sandbox.window.Capacitor = capacitorMock;
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(nativeSrc, sandbox, { filename: "freedom-native-notifications.js" });
  return sandbox.window.FreedomNativeNotifications;
}

const api = loadApi(undefined);
assert.equal(api.isNative(), false);
assert.equal(api.isFreedomReminderExtra({ freedomOpened: "reminder" }), true);
assert.equal(api.isFreedomReminderExtra({ opened: "reminder" }), true);
assert.equal(api.isFreedomReminderExtra({ freedomOpened: "other" }), false);
assert.equal(api.isFreedomReminderExtra(null), false);

const now = new Date(2026, 10, 18, 12, 0, 0); /* 18 Nov 2026 local */
const dates = api.buildMonthlyScheduleDates(now, 12);
assert.equal(dates.length, 12);
assert.equal(dates[0].getFullYear(), 2026);
assert.equal(dates[0].getMonth(), 10); /* Nov last day */
assert.equal(dates[0].getDate(), 30);
assert.equal(dates[0].getHours(), 17);
assert.equal(dates[0].getMinutes(), 0);
assert.ok(dates[0].getTime() > now.getTime());
assert.equal(dates[1].getMonth(), 11);
assert.equal(dates[1].getDate(), 31);
assert.equal(dates[11].getFullYear(), 2027);
assert.equal(dates[11].getMonth(), 9); /* Oct 2027 */

const late = new Date(2026, 10, 30, 18, 0, 0); /* after Nov fire */
const after = api.buildMonthlyScheduleDates(late, 3);
assert.equal(after[0].getMonth(), 11); /* Dec */
assert.equal(after.length, 3);

const notes = api.buildMonthlyNotifications(now);
assert.equal(notes.length, 12);
assert.equal(notes[0].title, "A little nudge");
assert.equal(notes[0].body, "Your companion has something for you. Tap to see what’s waiting.");
assert.equal(notes[0].extra.freedomOpened, "reminder");
assert.equal(notes[0].schedule.allowWhileIdle, true);
assert.equal(typeof notes[0].id, "number");
assert.notEqual(notes[0].id, api.idTest);
const ids = new Set(notes.map((n) => n.id));
assert.equal(ids.size, notes.length, "monthly notification ids must be unique");

function mockLocalNotifications() {
  const scheduled = [];
  const cancelled = [];
  const listeners = {};
  return {
    plugin: {
      schedule: async ({ notifications }) => {
        scheduled.push(...notifications);
        return { notifications };
      },
      cancel: async ({ notifications }) => {
        cancelled.push(...notifications.map((n) => n.id));
        return {};
      },
      checkPermissions: async () => ({ display: "granted" }),
      requestPermissions: async () => ({ display: "granted" }),
      addListener: async (event, cb) => {
        listeners[event] = cb;
        return { remove: async () => {} };
      }
    },
    scheduled,
    cancelled,
    listeners
  };
}

{
  const mock = mockLocalNotifications();
  const nativeApi = loadApi({
    isNativePlatform: () => true,
    Plugins: { LocalNotifications: mock.plugin },
    registerPlugin: () => mock.plugin
  });
  const enabled = await nativeApi.enableMonthlyReminders();
  assert.equal(enabled.ok, true);
  assert.equal(enabled.count, 12);
  assert.ok(mock.cancelled.length >= 12);
  assert.equal(mock.scheduled.length, 12);

  mock.scheduled.length = 0;
  const test = await nativeApi.sendTestReminder();
  assert.equal(test.ok, true);
  assert.equal(test.mode, "native-local");
  assert.equal(mock.scheduled.length, 1);
  assert.equal(mock.scheduled[0].id, nativeApi.idTest);
  assert.equal(mock.scheduled[0].extra.freedomOpened, "reminder");

  let opened = 0;
  const sandboxWindow = { FreedomNativeNotifications: nativeApi };
  /* re-bind open helper through a fresh load with tap spy */
  const tapMock = mockLocalNotifications();
  const tapSandbox = {
    window: {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: { LocalNotifications: tapMock.plugin },
        registerPlugin: () => tapMock.plugin
      },
      freedomOpenHomeFromReminder: () => {
        opened += 1;
        return true;
      }
    },
    globalThis: null,
    console,
    Date,
    Error,
    Math,
    Number,
    Array,
    Object,
    String,
    Promise,
    setTimeout,
    clearTimeout
  };
  tapSandbox.globalThis = tapSandbox.window;
  vm.runInNewContext(nativeSrc, tapSandbox, { filename: "freedom-native-notifications.js" });
  const tapApi = tapSandbox.window.FreedomNativeNotifications;
  await tapApi.ensureListeners();
  assert.ok(typeof tapMock.listeners.localNotificationActionPerformed === "function");
  await tapMock.listeners.localNotificationActionPerformed({
    notification: { extra: { freedomOpened: "reminder" } }
  });
  assert.equal(opened, 1);
  await tapMock.listeners.localNotificationActionPerformed({
    notification: { extra: { freedomOpened: "other" } }
  });
  assert.equal(opened, 1, "non-reminder extras must not open Home check-in");
  void sandboxWindow;
}

{
  const denied = mockLocalNotifications();
  denied.plugin.requestPermissions = async () => ({ display: "denied" });
  denied.plugin.checkPermissions = async () => ({ display: "denied" });
  const deniedApi = loadApi({
    isNativePlatform: () => true,
    Plugins: { LocalNotifications: denied.plugin },
    registerPlugin: () => denied.plugin
  });
  let threw = null;
  try {
    await deniedApi.enableMonthlyReminders();
  } catch (e) {
    threw = e;
  }
  assert.ok(threw);
  assert.equal(threw.code, "permission");
  assert.equal(denied.scheduled.length, 0);
}

{
  const pwaApi = loadApi({
    isNativePlatform: () => false,
    Plugins: {},
    registerPlugin: () => null
  });
  const skipped = await pwaApi.enableMonthlyReminders();
  assert.equal(skipped.skipped, true);
}

console.log("PASS: native local notification schedule, permission deny, and tap routing");
