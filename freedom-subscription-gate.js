/**
 * Freedom Phase 2 subscription gate (native iOS + RevenueCat only).
 *
 * Uses FreedomNativePurchases for offerings, purchase, restore, and entitlement.
 * PWA / web: always full access (no paywall, no read-only).
 * Demo Mode: personal data is snapshotted; demo writes stay allowed.
 */
(function (global) {
  "use strict";

  var CACHE_KEY = "freedom50-entitlement-cache-v1";
  var WRITE_BLOCK_SELECTORS = [
    "#addJourney",
    "#addGoal",
    "#addPension",
    "#toggleAddJourney",
    "#toggleAddGoal",
    "#toggleAddPension",
    "#toggleAddNote",
    ".archive-btn-restore",
    ".archive-btn-delete"
  ].join(",");

  var access = {
    refreshed: false,
    isPro: false,
    entitlement: null,
    product: null
  };
  var paywallContext = "onboarding"; /* onboarding | renew */
  var continueAfterUnlock = null;
  var bound = false;
  var busy = false;

  function purchases() {
    return global.FreedomNativePurchases || null;
  }

  function isNative() {
    var api = purchases();
    if (api && typeof api.isNative === "function") return !!api.isNative();
    try {
      var cap = global.Capacitor;
      return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function isDemo() {
    try {
      if (global.freedomDemo && typeof global.freedomDemo.isActive === "function") {
        return !!global.freedomDemo.isActive();
      }
    } catch (e) {}
    return !!(global.document && global.document.body && global.document.body.classList.contains("demo-mode-active"));
  }

  function byId(id) {
    return global.document ? global.document.getElementById(id) : null;
  }

  function readCache() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(snapshot) {
    try {
      if (!global.localStorage) return;
      var isPro = effectiveIsPro(snapshot);
      global.localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          isPro: isPro,
          expirationDate: snapshot && snapshot.expirationDate ? snapshot.expirationDate : null,
          periodType: snapshot && snapshot.periodType ? snapshot.periodType : null,
          updatedAt: new Date().toISOString()
        })
      );
    } catch (e) {}
  }

  /**
   * Active Premium only while entitlement says so AND expirationDate (if any)
   * is still in the future. Past expirationDate never counts as pro — including
   * stale localStorage caches after relaunch or failed network refresh.
   */
  function effectiveIsPro(snapshot) {
    if (!snapshot || snapshot.isPro !== true) return false;
    var raw = snapshot.expirationDate;
    if (raw == null || raw === "") return true; /* lifetime / no expiry */
    var exp = Date.parse(String(raw));
    if (!isFinite(exp)) return false; /* unparseable expiry → conservative deny */
    return exp > Date.now();
  }

  function applyEntitlement(entitlement) {
    var ent = entitlement || {};
    var isPro = effectiveIsPro(ent);
    access.entitlement = ent;
    access.isPro = isPro;
    access.refreshed = true;
    writeCache({
      isPro: isPro,
      expirationDate: ent.expirationDate || null,
      periodType: ent.periodType || null
    });
    syncReadOnlyUi();
    return ent;
  }

  function allowsPersonalWrites() {
    if (!isNative()) return true;
    if (isDemo()) return true;
    if (access.refreshed) return !!access.isPro;
    /* Before refresh: trust cache only if still unexpired. No cache → deny. */
    return effectiveIsPro(readCache());
  }

  function isReadOnlyPersonal() {
    return isNative() && !isDemo() && !allowsPersonalWrites();
  }

  function pluralUnit(value, singular) {
    return value + " " + singular + (value === 1 ? "" : "s");
  }

  /** ISO 8601 durations from StoreKit/RevenueCat, e.g. P1M, P1W, P3D, P1Y. */
  function formatIso8601Period(raw) {
    var s = String(raw || "").trim().toUpperCase();
    if (!s || s.charAt(0) !== "P") return "";
    var matched = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
    if (!matched) return "";
    var years = matched[1] ? Number(matched[1]) : 0;
    var months = matched[2] ? Number(matched[2]) : 0;
    var weeks = matched[3] ? Number(matched[3]) : 0;
    var days = matched[4] ? Number(matched[4]) : 0;
    if (years) return pluralUnit(years, "year");
    if (months) return pluralUnit(months, "month");
    if (weeks) return pluralUnit(weeks, "week");
    if (days) return pluralUnit(days, "day");
    return "";
  }

  function formatIntroPeriod(introPeriod) {
    if (introPeriod == null) return "";
    if (typeof introPeriod === "string") {
      var s = introPeriod.trim();
      if (!s) return "";
      var iso = formatIso8601Period(s);
      if (iso) return iso;
      if (/^month/i.test(s)) return "1 month";
      if (/^week/i.test(s)) return "1 week";
      if (/^year/i.test(s)) return "1 year";
      if (/^day/i.test(s)) return "1 day";
      /* Never surface raw ISO-looking tokens to customers. */
      if (/^P\d/i.test(s)) return "";
      return s;
    }
    if (typeof introPeriod === "object") {
      if (introPeriod.iso8601) {
        var fromIso = formatIso8601Period(introPeriod.iso8601);
        if (fromIso) return fromIso;
      }
      if (introPeriod.period) {
        var fromPeriod = formatIso8601Period(introPeriod.period);
        if (fromPeriod) return fromPeriod;
      }
      var unit = String(introPeriod.unit || introPeriod.periodUnit || "").toLowerCase();
      var value = Number(introPeriod.value != null ? introPeriod.value : introPeriod.numberOfUnits);
      if (!unit) return "";
      if (!value || value < 1) value = 1;
      var label = unit.replace(/s$/, "");
      if (label === "m") label = "month";
      return pluralUnit(value, label);
    }
    return "";
  }

  function buildOfferCopy(product) {
    var price = (product && product.priceString) || "";
    var hasIntro = !!(product && product.hasIntroOffer);
    var introPrice = (product && product.introPriceString) || "";
    var introPeriod = formatIntroPeriod(product && product.introPeriod);
    var headline = "Freedom Premium";
    var detail = "";
    var cta = "Subscribe";

    if (hasIntro && introPeriod) {
      var freeIntro =
        !introPrice ||
        /^free$/i.test(String(introPrice).trim()) ||
        String(introPrice).replace(/[^\d.,]/g, "") === "0" ||
        String(introPrice).replace(/[^\d.,]/g, "") === "0.00" ||
        String(introPrice).replace(/[^\d.,]/g, "") === "0,00";
      if (freeIntro) {
        detail = price
          ? "Start with " + introPeriod + " free, then " + price + " per month."
          : "Start with " + introPeriod + " free, then continue monthly.";
        cta = "Start free trial";
      } else {
        detail = price
          ? "Start with " + introPrice + " for " + introPeriod + ", then " + price + " per month."
          : "Start with " + introPrice + " for " + introPeriod + ".";
        cta = "Start trial";
      }
    } else if (price) {
      detail = price + " per month. Cancel anytime in your Apple ID settings.";
      cta = "Subscribe for " + price;
    } else {
      detail = "Unlock full Freedom on your iPhone. Pricing loads from the App Store.";
      cta = "Continue";
    }

    return { headline: headline, detail: detail, cta: cta, priceString: price };
  }

  function setStatus(message, isError) {
    var el = byId("freedomPaywallStatus");
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
    el.classList.toggle("is-error", !!isError && !!message);
  }

  function setBusy(next) {
    busy = !!next;
    ["freedomPaywallStart", "freedomPaywallRestore", "freedomPaywallDemo"].forEach(function (id) {
      var btn = byId(id);
      if (btn) btn.disabled = busy;
    });
  }

  function fillPaywallProduct(product) {
    access.product = product || null;
    var copy = buildOfferCopy(product);
    var title = byId("freedomPaywallTitle");
    var detail = byId("freedomPaywallDetail");
    var start = byId("freedomPaywallStart");
    var support = byId("freedomPaywallSupport");
    if (title) title.textContent = copy.headline;
    if (detail) detail.textContent = copy.detail;
    if (start) start.textContent = copy.cta;
    if (support) {
      support.textContent =
        paywallContext === "renew"
          ? "Your information is still here. Restore access to keep making changes."
          : "Explore Demo Mode anytime. Your personal numbers stay on this iPhone.";
    }
  }

  function syncReadOnlyUi() {
    var banner = byId("freedomReadOnlyBanner");
    var body = global.document && global.document.body;
    var readOnly = isReadOnlyPersonal();
    if (body) body.classList.toggle("freedom-readonly-active", readOnly);
    if (banner) banner.hidden = !readOnly;
  }

  function hidePaywall() {
    var el = byId("freedomPaywall");
    if (!el) return;
    el.hidden = true;
    el.classList.remove("is-present");
    setStatus("");
    setBusy(false);
    continueAfterUnlock = null;
  }

  async function loadOfferingIntoPaywall() {
    var api = purchases();
    if (!api || typeof api.getMonthlyOffering !== "function") {
      fillPaywallProduct(null);
      setStatus("Purchases are not available in this build.", true);
      return null;
    }
    setStatus("Loading offer…");
    var offering = await api.getMonthlyOffering();
    if (!offering || !offering.ok) {
      fillPaywallProduct(null);
      setStatus((offering && offering.error) || "Could not load the App Store offer.", true);
      return offering;
    }
    fillPaywallProduct(offering.product);
    setStatus("");
    return offering;
  }

  function showPaywall(opts) {
    opts = opts || {};
    paywallContext = opts.context === "renew" ? "renew" : "onboarding";
    continueAfterUnlock = typeof opts.onUnlocked === "function" ? opts.onUnlocked : null;
    var el = byId("freedomPaywall");
    if (!el) {
      if (continueAfterUnlock) continueAfterUnlock({ skipped: true });
      return;
    }
    var demoBtn = byId("freedomPaywallDemo");
    if (demoBtn) {
      demoBtn.hidden = paywallContext === "renew" && opts.allowDemo === false;
      demoBtn.textContent = paywallContext === "renew" ? "Enter Demo Mode" : "Continue in Demo Mode";
    }
    el.hidden = false;
    el.classList.add("is-present");
    fillPaywallProduct(access.product);
    void loadOfferingIntoPaywall();
  }

  function finishUnlocked(result) {
    var cb = continueAfterUnlock;
    hidePaywall();
    syncReadOnlyUi();
    if (cb) cb(result || { ok: true });
  }

  async function refreshEntitlement() {
    if (!isNative()) {
      access.refreshed = true;
      access.isPro = true;
      access.entitlement = { isPro: true, native: false };
      syncReadOnlyUi();
      return { ok: true, native: false, entitlement: access.entitlement };
    }
    var api = purchases();
    if (!api || typeof api.getCustomerEntitlement !== "function") {
      access.refreshed = true;
      access.isPro = false;
      syncReadOnlyUi();
      return { ok: false, code: "plugin-unavailable", entitlement: access.entitlement };
    }
    try {
      var result = await api.getCustomerEntitlement();
      if (!result || !result.ok) {
        access.refreshed = true;
        /* Offline/error: keep personal data, but only allow writes if cache is still unexpired. */
        access.isPro = effectiveIsPro(readCache());
        syncReadOnlyUi();
        return result || { ok: false, code: "customer-info-failed" };
      }
      applyEntitlement(result.entitlement || {});
      return result;
    } catch (e) {
      access.refreshed = true;
      access.isPro = effectiveIsPro(readCache());
      syncReadOnlyUi();
      return { ok: false, code: "customer-info-failed", error: String(e && e.message ? e.message : e) };
    }
  }

  async function afterCompanionSelection(onContinue) {
    var done = typeof onContinue === "function" ? onContinue : function () {};
    if (!isNative()) {
      done({ skipped: true, reason: "not-native" });
      return;
    }
    if (isDemo()) {
      done({ skipped: true, reason: "demo" });
      return;
    }
    var result = await refreshEntitlement();
    if (access.isPro) {
      done({ ok: true, entitlement: access.entitlement, from: "entitlement" });
      return;
    }
    showPaywall({
      context: "onboarding",
      onUnlocked: function (unlock) {
        done(unlock || { ok: true });
      }
    });
    if (result && result.ok === false && result.code === "plugin-unavailable") {
      setStatus("Purchases are not available in this build.", true);
    }
  }

  function notifyWriteBlocked() {
    if (!isNative() || isDemo()) return false;
    showPaywall({ context: "renew", allowDemo: true });
    return true;
  }

  async function startPurchase() {
    if (busy) return;
    var api = purchases();
    if (!api || typeof api.purchaseMonthly !== "function") {
      setStatus("Purchases are not available in this build.", true);
      return;
    }
    setBusy(true);
    setStatus("Connecting to the App Store…");
    try {
      var result = await api.purchaseMonthly();
      if (!result || !result.ok) {
        if (result && result.cancelled) {
          setStatus("Purchase cancelled.", false);
        } else {
          setStatus((result && result.error) || "Purchase could not be completed.", true);
        }
        setBusy(false);
        return;
      }
      applyEntitlement(result.entitlement || {});
      if (!access.isPro) {
        setStatus("Purchase finished, but Premium is not active yet. Try Restore Purchases.", true);
        setBusy(false);
        return;
      }
      finishUnlocked({ ok: true, purchased: true, entitlement: access.entitlement });
    } catch (e) {
      setStatus(String(e && e.message ? e.message : e) || "Purchase could not be completed.", true);
      setBusy(false);
    }
  }

  async function startRestore() {
    if (busy) return;
    var api = purchases();
    if (!api || typeof api.restorePurchases !== "function") {
      setStatus("Purchases are not available in this build.", true);
      return;
    }
    setBusy(true);
    setStatus("Restoring purchases…");
    try {
      var result = await api.restorePurchases();
      if (!result || !result.ok) {
        setStatus((result && result.error) || "Could not restore purchases.", true);
        setBusy(false);
        return;
      }
      applyEntitlement(result.entitlement || {});
      if (!access.isPro) {
        setStatus("No active Freedom Premium subscription found for this Apple ID.", true);
        setBusy(false);
        return;
      }
      finishUnlocked({ ok: true, restored: true, entitlement: access.entitlement });
    } catch (e) {
      setStatus(String(e && e.message ? e.message : e) || "Could not restore purchases.", true);
      setBusy(false);
    }
  }

  function continueInDemo() {
    hidePaywall();
    if (typeof global.enterDemo === "function") {
      global.enterDemo();
      return;
    }
    if (global.freedomDemo && typeof global.freedomDemo.openEntry === "function") {
      global.freedomDemo.openEntry();
    }
  }

  function onWriteIntentClick(event) {
    if (allowsPersonalWrites()) return;
    var target = event.target && event.target.closest ? event.target.closest(WRITE_BLOCK_SELECTORS) : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    notifyWriteBlocked();
  }

  function bindUi() {
    if (bound || !global.document) return;
    bound = true;
    var start = byId("freedomPaywallStart");
    var restore = byId("freedomPaywallRestore");
    var demo = byId("freedomPaywallDemo");
    var renew = byId("freedomReadOnlyRenew");
    if (start) start.addEventListener("click", function () { void startPurchase(); });
    if (restore) restore.addEventListener("click", function () { void startRestore(); });
    if (demo) demo.addEventListener("click", function () { continueInDemo(); });
    if (renew) {
      renew.addEventListener("click", function () {
        showPaywall({ context: "renew", allowDemo: true });
      });
    }
    global.document.addEventListener("click", onWriteIntentClick, true);
  }

  /* Hydrate from cache so a brief boot flash does not unlock writes after expiry. */
  (function hydrateFromCache() {
    if (!isNative()) return;
    var cached = readCache();
    if (!cached) return;
    var isPro = effectiveIsPro(cached);
    access.isPro = isPro;
    access.entitlement = {
      isPro: isPro,
      expirationDate: cached.expirationDate || null,
      periodType: cached.periodType || null
    };
    /* Rewrite cache if a stale isPro:true had already passed expirationDate. */
    if (cached.isPro === true && !isPro) {
      writeCache({
        isPro: false,
        expirationDate: cached.expirationDate || null,
        periodType: cached.periodType || null
      });
    }
  })();

  if (global.document && global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", bindUi);
  } else {
    bindUi();
  }

  global.FreedomSubscriptionGate = {
    isNative: isNative,
    allowsPersonalWrites: allowsPersonalWrites,
    isReadOnlyPersonal: isReadOnlyPersonal,
    refreshEntitlement: refreshEntitlement,
    afterCompanionSelection: afterCompanionSelection,
    showPaywall: showPaywall,
    hidePaywall: hidePaywall,
    notifyWriteBlocked: notifyWriteBlocked,
    startPurchase: startPurchase,
    startRestore: startRestore,
    continueInDemo: continueInDemo,
    syncReadOnlyUi: syncReadOnlyUi,
    getAccess: function () {
      return {
        refreshed: access.refreshed,
        isPro: access.isPro,
        entitlement: access.entitlement,
        product: access.product
      };
    },
    _test: {
      buildOfferCopy: buildOfferCopy,
      formatIntroPeriod: formatIntroPeriod,
      formatIso8601Period: formatIso8601Period,
      effectiveIsPro: effectiveIsPro,
      applyEntitlement: applyEntitlement,
      CACHE_KEY: CACHE_KEY,
      WRITE_BLOCK_SELECTORS: WRITE_BLOCK_SELECTORS
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
