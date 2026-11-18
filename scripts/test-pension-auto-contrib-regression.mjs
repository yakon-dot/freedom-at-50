/**
 * Automatic pension contributions regression:
 * - Monthly total includes personal + employer
 * - Value is recomputed from statement + autoPeriods (no duplicate on reload)
 * - Month-boundary accrual uses completed months only
 * - Manual statement change with new balance resets baseline
 * - Same-balance statement needs the new-statement tick (kept)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /function pensionEstimatedValue/);
assert.match(index, /function syncPensionEstimate/);
assert.match(index, /function pensionEnableAutoContrib/);
assert.match(index, /rates\.personal\+rates\.employer/);
assert.match(index, /Received a new pension statement\?/);
assert.match(
  index,
  /Tick this if your latest statement shows the same pension value\. This tells Freedom to start calculating future contributions from the new statement date\./
);
console.log("PASS: source contracts for pension auto-contrib");

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

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addMonths(key, delta) {
  const [y, m] = String(key).split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}
function countMonthsInclusive(start, end) {
  let n = 0;
  let cur = start;
  for (let i = 0; i < 1200 && cur <= end; i++) {
    n += 1;
    cur = addMonths(cur, 1);
  }
  return n;
}
function expectedAutoValue(statementValue, personal, employer, autoStart, asOf = new Date()) {
  const lastCompleted = addMonths(monthKey(asOf), -1);
  if (autoStart > lastCompleted) return statementValue;
  const months = countMonthsInclusive(autoStart, lastCompleted);
  return Math.round((statementValue + months * (personal + employer)) * 100) / 100;
}

function pensionFixture(overrides = {}) {
  return {
    id: "pension-auto-1",
    name: "AUTO-POT",
    value: 10000,
    personal: 100,
    employer: 50,
    collapsed: false,
    showInOverview: true,
    statementValue: 10000,
    statementMonth: "2024-01",
    contribPeriods: [{ startMonth: "2024-02", personal: 100, employer: 50 }],
    contribTrackingV1: true,
    autoContrib: true,
    autoPeriods: [{ startMonth: "2024-02", endMonth: null }],
    autoEnabledMonth: "2024-02",
    ordinarySkipNext: false,
    ordinaryLastLine: -1,
    ...overrides
  };
}

function multiState(pensions) {
  return {
    loans: [],
    customGoals: [],
    pensions,
    notes: [{ id: "n1", text: "Keep note", color: "yellow" }],
    hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true }
  };
}

async function seedEstablished(page, state) {
  await page.evaluateOnNewDocument(raw => {
    if (sessionStorage.getItem("freedom50-test-seeded-v1") === "1") return;
    sessionStorage.setItem("freedom50-test-seeded-v1", "1");
    localStorage.setItem("freedom50-welcome-complete-v1", "1");
    localStorage.setItem("freedom50-look-around-complete-v1", "1");
    localStorage.setItem("freedom50-first-time-complete-v1", "1");
    localStorage.setItem("freedom50-companion-id-v1", "kevin");
    localStorage.removeItem("freedom50-companion-pending-v1");
    localStorage.setItem("freedom50-mobile-v1", raw);
  }, JSON.stringify(state));
}

async function waitHome(page) {
  await page.waitForFunction(() => typeof window.page === "function", {
    timeout: 20000
  });
  await page.waitForFunction(
    () => document.body.classList.contains("home183"),
    { timeout: 30000 }
  );
  await page.evaluate(() => {
    const splash = document.getElementById("freedomSplash");
    if (splash) splash.remove();
  });
}

async function readPension(page) {
  return page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0];
    return {
      value: p.value,
      statementValue: p.statementValue,
      statementMonth: p.statementMonth,
      personal: p.personal,
      employer: p.employer,
      autoContrib: !!p.autoContrib,
      autoStart: p.autoPeriods?.[0]?.startMonth || null,
      autoEnd: p.autoPeriods?.[0]?.endMonth ?? null,
      autoCount: (p.autoPeriods || []).length
    };
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });
  const expected = expectedAutoValue(10000, 100, 50, "2024-02");

  /* 1) Correct accrual including employer; stable across reloads */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, multiState([pensionFixture()]));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    const first = await readPension(page);
    assert.equal(first.autoContrib, true);
    assert.equal(first.personal, 100);
    assert.equal(first.employer, 50);
    assert.equal(first.value, expected);
    assert.ok(first.value > first.statementValue);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    const second = await readPension(page);
    assert.equal(second.value, first.value);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    const third = await readPension(page);
    assert.equal(third.value, first.value);
    console.log("PASS: auto-contrib value correct and stable across reloads");
    await page.close();
  }

  /* 2) Auto OFF keeps statement only; enabling starts next month (no same-month double) */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(
      page,
      multiState([
        pensionFixture({
          autoContrib: false,
          autoPeriods: [],
          autoEnabledMonth: null,
          value: 10000
        })
      ])
    );
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    const off = await readPension(page);
    assert.equal(off.autoContrib, false);
    assert.equal(off.value, 10000);

    await page.evaluate(() => {
      document.body.classList.remove("home183");
      window.hideHome?.();
      window.page("pension");
    });
    await page.waitForSelector("#pension.page.active .pension-card", { timeout: 15000 });
    await page.evaluate(() => {
      const card = document.querySelector(".pension-card[data-pension-index='0']");
      if (card?.classList.contains("is-collapsed")) {
        card.querySelector("[data-toggle-pension]")?.click();
      }
    });
    await page.waitForSelector("#pensionAuto_0", { timeout: 10000 });

    const toggled = await page.evaluate(() => {
      const box = document.getElementById("pensionAuto_0");
      if (!box) return { found: false };
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("[data-save-pension='0']")?.click();
      return { found: true };
    });
    assert.equal(toggled.found, true);
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0].autoContrib === true,
      { timeout: 8000 }
    );
    const on = await readPension(page);
    const now = new Date();
    const nextMonth = addMonths(monthKey(now), 1);
    assert.equal(on.autoContrib, true);
    assert.equal(on.autoStart, nextMonth);
    /* Enabling mid-month must not invent completed months in the current month. */
    assert.equal(on.value, 10000);
    console.log("PASS: enabling auto starts next month without same-month accrual");
    await page.close();
  }

  /* 3) Manual statement with changed balance resets baseline (no stacked history) */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, multiState([pensionFixture()]));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    const before = await readPension(page);
    assert.ok(before.value > 10000);

    await page.evaluate(() => {
      document.body.classList.remove("home183");
      window.hideHome?.();
      window.page("pension");
    });
    await page.waitForSelector("#pension.page.active .pension-card", { timeout: 15000 });
    await page.evaluate(() => {
      const card = document.querySelector(".pension-card[data-pension-index='0']");
      if (card?.classList.contains("is-collapsed")) {
        card.querySelector("[data-toggle-pension]")?.click();
      }
    });
    await page.waitForSelector("#pensionValue_0", { timeout: 10000 });
    await page.evaluate(() => {
      const el = document.getElementById("pensionValue_0");
      el.value = "12000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-save-pension='0']").click();
    });
    const nowMonth = monthKey(new Date());
    await page.waitForFunction(
      month =>
        JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
          .statementMonth === month,
      { timeout: 8000 },
      nowMonth
    );
    const after = await readPension(page);
    assert.equal(after.statementValue, 12000);
    assert.equal(after.statementMonth, nowMonth);
    assert.equal(after.autoCount, 1);
    assert.equal(after.value, 12000);
    console.log("PASS: manual statement balance change resets baseline cleanly");
    await page.close();
  }

  /* 4) Pure month-boundary math: lastCompleted only (current month not counted) */
  {
    const asOf = new Date(2026, 10, 18); /* 18 Nov 2026 local */
    const v = expectedAutoValue(10000, 100, 50, "2024-02", asOf);
    const lastCompleted = "2026-10";
    const months = countMonthsInclusive("2024-02", lastCompleted);
    assert.equal(months, 33);
    assert.equal(v, 10000 + 33 * 150);
    console.log("PASS: completed-month boundary math (employer included)");
  }

  await browser.close();
  console.log("PASS: pension auto-contrib regression");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
