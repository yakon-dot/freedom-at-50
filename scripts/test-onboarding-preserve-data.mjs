/**
 * Onboarding must never silently wipe existing personal records.
 * - Genuine first-time users still get a clean empty personal state
 * - Returning users with saved data + missing/inconsistent markers keep records
 * - Demo Mode stays isolated
 * - Change companion still preserves data
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");

assert.match(index, /function personalStateHasSavedRecords/);
assert.match(index, /function readStoredPersonalStateForGuard/);
assert.match(
  index,
  /memoryHasRecords\|\|storedHasRecords/
);
assert.match(
  index,
  /If saved personal records already exist[\s\S]{0,120}never silently overwrite/
);
assert.match(index, /personalStateHasSavedRecords:personalStateHasSavedRecords/);
console.log("PASS: source contracts for onboarding data preservation");

function resolveChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    "/usr/local/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error("Google Chrome not found (set CHROME_PATH)");
  return found;
}

const BASE = process.env.FREEDOM_BASE || "http://127.0.0.1:8765";
const DATA_KEY = "freedom50-mobile-v1";
const MARKER_LOAN = "KEEP-ONBOARDING-LOAN";

const SAVED_STATE = {
  loans: [
    {
      name: MARKER_LOAN,
      starting: 3000,
      current: 1200,
      payment: 100,
      collapsed: true,
      payoffMode: "monthly",
      freedomDate: null,
      firstRepaymentCompanionConsumed: true
    }
  ],
  customGoals: [
    {
      name: "Keep Kitchen",
      current: 500,
      target: 5000,
      hasTarget: true,
      startingBalance: 500,
      lifetimeAdded: 500,
      lifeHappensTotal: 0,
      planMode: "monthly",
      plannedMonthly: 50,
      goalDate: null
    }
  ],
  pensions: [
    {
      id: "p1",
      name: "Keep Pension",
      value: 22000,
      statementValue: 22000,
      personal: 0,
      employer: 0,
      autoContrib: false,
      showInOverview: true
    }
  ],
  notes: [{ id: "n1", text: "Keep this note", color: "yellow" }],
  archivedJourneys: [],
  archivedGoals: [],
  archivedPensions: [],
  hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true }
};

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* 1) Genuine first-time user: no saved data → clean empty state */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.evaluateOnNewDocument(() => {
      localStorage.removeItem("freedom50-mobile-v1");
      localStorage.removeItem("freedom50-welcome-complete-v1");
      localStorage.removeItem("freedom50-look-around-complete-v1");
      localStorage.removeItem("freedom50-first-time-complete-v1");
      localStorage.removeItem("freedom50-companion-id-v1");
      localStorage.removeItem("freedom50-companion-pending-v1");
      localStorage.removeItem("freedom50-companion-first-setup-pending-v1");
    });
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => typeof window.freedomDev?.activateFreshPersonal === "function",
      { timeout: 20000 }
    );
    const beforeBlob = await page.evaluate(() => localStorage.getItem("freedom50-mobile-v1"));
    await page.evaluate(() => window.freedomDev.activateFreshPersonal({ skipHome: true }));
    const after = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1") || "{}");
      return {
        loans: (st.loans || []).length,
        pensions: (st.pensions || []).length,
        notes: (st.notes || []).length,
        customGoals: (st.customGoals || []).length,
        overviewExcludeHousePocket: !!st.overviewExcludeHousePocket
      };
    });
    assert.ok(beforeBlob == null || beforeBlob === "" || beforeBlob === "{}");
    assert.equal(after.loans, 0);
    assert.equal(after.pensions, 0);
    assert.equal(after.notes, 0);
    assert.equal(after.customGoals, 0);
    assert.equal(after.overviewExcludeHousePocket, true);
    console.log("PASS: genuine first-time user gets clean empty personal state");
    await page.close();
  }

  /* 2) Returning user: valid saved data + all onboarding markers missing */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.evaluateOnNewDocument(raw => {
      localStorage.removeItem("freedom50-welcome-complete-v1");
      localStorage.removeItem("freedom50-look-around-complete-v1");
      localStorage.removeItem("freedom50-first-time-complete-v1");
      localStorage.removeItem("freedom50-companion-id-v1");
      localStorage.removeItem("freedom50-companion-pending-v1");
      localStorage.removeItem("freedom50-companion-first-setup-pending-v1");
      localStorage.setItem("freedom50-mobile-v1", raw);
    }, JSON.stringify(SAVED_STATE));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => typeof window.freedomDev?.activateFreshPersonal === "function",
      { timeout: 20000 }
    );
    const before = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        loan: st.loans[0].name,
        goal: st.customGoals[0].name,
        pension: st.pensions[0].name,
        note: st.notes[0].text,
        welcome: localStorage.getItem("freedom50-welcome-complete-v1"),
        first: localStorage.getItem("freedom50-first-time-complete-v1")
      };
    });
    assert.equal(before.loan, MARKER_LOAN);
    assert.equal(before.welcome, null);
    assert.equal(before.first, null);
    await page.evaluate(() => window.freedomDev.activateFreshPersonal({ skipHome: true }));
    const after = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        loan: st.loans[0]?.name,
        goal: st.customGoals[0]?.name,
        pension: st.pensions[0]?.name,
        note: st.notes[0]?.text,
        loanCount: st.loans.length
      };
    });
    assert.equal(after.loan, MARKER_LOAN);
    assert.equal(after.goal, "Keep Kitchen");
    assert.equal(after.pension, "Keep Pension");
    assert.equal(after.note, "Keep this note");
    assert.equal(after.loanCount, 1);
    console.log("PASS: missing markers + saved data — activateFreshPersonal preserves records");
    await page.close();
  }

  /* 3) Partially inconsistent markers (welcome only) + saved data */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(raw => {
      localStorage.setItem("freedom50-welcome-complete-v1", "1");
      localStorage.removeItem("freedom50-look-around-complete-v1");
      localStorage.removeItem("freedom50-first-time-complete-v1");
      localStorage.removeItem("freedom50-companion-id-v1");
      localStorage.removeItem("freedom50-companion-pending-v1");
      localStorage.setItem("freedom50-mobile-v1", raw);
    }, JSON.stringify(SAVED_STATE));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => typeof window.freedomDev?.activateFreshPersonal === "function",
      { timeout: 20000 }
    );
    await page.evaluate(() => window.freedomDev.activateFreshPersonal({ skipHome: true }));
    const kept = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        loan: st.loans[0]?.name,
        pensionValue: st.pensions[0]?.value,
        welcome: localStorage.getItem("freedom50-welcome-complete-v1")
      };
    });
    assert.equal(kept.loan, MARKER_LOAN);
    assert.equal(kept.pensionValue, 22000);
    assert.equal(kept.welcome, "1");
    console.log("PASS: partial markers + saved data — records preserved");
    await page.close();
  }

  /* 4) Survives activateFreshPersonal + reload */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(raw => {
      localStorage.removeItem("freedom50-welcome-complete-v1");
      localStorage.removeItem("freedom50-look-around-complete-v1");
      localStorage.removeItem("freedom50-first-time-complete-v1");
      localStorage.removeItem("freedom50-companion-id-v1");
      localStorage.setItem("freedom50-mobile-v1", raw);
    }, JSON.stringify(SAVED_STATE));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => typeof window.freedomDev?.activateFreshPersonal === "function",
      { timeout: 20000 }
    );
    await page.evaluate(() => window.freedomDev.activateFreshPersonal({ skipHome: true }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.page === "function", { timeout: 20000 });
    const afterReload = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        loan: st.loans[0]?.name,
        goal: st.customGoals[0]?.name,
        note: st.notes[0]?.text,
        pension: st.pensions[0]?.name
      };
    });
    assert.equal(afterReload.loan, MARKER_LOAN);
    assert.equal(afterReload.goal, "Keep Kitchen");
    assert.equal(afterReload.note, "Keep this note");
    assert.equal(afterReload.pension, "Keep Pension");
    console.log("PASS: preserved data survives reload after onboarding guard");
    await page.close();
  }

  /* 5) Demo Mode isolation: activateFreshPersonal is a no-op in Demo; personal blob intact */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(raw => {
      localStorage.setItem("freedom50-welcome-complete-v1", "1");
      localStorage.setItem("freedom50-look-around-complete-v1", "1");
      localStorage.setItem("freedom50-first-time-complete-v1", "1");
      localStorage.setItem("freedom50-companion-id-v1", "kevin");
      localStorage.removeItem("freedom50-companion-pending-v1");
      localStorage.setItem("freedom50-mobile-v1", raw);
    }, JSON.stringify(SAVED_STATE));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.enterDemo === "function", { timeout: 20000 });
    await page.waitForFunction(
      () => document.body.classList.contains("home183"),
      { timeout: 30000 }
    );
    const beforeBlob = await page.evaluate(() => localStorage.getItem("freedom50-mobile-v1"));
    await page.evaluate(() => window.enterDemo());
    await page.waitForFunction(
      () => document.body.classList.contains("demo-mode-active"),
      { timeout: 10000 }
    );
    await page.evaluate(() => window.freedomDev.activateFreshPersonal({ skipHome: true }));
    const whileDemo = await page.evaluate(() => ({
      blob: localStorage.getItem("freedom50-mobile-v1"),
      demo: document.body.classList.contains("demo-mode-active"),
      loan: JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0]?.name
    }));
    assert.equal(whileDemo.demo, true);
    assert.equal(whileDemo.blob, beforeBlob);
    assert.equal(whileDemo.loan, MARKER_LOAN);
    await page.evaluate(() => window.freedomDemo.exit());
    await page.waitForFunction(
      () => !document.body.classList.contains("demo-mode-active"),
      { timeout: 10000 }
    );
    const afterExit = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return { loan: st.loans[0]?.name, note: st.notes[0]?.text };
    });
    assert.equal(afterExit.loan, MARKER_LOAN);
    assert.equal(afterExit.note, "Keep this note");
    console.log("PASS: Demo Mode isolation — personal blob untouched");
    await page.close();
  }

  /* 6) Companion switching still preserves financial data */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.evaluateOnNewDocument(raw => {
      localStorage.setItem("freedom50-welcome-complete-v1", "1");
      localStorage.setItem("freedom50-look-around-complete-v1", "1");
      localStorage.setItem("freedom50-first-time-complete-v1", "1");
      localStorage.setItem("freedom50-companion-id-v1", "patricia");
      localStorage.removeItem("freedom50-companion-pending-v1");
      localStorage.removeItem("freedom50-companion-first-setup-pending-v1");
      localStorage.setItem("freedom50-mobile-v1", raw);
    }, JSON.stringify(SAVED_STATE));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => document.body.classList.contains("home183"),
      { timeout: 30000 }
    );
    await page.evaluate(() => {
      document.querySelector('[data-more183="companion"]')?.click();
    });
    await page.waitForSelector("#freedomCompanionSelect:not([hidden])", { timeout: 10000 });
    await page.evaluate(() => {
      document.getElementById("freedomCompanionToggle-kevin")?.click();
    });
    await page.waitForSelector(
      '.freedom-companion-card[data-companion="kevin"].is-open',
      { timeout: 5000 }
    );
    await page.evaluate(() => {
      document.querySelector('[data-pick-companion="kevin"]')?.click();
    });
    await page.waitForFunction(
      () => localStorage.getItem("freedom50-companion-id-v1") === "kevin",
      { timeout: 10000 }
    );
    const kept = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        companion: localStorage.getItem("freedom50-companion-id-v1"),
        loan: st.loans[0]?.name,
        note: st.notes[0]?.text,
        pension: st.pensions[0]?.name
      };
    });
    assert.equal(kept.companion, "kevin");
    assert.equal(kept.loan, MARKER_LOAN);
    assert.equal(kept.note, "Keep this note");
    assert.equal(kept.pension, "Keep Pension");
    console.log("PASS: companion switch preserves journeys/goals/pensions/notes");
    await page.close();
  }

  /* Helper unit checks in-page */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem("freedom50-welcome-complete-v1", "1");
      localStorage.setItem("freedom50-look-around-complete-v1", "1");
      localStorage.setItem("freedom50-first-time-complete-v1", "1");
      localStorage.setItem("freedom50-companion-id-v1", "kevin");
      localStorage.removeItem("freedom50-mobile-v1");
    });
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => typeof window.freedomDev?.personalStateHasSavedRecords === "function",
      { timeout: 20000 }
    );
    const checks = await page.evaluate(() => {
      const fn = window.freedomDev.personalStateHasSavedRecords;
      return {
        empty: fn({ loans: [], pensions: [], notes: [], customGoals: [] }),
        loan: fn({ loans: [{ name: "A" }] }),
        note: fn({ notes: [{ text: "x" }] }),
        archive: fn({ archivedJourneys: [{ name: "Old" }] }),
        nullish: fn(null)
      };
    });
    assert.equal(checks.empty, false);
    assert.equal(checks.loan, true);
    assert.equal(checks.note, true);
    assert.equal(checks.archive, true);
    assert.equal(checks.nullish, false);
    console.log("PASS: personalStateHasSavedRecords helper cases");
    await page.close();
  }

  await browser.close();
  console.log("PASS: onboarding preserve-data flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
