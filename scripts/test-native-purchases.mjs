/**
 * Phase 1 RevenueCat native purchases contracts (no device StoreKit calls).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const nativeSrc = fs.readFileSync(path.join(root, "freedom-native-purchases.js"), "utf8");
const cfgSrc = fs.readFileSync(path.join(root, "freedom-purchases-config.js"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-capacitor-web.mjs"), "utf8");
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const capSpm = fs.readFileSync(
  path.join(root, "ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift"),
  "utf8"
);
const packageSwift = fs.readFileSync(
  path.join(root, "ios/App/CapApp-SPM/Package.swift"),
  "utf8"
);

assert.equal(!!pkg.dependencies["@revenuecat/purchases-capacitor"], true);
assert.match(index, /freedom-purchases-config\.js/);
assert.match(index, /freedom-native-purchases\.js/);
assert.match(prepare, /freedom-purchases-config\.js/);
assert.match(prepare, /freedom-native-purchases\.js/);
assert.match(sw, /freedom-purchases-config\.js/);
assert.match(sw, /freedom-native-purchases\.js/);
assert.match(cfgSrc, /applePublicSdkKey/);
assert.match(cfgSrc, /entitlementId:\s*"pro"/);
assert.match(cfgSrc, /offeringId:\s*"default"/);
assert.match(cfgSrc, /monthlyPackageId:\s*"\$rc_monthly"/);
assert.match(cfgSrc, /productId:\s*"freedom\.monthly"/);
assert.equal(/sk_[a-zA-Z0-9]/.test(cfgSrc), false);
assert.match(cfgSrc, /applePublicSdkKey:\s*"appl_aJQTfBycvAHKnyfWuiGlIfPtDqW"/);
assert.match(nativeSrc, /FreedomNativePurchases/);
assert.match(nativeSrc, /purchaseMonthly/);
assert.match(nativeSrc, /restorePurchases/);
assert.match(nativeSrc, /getMonthlyOffering/);
assert.match(nativeSrc, /getCustomerEntitlement/);
assert.match(capSpm, /PurchasesPlugin\.self/);
assert.match(capSpm, /import RevenuecatPurchasesCapacitor/);
assert.match(packageSwift, /RevenuecatPurchasesCapacitor/);
console.log("PASS: source contracts for Phase 1 native purchases");

function loadApi(capMock, purchasesConfig) {
  const sandbox = {
    window: {},
    globalThis: {},
    console
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.Capacitor = capMock;
  sandbox.FREEDOM_PURCHASES = purchasesConfig;
  vm.runInNewContext(nativeSrc, sandbox, { filename: "freedom-native-purchases.js" });
  return sandbox.FreedomNativePurchases;
}

const baseCfg = {
  applePublicSdkKey: "appl_test_public_key_for_unit_tests",
  entitlementId: "pro",
  offeringId: "default",
  monthlyPackageId: "$rc_monthly",
  productId: "freedom.monthly"
};

/* PWA / web: purchases must no-op. */
{
  const api = loadApi(
    { isNativePlatform: () => false, Plugins: {}, registerPlugin: () => null },
    baseCfg
  );
  assert.equal(api.isNative(), false);
  const ready = await api.ensureConfigured();
  assert.equal(ready.ok, false);
  assert.equal(ready.code, "not-native");
  const offering = await api.getMonthlyOffering();
  assert.equal(offering.ok, false);
  assert.equal(offering.code, "not-native");
  console.log("PASS: PWA no-op for purchases");
}

/* Missing public key. */
{
  const purchases = {
    configure: async () => {},
    getOfferings: async () => ({}),
    getCustomerInfo: async () => ({}),
    purchasePackage: async () => ({}),
    restorePurchases: async () => ({})
  };
  const api = loadApi(
    {
      isNativePlatform: () => true,
      Plugins: { Purchases: purchases },
      registerPlugin: () => purchases
    },
    { ...baseCfg, applePublicSdkKey: "" }
  );
  const ready = await api.ensureConfigured();
  assert.equal(ready.ok, false);
  assert.equal(ready.code, "missing-api-key");
  console.log("PASS: refuses to configure without appl_ public key");
}

function makeMonthlyPackage() {
  return {
    identifier: "$rc_monthly",
    packageType: "MONTHLY",
    product: {
      identifier: "freedom.monthly",
      title: "Freedom Monthly",
      description: "Full access",
      priceString: "€3.99",
      price: 3.99,
      currencyCode: "EUR",
      introPrice: { priceString: "Free", periodUnit: "MONTH" }
    }
  };
}

