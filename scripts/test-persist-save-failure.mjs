/**
 * Personal persist() save-failure warning:
 * - Success still shows Saved toast (not the failure banner)
 * - Quota / setItem errors show one visible warning, never Saved
 * - Repeated failures do not stack or re-create the banner
 * - OK dismisses; a later successful save also clears the warning
 * - Existing personal data stays intact; Demo Mode path unchanged
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");

assert.match(index, /id="freedomSaveFailBanner"/);
assert.match(index, /Your changes couldn't be saved/);
assert.match(index, /Please try again before closing Freedom/);
assert.equal(/couldn't be saved.*—|—.*couldn't be saved/i.test(index), false);
assert.match(index, /function showSaveFailureWarning/);
assert.match(index, /function hideSaveFailureWarning/);
assert.match(index, /showSaveFailureWarning\(\)/);
assert.match(
  index,
  /localStorage\.setItem\(KEY,JSON\.stringify\(state\)\);\s*showSaved\(\);/
);
assert.match(index, /catch\(e\)\{\s*console\.warn\("Freedom could not save personal data:",e\);\s*showSaveFailureWarning\(\);/);
assert.match(index, /if\(!banner\.hidden\)return;/);
assert.match(index, /\.freedom-save-fail-banner\{z-index:970\}/);
console.log("PASS: source contracts for persist save-failure warning");

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
const MARKER = "KEEP-SAVE-FAIL-LOAN";

const SAVED_STATE = {
  loans: [
    {
      name: MARKER,
      starting: 2000,
      current: 1500,
      payment: 100,
      collapsed: false,
      payoffMode: "monthly",
      freedomDate: null,
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
    localStorage.setItem("freedom50-welcome-complete-v1", "1");
    localStorage.setItem("freedom50-look-around-complete-v1", "1");
    localStorage.setItem("freedom50-first-time-complete-v1", "1");
    localStorage.setItem("freedom50-companion-id-v1", "kevin");
    localStorage.removeItem("freedom50-companion-pending-v1");
    localStorage.setItem("freedom50-mobile-v1", raw);
  }, JSON.stringify(state));
}

async function openJourney(page) {
  await page.waitForFunction(() => typeof window.page === "function", {
    timeout: 20000
  });
  await page.waitForFunction(
    () => document.body.classList.contains("home183"),
    { timeout: 30000 }
  );
  await page.evaluate(() => {
    document.body.classList.remove("home183");
    window.hideHome?.();
    window.page("journey");
  });
  await page.waitForSelector("#journey.page.active .loan-card", { timeout: 15000 });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* 1) Successful save: Saved toast, no failure banner */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await openJourney(page);
    await page.click("[data-loan-plan-section='0']");
    await page.evaluate(() => {
      const pay = document.querySelector('input[data-loan="0"][data-field="payment"]');
      pay.value = "125";
      pay.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-save-loan='0']").click();
    });
    await page.waitForFunction(
      () => document.getElementById("saveNote")?.classList.contains("show"),
      { timeout: 5000 }
    );
    const ui = await page.evaluate(() => ({
      saved: document.getElementById("saveNote")?.classList.contains("show"),
      failHidden: document.getElementById("freedomSaveFailBanner")?.hidden,
      payment: JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].payment
    }));
    assert.equal(ui.saved, true);
    assert.equal(ui.failHidden, true);
    assert.equal(ui.payment, 125);
    console.log("PASS: successful save shows Saved and no failure banner");
    await page.close();
  }

  /* 2) Quota failure: warning once, no Saved, data unchanged on disk */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await openJourney(page);
    await page.click("[data-loan-plan-section='0']");

    await page.evaluate(() => {
      window.__freedomNativeSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "freedom50-mobile-v1") {
          const e = new Error("simulated quota");
          e.name = "QuotaExceededError";
          throw e;
        }
        return window.__freedomNativeSetItem.apply(this, arguments);
      };
    });
    await page.evaluate(() => {
      const pay = document.querySelector('input[data-loan="0"][data-field="payment"]');
      pay.value = "321";
      pay.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-toggle-loan='0']").click();
    });
    await page.waitForFunction(
      () => document.getElementById("freedomSaveFailBanner")?.hidden === false,
      { timeout: 5000 }
    );
    const fail = await page.evaluate(() => {
      const banner = document.getElementById("freedomSaveFailBanner");
      return {
        saved: document.getElementById("saveNote")?.classList.contains("show"),
        failHidden: banner?.hidden,
        text: (banner?.innerText || "").replace(/\s+/g, " ").trim(),
        storedPayment: JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0]
          .payment,
        loanName: JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].name
      };
    });
    assert.equal(fail.saved, false);
    assert.equal(fail.failHidden, false);
    assert.match(fail.text, /Your changes couldn't be saved/);
    assert.match(fail.text, /Please try again before closing Freedom/);
    assert.equal(fail.storedPayment, 100);
    assert.equal(fail.loanName, MARKER);

    /* 3) Repeated failures: still a single banner */
    await page.evaluate(async () => {
      const card = document.querySelector(".loan-card");
      if (card?.classList.contains("is-collapsed")) {
        document.querySelector("[data-toggle-loan='0']")?.click();
        await new Promise(r => setTimeout(r, 700));
      }
      document.querySelector("[data-loan-plan-section='0']")?.click();
      const payEl = document.querySelector('input[data-loan="0"][data-field="payment"]');
      if (payEl) {
        payEl.value = "322";
        payEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
      document.querySelector("[data-toggle-loan='0']")?.click();
    });
    await new Promise(r => setTimeout(r, 900));
    const again = await page.evaluate(() => ({
      afterHidden: document.getElementById("freedomSaveFailBanner").hidden,
      bannerCount: document.querySelectorAll("#freedomSaveFailBanner").length,
      saved: document.getElementById("saveNote")?.classList.contains("show")
    }));
    assert.equal(again.afterHidden, false);
    assert.equal(again.bannerCount, 1);
    assert.equal(again.saved, false);
    console.log("PASS: storage failure shows one warning, no Saved, data intact");

    /* 4) Real iPhone-viewport tap on OK — must hit the button, not Demo/overlays */
    await page.evaluate(() => {
      if (window.__freedomNativeSetItem) {
        Storage.prototype.setItem = window.__freedomNativeSetItem;
      }
    });
    await new Promise(r => setTimeout(r, 800));
    const tapTarget = await page.evaluate(() => {
      const ok = document.getElementById("freedomSaveFailDismiss");
      const banner = document.getElementById("freedomSaveFailBanner");
      const demo = document.getElementById("demo183Wrap");
      const r = ok.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return {
        x,
        y,
        topId: top?.id || "",
        okReceivesHit: !!(top && (top === ok || ok.contains(top))),
        bannerZ: Number(getComputedStyle(banner).zIndex) || 0,
        demoZ: Number(getComputedStyle(demo).zIndex) || 0,
        bannerHidden: banner.hidden
      };
    });
    assert.equal(tapTarget.bannerHidden, false);
    assert.equal(tapTarget.okReceivesHit, true);
    assert.equal(tapTarget.topId, "freedomSaveFailDismiss");
    assert.ok(
      tapTarget.bannerZ > tapTarget.demoZ,
      `save-fail banner z-index (${tapTarget.bannerZ}) must sit above Demo control (${tapTarget.demoZ})`
    );
    /* Simulated finger tap at the visible OK centre — not element.click(). */
    await page.touchscreen.tap(tapTarget.x, tapTarget.y);
    const dismissed = await page.evaluate(
      () => document.getElementById("freedomSaveFailBanner").hidden
    );
    assert.equal(dismissed, true);
    console.log("PASS: real touch tap on OK dismisses warning; nothing intercepts");
    await page.close();
  }

  /* 5) Recovery: after storage works again, Saved shows and banner stays hidden */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await openJourney(page);
    await page.click("[data-loan-plan-section='0']");

    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      window.__freedomTestOrigSetItem = orig;
      Storage.prototype.setItem = function (k, v) {
        if (k === "freedom50-mobile-v1") {
          const e = new Error("simulated quota");
          e.name = "QuotaExceededError";
          throw e;
        }
        return orig.apply(this, arguments);
      };
      const pay = document.querySelector('input[data-loan="0"][data-field="payment"]');
      pay.value = "333";
      pay.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-toggle-loan='0']").click();
    });
    await page.waitForFunction(
      () => document.getElementById("freedomSaveFailBanner")?.hidden === false,
      { timeout: 5000 }
    );

    const recovered = await page.evaluate(() => new Promise(resolve => {
      Storage.prototype.setItem = window.__freedomTestOrigSetItem;
      const card = document.querySelector(".loan-card");
      if (card?.classList.contains("is-collapsed")) {
        document.querySelector("[data-toggle-loan='0']")?.click();
      }
      setTimeout(() => {
        document.querySelector("[data-loan-plan-section='0']")?.click();
        const pay = document.querySelector('input[data-loan="0"][data-field="payment"]');
        pay.value = "140";
        pay.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("[data-save-loan='0']").click();
        setTimeout(() => {
          resolve({
            failHidden: document.getElementById("freedomSaveFailBanner").hidden,
            saved: document.getElementById("saveNote")?.classList.contains("show"),
            payment: JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].payment,
            loan: JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].name
          });
        }, 400);
      }, 700);
    }));
    assert.equal(recovered.failHidden, true);
    assert.equal(recovered.saved, true);
    assert.equal(recovered.payment, 140);
    assert.equal(recovered.loan, MARKER);
    console.log("PASS: successful save after failure clears warning and shows Saved");
    await page.close();
  }

  /* 6) Demo Mode: personal KEY failures do not surface while Demo is active */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page, SAVED_STATE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.enterDemo === "function", {
      timeout: 20000
    });
    await page.waitForFunction(
      () => document.body.classList.contains("home183"),
      { timeout: 30000 }
    );
    await page.evaluate(() => {
      window.enterDemo();
      Storage.prototype.setItem = function () {
        const e = new Error("simulated quota");
        e.name = "QuotaExceededError";
        throw e;
      };
    });
    await page.waitForFunction(
      () => document.body.classList.contains("demo-mode-active"),
      { timeout: 10000 }
    );
    /* Demo UI actions that would persist personally are sandboxed to sessionStorage */
    const demo = await page.evaluate(() => ({
      demo: document.body.classList.contains("demo-mode-active"),
      failHidden: document.getElementById("freedomSaveFailBanner").hidden,
      personalLoan: JSON.parse(localStorage.getItem("freedom50-mobile-v1")).loans[0].name,
      note: JSON.parse(localStorage.getItem("freedom50-mobile-v1")).notes[0].text
    }));
    assert.equal(demo.demo, true);
    assert.equal(demo.failHidden, true);
    assert.equal(demo.personalLoan, MARKER);
    assert.equal(demo.note, "Keep note");
    console.log("PASS: Demo Mode unaffected; personal blob intact");
    await page.close();
  }

  await browser.close();
  console.log("PASS: persist save-failure flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
