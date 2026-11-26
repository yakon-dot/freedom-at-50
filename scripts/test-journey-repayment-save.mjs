/**
 * Journey Money Movement: Add Repayment and Save share apply logic.
 * Covers apply-once, validation, milestone, and persistence.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /function applyJourneyRepaymentToLoan/);
assert.match(index, /function presentJourneyRepaymentEffects/);
assert.match(index, /function parseJourneyRepaymentField/);
assert.match(index, /function showJourneyRepaymentInvalid/);
assert.match(index, /Enter a valid repayment amount greater than zero\./);
assert.match(index, /journeyRepaymentBusy/);
assert.match(index, /Your remaining balance is \$\{euro2\(remaining\)\}\. You can enter up to \$\{euro2\(remaining\)\}\./);
/* Save must call shared apply (not only injectRepay). */
assert.match(
  index,
  /data-save-loan[\s\S]*?applyJourneyRepaymentToLoan\(i/
);
assert.match(
  index,
  /data-add-repayment[\s\S]*?applyJourneyRepaymentToLoan\(i\)/
);
console.log("PASS: source contracts for journey repayment Save/Add share");

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

function baseState(overrides = {}) {
  return {
    loans: [
      {
        name: "REPAY-SAVE",
        starting: 1000,
        current: 600,
        payment: 50,
        collapsed: false,
        payoffMode: "monthly",
        freedomDate: null,
        lastRepaymentAmount: 50,
        lastRepaymentDate: "2024-06-01T12:00:00.000Z",
        firstRepaymentCompanionConsumed: true,
        milestoneExperienced: false,
        ...(overrides.loan || {})
      }
    ],
    customGoals: [],
    pensions: [],
    notes: [],
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
  await page.waitForFunction(() => typeof window.page === "function", { timeout: 20000 });
  await page.waitForFunction(() => document.body.classList.contains("home183"), {
    timeout: 30000
  });
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

async function loanSnap(page) {
  return page.evaluate(() => {
    const loan = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
    const inp = document.getElementById("loanRepayment_0");
    const msg = document.querySelector('[data-loan-repayment-msg="0"]');
    return {
      current: loan.current,
      last: loan.lastRepaymentAmount,
      lastDate: loan.lastRepaymentDate,
      milestoneExperienced: !!loan.milestoneExperienced,
      completionExperienced: !!loan.completionExperienced,
      inputValue: inp ? inp.value : null,
      msgHidden: msg ? !!msg.hidden : true,
      msgText: msg ? msg.textContent : ""
    };
  });
}

async function withPage(browser, state, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await seedEstablished(page, state);
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitHome(page);
  await openJourneyMoney(page);
  try {
    await fn(page);
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* 1) Add Repayment only */
  await withPage(browser, baseState(), async page => {
    await page.evaluate(() => {
      document.getElementById("loanRepayment_0").value = "250";
      document.querySelector("[data-add-repayment='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 350,
      { timeout: 5000 }
    );
    const snap = await loanSnap(page);
    assert.equal(snap.current, 350);
    assert.equal(snap.last, 250);
    assert.equal(snap.inputValue, "");
    console.log("PASS: 1 Add Repayment only");
  });

  /* 2) Save with a repayment amount */
  await withPage(browser, baseState(), async page => {
    await page.evaluate(() => {
      document.getElementById("loanRepayment_0").value = "250";
      document.querySelector("[data-save-loan='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 350,
      { timeout: 5000 }
    );
    const snap = await loanSnap(page);
    assert.equal(snap.current, 350);
    assert.equal(snap.last, 250);
    assert.equal(snap.inputValue, "");
    console.log("PASS: 2 Save with repayment amount");
  });

  /* 3) Add Repayment followed by Save — no double deduct */
  await withPage(browser, baseState(), async page => {
    await page.evaluate(() => {
      document.getElementById("loanRepayment_0").value = "100";
      document.querySelector("[data-add-repayment='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 500,
      { timeout: 5000 }
    );
    await openJourneyMoney(page);
    await page.evaluate(() => {
      document.querySelector("[data-save-loan='0']").click();
    });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector("[data-save-loan='0']");
        return btn && (btn.classList.contains("is-save-success") || btn.getAttribute("aria-busy") === "true");
      },
      { timeout: 5000 }
    ).catch(() => {});
    await new Promise(r => setTimeout(r, 200));
    const snap = await loanSnap(page);
    assert.equal(snap.current, 500);
    assert.equal(snap.last, 100);
    console.log("PASS: 3 Add then Save does not double-deduct");
  });

  /* 4) Save followed by Add Repayment — no double deduct */
  await withPage(browser, baseState(), async page => {
    await page.evaluate(() => {
      document.getElementById("loanRepayment_0").value = "100";
      document.querySelector("[data-save-loan='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 500,
      { timeout: 5000 }
    );
    await openJourneyMoney(page);
    await page.evaluate(() => {
      /* Input should be empty after Save; Add must not deduct again. */
      document.querySelector("[data-add-repayment='0']").click();
    });
    await new Promise(r => setTimeout(r, 150));
    const snap = await loanSnap(page);
    assert.equal(snap.current, 500);
    assert.equal(snap.last, 100);
    console.log("PASS: 4 Save then Add does not double-deduct");
  });

  /* 5) Rapid / repeated taps */
  await withPage(browser, baseState(), async page => {
    const result = await page.evaluate(() => {
      const inp = document.getElementById("loanRepayment_0");
      inp.value = "100";
      document.querySelector("[data-add-repayment='0']").click();
      document.querySelector("[data-add-repayment='0']").click();
      document.querySelector("[data-add-repayment='0']").click();
      const loan = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return { current: loan.current, last: loan.lastRepaymentAmount };
    });
    assert.equal(result.current, 500);
    assert.equal(result.last, 100);
    console.log("PASS: 5 rapid Add taps apply once");
  });

  /* 6) Save without a repayment amount — plan save still works */
  await withPage(browser, baseState(), async page => {
    await page.evaluate(() => {
      const name = document.querySelector('input[data-loan="0"][data-field="name"]');
      if (name) name.value = "Renamed Journey";
      document.getElementById("loanRepayment_0").value = "";
      document.querySelector("[data-save-loan='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].name === "Renamed Journey",
      { timeout: 5000 }
    );
    const snap = await loanSnap(page);
    assert.equal(snap.current, 600);
    assert.equal(snap.last, 50);
    const name = await page.evaluate(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].name
    );
    assert.equal(name, "Renamed Journey");
    console.log("PASS: 6 Save without repayment keeps balance and saves name");
  });

  /* 7) Excessive amount on Save — keep value, show over-balance warning */
  await withPage(browser, baseState(), async page => {
    const over = await page.evaluate(() => {
      const before = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      const inp = document.getElementById("loanRepayment_0");
      inp.value = "999";
      document.querySelector("[data-save-loan='0']").click();
      const msg = document.querySelector('[data-loan-repayment-msg="0"]');
      const after = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return {
        msgHidden: !!msg?.hidden,
        msgText: msg?.textContent || "",
        inputValue: inp.value,
        beforeCurrent: before.current,
        afterCurrent: after.current,
        afterLast: after.lastRepaymentAmount
      };
    });
    assert.equal(over.msgHidden, false);
    assert.equal(
      over.msgText,
      "Your remaining balance is €600.00. You can enter up to €600.00."
    );
    assert.equal(over.inputValue, "999");
    assert.equal(over.afterCurrent, 600);
    assert.equal(over.afterLast, 50);
    console.log("PASS: 7 excessive amount on Save keeps input and warns");
  });

  const INVALID_MSG = "Enter a valid repayment amount greater than zero.";

  /* type=number + min=0 strips many invalid strings; relax constraints so JS validation is exercised. */
  async function setRawRepayment(page, raw) {
    await page.evaluate(value => {
      const inp = document.getElementById("loanRepayment_0");
      inp.removeAttribute("min");
      inp.type = "text";
      inp.value = value;
    }, raw);
  }

  /* 7b) Negative / non-numeric on Add Repayment — error, keep input, no balance change */
  await withPage(browser, baseState(), async page => {
    await setRawRepayment(page, "-25");
    const neg = await page.evaluate(() => {
      document.querySelector("[data-add-repayment='0']").click();
      const inp = document.getElementById("loanRepayment_0");
      const msg = document.querySelector('[data-loan-repayment-msg="0"]');
      const after = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return {
        msgHidden: !!msg?.hidden,
        msgText: msg?.textContent || "",
        inputValue: inp.value,
        current: after.current,
        last: after.lastRepaymentAmount
      };
    });
    assert.equal(neg.msgHidden, false);
    assert.equal(neg.msgText, INVALID_MSG);
    assert.equal(neg.inputValue, "-25");
    assert.equal(neg.current, 600);
    assert.equal(neg.last, 50);

    await setRawRepayment(page, "abc");
    const nonNumeric = await page.evaluate(() => {
      document.querySelector("[data-add-repayment='0']").click();
      const inp = document.getElementById("loanRepayment_0");
      const msg = document.querySelector('[data-loan-repayment-msg="0"]');
      const after = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return {
        msgHidden: !!msg?.hidden,
        msgText: msg?.textContent || "",
        inputValue: inp.value,
        current: after.current,
        last: after.lastRepaymentAmount
      };
    });
    assert.equal(nonNumeric.msgHidden, false);
    assert.equal(nonNumeric.msgText, INVALID_MSG);
    assert.equal(nonNumeric.inputValue, "abc");
    assert.equal(nonNumeric.current, 600);
    assert.equal(nonNumeric.last, 50);
    console.log("PASS: 7b Add Repayment rejects negative and non-numeric with visible error");
  });

  /* 7c) Negative / non-numeric on Save — error, keep input, do not save plan changes */
  await withPage(browser, baseState(), async page => {
    await setRawRepayment(page, "-10");
    const negSave = await page.evaluate(() => {
      const name = document.querySelector('input[data-loan="0"][data-field="name"]');
      if (name) name.value = "Should Not Save";
      document.querySelector("[data-save-loan='0']").click();
      const inp = document.getElementById("loanRepayment_0");
      const msg = document.querySelector('[data-loan-repayment-msg="0"]');
      const after = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return {
        msgHidden: !!msg?.hidden,
        msgText: msg?.textContent || "",
        inputValue: inp.value,
        current: after.current,
        last: after.lastRepaymentAmount,
        name: after.name
      };
    });
    assert.equal(negSave.msgHidden, false);
    assert.equal(negSave.msgText, INVALID_MSG);
    assert.equal(negSave.inputValue, "-10");
    assert.equal(negSave.current, 600);
    assert.equal(negSave.last, 50);
    assert.equal(negSave.name, "REPAY-SAVE");

    await setRawRepayment(page, "12e");
    const junkSave = await page.evaluate(() => {
      const name = document.querySelector('input[data-loan="0"][data-field="name"]');
      if (name) name.value = "Still Should Not Save";
      document.querySelector("[data-save-loan='0']").click();
      const inp = document.getElementById("loanRepayment_0");
      const msg = document.querySelector('[data-loan-repayment-msg="0"]');
      const after = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return {
        msgHidden: !!msg?.hidden,
        msgText: msg?.textContent || "",
        inputValue: inp.value,
        current: after.current,
        name: after.name
      };
    });
    assert.equal(junkSave.msgHidden, false);
    assert.equal(junkSave.msgText, INVALID_MSG);
    assert.equal(junkSave.inputValue, "12e");
    assert.equal(junkSave.current, 600);
    assert.equal(junkSave.name, "REPAY-SAVE");
    console.log("PASS: 7c Save rejects negative and non-numeric without applying plan changes");
  });

  /* 8) Repayment equal to remaining balance */
  await withPage(browser, baseState(), async page => {
    await page.evaluate(() => {
      document.getElementById("loanRepayment_0").value = "600";
      document.querySelector("[data-save-loan='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 0,
      { timeout: 5000 }
    );
    const snap = await loanSnap(page);
    assert.equal(snap.current, 0);
    assert.equal(snap.last, 600);
    assert.equal(snap.completionExperienced, true);
    console.log("PASS: 8 exact remaining balance via Save completes");
  });

  /* 9) Crossing 50% milestone (600/1000 = 40% → repay 150 → 450/1000 = 55%) */
  await withPage(
    browser,
    baseState({
      loan: {
        current: 600,
        milestoneExperienced: false,
        firstRepaymentCompanionConsumed: true,
        lastRepaymentDate: "2024-06-01T12:00:00.000Z"
      }
    }),
    async page => {
      await page.evaluate(() => {
        document.getElementById("loanRepayment_0").value = "150";
        document.querySelector("[data-save-loan='0']").click();
      });
      await page.waitForFunction(
        () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 450,
        { timeout: 5000 }
      );
      const snap = await loanSnap(page);
      assert.equal(snap.current, 450);
      assert.equal(snap.last, 150);
      assert.equal(snap.milestoneExperienced, true);
      console.log("PASS: 9 Save repayment crossing 50% sets milestone");
    }
  );

  /* 10) Persistence after reload */
  await withPage(browser, baseState(), async page => {
    await page.evaluate(() => {
      document.getElementById("loanRepayment_0").value = "75";
      document.querySelector("[data-save-loan='0']").click();
    });
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].current === 525,
      { timeout: 5000 }
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => {
        try {
          const loan = JSON.parse(localStorage.getItem("freedom50-mobile-v1") || "null")?.loans?.[0];
          return loan && loan.current === 525 && loan.lastRepaymentAmount === 75;
        } catch (e) {
          return false;
        }
      },
      { timeout: 20000 }
    );
    const persisted = await page.evaluate(() => {
      const loan = JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0];
      return { current: loan.current, last: loan.lastRepaymentAmount };
    });
    assert.equal(persisted.current, 525);
    assert.equal(persisted.last, 75);
    console.log("PASS: 10 persistence after reload");
  });

  await browser.close();
  console.log("PASS: journey repayment Save/Add flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
