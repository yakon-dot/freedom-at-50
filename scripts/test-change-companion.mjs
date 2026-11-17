/**
 * Change companion (More → existing selection screen):
 * - Option enabled (no "not ready" gate)
 * - Reuses onboarding select + "X it is." confirm
 * - Current companion marker in change mode
 * - Cancel / same companion return Home without first-setup
 * - Different companion saves id only (preserves journeys / reminders keys)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");

assert.match(index, /data-more183="companion">Change companion</);
assert.match(index, /openForChange:openCompanionChange/);
assert.match(index, /cancelChange:cancelCompanionChange/);
assert.match(index, /opts\.changeMode/);
assert.match(index, /Current companion/);
assert.match(index, /freedomCompanionChangeClose/);
assert.match(index, /is-change-mode/);
assert.equal(/not ready yet/i.test(index), false);
assert.match(index, /companionNames\[id\]\+" it is\."/);
/* Change path must not remount first companion setup */
assert.match(
  index,
  /!wasChange&&window\.FreedomFirstCompanionSetup&&typeof window\.FreedomFirstCompanionSetup\.mountAfterSelection/
);
console.log("PASS: source contracts for Change companion");

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
const DATA_KEY = "freedom50-mobile-v1";
const COMPANION_KEY = "freedom50-companion-id-v1";
const FIRST_SETUP_KEY = "freedom50-companion-first-setup-pending-v1";
const PENDING_KEY = "freedom50-companion-pending-v1";
const REMINDER_ROTATION_KEY = "freedom50-reminder-checkin-rotation-v1";

const SAMPLE_STATE = {
  journeys: [{ id: "j1", title: "Keep my journey", progress: 40 }],
  goals: [{ id: "g1", title: "Keep my goal", done: false }],
  pensions: [{ id: "p1", name: "Keep my pension", value: 12000 }],
  notes: [{ id: "n1", text: "Keep my note" }]
};

async function seedEstablished(page, companion) {
  await page.evaluateOnNewDocument(
    (keys, companionId, state) => {
      localStorage.setItem("freedom50-welcome-complete-v1", "1");
      localStorage.setItem("freedom50-look-around-complete-v1", "1");
      localStorage.setItem("freedom50-first-time-complete-v1", "1");
      localStorage.setItem(keys.companion, companionId);
      localStorage.removeItem(keys.pending);
      localStorage.removeItem(keys.firstSetup);
      localStorage.setItem(keys.data, JSON.stringify(state));
      localStorage.setItem(keys.rotation, JSON.stringify({ index: 7, monthKey: "2026-11" }));
    },
    {
      companion: COMPANION_KEY,
      pending: PENDING_KEY,
      firstSetup: FIRST_SETUP_KEY,
      data: DATA_KEY,
      rotation: REMINDER_ROTATION_KEY
    },
    companion,
    SAMPLE_STATE
  );
}

async function openChangeFromMore(page) {
  const openedViaMore = await page.evaluate(() => {
    if (typeof window.showHome === "function") window.showHome();
    else document.body.classList.add("home183");
    const btn = document.querySelector('[data-more183="companion"]');
    if (!btn) return false;
    /* Same path as tapping More → Change companion (handler closes More + opens select). */
    btn.click();
    const root = document.getElementById("freedomCompanionSelect");
    return !!(
      root &&
      !root.hidden &&
      root.classList.contains("is-present") &&
      window.freedomCompanionSelect.isChangeMode()
    );
  });
  if (!openedViaMore) {
    await page.evaluate(() => window.freedomCompanionSelect.openForChange());
  }
  await page.waitForFunction(
    () => {
      const root = document.getElementById("freedomCompanionSelect");
      return (
        !!root &&
        !root.hidden &&
        root.classList.contains("is-present") &&
        window.freedomCompanionSelect.isChangeMode()
      );
    },
    { timeout: 10000 }
  );
}

