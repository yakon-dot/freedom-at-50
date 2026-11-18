/**
 * Freedom native monthly reminders (Capacitor Local Notifications).
 *
 * PWA Web Push + Cloudflare Worker stay unchanged. This module only runs when
 * Capacitor.isNativePlatform() is true. It schedules end-of-month local
 * notifications (no APNs) and routes taps into the existing
 * ?opened=reminder → Home + one-shot companion check-in path.
 */
(function (global) {
  "use strict";

  var REMINDER_TITLE = "A little nudge";
  var REMINDER_BODY =
    "Your companion has something for you. Tap to see what’s waiting.";
  var EXTRA_OPENED = "reminder";
  var ID_BASE = 51001;
  var ID_TEST = 51999;
  var MONTHS_AHEAD = 12;
  var HOUR_LOCAL = 17;
  var MINUTE_LOCAL = 0;
  var listenersReady = false;

  function isNativePlatform() {
    try {
      var cap = global.Capacitor;
      return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function getLocalNotifications() {
    if (!isNativePlatform()) return null;
    try {
      var cap = global.Capacitor;
      if (!cap) return null;
      var plugins = cap.Plugins || {};
      if (plugins.LocalNotifications && typeof plugins.LocalNotifications.schedule === "function") {
        return plugins.LocalNotifications;
      }
      if (typeof cap.registerPlugin !== "function") return null;
      return cap.registerPlugin("LocalNotifications");
    } catch (e) {
      return null;
    }
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function lastDayOfMonthLocal(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function endOfMonthAtLocalHour(fromDate, monthsAhead) {
    var base = fromDate instanceof Date ? fromDate : new Date();
    var y = base.getFullYear();
    var m = base.getMonth() + (Number(monthsAhead) || 0);
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    var day = lastDayOfMonthLocal(y, m);
    return new Date(y, m, day, HOUR_LOCAL, MINUTE_LOCAL, 0, 0);
  }

  /**
   * Pure helper: next MONTHS_AHEAD end-of-month fire times strictly after `now`.
   */
  function buildMonthlyScheduleDates(now, monthsAhead) {
    var from = now instanceof Date ? now : new Date();
    var count = Math.max(1, Number(monthsAhead) || MONTHS_AHEAD);
    var out = [];
    var offset = 0;
    while (out.length < count && offset < count + 3) {
      var candidate = endOfMonthAtLocalHour(from, offset);
      if (candidate.getTime() > from.getTime()) out.push(candidate);
      offset += 1;
    }
    return out;
  }

  function notificationIdForDate(date) {
    var d = date instanceof Date ? date : new Date(date);
    return ID_BASE + d.getFullYear() * 12 + d.getMonth();
  }

  function buildMonthlyNotifications(now) {
    var dates = buildMonthlyScheduleDates(now, MONTHS_AHEAD);
    return dates.map(function (at) {
      return {
        id: notificationIdForDate(at),
        title: REMINDER_TITLE,
        body: REMINDER_BODY,
        schedule: { at: at, allowWhileIdle: true },
        extra: { freedomOpened: EXTRA_OPENED },
        sound: "default"
      };
    });
  }

  function isFreedomReminderExtra(extra) {
    if (!isPlainObject(extra)) return false;
    return extra.freedomOpened === EXTRA_OPENED || extra.opened === EXTRA_OPENED;
  }

  function openReminderHomeFromNativeTap() {
    try {
      if (typeof global.freedomOpenHomeFromReminder === "function") {
        global.freedomOpenHomeFromReminder({ cleanUrl: true, force: true });
        return;
      }
    } catch (e) {}
    try {
      if (global.FreedomMonthlyReminderCheckIn && typeof global.FreedomMonthlyReminderCheckIn.armFromNotificationTap === "function") {
        global.FreedomMonthlyReminderCheckIn.armFromNotificationTap();
      }
    } catch (e) {}
    try {
      if (typeof global.showHome === "function") global.showHome();
    } catch (e) {}
  }

  async function ensureListeners() {
    if (listenersReady || !isNativePlatform()) return;
    var ln = getLocalNotifications();
    if (!ln || typeof ln.addListener !== "function") return;
    listenersReady = true;
    try {
      await ln.addListener("localNotificationActionPerformed", function (event) {
        var notification = event && event.notification;
        var extra = notification && notification.extra;
        if (!isFreedomReminderExtra(extra)) return;
        openReminderHomeFromNativeTap();
      });
    } catch (e) {}
  }

  async function checkPermission() {
    if (!isNativePlatform()) return { display: "prompt" };
    var ln = getLocalNotifications();
    if (!ln || typeof ln.checkPermissions !== "function") return { display: "denied" };
    try {
      return await ln.checkPermissions();
    } catch (e) {
      return { display: "denied" };
    }
  }

  async function requestPermission() {
    if (!isNativePlatform()) return { display: "denied" };
    var ln = getLocalNotifications();
    if (!ln || typeof ln.requestPermissions !== "function") return { display: "denied" };
    try {
      return await ln.requestPermissions();
    } catch (e) {
      return { display: "denied" };
    }
  }

  async function cancelFreedomReminderIds() {
    var ln = getLocalNotifications();
    if (!ln) return { ok: false, error: "unavailable" };
    var ids = [];
    var i;
    for (i = 0; i < MONTHS_AHEAD + 3; i++) {
      var at = endOfMonthAtLocalHour(new Date(), i);
      ids.push({ id: notificationIdForDate(at) });
    }
    ids.push({ id: ID_TEST });
    try {
      if (typeof ln.cancel === "function") {
        await ln.cancel({ notifications: ids });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function scheduleMonthlyReminders(now) {
    if (!isNativePlatform()) return { ok: true, skipped: true };
    await ensureListeners();
    var ln = getLocalNotifications();
    if (!ln || typeof ln.schedule !== "function") {
      return { ok: false, error: "local-notifications-unavailable" };
    }
    var notifications = buildMonthlyNotifications(now || new Date());
    try {
      await cancelFreedomReminderIds();
      if (!notifications.length) return { ok: false, error: "no-schedule" };
      await ln.schedule({ notifications: notifications });
      return { ok: true, count: notifications.length, ids: notifications.map(function (n) { return n.id; }) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function clearMonthlyReminders() {
    if (!isNativePlatform()) return { ok: true, skipped: true };
    return cancelFreedomReminderIds();
  }

  async function enableMonthlyReminders() {
    if (!isNativePlatform()) return { ok: true, skipped: true };
    await ensureListeners();
    var perm = await requestPermission();
    if (!perm || perm.display !== "granted") {
      var err = new Error("permission");
      err.code = "permission";
      throw err;
    }
    return scheduleMonthlyReminders(new Date());
  }

  async function disableMonthlyReminders() {
    if (!isNativePlatform()) return { ok: true, skipped: true };
    return clearMonthlyReminders();
  }

  async function sendTestReminder() {
    if (!isNativePlatform()) return { ok: false, error: "not-native" };
    await ensureListeners();
    var ln = getLocalNotifications();
    if (!ln || typeof ln.schedule !== "function") {
      return { ok: false, error: "local-notifications-unavailable" };
    }
    var perm = await checkPermission();
    if (!perm || perm.display !== "granted") {
      perm = await requestPermission();
    }
    if (!perm || perm.display !== "granted") {
      var err = new Error("permission");
      err.code = "permission";
      throw err;
    }
    var at = new Date(Date.now() + 1200);
    try {
      await ln.schedule({
        notifications: [
          {
            id: ID_TEST,
            title: REMINDER_TITLE,
            body: REMINDER_BODY,
            schedule: { at: at, allowWhileIdle: true },
            extra: { freedomOpened: EXTRA_OPENED },
            sound: "default"
          }
        ]
      });
      return { ok: true, mode: "native-local", at: at.toISOString() };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function refreshIfEnabled(getChoice) {
    if (!isNativePlatform()) return { ok: true, skipped: true };
    var choice = "";
    try {
      choice = typeof getChoice === "function" ? getChoice() : "";
    } catch (e) {}
    if (choice !== "keep") return { ok: true, disabled: true };
    var perm = await checkPermission();
    if (!perm || perm.display !== "granted") return { ok: false, error: "permission" };
    return scheduleMonthlyReminders(new Date());
  }

  global.FreedomNativeNotifications = {
    isNative: isNativePlatform,
    title: REMINDER_TITLE,
    body: REMINDER_BODY,
    idBase: ID_BASE,
    idTest: ID_TEST,
    monthsAhead: MONTHS_AHEAD,
    buildMonthlyScheduleDates: buildMonthlyScheduleDates,
    buildMonthlyNotifications: buildMonthlyNotifications,
    notificationIdForDate: notificationIdForDate,
    isFreedomReminderExtra: isFreedomReminderExtra,
    ensureListeners: ensureListeners,
    checkPermission: checkPermission,
    requestPermission: requestPermission,
    enableMonthlyReminders: enableMonthlyReminders,
    disableMonthlyReminders: disableMonthlyReminders,
    scheduleMonthlyReminders: scheduleMonthlyReminders,
    clearMonthlyReminders: clearMonthlyReminders,
    sendTestReminder: sendTestReminder,
    refreshIfEnabled: refreshIfEnabled,
    openReminderHomeFromNativeTap: openReminderHomeFromNativeTap
  };
})(typeof window !== "undefined" ? window : globalThis);
