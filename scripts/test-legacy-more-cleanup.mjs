/**
 * Legacy More / Reports cleanup:
 * - Retired #more page + Reports placeholder removed from markup
 * - #more / page("more") / history no longer expose unfinished screens
 * - Current Home → More menu actions remain intact
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");

assert.equal(/id="more"/.test(index), false);
assert.equal(/moreReports/.test(index), false);
assert.equal(/Progress summaries and reporting views will live here/.test(index), false);
assert.equal(/The plan behind the numbers/.test(index), false);
assert.match(index, /data-more183="archive"/);
assert.match(index, /data-more183="backup"/);
assert.match(index, /data-more183="reminders"/);
assert.match(index, /data-more183="companion">Change companion</);
assert.match(index, /Legacy #more \/ Reports page removed/);
console.log("PASS: source contracts for legacy More cleanup");

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

async function seedEstablished(page) {
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("freedom50-welcome-complete-v1", "1");
    localStorage.setItem("freedom50-look-around-complete-v1", "1");
    localStorage.setItem("freedom50-first-time-complete-v1", "1");
    localStorage.setItem("freedom50-companion-id-v1", "patricia");
    localStorage.removeItem("freedom50-companion-pending-v1");
    localStorage.removeItem("freedom50-companion-first-setup-pending-v1");
  });
}

async function waitApp(page) {
  await page.waitForFunction(
    () => typeof window.page === "function" && typeof window.showHome === "function",
    { timeout: 20000 }
  );
  await page.waitForFunction(
    () => document.body.classList.contains("home183"),
    { timeout: 30000 }
  );
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* Deep link #more → Home, no Reports markup */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page);
    await page.goto(`${BASE}/index.html#more`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await waitApp(page);
    const deep = await page.evaluate(() => ({
      home: document.body.classList.contains("home183"),
      moreEl: !!document.getElementById("more"),
      reports: /will live here/i.test(document.body.innerText || ""),
      hash: location.hash,
      moreMenu: [...document.querySelectorAll("[data-more183]")].map(el =>
        el.getAttribute("data-more183")
      )
    }));
    assert.equal(deep.moreEl, false);
    assert.equal(deep.reports, false);
    assert.equal(deep.home, true);
    assert.ok(["#home", "#more", ""].includes(deep.hash));
    assert.deepEqual(deep.moreMenu, [
      "archive",
      "backup",
      "reminders",
      "companion",
      "reset",
      "legal",
      "privacy",
      "terms",
      "support"
    ]);
    console.log("PASS: #more deep link lands on Home; Reports gone; More menu intact");
    await page.close();
  }

  /* page("more") API + More submenu still open working destinations */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page);
    await page.goto(`${BASE}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await waitApp(page);

    const fromApi = await page.evaluate(() => {
      window.page("more");
      return {
        home: document.body.classList.contains("home183"),
        moreEl: !!document.getElementById("more"),
        activeMore: !!document.querySelector("#more.page.active")
      };
    });
    assert.equal(fromApi.moreEl, false);
    assert.equal(fromApi.activeMore, false);
    assert.equal(fromApi.home, true);

    await page.evaluate(() => {
      document.querySelector('[data-more183="reminders"]')?.click();
    });
    await page.waitForSelector("#freedomRemindersPanelOverlay:not([hidden])", {
      timeout: 10000
    });
    await page.evaluate(() => {
      if (typeof window.closeFreedomRemindersPanel === "function") {
        window.closeFreedomRemindersPanel();
      } else {
        const panel = document.getElementById("freedomRemindersPanelOverlay");
        if (panel) panel.hidden = true;
      }
      if (typeof window.showHome === "function") window.showHome();
    });

    await page.evaluate(() => {
      document.querySelector('[data-more183="backup"]')?.click();
    });
    await page.waitForSelector("#freedomBackupPanelOverlay:not([hidden])", {
      timeout: 10000
    });
    const backupHash = await page.evaluate(() => location.hash);
    assert.notEqual(backupHash, "#more");

    await page.evaluate(() => {
      if (typeof window.closeFreedomBackupPanel === "function") {
        window.closeFreedomBackupPanel();
      }
      if (typeof window.showHome === "function") window.showHome();
      document.querySelector('[data-more183="companion"]')?.click();
    });
    await page.waitForFunction(
      () => {
        const root = document.getElementById("freedomCompanionSelect");
        return (
          !!root &&
          !root.hidden &&
          window.freedomCompanionSelect &&
          window.freedomCompanionSelect.isChangeMode &&
          window.freedomCompanionSelect.isChangeMode()
        );
      },
      { timeout: 10000 }
    );
    console.log("PASS: page('more') → Home; Reminders / Backup / Change companion still open");
    await page.close();
  }

  await browser.close();
  console.log("PASS: legacy More cleanup flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
