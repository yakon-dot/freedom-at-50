/**
 * Personal pension create-form usability:
 * - Current pension value label + hint
 * - Add-form contrast matches expanded card tokens
 * - Auto-contrib toggle on create (default off; persists when on)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");

assert.match(index, /Current pension value/);
assert.match(index, /You can find this on your latest pension statement\./);
assert.match(index, /id="newPensionAuto"/);
assert.match(index, /pensionEnableAutoContrib\(pension,now\)/);
assert.equal(/for="newPensionValue">Statement balance</.test(index), false);
assert.equal(/for="pensionValue_\$\{i\}">Statement balance</.test(index), false);
/* Add-form labels use the expanded-card label colour token */
assert.match(
  index,
  /add-pension-card label\{[^}]*color:rgba\(215,215,209,\.76\)/
);
assert.match(
  index,
  /add-pension-card input\{[^}]*color:rgba\(236,232,224,\.72\)/
);
console.log("PASS: source contracts for pension form usability");

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
const KEY = "freedom50-mobile-v1";

async function openPensionForm(page) {
  await page.evaluate(() => {
    document.body.classList.remove("home183");
    if (typeof window.hideHome === "function") window.hideHome();
    window.page("pension");
    document.getElementById("toggleAddPension").click();
  });
  await page.waitForSelector("#addPensionCard:not([hidden])", { timeout: 10000 });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("freedom50-welcome-complete-v1", "1");
    localStorage.setItem("freedom50-look-around-complete-v1", "1");
    localStorage.setItem("freedom50-first-time-complete-v1", "1");
    localStorage.setItem("freedom50-companion-id-v1", "patricia");
    localStorage.removeItem("freedom50-companion-pending-v1");
    localStorage.removeItem("freedom50-companion-first-setup-pending-v1");
    localStorage.removeItem("freedom50-mobile-v1");
  });
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.page === "function", { timeout: 20000 });

  await openPensionForm(page);
  const form = await page.evaluate(() => {
    const label = document.querySelector('label[for="newPensionValue"]')?.textContent?.trim();
    const hint = document.getElementById("newPensionValueHint")?.textContent?.trim();
    const auto = document.getElementById("newPensionAuto");
    const labelStyle = getComputedStyle(document.querySelector('label[for="newPensionName"]'));
    const inputStyle = getComputedStyle(document.getElementById("newPensionValue"));
    const cardLabel = document.createElement("label");
    /* Expanded-card token reference from a temporary element using the same classes path is hard;
       compare against known approved rgba from stylesheet via computed form styles. */
    return {
      label,
      hint,
      autoDefaultOff: auto ? auto.checked === false : null,
      labelColor: labelStyle.color,
      inputColor: inputStyle.color,
      inputBorder: inputStyle.borderTopColor
    };
  });
  assert.equal(form.label, "Current pension value");
  assert.equal(form.hint, "You can find this on your latest pension statement.");
  assert.equal(form.autoDefaultOff, true);
  /* rgba(215,215,209,.76) ≈ rgb with alpha in computed style */
  assert.match(form.labelColor, /215,\s*215,\s*209/);
  assert.match(form.inputColor, /236,\s*232,\s*224/);
  console.log("PASS: create form label, hint, default toggle, contrast tokens");

  /* Create with auto OFF */
  await page.evaluate(() => {
    document.getElementById("newPensionName").value = "Work Pension Off";
    document.getElementById("newPensionValue").value = "10000";
    document.getElementById("newPensionPersonal").value = "100";
    document.getElementById("newPensionEmployer").value = "50";
    document.getElementById("newPensionAuto").checked = false;
    document.getElementById("addPension").click();
  });
  await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem("freedom50-mobile-v1");
      const st = raw ? JSON.parse(raw) : null;
      return Array.isArray(st?.pensions) && st.pensions.some(p => p.name === "Work Pension Off");
    } catch {
      return false;
    }
  }, { timeout: 10000 });
  const off = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
    const p = st.pensions.find(x => x.name === "Work Pension Off");
    return {
      autoContrib: !!p.autoContrib,
      autoPeriods: p.autoPeriods || [],
      statementValue: p.statementValue,
      personal: p.personal,
      employer: p.employer
    };
  });
  assert.equal(off.autoContrib, false);
  assert.equal(off.autoPeriods.length, 0);
  assert.equal(off.statementValue, 10000);
  assert.equal(off.personal, 100);
  assert.equal(off.employer, 50);
  console.log("PASS: create pension with automatic calculations disabled");

  /* Create with auto ON */
  await openPensionForm(page);
  await page.evaluate(() => {
    document.getElementById("newPensionName").value = "Work Pension On";
    document.getElementById("newPensionValue").value = "20000";
    document.getElementById("newPensionPersonal").value = "200";
    document.getElementById("newPensionEmployer").value = "100";
    const auto = document.getElementById("newPensionAuto");
    auto.checked = true;
    auto.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("addPension").click();
  });
  await page.waitForFunction(() => {
    try {
      const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1") || "null");
      return Array.isArray(st?.pensions) && st.pensions.some(p => p.name === "Work Pension On");
    } catch {
      return false;
    }
  }, { timeout: 10000 });
  const on = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
    const p = st.pensions.find(x => x.name === "Work Pension On");
    const openPeriods = (p.autoPeriods || []).filter(per => per && per.endMonth == null);
    return {
      autoContrib: !!p.autoContrib,
      openCount: openPeriods.length,
      startMonth: openPeriods[0] && openPeriods[0].startMonth,
      statementMonth: p.statementMonth,
      value: p.value,
      statementValue: p.statementValue
    };
  });
  assert.equal(on.autoContrib, true);
  assert.equal(on.openCount, 1);
  assert.ok(on.startMonth && on.statementMonth);
  /* Next month only — not retroactive to statement month */
  assert.notEqual(on.startMonth, on.statementMonth);
  assert.equal(on.value, on.statementValue);
  console.log("PASS: create pension with automatic calculations enabled (from next month)");

  /* Expanded card uses Current pension value */
  await page.evaluate(() => {
    const card = document.querySelector('.pension-card[data-pension-index]');
    if (card?.classList.contains("is-collapsed")) {
      card.querySelector(".pension-card-head")?.click();
    }
  });
  await page.waitForFunction(() => {
    const lab = document.querySelector('label[for^="pensionValue_"]');
    return lab && /Current pension value/.test(lab.textContent || "");
  }, { timeout: 10000 });
  const cardLabel = await page.evaluate(
    () => document.querySelector('label[for^="pensionValue_"]')?.textContent?.trim()
  );
  assert.equal(cardLabel, "Current pension value");
  console.log("PASS: expanded pension card uses Current pension value label");

  await browser.close();
  console.log("PASS: pension form usability flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
