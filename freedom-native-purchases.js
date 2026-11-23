/**
 * Freedom native purchases (Capacitor iOS + RevenueCat only).
 *
 * Phase 1: initialise SDK, load offerings, purchase monthly package, restore,
 * and report the `pro` entitlement. No paywall UI and no read-only gating yet.
 *
 * No-ops on the GitHub Pages / PWA build. Does not touch financial localStorage.
 */
(function (global) {
  "use strict";

  var PLUGIN_NAME = "Purchases";
  var configured = false;
  var configurePromise = null;

  function isNativePlatform() {
    try {
      var cap = global.Capacitor;
      return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function getConfig() {
    var cfg = global.FREEDOM_PURCHASES || {};
    return {
      applePublicSdkKey: String(cfg.applePublicSdkKey || "").trim(),
      entitlementId: String(cfg.entitlementId || "pro").trim() || "pro",
      offeringId: String(cfg.offeringId || "default").trim() || "default",
      monthlyPackageId: String(cfg.monthlyPackageId || "$rc_monthly").trim() || "$rc_monthly",
      productId: String(cfg.productId || "freedom.monthly").trim() || "freedom.monthly"
    };
  }

  function getPurchasesPlugin() {
    if (!isNativePlatform()) return null;
    try {
      var cap = global.Capacitor;
      if (!cap) return null;
      var plugins = cap.Plugins || {};
      if (plugins[PLUGIN_NAME] && typeof plugins[PLUGIN_NAME].configure === "function") {
        return plugins[PLUGIN_NAME];
      }
      if (typeof cap.registerPlugin !== "function") return null;
      var proxy = cap.registerPlugin(PLUGIN_NAME);
      if (proxy && typeof proxy.configure === "function") return proxy;
      return proxy || null;
    } catch (e) {
      return null;
    }
  }

  function fail(code, message, extras) {
    var err = {
      ok: false,
      code: code || "unknown",
      error: String(message || "Something went wrong with purchases."),
      cancelled: false,
      native: isNativePlatform()
    };
    if (extras && typeof extras === "object") {
      Object.keys(extras).forEach(function (k) {
        err[k] = extras[k];
      });
    }
    return err;
  }

  function isUserCancelled(error) {
    if (!error) return false;
    if (error.userCancelled === true || error.readableErrorCode === "PURCHASE_CANCELLED") {
      return true;
    }
    var code = error.code;
    if (code === 1 || code === "1" || code === "PURCHASE_CANCELLED_ERROR") return true;
    var msg = String(error.message || error.errorMessage || error || "").toLowerCase();
    return /cancel|cancelled|canceled/.test(msg);
  }

  function normalizeError(error, fallbackCode) {
    if (isUserCancelled(error)) {
      return fail("cancelled", "Purchase cancelled.", { cancelled: true });
    }
    var msg =
      (error && (error.message || error.errorMessage || error.error)) ||
      "Purchases could not be completed.";
    var code =
      (error && (error.code != null ? String(error.code) : error.readableErrorCode)) ||
      fallbackCode ||
      "purchases-error";
    return fail(code, msg, { cancelled: false });
  }

  /**
   * RevenueCat Capacitor wraps CustomerInfo as `{ customerInfo: CustomerInfo }`
   * for getCustomerInfo / restorePurchases (and purchase results). Unwrap so
   * entitlement mapping always reads entitlements.active / .all.
   */
  function unwrapCustomerInfo(result) {
    return result && result.customerInfo ? result.customerInfo : result;
  }

  function entitlementSnapshot(customerInfo, entitlementId) {
    var info = customerInfo || {};
    var ents = info.entitlements || {};
    var active = ents.active || {};
    var all = ents.all || {};
    var pro = active[entitlementId] || null;
    var proAll = all[entitlementId] || pro || null;
    return {
      entitlementId: entitlementId,
      isPro: !!pro,
      expirationDate: (pro && pro.expirationDate) || (proAll && proAll.expirationDate) || null,
      willRenew: !!(pro && pro.willRenew),
      periodType: (pro && pro.periodType) || (proAll && proAll.periodType) || null,
      productIdentifier:
        (pro && pro.productIdentifier) || (proAll && proAll.productIdentifier) || null,
      activeEntitlementIds: Object.keys(active),
      originalAppUserId: info.originalAppUserId || null
    };
  }

  function summarizePackage(pkg) {
    if (!pkg) return null;
    var product = pkg.product || pkg.storeProduct || {};
    var intro = product.introPrice || product.introductoryPrice || null;
    return {
      identifier: pkg.identifier || null,
      packageType: pkg.packageType || null,
      productId: product.identifier || null,
      title: product.title || null,
      description: product.description || null,
      priceString: product.priceString || null,
      price: product.price != null ? product.price : null,
      currencyCode: product.currencyCode || null,
      hasIntroOffer: !!intro,
      introPriceString: intro && (intro.priceString || intro.localizedPriceString) || null,
      introPeriod:
        intro && (intro.period || intro.subscriptionPeriod || intro.periodUnit) || null
    };
  }

  function findMonthlyPackage(offerings, cfg) {
    if (!offerings) return null;
    var offering =
      (offerings.all && offerings.all[cfg.offeringId]) ||
      offerings.current ||
      null;
    if (!offering) return null;
    var packages = offering.availablePackages || [];
    var byId = packages.find(function (pkg) {
      return pkg && pkg.identifier === cfg.monthlyPackageId;
    });
    if (byId) return { offering: offering, package: byId };
    var byProduct = packages.find(function (pkg) {
      var product = pkg && (pkg.product || pkg.storeProduct);
      return product && product.identifier === cfg.productId;
    });
    if (byProduct) return { offering: offering, package: byProduct };
    var monthly = packages.find(function (pkg) {
      var t = String((pkg && pkg.packageType) || "").toUpperCase();
      return t === "MONTHLY" || t === "RC_MONTHLY";
    });
    if (monthly) return { offering: offering, package: monthly };
    return { offering: offering, package: null };
  }

  async function ensureConfigured() {
    if (!isNativePlatform()) {
      return fail("not-native", "Purchases are only available in the Freedom iPhone app.");
    }
    var purchases = getPurchasesPlugin();
    if (!purchases || typeof purchases.configure !== "function") {
      return fail(
        "plugin-unavailable",
        "Purchases are not available in this build. Update Freedom and try again."
      );
    }
    var cfg = getConfig();
    if (!cfg.applePublicSdkKey || !/^appl_/.test(cfg.applePublicSdkKey)) {
      return fail(
        "missing-api-key",
        "RevenueCat Apple public SDK key is not configured yet."
      );
    }
    if (configured) return { ok: true, already: true, native: true };
    if (configurePromise) return configurePromise;

    configurePromise = (async function () {
      try {
        await purchases.configure({ apiKey: cfg.applePublicSdkKey });
        configured = true;
        return { ok: true, native: true };
      } catch (e) {
        configured = false;
        return normalizeError(e, "configure-failed");
      } finally {
        configurePromise = null;
      }
    })();
    return configurePromise;
  }

  async function getCustomerEntitlement() {
    var ready = await ensureConfigured();
    if (!ready || !ready.ok) return ready;
    var purchases = getPurchasesPlugin();
    var cfg = getConfig();
    try {
      var info = unwrapCustomerInfo(await purchases.getCustomerInfo());
      return {
        ok: true,
        native: true,
        customerInfo: info,
        entitlement: entitlementSnapshot(info, cfg.entitlementId)
      };
    } catch (e) {
      return normalizeError(e, "customer-info-failed");
    }
  }

  /**
   * Normalize RevenueCat IntroEligibility to eligible | ineligible | unknown.
   * Apple subscription-group rules decide this — never local install history.
   */
  function normalizeIntroEligibility(entry) {
    if (!entry || entry.status == null) return "unknown";
    var status = entry.status;
    if (
      status === 2 ||
      status === "2" ||
      status === "INTRO_ELIGIBILITY_STATUS_ELIGIBLE" ||
      status === "ELIGIBLE"
    ) {
      return "eligible";
    }
    if (
      status === 1 ||
      status === "1" ||
      status === "INTRO_ELIGIBILITY_STATUS_INELIGIBLE" ||
      status === "INELIGIBLE" ||
      status === 3 ||
      status === "3" ||
      status === "INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS" ||
      status === "NO_INTRO_OFFER_EXISTS"
    ) {
      return "ineligible";
    }
    return "unknown";
  }

  async function checkIntroEligibility(productId) {
    var id = String(productId || "").trim();
    if (!id) return { ok: true, status: "unknown", productId: null };
    var purchases = getPurchasesPlugin();
    if (!purchases || typeof purchases.checkTrialOrIntroductoryPriceEligibility !== "function") {
      return { ok: true, status: "unknown", productId: id, unsupported: true };
    }
    try {
      var map = await purchases.checkTrialOrIntroductoryPriceEligibility({
        productIdentifiers: [id]
      });
      var entry = map && (map[id] || map[String(id)]) || null;
      return {
        ok: true,
        status: normalizeIntroEligibility(entry),
        productId: id,
        raw: entry
      };
    } catch (e) {
      return {
        ok: false,
        status: "unknown",
        productId: id,
        error: String(e && e.message ? e.message : e)
      };
    }
  }

  async function getMonthlyOffering() {
    var ready = await ensureConfigured();
    if (!ready || !ready.ok) return ready;
    var purchases = getPurchasesPlugin();
    var cfg = getConfig();
    try {
      var offerings = await purchases.getOfferings();
      var found = findMonthlyPackage(offerings, cfg);
      if (!found || !found.offering) {
        return fail(
          "offering-unavailable",
          "Freedom Premium is not available right now. Check your connection and try again."
        );
      }
      if (!found.package) {
        return fail(
          "package-unavailable",
          "The monthly Freedom Premium package is not available right now."
        );
      }
      var product = summarizePackage(found.package);
      var eligibility = await checkIntroEligibility(
        (product && product.productId) || cfg.productId
      );
      return {
        ok: true,
        native: true,
        offeringId: found.offering.identifier || cfg.offeringId,
        package: found.package,
        product: product,
        introEligibility: eligibility.status || "unknown",
        entitlementId: cfg.entitlementId
      };
    } catch (e) {
      return normalizeError(e, "offerings-failed");
    }
  }

  async function purchaseMonthly() {
    var offering = await getMonthlyOffering();
    if (!offering || !offering.ok) return offering;
    var purchases = getPurchasesPlugin();
    var cfg = getConfig();
    try {
      var result = await purchases.purchasePackage({ aPackage: offering.package });
      var customerInfo = result && result.customerInfo ? result.customerInfo : result;
      return {
        ok: true,
        native: true,
        cancelled: false,
        product: offering.product,
        customerInfo: customerInfo,
        entitlement: entitlementSnapshot(customerInfo, cfg.entitlementId)
      };
    } catch (e) {
      return normalizeError(e, "purchase-failed");
    }
  }

  async function restorePurchases() {
    var ready = await ensureConfigured();
    if (!ready || !ready.ok) return ready;
    var purchases = getPurchasesPlugin();
    var cfg = getConfig();
    try {
      var info = unwrapCustomerInfo(await purchases.restorePurchases());
      return {
        ok: true,
        native: true,
        customerInfo: info,
        entitlement: entitlementSnapshot(info, cfg.entitlementId)
      };
    } catch (e) {
      return normalizeError(e, "restore-failed");
    }
  }

  global.FreedomNativePurchases = {
    isNative: isNativePlatform,
    ensureConfigured: ensureConfigured,
    getMonthlyOffering: getMonthlyOffering,
    getCustomerEntitlement: getCustomerEntitlement,
    checkIntroEligibility: checkIntroEligibility,
    purchaseMonthly: purchaseMonthly,
    restorePurchases: restorePurchases,
    /* Phase 1 diagnostics helpers — not used by UI yet. */
    _test: {
      summarizePackage: summarizePackage,
      unwrapCustomerInfo: unwrapCustomerInfo,
      entitlementSnapshot: entitlementSnapshot,
      findMonthlyPackage: findMonthlyPackage,
      normalizeIntroEligibility: normalizeIntroEligibility,
      isUserCancelled: isUserCancelled,
      getConfig: getConfig
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
