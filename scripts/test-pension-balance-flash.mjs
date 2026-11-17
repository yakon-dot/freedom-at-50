/**
 * Pension combined-total flash:
 * - Markup must not ship the Demo sample €58,000
 * - Personal empty → €0; personal with pots → saved total
 * - Demo Mode still shows its intended combined sample total
 * - Never observe €58,000 on a personal (non-demo) Pension visit
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(
  index,
  /id="pensionDemoCombinedValue">€0<\/strong>/
);
assert.equal(
  /id="pensionDemoCombinedValue">€58,000<\/strong>/.test(index),
  false
);
assert.match(index, /function updatePensionCombinedTotal\(\)/);
console.log("PASS: source contracts for pension balance flash");

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

function installFlashProbe(page) {
  return page.evaluateOnNewDocument(() => {
    window.__pensionTotalSeen = [];
    document.addEventListener("DOMContentLoaded", () => {
      const el = document.getElementById("pensionDemoCombinedValue");
      if (!el) return;
      const record = () => {
        const t = (el.textContent || "").trim();
        const arr = window.__pensionTotalSeen;
        if (!arr.length || arr[arr.length - 1] !== t) arr.push(t);
      };
      record();
      new MutationObserver(record).observe(el, {
        characterData: true,
        childList: true,
        subtree: true
      });
    });
  });
}

async function seedEstablished(page, stateJson) {
  await page.evaluateOnNewDocument(raw => {
    localStorage.setItem("freedom50-welcome-complete-v1", "1");
    localStorage.setItem("freedom50-look-around-complete-v1", "1");
    localStorage.setItem("freedom50-first-time-complete-v1", "1");
    localStorage.setItem("freedom50-companion-id-v1", "patricia");
    localStorage.removeItem("freedom50-companion-pending-v1");
    localStorage.removeItem("freedom50-companion-first-setup-pending-v1");
    if (raw) localStorage.setItem("freedom50-mobile-v1", raw);
    else localStorage.removeItem("freedom50-mobile-v1");
  }, stateJson || null);
  await installFlashProbe(page);
}

async function openPension(page) {
  await page.waitForFunction(() => typeof window.page === "function", {
    timeout: 20000
  });
  await page.evaluate(() => {
    document.body.classList.remove("home183");
    if (typeof window.hideHome === "function") window.hideHome();
    window.page("pension");
  });
  await page.waitForSelector("#pension.page.active", { timeout: 10000 });
}

async function combinedText(page) {
  return page.evaluate(
    () =>
      (document.getElementById("pensionDemoCombinedValue")?.textContent || "")
        .trim()
  );
}

async function seenValues(page) {
  return page.evaluate(() => window.__pensionTotalSeen || []);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* Personal empty */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page, JSON.stringify({ pensions: [] }));
    await page.goto(`${BASE}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await openPension(page);
    await page.waitForFunction(
      () =>
        (document.getElementById("pensionDemoCombinedValue")?.textContent || "")
          .trim() === "€0",
      { timeout: 10000 }
    );
    const seen = await seenValues(page);
    assert.ok(seen.includes("€0"));
    assert.equal(seen.includes("€58,000"), false);
    assert.equal(await combinedText(page), "€0");
    console.log("PASS: personal empty pension stays €0; never €58,000");
    await page.close();
  }

  /* Personal with saved pensions */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(
      page,
      JSON.stringify({
        pensions: [
          {
            id: "p1",
            name: "Work",
            value: 12000,
            statementValue: 12000,
            personal: 100,
            employer: 50,
            autoContrib: false,
            showInOverview: true
          },
          {
            id: "p2",
            name: "Old job",
            value: 3450,
            statementValue: 3450,
            personal: 0,
            employer: 0,
            autoContrib: false,
            showInOverview: true
          }
        ]
      })
    );
    await page.goto(`${BASE}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await openPension(page);
    await page.waitForFunction(
      () =>
        (document.getElementById("pensionDemoCombinedValue")?.textContent || "")
          .trim() === "€15,450",
      { timeout: 10000 }
    );
    const seen = await seenValues(page);
    assert.equal(seen.includes("€58,000"), false);
    assert.ok(seen[0] === "€0" || seen[0] === "€15,450");
    assert.equal(await combinedText(page), "€15,450");
    console.log("PASS: personal saved pensions show real total; never €58,000");
    await page.close();
  }

  /* Demo Mode still shows sample combined total */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page);
    await page.goto(`${BASE}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForFunction(() => typeof window.enterDemo === "function", {
      timeout: 20000
    });
    await page.evaluate(() => window.enterDemo());
    await openPension(page);
    await page.waitForFunction(
      () =>
        (document.getElementById("pensionDemoCombinedValue")?.textContent || "")
          .trim() === "€58,000",
      { timeout: 10000 }
    );
    assert.equal(await combinedText(page), "€58,000");
    console.log("PASS: Demo Mode Pension still shows €58,000 sample total");
    await page.close();
  }

  /* Exit Demo → personal empty again */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page, JSON.stringify({ pensions: [] }));
    await page.goto(`${BASE}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForFunction(
      () =>
        typeof window.enterDemo === "function" &&
        typeof window.freedomDemo?.exit === "function",
      { timeout: 20000 }
    );
    await page.evaluate(() => window.enterDemo());
    await openPension(page);
    await page.waitForFunction(
      () =>
        (document.getElementById("pensionDemoCombinedValue")?.textContent || "")
          .trim() === "€58,000",
      { timeout: 10000 }
    );
    await page.evaluate(() => window.freedomDemo.exit());
    await openPension(page);
    await page.waitForFunction(
      () =>
        (document.getElementById("pensionDemoCombinedValue")?.textContent || "")
          .trim() === "€0" &&
        !document.body.classList.contains("demo-mode-active"),
      { timeout: 10000 }
    );
    assert.equal(await combinedText(page), "€0");
    console.log("PASS: exiting Demo restores personal €0 empty state");
    await page.close();
  }

  await browser.close();
  console.log("PASS: pension balance flash flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