function makeOfferings(monthlyPkg) {
  return {
    current: {
      identifier: "default",
      availablePackages: [monthlyPkg]
    },
    all: {
      default: {
        identifier: "default",
        availablePackages: [monthlyPkg]
      }
    }
  };
}

/** Matches RevenueCat Capacitor plugin return shape. */
function wrapCustomerInfo(customerInfo) {
  return { customerInfo };
}

function makeCustomerInfo({ activePro, allPro, originalAppUserId }) {
  const active = {};
  const all = {};
  if (activePro) active.pro = activePro;
  if (allPro) all.pro = allPro;
  else if (activePro) all.pro = activePro;
  return {
    originalAppUserId: originalAppUserId || "$RCAnonymousID:test",
    entitlements: { active, all }
  };
}

function loadPurchasesApi(purchases) {
  return loadApi(
    {
      isNativePlatform: () => true,
      Plugins: { Purchases: purchases },
      registerPlugin: () => purchases
    },
    baseCfg
  );
}

/* Offerings + entitlement mapping + cancelled purchase. */
{
  const monthlyPkg = makeMonthlyPackage();
  const offerings = makeOfferings(monthlyPkg);
  const customerInfo = makeCustomerInfo({
    activePro: {
      identifier: "pro",
      productIdentifier: "freedom.monthly",
      expirationDate: "2026-12-23T00:00:00Z",
      willRenew: true,
      periodType: "TRIAL"
    }
  });
  let purchaseCalls = 0;
  const purchases = {
    configure: async () => {},
    getOfferings: async () => offerings,
    getCustomerInfo: async () => wrapCustomerInfo(customerInfo),
    purchasePackage: async opts => {
      purchaseCalls += 1;
      assert.equal(opts.aPackage.identifier, "$rc_monthly");
      return wrapCustomerInfo(customerInfo);
    },
    restorePurchases: async () => wrapCustomerInfo(customerInfo)
  };
  const api = loadPurchasesApi(purchases);

  const offering = await api.getMonthlyOffering();
  assert.equal(offering.ok, true);
  assert.equal(offering.product.productId, "freedom.monthly");
  assert.equal(offering.product.priceString, "€3.99");
  assert.equal(offering.product.hasIntroOffer, true);

  const purchased = await api.purchaseMonthly();
  assert.equal(purchased.ok, true);
  assert.equal(purchased.entitlement.isPro, true);
  assert.equal(purchased.entitlement.productIdentifier, "freedom.monthly");
  assert.equal(purchaseCalls, 1);

  const restored = await api.restorePurchases();
  assert.equal(restored.ok, true);
  assert.equal(restored.entitlement.isPro, true);
  assert.equal(restored.customerInfo.entitlements.active.pro.periodType, "TRIAL");
  assert.equal(restored.customerInfo.customerInfo, undefined);

  purchases.purchasePackage = async () => {
    const err = new Error("Purchase was cancelled.");
    err.userCancelled = true;
    err.code = 1;
    throw err;
  };
  const cancelled = await api.purchaseMonthly();
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.code, "cancelled");
  console.log("PASS: offerings, purchase, restore, cancel mapping");
}

/* Active trial via getCustomerEntitlement — Capacitor { customerInfo } wrap. */
{
  const trialInfo = makeCustomerInfo({
    activePro: {
      identifier: "pro",
      productIdentifier: "freedom.monthly",
      expirationDate: "2026-11-23T12:34:20Z",
      willRenew: true,
      periodType: "TRIAL"
    }
  });
  const purchases = {
    configure: async () => {},
    getOfferings: async () => makeOfferings(makeMonthlyPackage()),
    getCustomerInfo: async () => wrapCustomerInfo(trialInfo),
    purchasePackage: async () => wrapCustomerInfo(trialInfo),
    restorePurchases: async () => wrapCustomerInfo(trialInfo)
  };
  const api = loadPurchasesApi(purchases);
  const entitlement = await api.getCustomerEntitlement();
  assert.equal(entitlement.ok, true);
  assert.equal(entitlement.entitlement.isPro, true);
  assert.equal(entitlement.entitlement.periodType, "TRIAL");
  assert.equal(entitlement.entitlement.willRenew, true);
  assert.equal(entitlement.entitlement.expirationDate, "2026-11-23T12:34:20Z");
  assert.equal(entitlement.entitlement.activeEntitlementIds.join(","), "pro");
  assert.equal(entitlement.customerInfo.entitlements.active.pro.periodType, "TRIAL");
  assert.equal(entitlement.customerInfo.customerInfo, undefined);
  console.log("PASS: active trial unwrap via getCustomerEntitlement");
}

