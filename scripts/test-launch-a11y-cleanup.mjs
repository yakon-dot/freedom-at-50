/**
 * Launch Task 4 cleanup contracts:
 * - version label aligned with SW cache
 * - Send test reminder gated to internal testing
 * - dialog Escape / focus helpers present for Reminders, Backup, Confirm Removal
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
const sw = fs.readFileSync("service-worker.js", "utf8");

assert.match(index, /Web app v1\.8\.6\.160/);
assert.match(sw, /CACHE_NAME = "freedom-at-50-v1\.8\.6\.160"/);
assert.match(index, /service-worker\.js\?v=1941/);
assert.equal(/Web app v1\.8\.6\.2\.2\.2/.test(index), false);
assert.equal(/freedom-at-50-v1\.8\.6\.159/.test(sw), false);

assert.match(
  index,
  /testWrap\.hidden=!\(on&&availability\.ok&&!demoMode&&typeof isInternalTestMode==="function"&&isInternalTestMode\(\)\)/
);
assert.match(index, /freedomRememberDialogFocus/);
assert.match(index, /freedomRestoreDialogFocus/);
assert.match(index, /freedomBindDialogEscape/);
assert.match(index, /freedomFocusDialogControl/);
console.log("PASS: source contracts for launch a11y / version / test-button gate");

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
    localStorage.removeItem("freedom50-internal-test-v1");
  });
  await page.goto(`${BASE}/index.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForFunction(
    () => typeof window.openFreedomRemindersPanel === "function",
    { timeout: 20000 }
  );

  const version = await page.evaluate(
    () => document.querySelector(".version")?.textContent?.trim() || ""
  );
  assert.equal(version, "Web app v1.8.6.160");

  /* Real Reminders UI: never assign testWrap.hidden in the test. */
  await page.evaluate(() => {
    window.FREEDOM_PUSH = Object.assign({}, window.FREEDOM_PUSH, {
      apiBase: "https://freedom-reminders.dorothy-yakon.workers.dev",
      vapidPublicKey: "B".padEnd(88, "A")
    });
    try {
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => "granted"
      });
    } catch (e) {}
    window.FreedomReminders._setDemoModeForTests(false);
    document.body.classList.remove("demo-mode-active");
    window.setInternalTestEnabled(false);
    window.FreedomReminders.setChoice("keep");
    window.openFreedomRemindersPanel();
  });
  await page.waitForSelector("#freedomRemindersPanelOverlay:not([hidden])");

  const publicState = await page.evaluate(() => {
    const panel = document.getElementById("freedomRemindersPanelOverlay");
    const wrap = document.getElementById("freedomRemindersTestWrap");
    const avail = window.FreedomReminders.availability();
    return {
      panelOpen: panel && !panel.hidden,
      availOk: !!avail.ok,
      remindersOn: window.FreedomReminders.isEffectivelyOn(),
      testHidden: wrap ? wrap.hidden : true,
      internal: window.isInternalTestMode(),
      escapeBound: panel?.dataset.escapeBound === "1",
      confirm: document.getElementById("freedomRemindersConfirmText")?.textContent?.trim()
    };
  });
  assert.equal(publicState.panelOpen, true);
  assert.equal(publicState.availOk, true);
  assert.equal(publicState.remindersOn, true);
  assert.equal(publicState.internal, false);
  assert.equal(publicState.testHidden, true);
  assert.equal(publicState.confirm, "Your reminders are on");
  assert.equal(publicState.escapeBound, true);
  console.log("PASS: Reminders Escape bound; test hidden without internal mode");

  /* Escape closes reminders and returns Home */
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.getElementById("freedomRemindersPanelOverlay")?.hidden === true,
    { timeout: 5000 }
  );
  const afterEsc = await page.evaluate(() => ({
    home: document.body.classList.contains("home183"),
    panelHidden: document.getElementById("freedomRemindersPanelOverlay")?.hidden === true
  }));
  assert.equal(afterEsc.panelHidden, true);
  assert.equal(afterEsc.home, true);
  console.log("PASS: Escape closes Reminders and returns Home");

  /* Internal mode + active reminders → real render shows test button */
  await page.evaluate(() => {
    window.setInternalTestEnabled(true);
    window.FreedomReminders.setChoice("keep");
    window.openFreedomRemindersPanel();
  });
  await page.waitForSelector("#freedomRemindersPanelOverlay:not([hidden])");
  const internal = await page.evaluate(() => ({
    testHidden: document.getElementById("freedomRemindersTestWrap")?.hidden === true,
    label: document.getElementById("freedomRemindersTestBtn")?.textContent?.trim(),
    remindersOn: window.FreedomReminders.isEffectivelyOn(),
    internal: window.isInternalTestMode()
  }));
  assert.equal(internal.internal, true);
  assert.equal(internal.remindersOn, true);
  assert.equal(internal.testHidden, false);
  assert.equal(internal.label, "Send test reminder");
  console.log("PASS: Internal testing shows Send test reminder");

  /* Disable internal testing → real render hides it again while reminders stay on */
  await page.evaluate(() => {
    window.setInternalTestEnabled(false);
    window.FreedomReminders.renderPanel();
  });
  const afterInternalOff = await page.evaluate(() => ({
    testHidden: document.getElementById("freedomRemindersTestWrap")?.hidden === true,
    remindersOn: window.FreedomReminders.isEffectivelyOn(),
    internal: window.isInternalTestMode(),
    confirm: document.getElementById("freedomRemindersConfirmText")?.textContent?.trim()
  }));
  assert.equal(afterInternalOff.internal, false);
  assert.equal(afterInternalOff.remindersOn, true);
  assert.equal(afterInternalOff.testHidden, true);
  assert.equal(afterInternalOff.confirm, "Your reminders are on");
  console.log("PASS: Disabling internal testing hides Send test reminder again");

  /* Backup panel Escape */
  await page.evaluate(() => {
    window.closeFreedomRemindersPanel();
    window.openFreedomBackupPanel();
  });
  await page.waitForSelector("#freedomBackupPanelOverlay:not([hidden])");
  const backup = await page.evaluate(() => ({
    escapeBound: document.getElementById("freedomBackupPanelOverlay")?.dataset.escapeBound === "1",
    focusedExport:
      document.activeElement === document.getElementById("freedomBackupExport")
  }));
  assert.equal(backup.escapeBound, true);
  assert.equal(backup.focusedExport, true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.getElementById("freedomBackupPanelOverlay")?.hidden === true,
    { timeout: 5000 }
  );
  console.log("PASS: Backup panel focuses Export and closes on Escape");

  await browser.close();
  console.log("PASS: launch a11y cleanup flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
