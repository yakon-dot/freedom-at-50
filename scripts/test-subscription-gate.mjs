/**
 * Phase 2 subscription gate contracts (no device StoreKit calls).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const gateSrc = fs.readFileSync(path.join(root, "freedom-subscription-gate.js"), "utf8");
const purchasesSrc = fs.readFileSync(path.join(root, "freedom-native-purchases.js"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-capacitor-web.mjs"), "utf8");
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(index, /freedom-subscription-gate\.js/);
assert.match(index, /id="freedomPaywall"/);
assert.match(index, /id="freedomPaywallStart"/);
assert.match(index, /id="freedomPaywallRestore"/);
assert.match(index, /id="freedomPaywallDemo"/);
assert.match(index, /id="freedomPaywallClose"/);
assert.match(index, /id="freedomReadOnlyBanner"/);
assert.match(index, /Viewing only\. Freedom Premium is not active\./);
assert.equal(index.includes("Viewing only —"), false);
assert.match(gateSrc, /dismissPaywall/);
assert.match(purchasesSrc, /checkTrialOrIntroductoryPriceEligibility|checkIntroEligibility/);
assert.match(purchasesSrc, /normalizeIntroEligibility/);
assert.match(index, /FreedomSubscriptionGate\.afterCompanionSelection/);
assert.match(index, /FreedomSubscriptionGate\.allowsPersonalWrites/);
assert.match(index, /body:not\(\.home183\) #freedomReadOnlyBanner/);
assert.match(index, /#freedomReadOnlyBanner\{[^}]*bottom:\s*0/s);
assert.equal(/data-more183="restorePurchases"/.test(index), false);
assert.match(index, /id="freedomPaywallRestore"/);
const onboardingSupport =
  "Create and manage your Journeys, Goals, Pension and Notes. Track your progress with encouragement from your chosen companion. Explore Demo Mode anytime. Your personal numbers stay on this iPhone.";
const renewSupport =
  "Your information is still here. Restore full access to your Journeys, Goals, Pension and Notes to continue tracking your progress.";
assert.match(
  index,
  /id="freedomPaywallSupport">Create and manage your Journeys, Goals, Pension and Notes\. Track your progress with encouragement from your chosen companion\. Explore Demo Mode anytime\. Your personal numbers stay on this iPhone\.</
);
assert.match(gateSrc, new RegExp(onboardingSupport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(gateSrc, new RegExp(renewSupport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal(onboardingSupport.includes("—") || renewSupport.includes("—"), false);
assert.match(prepare, /freedom-subscription-gate\.js/);
assert.match(sw, /freedom-subscription-gate\.js/);
assert.equal(!!pkg.scripts["test:subscription-gate"], true);
assert.match(gateSrc, /FreedomSubscriptionGate/);
assert.match(gateSrc, /buildOfferCopy/);
assert.match(purchasesSrc, /unwrapCustomerInfo/);
console.log("PASS: source contracts for Phase 2 subscription gate");

function loadGate(opts) {
  const store = new Map();
  const sandbox = {
    console,
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(String(key), String(value));
      },
      removeItem(key) {
        store.delete(String(key));
      }
    },
    document: {
      readyState: "complete",
      body: { classList: { contains: () => false, toggle: () => {} } },
      getElementById: () => null,
      addEventListener: () => {}
    },
    Capacitor: opts.capacitor,
    FreedomNativePurchases: opts.purchases,
    freedomDemo: opts.freedomDemo || { isActive: () => false },
    enterDemo: opts.enterDemo || (() => {})
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(gateSrc, sandbox, { filename: "freedom-subscription-gate.js" });
  return { api: sandbox.FreedomSubscriptionGate, store, sandbox };
}

function mockPurchases({ isPro, product, cancelled }) {
  const entitlement = isPro
    ? {
        isPro: true,
        expirationDate: "2026-12-23T00:00:00Z",
        willRenew: true,
        periodType: "TRIAL",
        activeEntitlementIds: ["pro"]
      }
    : {
        isPro: false,
        expirationDate: "2026-11-23T12:34:20Z",
        willRenew: false,
        periodType: "TRIAL",
        activeEntitlementIds: []
      };
  const customerInfo = {
    entitlements: {
      active: isPro ? { pro: entitlement } : {},
      all: { pro: entitlement }
    }
  };
  return {
    isNative: () => true,
    ensureConfigured: async () => ({ ok: true }),
    getMonthlyOffering: async () => ({
      ok: true,
      product: product || {
        priceString: "€3.99",
        hasIntroOffer: true,
        introPriceString: "Free",
        introPeriod: "MONTH"
      }
    }),
    getCustomerEntitlement: async () => ({
      ok: true,
      customerInfo,
      entitlement
    }),
    purchaseMonthly: async () => {
      if (cancelled) return { ok: false, cancelled: true, code: "cancelled", error: "Purchase cancelled." };
      return { ok: true, customerInfo, entitlement: { ...entitlement, isPro: true } };
    },
    restorePurchases: async () => ({
      ok: true,
      customerInfo,
      entitlement
    })
  };
}

/* Offer copy uses Apple product fields + intro eligibility. */
{
  const { api } = loadGate({
    capacitor: { isNativePlatform: () => false },
    purchases: { isNative: () => false }
  });
  const product = {
    priceString: "€3.99",
    hasIntroOffer: true,
    introPriceString: "Free",
    introPeriod: "P1M"
  };

  const eligible = api._test.buildOfferCopy(product, "eligible");
  assert.match(eligible.detail, /1 month free/i);
  assert.match(eligible.detail, /€3\.99/);
  assert.equal(
    eligible.detail,
    "Start with 1 month free, then €3.99 per month. Renews automatically unless cancelled."
  );
  assert.equal(eligible.cta, "Start Free Trial");
  assert.equal(eligible.offersFreeTrial, true);
  assert.equal(/P1M/i.test(eligible.detail), false);

  const ineligible = api._test.buildOfferCopy(product, "ineligible");
  assert.equal(
    ineligible.detail,
    "€3.99 per month. Renews automatically unless cancelled in your Apple ID settings."
  );
  assert.equal(/free trial|month free/i.test(ineligible.detail), false);
  assert.equal(ineligible.cta, "Subscribe");
  assert.equal(ineligible.offersFreeTrial, false);

  const unknown = api._test.buildOfferCopy(product, "unknown");
  assert.equal(
    unknown.detail,
    "€3.99 per month. Renews automatically unless cancelled in your Apple ID settings."
  );
  assert.equal(/free trial|month free/i.test(unknown.detail), false);
  assert.equal(unknown.cta, "Subscribe");
  assert.equal(unknown.offersFreeTrial, false);

  const paidIntro = api._test.buildOfferCopy(
    {
      priceString: "€3.99",
      hasIntroOffer: true,
      introPriceString: "€0.99",
      introPeriod: "P1W"
    },
    "eligible"
  );
  assert.equal(
    paidIntro.detail,
    "Start with €0.99 for 1 week, then €3.99 per month. Renews automatically unless cancelled."
  );
  assert.equal(paidIntro.cta, "Start Trial");
  assert.equal(paidIntro.offersFreeTrial, false);

  assert.equal(api._test.formatIntroPeriod("P1M"), "1 month");
  assert.equal(api._test.formatIso8601Period("P1M"), "1 month");

  const empty = api._test.buildOfferCopy(null, "eligible");
  assert.equal(/€3\.99/.test(empty.detail), false);
  console.log("PASS: eligible / ineligible / unknown trial wording");
  console.log("PASS: paid-intro and auto-renew disclosure wording");
  console.log("PASS: P1M introPeriod renders as 1 month");
}

