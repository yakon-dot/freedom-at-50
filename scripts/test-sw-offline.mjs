/**
 * Service Worker offline respondWith checks for PR #235.
 * Uses a root harness page on localhost (secure context) so the app's
 * localhost SW-unregister path in index.html is bypassed.
 */
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.FREEDOM_BASE || "http://127.0.0.1:8765";
const KEY = "freedom50-mobile-v1";

async function main() {
  const swSource = fs.readFileSync(path.resolve("service-worker.js"), "utf8");
  assert.match(swSource, /APP_SHELL/);
  assert.match(swSource, /offlineDocumentResponse/);
  assert.match(swSource, /offlineAssetResponse/);
  assert.match(swSource, /freedom-at-50-v1\.8\.6\.154/);
  assert.equal(/catch\s*\([^)]*\)\s*\{[\s\S]*?throw\s+err/.test(swSource), false);
  /* Documents prefer live network (cache: no-store) so updates are not stuck on old HTML. */
  assert.match(swSource, /cache:\s*["']no-store["']/);
  assert.match(swSource, /Your personal data saved on this device is unchanged/);
  console.log("PASS: SW source includes shell cache + offline helpers; network-first updates; no throw-after-miss");

  const browser = await puppeteer.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  /* Unit-check helper Response shapes */
  {
    const page = await browser.newPage();
    await page.setContent("<html><body></body></html>");
    const docFn = swSource.match(/function offlineDocumentResponse\(\)\s*\{[\s\S]*?\n\}/)?.[0];
    const assetFn = swSource.match(/function offlineAssetResponse\(\)\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(docFn && assetFn, "offline helper functions present in SW");
    const helperCheck = await page.evaluate(
      ({ docFn, assetFn }) => {
        const api = new Function(`${docFn}\n${assetFn}\n;return { offlineDocumentResponse, offlineAssetResponse };`)();
        const doc = api.offlineDocumentResponse();
        const asset = api.offlineAssetResponse();
        return {
          docStatus: doc.status,
          docType: doc.headers.get("Content-Type"),
          assetStatus: asset.status,
          docIsResponse: doc instanceof Response,
          assetIsResponse: asset instanceof Response,
        };
      },
      { docFn, assetFn }
    );
    assert.equal(helperCheck.docIsResponse, true);
    assert.equal(helperCheck.assetIsResponse, true);
    assert.equal(helperCheck.docStatus, 503);
    assert.equal(helperCheck.assetStatus, 503);
    assert.match(helperCheck.docType || "", /text\/html/i);
    console.log("PASS: offlineDocumentResponse / offlineAssetResponse always return Response 503");
    await page.close();
  }

  /* Integration via harness (registers SW without index.html unregister) */
  const page = await browser.newPage();
  await page.goto(`${BASE}/sw-harness.html`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 20000 });
  console.log("PASS: Harness page is controlled by Service Worker");

  /* Seed personal data while controlled, then hit index.html under same origin SW */
  await page.evaluate(
    ({ KEY }) => {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          loans: [{ id: "sw1", name: "SW Loan", starting: 100, current: 80, payment: 10 }],
          pensions: [],
          notes: [],
        })
      );
    },
    { KEY }
  );
  const before = await page.evaluate((KEY) => localStorage.getItem(KEY), KEY);

  const onlineDoc = await page.evaluate(async () => {
    const res = await fetch("./index.html", { cache: "no-store" });
    const text = await res.text();
    return {
      status: res.status,
      ok: res instanceof Response,
      hasBackup: /password-protected|FreedomBackup|encryptFreedomBackupEnvelope/i.test(text),
      hasSafeLoad: /freedomPersonalLoadError|loadPersonalStateFromStorage/i.test(text),
    };
  });
  assert.equal(onlineDoc.ok, true);
  assert.equal(onlineDoc.status, 200);
  assert.equal(onlineDoc.hasBackup, true);
  assert.equal(onlineDoc.hasSafeLoad, true);
  console.log("PASS: Online network-first fetch returns current app HTML (backup + safe storage present)");

  await page.setOfflineMode(true);
  const offlineNav = await page.evaluate(async () => {
    try {
      const res = await fetch("./index.html", { cache: "no-store" });
      const text = await res.text();
      return {
        ok: true,
        status: res.status,
        hasBody: text.length > 0,
        mentionsFreedom: /Freedom/i.test(text),
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  assert.equal(offlineNav.ok, true, offlineNav.error || "offline fetch failed");
  assert.equal(typeof offlineNav.status, "number");
  assert.ok(offlineNav.hasBody);
  console.log("PASS: Offline document fetch returns a concrete Response", offlineNav.status);

  const missingAsset = await page.evaluate(async () => {
    try {
      const res = await fetch("./definitely-missing-asset-" + Date.now() + ".js", { cache: "no-store" });
      return { ok: true, status: res.status, defined: res != null };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  assert.equal(missingAsset.ok, true);
  assert.equal(missingAsset.defined, true);
  console.log("PASS: Offline missing asset returns a Response (not undefined)", missingAsset.status);

  await page.setOfflineMode(false);
  const after = await page.evaluate((KEY) => localStorage.getItem(KEY), KEY);
  assert.equal(after, before);
  assert.match(after, /SW Loan/);
  console.log("PASS: Service Worker activity did not alter personal localStorage");

  /* Open the real app under same origin and confirm backup crypto still works */
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0" });
  await page.evaluate(
    ({ KEY }) => {
      localStorage.setItem("freedom50-welcome-complete-v1", "1");
      localStorage.setItem("freedom50-look-around-complete-v1", "1");
      localStorage.setItem("freedom50-first-time-complete-v1", "1");
      localStorage.setItem("freedom50-companion-id-v1", "patricia");
      localStorage.setItem(
        KEY,
        JSON.stringify({
          loans: [{ id: "sw1", name: "SW Loan", starting: 100, current: 80, payment: 10 }],
          pensions: [],
          notes: [],
          archivedJourneys: [],
          archivedGoals: [],
          archivedPensions: [],
          customGoals: [],
          hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true },
          deletedBuiltInGoals: { houseFund: false, holidayFund: false, personalSavings: false },
          goalNames: {},
          goalTargets: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
          goalHasTarget: { houseFund: false, holidayFund: false, personalSavings: false },
          goalPlanMode: { houseFund: "monthly", holidayFund: "monthly", personalSavings: "monthly" },
          goalPlannedMonthly: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
          goalDate: { houseFund: null, holidayFund: null, personalSavings: null },
          goalLifetimeAdded: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
          goalLifeHappensTotal: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
          goalLastLifeHappens: {},
          goalStartingBalance: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
          goalLastBalanceCorrection: {},
          goalCollapsed: {},
          goalOrder: [],
          housePocket: 0,
          housePocketMonthly: 0,
          housePocketArchived: true,
          housePocketCompletedAt: null,
          housePocketArchiveRemoved: true,
          houseFund: 0,
          holidayFund: 0,
          holidayMonthly: 0,
          personalSavings: 0,
          overviewExcludeHousePocket: true,
        })
      );
    },
    { KEY }
  );
  await page.reload({ waitUntil: "networkidle0" });

  const backupOk = await page.evaluate(async () => {
    const api = window.FreedomBackup;
    if (!api) return { missing: true };
    const password = "FreedomOffline12";
    const envelope = await api.encrypt(api.buildInner(), password);
    const wrong = await api.decrypt(envelope, "wrong-password!!");
    const right = await api.decrypt(envelope, password);
    return {
      missing: false,
      encrypted: envelope.encrypted === true,
      iter: envelope.iter,
      wrongOk: wrong.ok,
      rightOk: right.ok,
      loan: right.ok ? right.state.loans.find((l) => l.id === "sw1")?.name : null,
      loadError: api.getPersonalLoadError ? api.getPersonalLoadError() : null,
    };
  });
  assert.equal(backupOk.missing, false);
  assert.equal(backupOk.encrypted, true);
  assert.equal(backupOk.iter, 210000);
  assert.equal(backupOk.wrongOk, false);
  assert.equal(backupOk.rightOk, true);
  assert.equal(backupOk.loan, "SW Loan");
  assert.equal(backupOk.loadError, null);
  console.log("PASS: Encrypted backup/restore crypto works after SW merge");
  console.log("PASS: Incorrect password fails closed after SW merge");

  console.log("\nAll SW offline checks passed.");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
