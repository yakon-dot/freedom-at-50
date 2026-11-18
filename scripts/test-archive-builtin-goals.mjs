/**
 * Default-hidden built-in Goals (House Fund / Holiday Fund / Personal Savings)
 * must not appear under Archive → Archived for clean / new-user state.
 * Explicitly archived built-ins still appear with Restore / Delete.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /function shouldShowBuiltInGoalInArchive/);
assert.match(index, /function markBuiltInGoalArchived/);
assert.match(index, /builtInGoalArchivedAt/);
assert.match(index, /House Fund/);
assert.match(index, /Holiday Fund/);
assert.match(index, /Personal Savings/);
console.log("PASS: source contracts for Archive built-in Goals filter");

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
    document.getElementById("freedomSplash")?.remove();
  });
}

async function openArchive(page) {
  await page.evaluate(() => {
    document.body.classList.remove("home183");
    window.hideHome?.();
    window.page("archive");
  });
  await page.waitForSelector("#archive.page.active #archiveSections", {
    timeout: 15000
  });
}

async function archivedNames(page) {
  return page.evaluate(() => {
    const section = [...document.querySelectorAll("#archiveSections .archive-section")].find(
      el => (el.querySelector(".archive-section-label")?.textContent || "").trim() === "Archived"
    );
    if (!section) return [];
    return [...section.querySelectorAll(".archive-row-name")].map(el =>
      (el.textContent || "").trim()
    );
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* Clean personal state: built-ins hidden by default, no activity. */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, {
      loans: [],
      customGoals: [],
      pensions: [],
      notes: [],
      victories: [],
      archivedGoals: [],
      archivedJourneys: [],
      archivedPensions: [],
      hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true },
      deletedBuiltInGoals: { houseFund: false, holidayFund: false, personalSavings: false },
      houseFund: 0,
      holidayFund: 0,
      personalSavings: 0
    });
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openArchive(page);
    const names = await archivedNames(page);
    assert.equal(names.includes("House Fund"), false);
    assert.equal(names.includes("Holiday Fund"), false);
    assert.equal(names.includes("Personal Savings"), false);
    console.log("PASS: default-hidden unused built-ins stay out of Archive");
    await page.close();
  }

  /* Explicitly archived built-in still appears. */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, {
      loans: [],
      customGoals: [],
      pensions: [],
      notes: [],
      victories: [],
      archivedGoals: [],
      archivedJourneys: [],
      archivedPensions: [],
      hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true },
      deletedBuiltInGoals: { houseFund: false, holidayFund: false, personalSavings: false },
      builtInGoalArchivedAt: { holidayFund: "2026-11-01T12:00:00.000Z" },
      houseFund: 0,
      holidayFund: 250,
      personalSavings: 0,
      goalLifetimeAdded: { holidayFund: 250 }
    });
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openArchive(page);
    const names = await archivedNames(page);
    assert.deepEqual(names, ["Holiday Fund"]);
    const hasActions = await page.evaluate(() => {
      const row = [...document.querySelectorAll("#archiveSections .archive-row")].find(el =>
        (el.textContent || "").includes("Holiday Fund")
      );
      return !!(
        row?.querySelector("[data-restore-built-in='holidayFund']") &&
        row?.querySelector("[data-delete-built-in-archive='holidayFund']")
      );
    });
    assert.equal(hasActions, true);
    console.log("PASS: explicitly archived built-in still shows Restore/Delete");
    await page.close();
  }

  /* Completed built-in in Victories must not also appear under Archived. */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await seedEstablished(page, {
      loans: [],
      customGoals: [],
      pensions: [],
      notes: [],
      victories: [
        {
          id: "victory-house-1",
          kind: "goal",
          name: "House Fund",
          amount: 10000,
          completedAt: "2026-10-01T12:00:00.000Z",
          recordId: "houseFund"
        }
      ],
      archivedGoals: [],
      archivedJourneys: [],
      archivedPensions: [],
      hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true },
      deletedBuiltInGoals: { houseFund: false, holidayFund: false, personalSavings: false },
      houseFund: 10000,
      holidayFund: 0,
      personalSavings: 0,
      goalHasTarget: { houseFund: true },
      goalTargets: { houseFund: 10000, holidayFund: 0, personalSavings: 0 }
    });
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitHome(page);
    await openArchive(page);
    const names = await archivedNames(page);
    assert.equal(names.includes("House Fund"), false);
    const victoryNames = await page.evaluate(() =>
      [...document.querySelectorAll(".archive-victories-wrap .victories-row-name")].map(el =>
        (el.textContent || "").trim()
      )
    );
    assert.ok(victoryNames.includes("House Fund"));
    console.log("PASS: completed built-in stays in Victories only");
    await page.close();
  }

  await browser.close();
  console.log("PASS: Archive built-in Goals filter");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
