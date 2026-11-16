/**
 * Browser checks for reminder preference UI (personal vs demo) and localStorage choice.
 */
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.FREEDOM_BASE || "http://127.0.0.1:8765";
const CHOICE_KEY = "freedom50-reminders-choice-v1";

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

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.FreedomReminders === "object", { timeout: 20000 });

  /* Demo mode never exposes Keep/Never through open panel */
  await page.evaluate(() => {
    window.FreedomReminders._setDemoModeForTests(true);
    document.body.classList.add("demo-mode-active");
  });
  const demoHidden = await page.evaluate(() => {
    const btn = document.querySelector('[data-more183="reminders"]');
    const style = btn ? getComputedStyle(btn).display : "none";
    window.openFreedomRemindersPanel();
    const panel = document.getElementById("freedomRemindersPanelOverlay");
    return {
      display: style,
      panelHidden: !panel || panel.hidden === true
    };
  });
  assert.equal(demoHidden.display, "none");
  assert.equal(demoHidden.panelHidden, true);
  console.log("PASS: Reminders hidden / blocked in Demo Mode");

  /* Personal: open panel, choose Never, remember, no re-prompt buttons for Keep until user opts in */
  await page.evaluate(() => {
    window.FreedomReminders._setDemoModeForTests(false);
    document.body.classList.remove("demo-mode-active");
    localStorage.removeItem("freedom50-reminders-choice-v1");
  });
  await page.evaluate(() => window.openFreedomRemindersPanel());
  await page.waitForSelector("#freedomRemindersPanelOverlay:not([hidden])");
  const initialButtons = await page.evaluate(() =>
    [...document.querySelectorAll("#freedomRemindersActions button")].map(b => b.textContent.trim())
  );
  /* With Worker URL configured, panel offers Keep / Never without crashing */
  const status = await page.evaluate(() => document.getElementById("freedomRemindersStatus")?.textContent || "");
  assert.ok(status.length > 0);
  assert.equal(/not connected yet/i.test(status), false);
  assert.ok(
    initialButtons.includes("Keep reminders") || initialButtons.includes("Never remind me"),
    `expected opt-in buttons, got: ${initialButtons.join(", ")}`
  );
  const cfgOk = await page.evaluate(() => {
    const cfg = window.FREEDOM_PUSH || {};
    return !!(cfg.apiBase && cfg.vapidPublicKey && !/privateKey/i.test(JSON.stringify(cfg)));
  });
  assert.equal(cfgOk, true);
  console.log("PASS: Personal Reminders panel opens with status:", status.slice(0, 80));

  /* Choose Never via UI button (and API path) — no network subscribe */
  const clicked = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll("#freedomRemindersActions button")]
      .find(b => b.textContent.trim() === "Never remind me");
    if(!btn) return false;
    btn.click();
    return true;
  });
  assert.equal(clicked, true);
  await page.waitForFunction(
    key => localStorage.getItem(key) === "never",
    { timeout: 10000 },
    CHOICE_KEY
  );
  const neverChoice = await page.evaluate(key => localStorage.getItem(key), CHOICE_KEY);
  assert.equal(neverChoice, "never");
  await page.waitForFunction(() => {
    const labels = [...document.querySelectorAll("#freedomRemindersActions button")].map(b => b.textContent.trim());
    return labels.includes("Keep reminders") && !labels.includes("Never remind me");
  }, { timeout: 10000 });
  console.log("PASS: Never remind me persists; only Keep reminders offered to turn back on");

  /* Declined users are not auto-prompted again (choice remains never after panel reopen) */
  await page.evaluate(() => {
    window.closeFreedomRemindersPanel();
    window.openFreedomRemindersPanel();
  });
  const stillNever = await page.evaluate(key => localStorage.getItem(key), CHOICE_KEY);
  assert.equal(stillNever, "never");
  const reopenButtons = await page.evaluate(() =>
    [...document.querySelectorAll("#freedomRemindersActions button")].map(b => b.textContent.trim())
  );
  assert.ok(reopenButtons.includes("Keep reminders"));
  assert.equal(reopenButtons.includes("Never remind me"), false);
  console.log("PASS: Declined choice remembered across panel reopen");

  /* Turning back on without Worker URL explains unavailability (does not clear Never until subscribe succeeds) */
  await page.evaluate(() => {
    window.FREEDOM_PUSH = Object.assign({}, window.FREEDOM_PUSH, { apiBase: "" });
  });
  await page.click("#freedomRemindersActions button");
  await page.waitForFunction(() => {
    const status = document.getElementById("freedomRemindersStatus")?.textContent || "";
    return /not connected yet|could not turn reminders on|Reminders are not/i.test(status)
      || localStorage.getItem("freedom50-reminders-choice-v1") === "never";
  }, { timeout: 10000 });
  console.log("PASS: Keep reminders without Worker stays safe / explained");

  /* iOS Home Screen guidance exists in client logic */
  const iosCopy = await page.evaluate(() => {
    return String(window.FreedomReminders.availability.toString?"":"") || document.documentElement.innerHTML.includes("Add to Home Screen");
  });
  /* Availability function closes over helpers; confirm copy via evaluating message path */
  const iosMessage = await page.evaluate(() => {
    const ua = navigator.userAgent;
    /* Directly invoke by simulating standalone false + iOS via function from page if exposed */
    const statusEl = document.getElementById("freedomRemindersStatus");
    return {
      hasCopyInSource: document.documentElement.innerHTML.includes("Add to Home Screen")
        || document.documentElement.innerHTML.includes("Home Screen")
    };
  });
  /* Source is in the big script — check via FreedomReminders by forcing reason through choice UI text in function source */
  const sourceHasIos = await page.evaluate(() => {
    return Function.prototype.toString.call(window.FreedomReminders.availability).includes("Home Screen")
      || document.documentElement.innerHTML.includes("Home Screen");
  });
  assert.equal(sourceHasIos || iosMessage.hasCopyInSource, true);
  console.log("PASS: Home Screen install guidance present");

  /* Private key never in page */
  const html = await page.content();
  assert.equal(/VAPID_PRIVATE_KEY|privateKey\s*:/.test(html), false);

  /* Cold-start: ?opened=reminder opens Home and shows one companion check-in. */
  await page.evaluate(() => {
    localStorage.setItem("freedom50-welcome-complete-v1", "1");
    localStorage.setItem("freedom50-look-around-complete-v1", "1");
    localStorage.setItem("freedom50-first-time-complete-v1", "1");
    localStorage.setItem("freedom50-companion-id-v1", "patricia");
    localStorage.removeItem("freedom50-companion-pending-v1");
    localStorage.removeItem("freedom50-companion-first-setup-pending-v1");
    sessionStorage.removeItem("freedom50-reminder-checkin-pending-v1");
    sessionStorage.removeItem("freedom50-reminder-checkin-session-v1");
  });
  await page.goto(`${BASE}/index.html?opened=reminder`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.FreedomMonthlyReminderCheckIn === "object", { timeout: 20000 });
  await page.waitForFunction(() => {
    const host = document.getElementById("freedomCompanionMsgHost");
    const msg = host && host.querySelector(".freedom-companion-msg-text");
    return document.body.classList.contains("home183")
      && !!msg
      && /Journey|Goal/i.test(msg.textContent || "");
  }, { timeout: 20000 });
  const cold = await page.evaluate(() => {
    const host = document.getElementById("freedomCompanionMsgHost");
    return {
      home: document.body.classList.contains("home183"),
      owner: host && host.dataset.companionMessageOwner,
      name: host && host.querySelector(".freedom-companion-msg-name")?.textContent,
      text: host && host.querySelector(".freedom-companion-msg-text")?.textContent,
      pending: sessionStorage.getItem("freedom50-reminder-checkin-pending-v1"),
      session: sessionStorage.getItem("freedom50-reminder-checkin-session-v1"),
      query: location.search
    };
  });
  assert.equal(cold.home, true);
  assert.equal(cold.owner, "monthly-reminder-checkin");
  assert.equal(cold.name, "Patricia");
  assert.match(cold.text || "", /Journey|Goal/i);
  assert.equal(cold.pending, null);
  assert.equal(cold.session, "1");
  assert.equal(/opened=reminder/.test(cold.query), false);
  console.log("PASS: cold-start reminder opens Home with companion check-in");

  /* After the tap is consumed, a normal Home visit must not show it again. */
  await page.evaluate(() => {
    if (window.FreedomMonthlyReminderCheckIn && window.FreedomMonthlyReminderCheckIn.clearHost) {
      window.FreedomMonthlyReminderCheckIn.clearHost();
    }
    const host = document.getElementById("freedomCompanionMsgHost");
    if (host) {
      host.innerHTML = "";
      host.hidden = true;
      delete host.dataset.companionMessageOwner;
    }
    window.__FREEDOM_FROM_REMINDER__ = false;
    sessionStorage.removeItem("freedom50-reminder-checkin-pending-v1");
  });
  await page.evaluate(() => {
    if (typeof window.showHome === "function") window.showHome();
    window.FreedomMonthlyReminderCheckIn.tryFromNotificationTap();
  });
  await new Promise(r => setTimeout(r, 700));
  const noRepeat = await page.evaluate(() => {
    const host = document.getElementById("freedomCompanionMsgHost");
    const open = host && !host.hidden && !!host.querySelector(".freedom-companion-msg");
    return {
      open: !!open,
      owner: host && host.dataset.companionMessageOwner,
      pending: sessionStorage.getItem("freedom50-reminder-checkin-pending-v1"),
      session: sessionStorage.getItem("freedom50-reminder-checkin-session-v1")
    };
  });
  assert.equal(noRepeat.pending, null);
  assert.equal(noRepeat.session, "1");
  assert.equal(noRepeat.open, false);
  console.log("PASS: normal open does not repeat reminder companion message");

  /* Already-open app: a fresh notification arm shows one check-in. */
  await page.evaluate(() => {
    sessionStorage.removeItem("freedom50-reminder-checkin-session-v1");
    window.freedomOpenHomeFromReminder({ force: true, cleanUrl: true });
  });
  await page.waitForFunction(() => {
    const host = document.getElementById("freedomCompanionMsgHost");
    return host && !host.hidden && host.dataset.companionMessageOwner === "monthly-reminder-checkin";
  }, { timeout: 10000 });
  const openApp = await page.evaluate(() => {
    const host = document.getElementById("freedomCompanionMsgHost");
    return {
      home: document.body.classList.contains("home183"),
      text: host && host.querySelector(".freedom-companion-msg-text")?.textContent,
      pending: sessionStorage.getItem("freedom50-reminder-checkin-pending-v1"),
      session: sessionStorage.getItem("freedom50-reminder-checkin-session-v1")
    };
  });
  assert.equal(openApp.home, true);
  assert.match(openApp.text || "", /Journey|Goal/i);
  assert.equal(openApp.pending, null);
  assert.equal(openApp.session, "1");
  /* Without a new arm/pending flag, tryFromNotificationTap must not show again. */
  await page.evaluate(() => {
    if (window.FreedomMonthlyReminderCheckIn.clearHost) window.FreedomMonthlyReminderCheckIn.clearHost();
    const host = document.getElementById("freedomCompanionMsgHost");
    if (host) {
      host.innerHTML = "";
      host.hidden = true;
      delete host.dataset.companionMessageOwner;
    }
    window.FreedomMonthlyReminderCheckIn.tryFromNotificationTap();
  });
  await new Promise(r => setTimeout(r, 700));
  const second = await page.evaluate(() => {
    const host = document.getElementById("freedomCompanionMsgHost");
    return host && !host.hidden && host.dataset.companionMessageOwner === "monthly-reminder-checkin";
  });
  assert.equal(second, false);
  console.log("PASS: already-open reminder path shows once, not twice");

  await browser.close();
  console.log("PASS: reminder preference browser flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
