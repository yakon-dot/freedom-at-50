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
  var ID_YEAR_MIN = 2020;
  var ID_YEAR_MAX = 2100;
  var TAP_DEBOUNCE_MS = 2500;
  var listenersReady = false;
  var lastTapKey = "";
  var lastTapAt = 0;

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

  function isFreedomReminderId(id) {
    var n = Number(id);
    if (!Number.isFinite(n)) return false;
    if (n === ID_TEST) return true;
    var rem = n - ID_BASE;
    if (rem < 0 || !Number.isInteger(rem)) return false;
    var year = Math.floor(rem / 12);
    var month = rem % 12;
    return year >= ID_YEAR_MIN && year <= ID_YEAR_MAX && month >= 0 && month <= 11;
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

  function isFreedomReminderNotification(notification) {
    if (!isPlainObject(notification)) return false;
    if (isFreedomReminderExtra(notification.extra)) return true;
    return isFreedomReminderId(notification.id);
  }

  function uniqueIdDescriptors(ids) {
    var seen = Object.create(null);
    var out = [];
    (ids || []).forEach(function (id) {
      var n = Number(id);
      if (!Number.isFinite(n) || seen[n]) return;
      seen[n] = true;
      out.push({ id: n });
    });
    return out;
  }

  function collectFreedomIdsFromList(notifications) {
    var ids = [];
    (notifications || []).forEach(function (notification) {
      if (!isFreedomReminderNotification(notification)) return;
      if (notification.id == null) return;
      ids.push(notification.id);
    });
    return ids;
  }

  /**
   * Wide fallback id set for when getPending is unavailable — covers historical
   * Freedom monthly ids + the test id, never unrelated plugin notifications.
   */
  function buildFreedomIdFallbackRange() {
    var ids = [ID_TEST];
    var year;
    var month;
    for (year = ID_YEAR_MIN; year <= ID_YEAR_MAX; year++) {
      for (month = 0; month < 12; month++) {
        ids.push(ID_BASE + year * 12 + month);
      }
    }
    return uniqueIdDescriptors(ids);
  }

  function openReminderHomeFromNativeTap(notification) {
    var id = notification && notification.id;
    var key = id != null ? String(id) : EXTRA_OPENED;
    var now = Date.now();
    if (key === lastTapKey && now - lastTapAt < TAP_DEBOUNCE_MS) return false;
    lastTapKey = key;
    lastTapAt = now;
    try {
      if (typeof global.freedomOpenHomeFromReminder === "function") {
        global.freedomOpenHomeFromReminder({ cleanUrl: true, force: true });
        return true;
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
    try {
      if (global.FreedomMonthlyReminderCheckIn && typeof global.FreedomMonthlyReminderCheckIn.tryFromNotificationTap === "function") {
        global.FreedomMonthlyReminderCheckIn.tryFromNotificationTap();
      }
    } catch (e) {}
    return true;
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
        if (!isFreedomReminderExtra(extra) && !isFreedomReminderId(notification && notification.id)) return;
        openReminderHomeFromNativeTap(notification);
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

  async function listFreedomPendingIds(ln) {
    if (!ln || typeof ln.getPending !== "function") {
      return { ok: false, ids: [], usedFallback: true };
    }
    try {
      var pending = await ln.getPending();
      var ids = collectFreedomIdsFromList(pending && pending.notifications);
      return { ok: true, ids: ids, usedFallback: false };
    } catch (e) {
      return { ok: false, ids: [], usedFallback: true, error: e };
    }
  }

  async function listFreedomDeliveredIds(ln) {
    if (!ln || typeof ln.getDeliveredNotifications !== "function") {
      return { ok: false, ids: [] };
    }
    try {
      var delivered = await ln.getDeliveredNotifications();
      var ids = collectFreedomIdsFromList(delivered && delivered.notifications);
      return { ok: true, ids: ids };
    } catch (e) {
      return { ok: false, ids: [], error: e };
    }
  }

  async function cancelIdList(ln, ids) {
    var descriptors = uniqueIdDescriptors(ids);
    if (!descriptors.length) return { ok: true, cancelled: [] };
    if (typeof ln.cancel === "function") {
      await ln.cancel({ notifications: descriptors });
    }
    if (typeof ln.removeDeliveredNotifications === "function") {
      try {
        await ln.removeDeliveredNotifications({ notifications: descriptors });
      } catch (e) {}
    } else if (typeof ln.removeDeliveredNotificationsById === "function") {
      try {
        await ln.removeDeliveredNotificationsById({
          ids: descriptors.map(function (d) {
            return d.id;
          })
        });
      } catch (e) {}
    }
    return { ok: true, cancelled: descriptors.map(function (d) { return d.id; }) };
  }

  /**
   * Cancel every pending/delivered Freedom reminder (monthly + test).
   * Never uses cancelAll — unrelated local notifications stay untouched.
   */
  async function cancelAllFreedomReminders(options) {
    var keep = Object.create(null);
    var keepIds = (options && options.keepIds) || [];
    keepIds.forEach(function (id) {
      var n = Number(id);
      if (Number.isFinite(n)) keep[n] = true;
    });
    if (!isNativePlatform()) return { ok: true, skipped: true, cancelled: [] };
    var ln = getLocalNotifications();
    if (!ln) return { ok: false, error: "unavailable", cancelled: [] };

    var pending = await listFreedomPendingIds(ln);
    var delivered = await listFreedomDeliveredIds(ln);
    var ids = pending.ids.concat(delivered.ids);
    if (pending.usedFallback) {
      buildFreedomIdFallbackRange().forEach(function (d) {
        ids.push(d.id);
      });
    }
    /* Always include the test id so a pending test cannot outlive disable. */
    ids.push(ID_TEST);

    var toCancel = ids.filter(function (id) {
      return !keep[Number(id)];
    });

    try {
      var result = await cancelIdList(ln, toCancel);
      return {
        ok: true,
        cancelled: result.cancelled,
        usedFallback: !!pending.usedFallback
      };
    } catch (e) {
      return { ok: false, error: e, cancelled: [] };
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
    if (!notifications.length) return { ok: false, error: "no-schedule" };
    var keepIds = notifications.map(function (n) {
      return n.id;
    });
    try {
      /* Schedule first so a failure cannot wipe existing reminders while UI stays on. */
      await ln.schedule({ notifications: notifications });
      var cleared = await cancelAllFreedomReminders({ keepIds: keepIds });
      /* New set is live — treat enable/refresh as success even if orphan cleanup fails,
         so the UI cannot show “off” while monthly reminders remain scheduled. */
      return {
        ok: true,
        count: notifications.length,
        ids: keepIds,
        orphanCleanupFailed: !cleared.ok,
        orphanError: cleared.ok ? undefined : cleared.error
      };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function clearMonthlyReminders() {
    if (!isNativePlatform()) return { ok: true, skipped: true };
    return cancelAllFreedomReminders({ keepIds: [] });
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
    isFreedomReminderId: isFreedomReminderId,
    isFreedomReminderExtra: isFreedomReminderExtra,
    isFreedomReminderNotification: isFreedomReminderNotification,
    collectFreedomIdsFromList: collectFreedomIdsFromList,
    buildFreedomIdFallbackRange: buildFreedomIdFallbackRange,
    ensureListeners: ensureListeners,
    checkPermission: checkPermission,
    requestPermission: requestPermission,
    enableMonthlyReminders: enableMonthlyReminders,
    disableMonthlyReminders: disableMonthlyReminders,
    scheduleMonthlyReminders: scheduleMonthlyReminders,
    clearMonthlyReminders: clearMonthlyReminders,
    cancelAllFreedomReminders: cancelAllFreedomReminders,
    sendTestReminder: sendTestReminder,
    refreshIfEnabled: refreshIfEnabled,
    openReminderHomeFromNativeTap: openReminderHomeFromNativeTap
  };
})(typeof window !== "undefined" ? window : globalThis);