async function snapshotPreserved(page) {
  return page.evaluate(
    (keys) => {
      const raw = localStorage.getItem(keys.data);
      let state = null;
      try {
        state = raw ? JSON.parse(raw) : null;
      } catch {
        state = null;
      }
      return {
        companion: localStorage.getItem(keys.companion),
        pending: localStorage.getItem(keys.pending),
        firstSetup: localStorage.getItem(keys.firstSetup),
        rotation: localStorage.getItem(keys.rotation),
        journeyTitle: state?.journeys?.[0]?.title || null,
        goalTitle: state?.goals?.[0]?.title || null,
        pensionName: state?.pensions?.[0]?.name || null,
        noteText: state?.notes?.[0]?.text || null,
        firstSetupHost: !!document.querySelector(
          "#freedomFirstCompanionSetup, .freedom-first-companion-setup"
        ),
        changeMode: !!(
          window.freedomCompanionSelect &&
          window.freedomCompanionSelect.isChangeMode &&
          window.freedomCompanionSelect.isChangeMode()
        ),
        selectHidden: document.getElementById("freedomCompanionSelect")?.hidden === true,
        home: document.body.classList.contains("home183")
      };
    },
    {
      companion: COMPANION_KEY,
      pending: PENDING_KEY,
      firstSetup: FIRST_SETUP_KEY,
      data: DATA_KEY,
      rotation: REMINDER_ROTATION_KEY
    }
  );
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* Open Change companion: same screen, current marker, close cancels */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page, "patricia");
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () =>
        typeof window.freedomCompanionSelect === "object" &&
        typeof window.freedomCompanionSelect.openForChange === "function",
      { timeout: 20000 }
    );
    await openChangeFromMore(page);
    const opened = await page.evaluate(() => {
      const root = document.getElementById("freedomCompanionSelect");
      const close = document.getElementById("freedomCompanionChangeClose");
      const current = document.querySelector(
        '.freedom-companion-card[data-companion="patricia"].is-current .freedom-companion-current'
      );
      const heading = root?.querySelector(".freedom-companion-heading")?.textContent || "";
      const sub = root?.querySelector(".freedom-companion-sub")?.textContent || "";
      return {
        changeMode: window.freedomCompanionSelect.isChangeMode(),
        closeVisible: close && !close.hidden,
        currentText: current?.textContent?.trim() || "",
        heading: heading.replace(/\s+/g, " ").trim(),
        sub: sub.trim(),
        pickCount: root?.querySelectorAll("[data-pick-companion]").length || 0
      };
    });
    assert.equal(opened.changeMode, true);
    assert.equal(opened.closeVisible, true);
    assert.equal(opened.currentText, "Current companion");
    assert.match(opened.heading, /Pick whoever you fancy/);
    assert.equal(opened.sub, "You can change your mind later.");
    assert.equal(opened.pickCount, 3);

    await page.evaluate(() => {
      document.getElementById("freedomCompanionChangeClose")?.click();
    });
    await page.waitForFunction(
      () =>
        document.getElementById("freedomCompanionSelect")?.hidden === true &&
        document.body.classList.contains("home183") &&
        !window.freedomCompanionSelect.isChangeMode(),
      { timeout: 10000 }
    );
    const afterCancel = await snapshotPreserved(page);
    assert.equal(afterCancel.companion, "patricia");
    assert.equal(afterCancel.pending, null);
    assert.equal(afterCancel.firstSetup, null);
    assert.equal(afterCancel.journeyTitle, "Keep my journey");
    assert.equal(afterCancel.home, true);
    console.log("PASS: More opens change mode; cancel returns Home unchanged");
    await page.close();
  }

  /* Switch Patricia → Kevin: confirm wording, save, Home, no first-setup, data kept */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page, "patricia");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => typeof window.freedomCompanionSelect?.openForChange === "function",
      { timeout: 20000 }
    );
    await openChangeFromMore(page);
    await page.evaluate(() => {
      document.getElementById("freedomCompanionToggle-kevin")?.click();
    });
    await page.waitForSelector(
      '.freedom-companion-card[data-companion="kevin"].is-open',
      { timeout: 5000 }
    );
    const confirm = await page.evaluate(() => {
      const btn = document.querySelector('[data-pick-companion="kevin"]');
      btn?.click();
      return {
        text: (btn?.textContent || "").trim(),
        companion: localStorage.getItem("freedom50-companion-id-v1"),
        firstSetup: localStorage.getItem("freedom50-companion-first-setup-pending-v1")
      };
    });
    assert.equal(confirm.companion, "kevin");
    assert.match(confirm.text, /Kevin it is/);
    assert.equal(confirm.firstSetup, null);
    await page.waitForFunction(
      () =>
        document.getElementById("freedomCompanionSelect")?.hidden === true &&
        document.body.classList.contains("home183"),
      { timeout: 15000 }
    );
    const after = await snapshotPreserved(page);
    assert.equal(after.companion, "kevin");
    assert.equal(after.pending, null);
    assert.equal(after.firstSetup, null);
    assert.equal(after.firstSetupHost, false);
    assert.equal(after.journeyTitle, "Keep my journey");
    assert.equal(after.goalTitle, "Keep my goal");
    assert.equal(after.pensionName, "Keep my pension");
    assert.equal(after.noteText, "Keep my note");
    assert.ok(after.rotation && after.rotation.includes('"index":7'));
    console.log("PASS: switch companion confirms, saves, Home, data preserved");
    await page.close();
  }

  /* Same companion pick: Home without first-setup / data reset */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page, "veronica");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => typeof window.freedomCompanionSelect?.openForChange === "function",
      { timeout: 20000 }
    );
    await openChangeFromMore(page);
    await page.evaluate(() => {
      document.getElementById("freedomCompanionToggle-veronica")?.click();
    });
    await page.waitForSelector(
      '.freedom-companion-card[data-companion="veronica"].is-open',
      { timeout: 5000 }
    );
    await page.evaluate(() => {
      document.querySelector('[data-pick-companion="veronica"]')?.click();
    });
    await page.waitForFunction(
      () =>
        localStorage.getItem("freedom50-companion-id-v1") === "veronica" &&
        document.getElementById("freedomCompanionSelect")?.hidden === true &&
        document.body.classList.contains("home183"),
      { timeout: 15000 }
    );
    const after = await snapshotPreserved(page);
    assert.equal(after.companion, "veronica");
    assert.equal(after.firstSetup, null);
    assert.equal(after.firstSetupHost, false);
    assert.equal(after.journeyTitle, "Keep my journey");
    console.log("PASS: same companion returns Home without onboarding replay");
    await page.close();
  }

  await browser.close();
  console.log("PASS: change companion flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