/* PWA: always writable, companion continue skips paywall. */
{
  const { api } = loadGate({
    capacitor: { isNativePlatform: () => false },
    purchases: { isNative: () => false }
  });
  assert.equal(api.isNative(), false);
  assert.equal(api.allowsPersonalWrites(), true);
  let continued = false;
  await api.afterCompanionSelection(() => {
    continued = true;
  });
  assert.equal(continued, true);
  const refreshed = await api.refreshEntitlement();
  assert.equal(refreshed.ok, true);
  assert.equal(api.allowsPersonalWrites(), true);
  console.log("PASS: PWA full access / no paywall requirement");
}

/* Native active trial unlocks writes. */
{
  const { api } = loadGate({
    capacitor: { isNativePlatform: () => true },
    purchases: mockPurchases({ isPro: true })
  });
  const refreshed = await api.refreshEntitlement();
  assert.equal(refreshed.ok, true);
  assert.equal(api.getAccess().isPro, true);
  assert.equal(api.allowsPersonalWrites(), true);
  assert.equal(api.isReadOnlyPersonal(), false);
  let continued = false;
  await api.afterCompanionSelection(() => {
    continued = true;
  });
  assert.equal(continued, true);
  console.log("PASS: active trial / subscription allows writes");
}

/* Native expired → read-only; Demo still writable. */
{
  let demoActive = false;
  const { api } = loadGate({
    capacitor: { isNativePlatform: () => true },
    purchases: mockPurchases({ isPro: false }),
    freedomDemo: { isActive: () => demoActive }
  });
  await api.refreshEntitlement();
  assert.equal(api.getAccess().isPro, false);
  assert.equal(api.allowsPersonalWrites(), false);
  assert.equal(api.isReadOnlyPersonal(), true);
  demoActive = true;
  assert.equal(api.allowsPersonalWrites(), true);
  assert.equal(api.isReadOnlyPersonal(), false);
  console.log("PASS: expired is read-only; Demo Mode still writable");
}

