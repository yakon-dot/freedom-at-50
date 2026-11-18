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
const pbx = fs.readFileSync(path.join(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
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
assert.match(index, /alreadyPending/);
assert.match(index, /Could not cancel scheduled Freedom reminders/);
assert.match(index, /Your reminders stay on until they can be cancelled/);
assert.match(index, /closeFreedomRemindersPanel/);
assert.match(
  index,
  /freedomOpenHomeFromReminder=function[\s\S]*?closeFreedomRemindersPanel[\s\S]*?page\("home"\)/
);
assert.match(index, /Always dismiss blocking overlays first/);
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
assert.equal(/DEVELOPMENT_TEAM\s*=/.test(pbx), false, "Do not commit a personal DEVELOPMENT_TEAM");
assert.match(nativeSrc, /A little nudge/);
assert.match(nativeSrc, /Your companion has something for you\. Tap to see what’s waiting\./);
assert.match(nativeSrc, /freedomOpened/);
assert.match(nativeSrc, /allowWhileIdle/);
assert.match(nativeSrc, /registerPlugin\("LocalNotifications"\)/);
assert.match(nativeSrc, /getPending/);
assert.match(nativeSrc, /cancelAllFreedomReminders/);
assert.equal(/cancelAll\(/.test(nativeSrc), false, "Must not cancel unrelated local notifications");
assert.equal(/@capacitor\/push-notifications|PushNotifications\.|registerPlugin\("PushNotifications"\)/.test(nativeSrc), false, "Native path must stay local, not APNs");
assert.equal(
  index.includes("freedomSubscribePush()") && index.includes("freedomRemindersNativeAvailable()"),
  true
);
assert.match(index, /Same notification tap can reach us from native listener/);
console.log("PASS: source contracts for native local notifications");

function loadApi(capacitorMock, windowExtras = {}) {
  const sandbox = {
    window: { ...windowExtras },
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
  return { api: sandbox.window.FreedomNativeNotifications, window: sandbox.window };
}

const { api } = loadApi(undefined);
assert.equal(api.isNative(), false);
assert.equal(api.isFreedomReminderExtra({ freedomOpened: "reminder" }), true);
assert.equal(api.isFreedomReminderExtra({ opened: "reminder" }), true);
assert.equal(api.isFreedomReminderExtra({ freedomOpened: "other" }), false);
assert.equal(api.isFreedomReminderExtra(null), false);
assert.equal(api.isFreedomReminderId(api.idTest), true);
assert.equal(api.isFreedomReminderId(api.notificationIdForDate(new Date(2026, 10, 30))), true);
assert.equal(api.isFreedomReminderId(42), false, "unrelated notification ids must not match");
assert.equal(api.isFreedomReminderId(api.idBase - 1), false);

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

function mockLocalNotifications(seedPending = [], seedDelivered = []) {
  let pending = seedPending.map((n) => ({ ...n }));
  let delivered = seedDelivered.map((n) => ({ ...n }));
  const scheduled = [];
  const cancelled = [];
  const removedDelivered = [];
  const listeners = {};
  return {
    plugin: {
      schedule: async ({ notifications }) => {
        scheduled.push(...notifications);
        for (const n of notifications) {
          pending = pending.filter((p) => p.id !== n.id);
          pending.push({ id: n.id, extra: n.extra, title: n.title, body: n.body });
        }
        return { notifications };
      },
      cancel: async ({ notifications }) => {
        const cancelIds = notifications.map((n) => n.id);
        cancelled.push(...cancelIds);
        pending = pending.filter((p) => !cancelIds.includes(p.id));
        return {};
      },
      getPending: async () => ({ notifications: pending.slice() }),
      getDeliveredNotifications: async () => ({ notifications: delivered.slice() }),
      removeDeliveredNotifications: async ({ notifications }) => {
        const idsToRemove = notifications.map((n) => n.id);
        removedDelivered.push(...idsToRemove);
        delivered = delivered.filter((d) => !idsToRemove.includes(d.id));
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
    removedDelivered,
    listeners,
    getPending: () => pending,
    getDelivered: () => delivered
  };
}

{
  const oldFreedomId = api.notificationIdForDate(new Date(2025, 0, 31)); /* Jan 2025 orphan */
  const unrelated = { id: 42, title: "Other", extra: { feature: "unrelated" } };
  const mock = mockLocalNotifications(
    [
      { id: oldFreedomId, extra: { freedomOpened: "reminder" } },
      { id: api.idTest, extra: { freedomOpened: "reminder" } },
      unrelated
    ],
    [{ id: oldFreedomId, extra: { freedomOpened: "reminder" } }]
  );
  const { api: nativeApi } = loadApi({
    isNativePlatform: () => true,
    Plugins: { LocalNotifications: mock.plugin },
    registerPlugin: () => mock.plugin
  });

  const enabled = await nativeApi.enableMonthlyReminders();
  assert.equal(enabled.ok, true);
  assert.equal(enabled.count, 12);
  assert.ok(mock.cancelled.includes(oldFreedomId), "older Freedom months must be cancelled");
  assert.ok(mock.cancelled.includes(api.idTest), "test reminder must be cancelled on reschedule");
  assert.equal(mock.cancelled.includes(42), false, "unrelated notifications must remain");
  assert.equal(
    mock.getPending().some((n) => n.id === 42),
    true,
    "unrelated pending notification must survive"
  );
  assert.equal(mock.scheduled.length, 12);

  mock.scheduled.length = 0;
  const test = await nativeApi.sendTestReminder();
  assert.equal(test.ok, true);
  assert.equal(test.mode, "native-local");
  assert.equal(mock.scheduled.length, 1);
  assert.equal(mock.scheduled[0].id, nativeApi.idTest);

  const disabled = await nativeApi.disableMonthlyReminders();
  assert.equal(disabled.ok, true);
  assert.ok(disabled.cancelled.includes(nativeApi.idTest));
  assert.equal(
    mock.getPending().some((n) => nativeApi.isFreedomReminderId(n.id)),
    false,
    "no Freedom reminders may remain after disable"
  );
  assert.equal(mock.getPending().some((n) => n.id === 42), true);
}

{
  const mock = mockLocalNotifications([{ id: 42, extra: { feature: "unrelated" } }]);
  mock.plugin.schedule = async () => {
    throw new Error("schedule-failed");
  };
  const { api: nativeApi } = loadApi({
    isNativePlatform: () => true,
    Plugins: { LocalNotifications: mock.plugin },
    registerPlugin: () => mock.plugin
  });
  const before = mock.getPending().map((n) => n.id);
  const failed = await nativeApi.scheduleMonthlyReminders(now);
  assert.equal(failed.ok, false);
  assert.deepEqual(
    mock.getPending().map((n) => n.id),
    before,
    "failed schedule must not wipe existing notifications"
  );
  assert.equal(mock.cancelled.length, 0, "failed schedule must not cancel first");
}

{
  const mock = mockLocalNotifications([
    { id: api.idTest, extra: { freedomOpened: "reminder" } },
    { id: 42, extra: { feature: "unrelated" } }
  ]);
  mock.plugin.cancel = async () => {
    throw new Error("cancel-failed");
  };
  const { api: nativeApi } = loadApi({
    isNativePlatform: () => true,
    Plugins: { LocalNotifications: mock.plugin },
    registerPlugin: () => mock.plugin
  });
  const cleared = await nativeApi.disableMonthlyReminders();
  assert.equal(cleared.ok, false, "disable must report cancel failure");
  assert.equal(mock.getPending().some((n) => n.id === api.idTest), true);
}

{
  let opened = 0;
  const tapMock = mockLocalNotifications();
  const { api: tapApi } = loadApi(
    {
      isNativePlatform: () => true,
      Plugins: { LocalNotifications: tapMock.plugin },
      registerPlugin: () => tapMock.plugin
    },
    {
      freedomOpenHomeFromReminder: () => {
        opened += 1;
        return true;
      }
    }
  );
  await tapApi.ensureListeners();
  assert.ok(typeof tapMock.listeners.localNotificationActionPerformed === "function");
  await tapMock.listeners.localNotificationActionPerformed({
    notification: { id: tapApi.idTest, extra: { freedomOpened: "reminder" } }
  });
  await tapMock.listeners.localNotificationActionPerformed({
    notification: { id: tapApi.idTest, extra: { freedomOpened: "reminder" } }
  });
  assert.equal(opened, 1, "duplicate native tap events for the same id must debounce");
  await tapMock.listeners.localNotificationActionPerformed({
    notification: { extra: { freedomOpened: "other" }, id: 99 }
  });
  assert.equal(opened, 1, "non-reminder extras must not open Home check-in");
}

{
  const denied = mockLocalNotifications();
  denied.plugin.requestPermissions = async () => ({ display: "denied" });
  denied.plugin.checkPermissions = async () => ({ display: "denied" });
  const { api: deniedApi } = loadApi({
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
  const { api: pwaApi } = loadApi({
    isNativePlatform: () => false,
    Plugins: {},
    registerPlugin: () => null
  });
  const skipped = await pwaApi.enableMonthlyReminders();
  assert.equal(skipped.skipped, true);
}

/* Index contracts: openHome arms only when not already pending. */
assert.match(
  index,
  /const alreadyPending=!!\(checkIn&&typeof checkIn\.isPending==="function"&&checkIn\.isPending\(\)\);/
);
assert.match(index, /if\(!alreadyPending\)\{/);
assert.match(index, /if\(readPending\(\)\|\|window\.__FREEDOM_FROM_REMINDER__\)/);
assert.match(index, /Stay pending without resetting retry\/show state mid-flight/);

console.log("PASS: native cancel-all, schedule failure safety, tap debounce, and permission paths");
