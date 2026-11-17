/**
 * Browser checks for redesigned Reminders panel (toggle + personal/demo states).
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

async function panelState(page) {
  return page.evaluate(() => {
    const toggle = document.getElementById("freedomRemindersToggle");
    const confirm = document.getElementById("freedomRemindersConfirmText");
    const status = document.getElementById("freedomRemindersStatus");
    const testWrap = document.getElementById("freedomRemindersTestWrap");
    const title = document.getElementById("freedomRemindersPanelTitle");
    return {
      title: title?.textContent?.trim() || "",
      checked: toggle?.getAttribute("aria-checked") === "true",
      disabled: !!toggle?.disabled,
      confirm: confirm?.textContent?.trim() || "",
      status: status?.textContent || "",
      testVisible: !!(testWrap && !testWrap.hidden),
      choice: localStorage.getItem("freedom50-reminders-choice-v1")
    };
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
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.FreedomReminders === "object", { timeout: 20000 });

  /* Demo mode never exposes Reminders */
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

  /* Personal: redesigned copy + toggle off by default */
  await page.evaluate(() => {
    window.FreedomReminders._setDemoModeForTests(false);
    document.body.classList.remove("demo-mode-active");
    localStorage.removeItem("freedom50-reminders-choice-v1");
  });
  await page.evaluate(() => window.openFreedomRemindersPanel());
  await page.waitForSelector("#freedomRemindersPanelOverlay:not([hidden])");
  const initial = await panelState(page);
  assert.equal(initial.title, "A little nudge");
  assert.equal(initial.checked, false);
  assert.equal(initial.confirm, "Your reminders are off");
  assert.equal(/not connected yet/i.test(initial.status), false);
  const hero = await page.evaluate(() => ({
    intro: document.getElementById("freedomRemindersIntro")?.textContent || "",
    hasBell: !!document.querySelector(".freedom-reminders-bell"),
    hasTerms: /On your terms/.test(document.getElementById("freedomRemindersPanelOverlay")?.innerText || ""),
    footer: /You can change your mind anytime/.test(document.getElementById("freedomRemindersPanelOverlay")?.innerText || ""),
    classic: /Test classic notification/.test(document.getElementById("freedomRemindersPanelOverlay")?.innerHTML || "")
  }));
  assert.match(hero.intro, /gentle reminder to check in with your Journeys and Goals/i);
  assert.equal(hero.hasBell, true);
  assert.equal(hero.hasTerms, true);
  assert.equal(hero.footer, true);
  assert.equal(hero.classic, false);
  const cfgOk = await page.evaluate(() => {
    const cfg = window.FREEDOM_PUSH || {};
    return !!(cfg.apiBase && cfg.vapidPublicKey && !/privateKey/i.test(JSON.stringify(cfg)));
  });
  assert.equal(cfgOk, true);
  console.log("PASS: redesigned Reminders panel opens with toggle off");

  /* Turn off via chooseNever API (same path as toggle off) */
  await page.evaluate(async () => {
    await window.FreedomReminders.chooseNever();
  });
  await page.waitForFunction(
    key => localStorage.getItem(key) === "never",
    { timeout: 10000 },
    CHOICE_KEY
  );
  const neverState = await panelState(page);
  assert.equal(neverState.choice, "never");
  assert.equal(neverState.checked, false);
  assert.equal(neverState.confirm, "Your reminders are off");
  assert.equal(neverState.testVisible, false);
  console.log("PASS: Never preference leaves toggle off and confirmation off");

  /* Declined users remain off after reopen */
  await page.evaluate(() => {
    window.closeFreedomRemindersPanel();
    window.openFreedomRemindersPanel();
  });
  const reopen = await panelState(page);
  assert.equal(reopen.choice, "never");
  assert.equal(reopen.checked, false);
  assert.equal(reopen.confirm, "Your reminders are off");
  console.log("PASS: Declined choice remembered across panel reopen");

  /* Without Worker URL, panel explains unavailability and keeps Never / toggle off */
  await page.evaluate(() => {
    window.FREEDOM_PUSH = Object.assign({}, window.FREEDOM_PUSH, { apiBase: "" });
    window.FreedomReminders.renderPanel();
  });
  const blocked = await panelState(page);
  assert.equal(blocked.choice, "never");
  assert.equal(blocked.checked, false);
  assert.match(blocked.status, /not connected yet|Reminders are not|could not turn reminders on/i);
  assert.equal(blocked.disabled, true);
  /* chooseKeep still refuses without clearing Never */
  await page.evaluate(async () => {
    await window.FreedomReminders.chooseKeep();
  });
  const stillBlocked = await panelState(page);
  assert.equal(stillBlocked.choice, "never");
  assert.equal(stillBlocked.checked, false);
  console.log("PASS: Toggle on without Worker stays safe / explained");

  /* Real UI path: keep + push available + permission granted → reminders on.
     Never touch testWrap.hidden directly — only setInternalTestEnabled + renderPanel. */
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
    window.FreedomReminders.renderPanel();
  });
  const availPublic = await page.evaluate(() => window.FreedomReminders.availability());
  assert.equal(availPublic.ok, true, "headless Chrome should report reminders available");
  const onVisual = await panelState(page);
  assert.equal(onVisual.choice, "keep");
  assert.equal(onVisual.checked, true);
  assert.equal(onVisual.confirm, "Your reminders are on");
  assert.equal(onVisual.testVisible, false);
  assert.equal(/Test classic notification/.test(await page.content()), false);
  console.log("PASS: Enabled reminders hide test button for ordinary users");

  await page.evaluate(() => {
    window.setInternalTestEnabled(true);
    window.FreedomReminders.renderPanel();
  });
  const internalVisual = await panelState(page);
  assert.equal(internalVisual.checked, true);
  assert.equal(internalVisual.testVisible, true);
  const testLabel = await page.evaluate(() =>
    document.getElementById("freedomRemindersTestBtn")?.textContent?.trim()
  );
  assert.equal(testLabel, "Send test reminder");
  console.log("PASS: Internal testing reveals Send test reminder");

  await page.evaluate(() => {
    window.setInternalTestEnabled(false);
    window.FreedomReminders.renderPanel();
  });
  const afterDisable = await panelState(page);
  assert.equal(afterDisable.checked, true);
  assert.equal(afterDisable.testVisible, false);
  console.log("PASS: Disabling internal testing hides Send test reminder again");

  /* iOS Home Screen guidance present */
  const sourceHasIos = await page.evaluate(() => {
    return Function.prototype.toString.call(window.FreedomReminders.availability).includes("Home Screen")
      || document.documentElement.innerHTML.includes("Home Screen");
  });
  assert.equal(sourceHasIos, true);
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