/* Cancelled purchase keeps read-only / no unlock. */
{
  const { api } = loadGate({
    capacitor: { isNativePlatform: () => true },
    purchases: mockPurchases({ isPro: false, cancelled: true })
  });
  await api.refreshEntitlement();
  assert.equal(api.allowsPersonalWrites(), false);
  await api.startPurchase();
  assert.equal(api.getAccess().isPro, false);
  assert.equal(api.allowsPersonalWrites(), false);
  console.log("PASS: cancelled purchase does not unlock");
}

/* Restore with active entitlement unlocks. */
{
  const { api } = loadGate({
    capacitor: { isNativePlatform: () => true },
    purchases: mockPurchases({ isPro: true })
  });
  /* Start expired via apply, then restore. */
  api._test.applyEntitlement({ isPro: false, activeEntitlementIds: [] });
  assert.equal(api.allowsPersonalWrites(), false);
  await api.startRestore();
  assert.equal(api.getAccess().isPro, true);
  assert.equal(api.allowsPersonalWrites(), true);
  console.log("PASS: restore purchases unlocks when entitlement active");
}

/* Cache remembers expired across gate reload before refresh. */
{
  const purchases = mockPurchases({ isPro: false });
  const first = loadGate({
    capacitor: { isNativePlatform: () => true },
    purchases
  });
  await first.api.refreshEntitlement();
  assert.equal(first.api.allowsPersonalWrites(), false);
  const cached = first.store.get(first.api._test.CACHE_KEY);
  assert.ok(cached);
  assert.match(cached, /"isPro":false/);

  /* Re-run hydrate by constructing a fresh gate with prefilled storage */
  const store = new Map([[first.api._test.CACHE_KEY, cached]]);
  const sandbox = {
    console,
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(String(key), String(value));
      },
      removeItem(key) {
        store.delete(String(key));
      }
    },
    document: {
      readyState: "complete",
      body: { classList: { contains: () => false, toggle: () => {} } },
      getElementById: () => null,
      addEventListener: () => {}
    },
    Capacitor: { isNativePlatform: () => true },
    FreedomNativePurchases: purchases,
    freedomDemo: { isActive: () => false }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(gateSrc, sandbox, { filename: "freedom-subscription-gate.js" });
  assert.equal(sandbox.FreedomSubscriptionGate.allowsPersonalWrites(), false);
  console.log("PASS: entitlement cache blocks writes after expiry before refresh");
}

/* Stale cached isPro:true with past expirationDate must not unlock writes. */
{
  const past = "2020-01-01T00:00:00Z";
  const future = "2099-01-01T00:00:00Z";
  const { api } = loadGate({
    capacitor: { isNativePlatform: () => true },
    purchases: mockPurchases({ isPro: false })
  });
  assert.equal(api._test.effectiveIsPro({ isPro: true, expirationDate: past }), false);
  assert.equal(api._test.effectiveIsPro({ isPro: true, expirationDate: future }), true);
  assert.equal(api._test.effectiveIsPro({ isPro: true, expirationDate: null }), true);
  assert.equal(api._test.effectiveIsPro({ isPro: false, expirationDate: future }), false);

  const staleKey = api._test.CACHE_KEY;
  const stale = JSON.stringify({
    isPro: true,
    expirationDate: past,
    periodType: "TRIAL",
    updatedAt: "2020-01-01T00:00:00Z"
  });
  const failingPurchases = {
    isNative: () => true,
    getCustomerEntitlement: async () => ({ ok: false, code: "offline", error: "network" })
  };
  const store = new Map([[staleKey, stale]]);
  const sandbox = {
    console,
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(String(key), String(value));
      },
      removeItem(key) {
        store.delete(String(key));
      }
    },
    document: {
      readyState: "complete",
      body: { classList: { contains: () => false, toggle: () => {} } },
      getElementById: () => null,
      addEventListener: () => {}
    },
    Capacitor: { isNativePlatform: () => true },
    FreedomNativePurchases: failingPurchases,
    freedomDemo: { isActive: () => false }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(gateSrc, sandbox, { filename: "freedom-subscription-gate.js" });
  const gate = sandbox.FreedomSubscriptionGate;
  assert.equal(gate.allowsPersonalWrites(), false, "hydrate must ignore expired isPro:true cache");
  const refreshed = await gate.refreshEntitlement();
  assert.equal(refreshed.ok, false);
  assert.equal(gate.allowsPersonalWrites(), false, "failed refresh must not revive expired cache");
  assert.equal(gate.isReadOnlyPersonal(), true);
  const rewritten = JSON.parse(store.get(staleKey));
  assert.equal(rewritten.isPro, false);
  console.log("PASS: expired isPro:true cache cannot unlock writes after relaunch/offline");
}

