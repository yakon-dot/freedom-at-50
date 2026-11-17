/**
 * Journey / Goal plan edits must not commit until Save.
 * Collapse, tab switches and unrelated actions keep the last saved values.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");

assert.match(index, /function getLoanLivePlanningValues/);
assert.match(
  index,
  /Name \/ plan fields commit on Save only|Payoff mode commits on Save/
);
assert.match(index, /Plan mode commits on Save/);
assert.equal(
  /input\.addEventListener\("input",e=>\{[\s\S]*?applyLoanField\(i,field/.test(index),
  false
);
assert.equal(/setGoalPlannedMonthly\(key,inp\.value\)/.test(index), false);
assert.equal(/setGoalDate\(key,inp\.value/.test(index), false);
assert.equal(/loan\.payoffMode=mode;/.test(index), false);
console.log("PASS: source contracts for draft-until-save");

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
      name: "DRAFT-LOAN",
      starting: 2000,
      current: 1500,
      payment: 100,
      collapsed: false,
      payoffMode: "monthly",
      freedomDate: null,
      firstRepaymentCompanionConsumed: true
    }
  ],
  customGoals: [
    {
      name: "DRAFT-GOAL",
      current: 200,
      startingBalance: 0,
      target: 1000,
      hasTarget: true,
      planMode: "monthly",
      plannedMonthly: 50,
      goalDate: null,
      lifetimeAdded: 200,
      lifeHappensTotal: 0
    }
  ],
  notes: [{ id: "n1", text: "Keep note", color: "yellow" }],
  hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true },
  goalCollapsed: { "custom:0": false }
};

async function seedEstablished(page, state) {
  await page.evaluateOnNewDocument(raw => {
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
    () => document.body.classList.contains("home183") && !document.getElementById("freedomSplash"),
    { timeout: 30000 }
  );
}

async function openPage(page, id, selector) {
  await page.evaluate(pageId => {
    document.body.classList.remove("home183");
    window.hideHome?.();
    window.page(pageId);
  }, id);
  await page.waitForSelector(selector, { timeout: 15000 });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* 1) Journey payment edit → collapse without Save → prior payment remains */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPage(page, "journey", "#journey.page.active .loan-card");
    await page.click("[data-loan-plan-section='0']");
    const preview = await page.evaluate(() => {
      const pay = document.querySelector('input[data-loan="0"][data-field="payment"]');
      pay.value = "321";
      pay.dispatchEvent(new Event("input", { bubbles: true }));
      const summary = document.getElementById("journeyMonthlyAmount")?.textContent || "";
      const storedPay = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].payment;
      document.querySelector("[data-toggle-loan='0']").click();
      return { summary, storedPay };
    });
    assert.equal(preview.storedPay, 100);
    assert.match(preview.summary, /321/);
    await page.waitForFunction(
      () => document.querySelector("#loanList .loan-card.is-collapsed"),
      { timeout: 5000 }
    );
    await new Promise(r => setTimeout(r, 500));
    const afterCollapse = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        payment: stored.loans[0].payment,
        name: stored.loans[0].name
      };
    });
    assert.equal(afterCollapse.payment, 100);
    assert.equal(afterCollapse.name, "DRAFT-LOAN");

    /* reopen + navigate away still keeps prior */
    await page.evaluate(() => {
      document.querySelector("[data-toggle-loan='0']").click();
    });
    await page.waitForSelector('input[data-loan="0"][data-field="payment"]', { timeout: 5000 });
    const reopened = await page.evaluate(
      () => document.querySelector('input[data-loan="0"][data-field="payment"]').value
    );
    assert.equal(Number(reopened), 100);
    await openPage(page, "goals", "#goals.page.active .goal-card");
    await openPage(page, "journey", "#journey.page.active .loan-card");
    const afterNav = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return stored.loans[0].payment;
    });
    assert.equal(afterNav, 100);
    console.log("PASS: Journey payment edit + collapse/nav keeps prior value");
    await page.close();
  }

  /* 2) Journey payment + freedom date + mode → Save commits; reload keeps */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPage(page, "journey", "#journey.page.active .loan-card");
    await page.click("[data-loan-plan-section='0']");
    await page.evaluate(() => {
      const pay = document.querySelector('input[data-loan="0"][data-field="payment"]');
      pay.value = "175";
      pay.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('[data-loan-mode="0"][data-mode="date"]').click();
      const date = document.querySelector('input[data-loan="0"][data-field="freedomDate"]');
      date.value = "2030-06";
      date.dispatchEvent(new Event("input", { bubbles: true }));
      /* Before Save, storage must still hold the prior monthly plan. */
      window.__before = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      document.querySelector("[data-save-loan='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].payment === 175,
      { timeout: 5000 }
    );
    const saved = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        before: window.__before,
        payment: stored.loans[0].payment,
        mode: stored.loans[0].payoffMode,
        date: stored.loans[0].freedomDate
      };
    });
    assert.equal(saved.before.payment, 100);
    assert.equal(saved.before.payoffMode, "monthly");
    assert.equal(saved.before.freedomDate, null);
    assert.equal(saved.payment, 175);
    assert.equal(saved.mode, "date");
    assert.equal(saved.date, "2030-06-01");
    console.log("PASS: Journey Save commits payment, date and payoff mode");
    await page.close();
  }

  /* 3) Goal planned monthly edit → collapse without Save → prior remains */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPage(page, "goals", "#goals.page.active .goal-card");
    await page.click('[data-goal-plan-section="custom:0"]');
    const preview = await page.evaluate(() => {
      const planned = document.querySelector('[data-goal-planned="custom:0"]');
      planned.value = "222";
      planned.dispatchEvent(new Event("input", { bubbles: true }));
      const summary = document.getElementById("goalsMonthlyAmount")?.textContent || "";
      const target = document.querySelector("#goalTarget_custom_0");
      target.value = "2500";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      const stored = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).customGoals[0];
      document.querySelector('[data-toggle-goal="custom:0"]').click();
      return {
        summary,
        storedPlanned: stored.plannedMonthly,
        storedTarget: stored.target
      };
    });
    assert.equal(preview.storedPlanned, 50);
    assert.equal(preview.storedTarget, 1000);
    assert.match(preview.summary, /222/);
    await page.waitForFunction(
      () => document.querySelector('#goalsList .goal-card[data-goal-key="custom:0"].is-collapsed'),
      { timeout: 5000 }
    );
    await new Promise(r => setTimeout(r, 500));
    const after = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        planned: stored.customGoals[0].plannedMonthly,
        target: stored.customGoals[0].target,
        name: stored.customGoals[0].name
      };
    });
    assert.equal(after.planned, 50);
    assert.equal(after.target, 1000);
    assert.equal(after.name, "DRAFT-GOAL");
    console.log("PASS: Goal planned/target edit + collapse keeps prior values");
    await page.close();
  }

  /* 4) Goal Save commits planned, date, mode, target together */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPage(page, "goals", "#goals.page.active .goal-card");
    await page.click('[data-goal-plan-section="custom:0"]');
    await page.evaluate(() => {
      document.querySelector("#goalTarget_custom_0").value = "1800";
      document.querySelector("#goalTarget_custom_0").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('[data-goal-planned="custom:0"]').value = "90";
      document.querySelector('[data-goal-planned="custom:0"]').dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('[data-goal-plan-mode="custom:0"][data-mode="date"]').click();
      document.querySelector('[data-goal-date="custom:0"]').value = "2029-12";
      document.querySelector('[data-goal-date="custom:0"]').dispatchEvent(new Event("input", { bubbles: true }));
      window.__goalBefore = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).customGoals[0];
      document.querySelector('[data-save-goal="custom:0"]').click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).customGoals[0].plannedMonthly === 90,
      { timeout: 5000 }
    );
    const saved = await page.evaluate(() => {
      const g = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).customGoals[0];
      return { before: window.__goalBefore, g };
    });
    assert.equal(saved.before.plannedMonthly, 50);
    assert.equal(saved.before.target, 1000);
    assert.equal(saved.before.planMode, "monthly");
    assert.equal(saved.g.plannedMonthly, 90);
    assert.equal(saved.g.target, 1800);
    assert.equal(saved.g.planMode, "date");
    assert.equal(saved.g.goalDate, "2029-12");
    console.log("PASS: Goal Save commits planned, target, date and plan mode");
    await page.close();
  }

  /* 5) Repayment still commits immediately; Demo Mode keeps personal blob intact */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openPage(page, "journey", "#journey.page.active .loan-card");
    await page.click("[data-loan-money-section='0']");
    await page.evaluate(() => {
      const inp = document.getElementById("loanRepayment_0");
      inp.value = "25";
      document.querySelector("[data-add-repayment='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 1475,
      { timeout: 5000 }
    );
    const repay = await page.evaluate(() => {
      const loan = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return { current: loan.current, payment: loan.payment, amount: loan.lastRepaymentAmount };
    });
    assert.equal(repay.current, 1475);
    assert.equal(repay.payment, 100);
    assert.equal(repay.amount, 25);

    await page.evaluate(() => window.enterDemo());
    await page.waitForFunction(
      () => document.body.classList.contains("demo-mode-active"),
      { timeout: 10000 }
    );
    const demo = await page.evaluate(() => {
      const personal = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
      return {
        demo: document.body.classList.contains("demo-mode-active"),
        payment: personal.loans[0].payment,
        planned: personal.customGoals[0].plannedMonthly,
        current: personal.loans[0].current
      };
    });
    assert.equal(demo.demo, true);
    assert.equal(demo.payment, 100);
    assert.equal(demo.planned, 50);
    assert.equal(demo.current, 1475);
    console.log("PASS: repayment still saves; Demo Mode leaves personal blob intact");
    await page.close();
  }

  await browser.close();
  console.log("PASS: unsaved-edit draft-until-save flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
