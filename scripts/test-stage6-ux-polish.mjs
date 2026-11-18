/**
 * Stage 6 UX polish contracts + smoke:
 * - Goal completion close-chapter offers Move to Victories / Keep / Delete
 * - Journey original loan amount beside Money returned
 * - Correct Balance Journey note uses "left to pay"
 * - Overpay message is assertive + styled alert
 * - Delete uses FreedomConfirmRemoval delete mode (not window.confirm only)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");

assert.match(index, /yesBtn\.textContent="Move to Victories"/);
assert.match(index, /notYetBtn\.textContent=isGoal\?"Keep in Goals":"Keep in Journey"/);
assert.match(index, /deleteBtn\.textContent=isGoal\?"Delete Goal":"Delete Journey"/);
assert.match(index, /mode:"delete"/);
assert.match(index, /permanentlyDeleteActiveItem/);
assert.match(index, /Original loan amount/);
assert.match(index, /loan-summary-returned-pair/);
assert.match(
  index,
  /Use this if the balance shown doesn't match what you actually have left to pay\./
);
assert.match(index, /role="alert" aria-live="assertive"/);
assert.match(index, /\.journey-repayment-msg\{/);
assert.equal(/completed history/i.test(index), false);
assert.equal(
  /Use this if the balance shown doesn't match what you actually have left to pay\.—|—Use this if the balance shown/.test(
    index
  ),
  false
);
console.log("PASS: source contracts for Stage 6 UX polish");

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
      id: "loan-orig-1",
      name: "Test Loan",
      starting: 2000,
      current: 1150,
      payment: 100,
      collapsed: false,
      payoffMode: "monthly",
      freedomDate: null,
      lastRepaymentAmount: 850,
      lastRepaymentDate: "2024-06-01T12:00:00.000Z",
      firstRepaymentCompanionConsumed: true
    }
  ],
  customGoals: [
    {
      id: "goal-del-1",
      name: "Delete Me Goal",
      current: 50,
      target: 500,
      monthly: 25,
      collapsed: false,
      hasTarget: true
    }
  ],
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

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* 1) Original loan amount + Correct Balance note */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
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
    await page.waitForSelector(".journey-starting-value", { timeout: 10000 });
    const details = await page.evaluate(() => {
      const returned = document.querySelector(".journey-returned-value")?.textContent?.trim();
      const starting = document.querySelector(".journey-starting-value")?.textContent?.trim();
      const pair = !!document.querySelector(".loan-summary-returned-pair");
      const money = document.querySelector('[data-loan-section-money="0"]');
      if (money?.classList.contains("is-collapsed")) {
        document.querySelector("[data-loan-money-section='0']")?.click();
      }
      const correctBtn = document.querySelector("[data-loan-correct-balance-toggle='0']");
      if (correctBtn) correctBtn.click();
      const noteAfter =
        document.querySelector(".goal-correct-note")?.textContent?.trim() ||
        Array.from(document.querySelectorAll("#journey .loan-card .goal-correct-note, #journey .loan-card p"))
          .map(el => el.textContent.trim())
          .find(t => /left to pay/.test(t)) ||
        "";
      return { returned, starting, pair, noteAfter };
    });
    assert.equal(details.pair, true);
    assert.match(details.returned || "", /€850\.00/);
    assert.match(details.starting || "", /€2,000\.00/);
    assert.match(details.noteAfter, /left to pay/);
    console.log("PASS: Original loan amount + Journey correct-balance wording");
    await page.close();
  }

  /* 2) Overpay alert visibility attributes */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
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
      const money = document.querySelector('[data-loan-section-money="0"]');
      if (money?.classList.contains("is-collapsed")) {
        document.querySelector("[data-loan-money-section='0']")?.click();
      }
    });
    await page.waitForSelector("#loanRepayment_0", { timeout: 10000 });
    const alert = await page.evaluate(() => {
      const inp = document.getElementById("loanRepayment_0");
      inp.value = "9999";
      document.querySelector("[data-add-repayment='0']").click();
      const msg = document.querySelector('[data-loan-repayment-msg="0"]');
      const style = msg ? getComputedStyle(msg) : null;
      return {
        hidden: !!msg?.hidden,
        role: msg?.getAttribute("role"),
        live: msg?.getAttribute("aria-live"),
        text: msg?.textContent || "",
        bg: style?.backgroundColor || "",
        display: style?.display || ""
      };
    });
    assert.equal(alert.hidden, false);
    assert.equal(alert.role, "alert");
    assert.equal(alert.live, "assertive");
    assert.match(alert.text, /remaining balance/i);
    assert.notEqual(alert.display, "none");
    assert.notEqual(alert.bg, "rgba(0, 0, 0, 0)");
    console.log("PASS: overpay validation is visible and assertive");
    await page.close();
  }

  /* 3) Styled delete confirmation for Journey + Goal */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);

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
    await page.waitForSelector("[data-delete-loan='0']", { timeout: 10000 });
    await page.evaluate(() => {
      const btn = document.querySelector("[data-delete-loan='0']");
      btn?.scrollIntoView({ block: "center" });
      btn?.click();
    });
    await page.waitForFunction(
      () => !document.getElementById("freedomConfirmRemovalOverlay")?.hidden,
      { timeout: 5000 }
    );
    const journeyDelete = await page.evaluate(() => {
      const overlay = document.getElementById("freedomConfirmRemovalOverlay");
      const card = overlay.querySelector(".freedom-confirm-removal-card");
      return {
        title: document.getElementById("freedomConfirmRemovalTitle")?.textContent,
        body: document.getElementById("freedomConfirmRemovalBody")?.textContent,
        cancel: document.getElementById("freedomConfirmRemovalNotYet")?.textContent,
        deleteLabel: document.getElementById("freedomConfirmRemovalDelete")?.textContent,
        deleteHidden: !!document.getElementById("freedomConfirmRemovalDelete")?.hidden,
        yesHidden: !!document.getElementById("freedomConfirmRemovalYes")?.hidden,
        deleteMode: card.classList.contains("is-delete-mode")
      };
    });
    assert.equal(journeyDelete.title, "Delete this Journey?");
    assert.match(journeyDelete.body, /permanently removed/);
    assert.equal(journeyDelete.cancel, "Cancel");
    assert.equal(journeyDelete.deleteLabel, "Delete Journey");
    assert.equal(journeyDelete.deleteHidden, false);
    assert.equal(journeyDelete.yesHidden, true);
    assert.equal(journeyDelete.deleteMode, true);
    await page.click("#freedomConfirmRemovalNotYet");
    await page.waitForFunction(
      () => document.getElementById("freedomConfirmRemovalOverlay")?.hidden,
      { timeout: 5000 }
    );

    await page.evaluate(() => {
      window.page("goals");
    });
    await page.waitForSelector("#goals.page.active .goal-card", { timeout: 15000 });
    await page.evaluate(() => {
      const card = document.querySelector("#goalsList .goal-card");
      if (card?.classList.contains("is-collapsed")) {
        card.querySelector("[data-toggle-goal], [data-toggle-custom-goal]")?.click();
      }
    });
    await page.waitForSelector("[data-delete-goal='0']", { timeout: 10000 });
    await page.evaluate(() => {
      const btn = document.querySelector("[data-delete-goal='0']");
      btn?.scrollIntoView({ block: "center" });
      btn?.click();
    });
    await page.waitForFunction(
      () => !document.getElementById("freedomConfirmRemovalOverlay")?.hidden,
      { timeout: 5000 }
    );
    const goalDelete = await page.evaluate(() => ({
      title: document.getElementById("freedomConfirmRemovalTitle")?.textContent,
      cancel: document.getElementById("freedomConfirmRemovalNotYet")?.textContent,
      deleteLabel: document.getElementById("freedomConfirmRemovalDelete")?.textContent,
      yesHidden: !!document.getElementById("freedomConfirmRemovalYes")?.hidden
    }));
    assert.equal(goalDelete.title, "Delete this Goal?");
    assert.equal(goalDelete.cancel, "Cancel");
    assert.equal(goalDelete.deleteLabel, "Delete Goal");
    assert.equal(goalDelete.yesHidden, true);
    console.log("PASS: styled delete confirmation for Journey and Goal");
    await page.close();
  }

  /* 4) Goal close-chapter offers three actions */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    const labels = await page.evaluate(() => {
      window.FreedomConfirmRemoval.show({
        kind: "goal",
        itemName: "Kitchen",
        recordId: "goal-del-1",
        amount: 500,
        completedAt: new Date().toISOString()
      });
      return {
        title: document.getElementById("freedomConfirmRemovalTitle")?.textContent,
        body: document.getElementById("freedomConfirmRemovalBody")?.textContent,
        keep: document.getElementById("freedomConfirmRemovalNotYet")?.textContent,
        yes: document.getElementById("freedomConfirmRemovalYes")?.textContent,
        del: document.getElementById("freedomConfirmRemovalDelete")?.textContent,
        delHidden: !!document.getElementById("freedomConfirmRemovalDelete")?.hidden,
        keepHidden: !!document.getElementById("freedomConfirmRemovalNotYet")?.hidden,
        yesHidden: !!document.getElementById("freedomConfirmRemovalYes")?.hidden
      };
    });
    assert.equal(labels.title, "Ready to close this chapter?");
    assert.match(labels.body, /Victories/);
    assert.equal(labels.keep, "Keep in Goals");
    assert.equal(labels.yes, "Move to Victories");
    assert.equal(labels.del, "Delete Goal");
    assert.equal(labels.delHidden, false);
    assert.equal(labels.keepHidden, false);
    assert.equal(labels.yesHidden, false);
    console.log("PASS: Goal completion offers three clear choices");
    await page.close();
  }

  await browser.close();
  console.log("PASS: Stage 6 UX polish");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