/* Active paid subscription (NORMAL period). */
{
  const paidInfo = makeCustomerInfo({
    activePro: {
      identifier: "pro",
      productIdentifier: "freedom.monthly",
      expirationDate: "2026-12-23T00:00:00Z",
      willRenew: true,
      periodType: "NORMAL"
    }
  });
  const purchases = {
    configure: async () => {},
    getOfferings: async () => ({}),
    getCustomerInfo: async () => wrapCustomerInfo(paidInfo),
    purchasePackage: async () => wrapCustomerInfo(paidInfo),
    restorePurchases: async () => wrapCustomerInfo(paidInfo)
  };
  const api = loadPurchasesApi(purchases);
  const entitlement = await api.getCustomerEntitlement();
  assert.equal(entitlement.ok, true);
  assert.equal(entitlement.entitlement.isPro, true);
  assert.equal(entitlement.entitlement.periodType, "NORMAL");
  assert.equal(entitlement.entitlement.willRenew, true);
  console.log("PASS: active NORMAL subscription unwrap");
}

/* Expired subscription — not in active, still present in all. */
{
  const expiredPro = {
    identifier: "pro",
    productIdentifier: "freedom.monthly",
    expirationDate: "2026-11-23T12:34:20Z",
    willRenew: false,
    periodType: "TRIAL",
    isActive: false
  };
  const expiredInfo = makeCustomerInfo({
    activePro: null,
    allPro: expiredPro
  });
  const purchases = {
    configure: async () => {},
    getOfferings: async () => ({}),
    getCustomerInfo: async () => wrapCustomerInfo(expiredInfo),
    purchasePackage: async () => wrapCustomerInfo(expiredInfo),
    restorePurchases: async () => wrapCustomerInfo(expiredInfo)
  };
  const api = loadPurchasesApi(purchases);
  const entitlement = await api.getCustomerEntitlement();
  assert.equal(entitlement.ok, true);
  assert.equal(entitlement.entitlement.isPro, false);
  assert.equal(entitlement.entitlement.activeEntitlementIds.length, 0);
  assert.equal(entitlement.entitlement.expirationDate, "2026-11-23T12:34:20Z");
  assert.equal(entitlement.entitlement.periodType, "TRIAL");
  assert.equal(entitlement.entitlement.willRenew, false);
  assert.equal(entitlement.entitlement.productIdentifier, "freedom.monthly");

  const restored = await api.restorePurchases();
  assert.equal(restored.ok, true);
  assert.equal(restored.entitlement.isPro, false);
  assert.equal(restored.entitlement.expirationDate, "2026-11-23T12:34:20Z");
  console.log("PASS: expired subscription + restore keep expiry metadata");
}

/* unwrapCustomerInfo helper: wrapped vs already-bare. */
{
  const api = loadApi(
    { isNativePlatform: () => false, Plugins: {}, registerPlugin: () => null },
    baseCfg
  );
  const bare = { entitlements: { active: {}, all: {} } };
  assert.equal(api._test.unwrapCustomerInfo({ customerInfo: bare }), bare);
  assert.equal(api._test.unwrapCustomerInfo(bare), bare);
  assert.equal(api._test.unwrapCustomerInfo(null), null);
  console.log("PASS: unwrapCustomerInfo helper");
}

/* Unavailable offering. */
{
  const purchases = {
    configure: async () => {},
    getOfferings: async () => ({ current: null, all: {} }),
    getCustomerInfo: async () => ({}),
    purchasePackage: async () => ({}),
    restorePurchases: async () => ({})
  };
  const api = loadApi(
    {
      isNativePlatform: () => true,
      Plugins: { Purchases: purchases },
      registerPlugin: () => purchases
    },
    baseCfg
  );
  const offering = await api.getMonthlyOffering();
  assert.equal(offering.ok, false);
  assert.equal(offering.code, "offering-unavailable");
  console.log("PASS: unavailable offerings fail safely");
}

console.log("PASS: Phase 1 native purchases unit contracts");