/* Live entitlement with past expirationDate is treated as inactive. */
{
  const { api } = loadGate({
    capacitor: { isNativePlatform: () => true },
    purchases: mockPurchases({ isPro: true })
  });
  api._test.applyEntitlement({
    isPro: true,
    expirationDate: "2020-06-01T00:00:00Z",
    periodType: "TRIAL",
    activeEntitlementIds: ["pro"]
  });
  assert.equal(api.getAccess().isPro, false);
  assert.equal(api.allowsPersonalWrites(), false);
  console.log("PASS: applyEntitlement respects past expirationDate");
}

/* index.html persist path reloads stored personal state when writes are blocked. */
{
  assert.match(
    index,
    /allowsPersonalWrites[\s\S]{0,400}localStorage\.getItem\(KEY\)[\s\S]{0,200}state\s*=\s*parsed/
  );
  assert.match(index, /notifyWriteBlocked/);
  console.log("PASS: blocked persist reverts unsaved in-memory personal edits");
}

/* Home-only permanent banner; write intents still open the subscription screen. */
{
  assert.match(gateSrc, /banner\.hidden = !\(readOnly && onHome\)/);
  assert.match(gateSrc, /WRITE_BLOCK_SELECTORS/);
  assert.match(gateSrc, /notifyWriteBlocked/);
  assert.match(gateSrc, /showPaywall\(\{ context: "renew"/);
  console.log("PASS: read-only banner is Home-only; writes still open subscription screen");
}

/* Dismiss renew paywall without enabling edits. */
{
  function el(extra) {
    return Object.assign({ addEventListener() {}, disabled: false, hidden: false, textContent: "" }, extra || {});
  }
  const closeState = el({ hidden: true });
  const paywallState = el({
    hidden: true,
    classList: { add() {}, remove() {} }
  });
  const body = {
    classList: {
      contains: () => false,
      toggle() {}
    }
  };
  const elements = {
    freedomPaywall: paywallState,
    freedomPaywallClose: closeState,
    freedomPaywallTitle: el(),
    freedomPaywallDetail: el(),
    freedomPaywallStart: el(),
    freedomPaywallRestore: el(),
    freedomPaywallDemo: el({ hidden: false }),
    freedomPaywallSupport: el(),
    freedomPaywallStatus: el({ hidden: true, classList: { toggle() {} } }),
    freedomReadOnlyBanner: el({ hidden: true }),
    freedomReadOnlyRenew: el()
  };
  const purchases = mockPurchases({ isPro: false });
  const store = new Map();
  const sandbox = {
    console,
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(String(key), String(value));
      },
      removeItem(key) {
        store.delete(String(key));
      }
    },
    document: {
      readyState: "complete",
      body,
      getElementById(id) {
        return elements[id] || null;
      },
      addEventListener() {}
    },
    Capacitor: { isNativePlatform: () => true },
    FreedomNativePurchases: purchases,
    freedomDemo: { isActive: () => false }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(gateSrc, sandbox, { filename: "freedom-subscription-gate.js" });
  const gate = sandbox.FreedomSubscriptionGate;
  await gate.refreshEntitlement();
  assert.equal(gate.allowsPersonalWrites(), false);
  gate.showPaywall({ context: "renew", allowDemo: true });
  assert.equal(paywallState.hidden, false);
  assert.equal(closeState.hidden, false);
  assert.equal(gate._test.getPaywallContext(), "renew");
  assert.equal(
    elements.freedomPaywallSupport.textContent,
    "Your information is still here. Restore full access to your Journeys, Goals, Pension and Notes to continue tracking your progress."
  );
  assert.equal(gate.dismissPaywall(), true);
  assert.equal(paywallState.hidden, true);
  assert.equal(gate.allowsPersonalWrites(), false);
  assert.equal(gate.isReadOnlyPersonal(), true);
  /* Onboarding keeps close hidden and Demo Mode available. */
  gate.showPaywall({ context: "onboarding" });
  assert.equal(closeState.hidden, true);
  assert.equal(elements.freedomPaywallDemo.hidden, false);
  assert.equal(
    elements.freedomPaywallSupport.textContent,
    "Create and manage your Journeys, Goals, Pension and Notes. Track your progress with encouragement from your chosen companion. Explore Demo Mode anytime. Your personal numbers stay on this iPhone."
  );
  gate.hidePaywall();
  console.log("PASS: renew paywall dismiss returns to tab without enabling edits");
}

console.log("PASS: Phase 2 subscription gate unit contracts");
