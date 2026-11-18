/**
 * Journey repayments must not exceed remaining balance.
 * Over-amount shows validation and leaves financial state unchanged.
 * Exact final repayment still completes the Journey once.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /data-loan-repayment-msg/);
assert.match(index, /Your remaining balance is \$\{euro2\(remaining\)\}\. You can enter up to \$\{euro2\(remaining\)\}\./);
assert.match(index, /if\(amount>remaining\)/);
assert.match(index, /role="alert" aria-live="assertive"/);
assert.match(index, /\.journey-repayment-msg\{/);
assert.equal(/Your remaining balance is.*—|—.*You can enter/.test(index), false);
console.log("PASS: source contracts for journey repayment max");

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

const SAVED_STATE = {
  loans: [
    {
      name: "REPAY-MAX",
      starting: 500,
      current: 80,
      payment: 40,
      collapsed: false,
      payoffMode: "monthly",
      freedomDate: null,
      lastRepaymentAmount: 40,
      lastRepaymentDate: "2024-06-01T12:00:00.000Z",
      firstRepaymentCompanionConsumed: true
    }
  ],
  customGoals: [],
  pensions: [],
  notes: [{ id: "n1", text: "Keep note", color: "yellow" }],
  hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true }
};

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

async function openJourneyMoney(page) {
  await page.evaluate(() => {
    document.body.classList.remove("home183");
    window.hideHome?.();
    window.page("journey");
  });
  await page.waitForSelector("#journey.page.active .loan-card", { timeout: 15000 });
  await page.evaluate(() => {
    const card = document.querySelector(".loan-card[data-loan-index='0']");
    if (card?.classList.contains("is-collapsed")) {
      card.querySelector("[data-toggle-loan]")?.click();
    }
  });
  await page.waitForSelector("#loanRepayment_0", { timeout: 10000 });
  const moneyOpen = await page.evaluate(() => {
    const section = document.querySelector('[data-loan-section-money="0"]');
    return section && !section.classList.contains("is-collapsed");
  });
  if (!moneyOpen) {
    await page.click("[data-loan-money-section='0']");
    await page.waitForSelector("#loanRepayment_0", { timeout: 5000 });
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* 1) Over-amount rejected; state unchanged */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openJourneyMoney(page);
    const result = await page.evaluate(() => {
      const before = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      const inp = document.getElementById("loanRepayment_0");
      inp.value = "200";
      document.querySelector("[data-add-repayment='0']").click();
      const msg = document.querySelector('[data-loan-repayment-msg="0"]');
      const after = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      const style = msg ? getComputedStyle(msg) : null;
      return {
        msgHidden: !!msg?.hidden,
        msgText: msg?.textContent || "",
        role: msg?.getAttribute("role"),
        live: msg?.getAttribute("aria-live"),
        bg: style?.backgroundColor || "",
        beforeCurrent: before.current,
        beforeLast: before.lastRepaymentAmount,
        afterCurrent: after.current,
        afterLast: after.lastRepaymentAmount,
        afterDate: after.lastRepaymentDate
      };
    });
    assert.equal(result.msgHidden, false);
    assert.equal(result.role, "alert");
    assert.equal(result.live, "assertive");
    assert.notEqual(result.bg, "rgba(0, 0, 0, 0)");
    assert.equal(
      result.msgText,
      "Your remaining balance is €80.00. You can enter up to €80.00."
    );
    assert.equal(result.afterCurrent, 80);
    assert.equal(result.afterLast, 40);
    assert.equal(result.afterDate, "2024-06-01T12:00:00.000Z");
    assert.equal(result.beforeCurrent, result.afterCurrent);
    console.log("PASS: repayment above remaining balance is rejected");
    await page.close();
  }

  /* 2) Zero / invalid leave state alone */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openJourneyMoney(page);
    const result = await page.evaluate(() => {
      const snap = () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      const before = snap();
      const inp = document.getElementById("loanRepayment_0");
      inp.value = "0";
      document.querySelector("[data-add-repayment='0']").click();
      const afterZero = snap();
      inp.value = "";
      document.querySelector("[data-add-repayment='0']").click();
      const afterEmpty = snap();
      return {
        beforeLast: before.lastRepaymentAmount,
        afterZeroCurrent: afterZero.current,
        afterZeroLast: afterZero.lastRepaymentAmount,
        afterEmptyCurrent: afterEmpty.current,
        afterEmptyLast: afterEmpty.lastRepaymentAmount
      };
    });
    assert.equal(result.afterZeroCurrent, 80);
    assert.equal(result.afterZeroLast, 40);
    assert.equal(result.afterEmptyCurrent, 80);
    assert.equal(result.afterEmptyLast, 40);
    console.log("PASS: zero and empty repayments do not change state");
    await page.close();
  }

  /* 3) Smaller repayment accepted */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openJourneyMoney(page);
    await page.evaluate(() => {
      const inp = document.getElementById("loanRepayment_0");
      inp.value = "30";
      document.querySelector("[data-add-repayment='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 50,
      { timeout: 5000 }
    );
    const after = await page.evaluate(() => {
      const loan = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return { current: loan.current, last: loan.lastRepaymentAmount };
    });
    assert.equal(after.current, 50);
    assert.equal(after.last, 30);
    console.log("PASS: smaller repayment records correctly");
    await page.close();
  }

  /* 4) Exact final repayment completes once; no duplicate completion hosts */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openJourneyMoney(page);
    await page.evaluate(() => {
      const inp = document.getElementById("loanRepayment_0");
      inp.value = "80";
      document.querySelector("[data-add-repayment='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 0,
      { timeout: 5000 }
    );
    const done = await page.evaluate(() => {
      const loan = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      const hosts = document.querySelectorAll(
        "#freedomJourneyCompanionMsgHost, [id*='Companion'], .freedom-companion-msg-host"
      );
      const visibleHosts = [...document.querySelectorAll(".freedom-companion-msg-host")].filter(
        el => !el.hidden
      );
      return {
        current: loan.current,
        last: loan.lastRepaymentAmount,
        completionExperienced: !!loan.completionExperienced,
        visibleCompanionHosts: visibleHosts.length
      };
    });
    assert.equal(done.current, 0);
    assert.equal(done.last, 80);
    assert.equal(done.completionExperienced, true);
    assert.ok(done.visibleCompanionHosts <= 1);
    console.log("PASS: exact final repayment completes without duplicate messages");
    await page.close();
  }

  /* 5) Demo Mode leaves personal blob intact; rejected over-amount persists after refresh */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openJourneyMoney(page);
    await page.evaluate(() => {
      document.getElementById("loanRepayment_0").value = "200";
      document.querySelector("[data-add-repayment='0']").click();
    });
    await page.evaluate(() => window.enterDemo());
    await page.waitForFunction(
      () => document.body.classList.contains("demo-mode-active"),
      { timeout: 10000 }
    );
    const demo = await page.evaluate(() => {
      const personal = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return {
        demo: document.body.classList.contains("demo-mode-active"),
        current: personal.current,
        last: personal.lastRepaymentAmount
      };
    });
    assert.equal(demo.demo, true);
    assert.equal(demo.current, 80);
    assert.equal(demo.last, 40);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    const persisted = await page.evaluate(() => {
      const loan = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return { current: loan.current, last: loan.lastRepaymentAmount };
    });
    assert.equal(persisted.current, 80);
    assert.equal(persisted.last, 40);
    console.log("PASS: Demo isolation and persistence after rejected over-amount");
    await page.close();
  }

  await browser.close();
  console.log("PASS: journey repayment max flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
