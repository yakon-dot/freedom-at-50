/**
 * Pension statement baseline:
 * - Editing the statement value field (even with the same number) resets the baseline
 * - Ordinary Save of name / contributions / auto / Overview does not
 * - Auto on/off and combined totals stay coherent; Demo leaves personal data alone
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /dataset\.statementEdited/);
assert.match(index, /statementIntent/);
assert.match(index, /statementEdited\|\|statementChanged|statementChanged\|\|statementEdited/);
assert.match(index, /pensionResetStatementBaseline/);
console.log("PASS: source contracts for pension statement baseline");

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

function pensionFixture(overrides = {}) {
  return {
    id: "pension-test-1",
    name: "BASELINE-POT",
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
    /* Skip on reload so persistence checks keep the saved personal blob. */
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

async function openPension(page) {
  await page.evaluate(() => {
    document.body.classList.remove("home183");
    window.hideHome?.();
    window.page("pension");
  });
  await page.waitForSelector("#pension.page.active .pension-card", {
    timeout: 15000
  });
}

async function expandFirst(page) {
  await page.evaluate(() => {
    const card = document.querySelector(".pension-card[data-pension-index='0']");
    if (card?.classList.contains("is-collapsed")) {
      card.querySelector("[data-toggle-pension]")?.click();
    }
  });
  await page.waitForSelector("#pensionValue_0", { timeout: 10000 });
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });
  const nowMonth = currentMonthKey();

  /* 1) Same-balance statement edit resets baseline */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, multiState([pensionFixture()]));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPension(page);
    await expandFirst(page);
    const before = await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0];
      return {
        statementMonth: p.statementMonth,
        statementValue: p.statementValue,
        autoStart: p.autoPeriods?.[0]?.startMonth,
        value: p.value
      };
    });
    assert.equal(before.statementMonth, "2024-01");
    assert.ok(before.value > before.statementValue);

    await page.evaluate(() => {
      const el = document.getElementById("pensionValue_0");
      el.value = "10000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-save-pension='0']").click();
    });
    await page.waitForFunction(
      month =>
        JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
          .statementMonth === month,
      { timeout: 5000 },
      nowMonth
    );
    const after = await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0];
      return {
        statementMonth: p.statementMonth,
        statementValue: p.statementValue,
        autoStart: p.autoPeriods?.[0]?.startMonth,
        autoCount: (p.autoPeriods || []).length,
        value: p.value,
        personal: p.personal
      };
    });
    assert.equal(after.statementValue, 10000);
    assert.equal(after.statementMonth, nowMonth);
    assert.equal(after.autoCount, 1);
    assert.notEqual(after.autoStart, "2024-02");
    assert.equal(after.value, 10000);
    assert.equal(after.personal, 100);
    console.log("PASS: same-balance statement edit resets baseline");
    await page.close();
  }

  /* 2) Higher and lower statement balances also reset */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, multiState([pensionFixture()]));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPension(page);
    await expandFirst(page);
    await page.evaluate(() => {
      const el = document.getElementById("pensionValue_0");
      el.value = "12000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-save-pension='0']").click();
    });
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
          .statementValue === 12000,
      { timeout: 5000 }
    );
    let p = await page.evaluate(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
    );
    assert.equal(p.statementMonth, nowMonth);
    assert.equal(p.value, 12000);

    await expandFirst(page);
    await page.evaluate(() => {
      const el = document.getElementById("pensionValue_0");
      el.value = "9000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-save-pension='0']").click();
    });
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
          .statementValue === 9000,
      { timeout: 5000 }
    );
    p = await page.evaluate(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
    );
    assert.equal(p.statementValue, 9000);
    assert.equal(p.statementMonth, nowMonth);
    assert.equal(p.value, 9000);
    console.log("PASS: higher and lower statement balances reset baseline");
    await page.close();
  }

  /* 3) Ordinary Save without touching statement value keeps baseline */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, multiState([pensionFixture()]));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPension(page);
    await expandFirst(page);
    const before = await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0];
      return {
        statementMonth: p.statementMonth,
        autoStart: p.autoPeriods?.[0]?.startMonth,
        value: p.value
      };
    });
    await page.evaluate(() => {
      document.querySelector('[data-pension-name="0"]').value = "BASELINE-POT-RENAMED";
      document.getElementById("pensionPersonal_0").value = "125";
      document.getElementById("pensionPersonal_0").dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("pensionEmployer_0").value = "75";
      document.getElementById("pensionEmployer_0").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-save-pension='0']").click();
    });
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0].name ===
        "BASELINE-POT-RENAMED",
      { timeout: 5000 }
    );
    const after = await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0];
      return {
        name: p.name,
        personal: p.personal,
        employer: p.employer,
        statementMonth: p.statementMonth,
        statementValue: p.statementValue,
        autoStart: p.autoPeriods?.[0]?.startMonth,
        value: p.value
      };
    });
    assert.equal(after.name, "BASELINE-POT-RENAMED");
    assert.equal(after.personal, 125);
    assert.equal(after.employer, 75);
    assert.equal(after.statementMonth, before.statementMonth);
    assert.equal(after.statementValue, 10000);
    assert.equal(after.autoStart, before.autoStart);
    assert.ok(after.value >= before.value);
    console.log("PASS: name/contribution Save does not reset statement baseline");
    await page.close();
  }

  /* 4) Auto toggle on/off without statement edit does not reset baseline */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, multiState([pensionFixture({ autoContrib: true })]));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPension(page);
    await expandFirst(page);
    await page.evaluate(() => {
      const auto = document.getElementById("pensionAuto_0");
      auto.checked = false;
      auto.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("[data-save-pension='0']").click();
    });
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
          .autoContrib === false,
      { timeout: 5000 }
    );
    let p = await page.evaluate(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
    );
    assert.equal(p.statementMonth, "2024-01");
    assert.equal(p.statementValue, 10000);
    assert.equal(p.autoContrib, false);
    assert.equal(p.value, 10000);

    await expandFirst(page);
    await page.evaluate(() => {
      const auto = document.getElementById("pensionAuto_0");
      auto.checked = true;
      auto.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("[data-save-pension='0']").click();
    });
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
          .autoContrib === true,
      { timeout: 5000 }
    );
    p = await page.evaluate(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
    );
    assert.equal(p.statementMonth, "2024-01");
    assert.equal(p.statementValue, 10000);
    assert.equal(p.autoContrib, true);
    console.log("PASS: auto on/off Save does not reset statement baseline");
    await page.close();
  }

  /* 5) Multiple pensions / combined totals / Overview / persistence */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(
      page,
      multiState([
        pensionFixture({ id: "p1", name: "Pot A", statementValue: 10000, value: 10000 }),
        pensionFixture({
          id: "p2",
          name: "Pot B",
          statementValue: 5000,
          value: 5000,
          personal: 40,
          employer: 20,
          showInOverview: false
        })
      ])
    );
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPension(page);
    await expandFirst(page);
    await page.evaluate(() => {
      const el = document.getElementById("pensionValue_0");
      el.value = "10000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-save-pension='0']").click();
    });
    await page.waitForFunction(
      month =>
        JSON.parse(localStorage.getItem("freedom50-mobile-v1")).pensions[0]
          .statementMonth === month,
      { timeout: 5000 },
      nowMonth
    );
    const totals = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      const a = st.pensions[0];
      const b = st.pensions[1];
      const combined = (st.pensions || []).reduce((s, p) => s + (Number(p.value) || 0), 0);
      const overview = (st.pensions || [])
        .filter(p => p.showInOverview !== false)
        .reduce((s, p) => s + (Number(p.value) || 0), 0);
      const ui = document.getElementById("pensionDemoCombinedValue")?.textContent || "";
      return {
        combined,
        overview,
        ui,
        aMonth: a.statementMonth,
        aValue: a.value,
        bMonth: b.statementMonth,
        bStatement: b.statementValue,
        bValue: b.value
      };
    });
    assert.equal(totals.aMonth, nowMonth);
    assert.equal(totals.aValue, 10000);
    assert.equal(totals.bMonth, "2024-01");
    assert.equal(totals.bStatement, 5000);
    assert.ok(totals.bValue >= 5000);
    assert.equal(totals.overview, totals.aValue);
    assert.equal(totals.combined, totals.aValue + totals.bValue);
    assert.match(
      totals.ui.replace(/,/g, ""),
      new RegExp(String(Math.round(totals.combined)))
    );

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    const persisted = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        aMonth: st.pensions[0].statementMonth,
        aValue: st.pensions[0].statementValue,
        bMonth: st.pensions[1].statementMonth
      };
    });
    assert.equal(persisted.aMonth, nowMonth);
    assert.equal(persisted.aValue, 10000);
    assert.equal(persisted.bMonth, "2024-01");
    console.log("PASS: multi-pension totals and persistence");
    await page.close();
  }

  /* 6) Demo Mode isolation */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, multiState([pensionFixture()]));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await page.evaluate(() => window.enterDemo());
    await page.waitForFunction(
      () => document.body.classList.contains("demo-mode-active"),
      { timeout: 10000 }
    );
    const demo = await page.evaluate(() => {
      const personal = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        demo: document.body.classList.contains("demo-mode-active"),
        name: personal.pensions[0].name,
        statementMonth: personal.pensions[0].statementMonth,
        statementValue: personal.pensions[0].statementValue
      };
    });
    assert.equal(demo.demo, true);
    assert.equal(demo.name, "BASELINE-POT");
    assert.equal(demo.statementMonth, "2024-01");
    assert.equal(demo.statementValue, 10000);
    console.log("PASS: Demo Mode leaves personal pension baseline intact");
    await page.close();
  }

  await browser.close();
  console.log("PASS: pension statement baseline flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
