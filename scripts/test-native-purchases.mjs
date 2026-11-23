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
assert.equal(/appl_[a-zA-Z0-9]{8,}/.test(cfgSrc), false);
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

/* Offerings + entitlement mapping + cancelled purchase. */
{
  const monthlyPkg = {
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
  const offerings = {
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
  const customerInfo = {
    originalAppUserId: "$RCAnonymousID:test",
    entitlements: {
      active: {
        pro: {
          identifier: "pro",
          productIdentifier: "freedom.monthly",
          expirationDate: "2026-12-23T00:00:00Z",
          willRenew: true,
          periodType: "TRIAL"
        }
      },
      all: {}
    }
  };
  let purchaseCalls = 0;
  const purchases = {
    configure: async () => {},
    getOfferings: async () => offerings,
    getCustomerInfo: async () => customerInfo,
    purchasePackage: async opts => {
      purchaseCalls += 1;
      assert.equal(opts.aPackage.identifier, "$rc_monthly");
      return { customerInfo };
    },
    restorePurchases: async () => customerInfo
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
