/**
 * Individual Victories can be deleted from Archive without touching
 * other Victories or active Journeys/Goals.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /data-delete-victory-record/);
assert.match(index, /permanentlyDeleteVictory/);
assert.match(index, /This Victory record will be permanently deleted/);
assert.match(index, /victories-row-delete/);
assert.match(index, /background:#B86A61;color:#fff/);
assert.equal(/background:rgba\(168,72,72,\.22\)/.test(index), false);
console.log("PASS: source contracts for Victories delete");

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
      id: "loan-keep-1",
      name: "Active Loan",
      starting: 1000,
      current: 400,
      payment: 50,
      collapsed: true,
      payoffMode: "monthly"
    }
  ],
  customGoals: [
    {
      id: "goal-keep-1",
      name: "Active Goal",
      current: 100,
      target: 500,
      monthly: 25,
      collapsed: true,
      hasTarget: true
    }
  ],
  pensions: [],
  notes: [{ id: "n1", text: "Keep note", color: "yellow" }],
  victories: [
    {
      id: "victory-keep-1",
      kind: "journey",
      name: "Keep Victory",
      amount: 2000,
      completedAt: "2026-01-10T12:00:00.000Z",
      recordId: "old-loan-1"
    },
    {
      id: "victory-delete-1",
      kind: "goal",
      name: "Delete Victory",
      amount: 500,
      completedAt: "2026-02-10T12:00:00.000Z",
      recordId: "old-goal-1"
    }
  ],
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
    document.getElementById("freedomSplash")?.remove();
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await seedEstablished(page, SAVED_STATE);
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitHome(page);

  await page.evaluate(() => {
    document.body.classList.remove("home183");
    window.hideHome?.();
    window.page("archive");
  });
  await page.waitForSelector("[data-delete-victory-record='victory-delete-1']", {
    timeout: 15000
  });

  const before = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
    return {
      victories: (st.victories || []).map(v => v.id),
      loans: (st.loans || []).map(l => l.id),
      goals: (st.customGoals || []).map(g => g.id)
    };
  });
  assert.deepEqual(before.victories.sort(), ["victory-delete-1", "victory-keep-1"].sort());
  assert.deepEqual(before.loans, ["loan-keep-1"]);
  assert.deepEqual(before.goals, ["goal-keep-1"]);

  await page.evaluate(() => {
    document.querySelector("[data-delete-victory-record='victory-delete-1']")?.click();
  });
  await page.waitForFunction(
    () => !document.getElementById("freedomConfirmRemovalOverlay")?.hidden,
    { timeout: 5000 }
  );
  const modal = await page.evaluate(() => ({
    title: document.getElementById("freedomConfirmRemovalTitle")?.textContent,
    body: document.getElementById("freedomConfirmRemovalBody")?.textContent,
    cancel: document.getElementById("freedomConfirmRemovalNotYet")?.textContent,
    del: document.getElementById("freedomConfirmRemovalDelete")?.textContent,
    dangerBg: getComputedStyle(document.getElementById("freedomConfirmRemovalDelete")).backgroundColor
  }));
  assert.equal(modal.title, "Delete this Victory?");
  assert.match(modal.body, /permanently deleted/i);
  assert.equal(modal.cancel, "Cancel");
  assert.equal(modal.del, "Delete");
  assert.equal(modal.dangerBg, "rgb(184, 106, 97)"); /* #B86A61 */

  await page.evaluate(() => {
    document.getElementById("freedomConfirmRemovalDelete")?.click();
  });
  await page.waitForFunction(
    () =>
      (JSON.parse(localStorage.getItem("freedom50-mobile-v1")).victories || []).length === 1,
    { timeout: 8000 }
  );

  const after = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
    return {
      victories: (st.victories || []).map(v => ({ id: v.id, name: v.name })),
      loans: (st.loans || []).map(l => l.id),
      goals: (st.customGoals || []).map(g => g.id),
      deleteBtnGone: !document.querySelector("[data-delete-victory-record='victory-delete-1']"),
      keepBtn: !!document.querySelector("[data-delete-victory-record='victory-keep-1']")
    };
  });
  assert.equal(after.victories.length, 1);
  assert.equal(after.victories[0].id, "victory-keep-1");
  assert.equal(after.victories[0].name, "Keep Victory");
  assert.deepEqual(after.loans, ["loan-keep-1"]);
  assert.deepEqual(after.goals, ["goal-keep-1"]);
  assert.equal(after.deleteBtnGone, true);
  assert.equal(after.keepBtn, true);

  console.log("PASS: deleting one Victory leaves others and active records intact");
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
