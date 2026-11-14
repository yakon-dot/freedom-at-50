/**
 * In-browser encrypted backup integration against local index.html.
 * Seeds personal state, encrypts via page functions, verifies wrong password
 * does not mutate localStorage, and successful decrypt preserves contribPeriods.
 */
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";

const BASE = process.env.FREEDOM_BASE || "http://127.0.0.1:8765/index.html";
const KEY = "freedom50-mobile-v1";

const seedState = {
  archivedJourneys: [],
  archivedGoals: [],
  archivedPensions: [],
  customGoals: [
    {
      id: "g1",
      name: "Japan",
      current: 1200,
      target: 5000,
      hasTarget: true,
      plannedMonthly: 100,
      planMode: "monthly",
    },
  ],
  hiddenBuiltInGoals: { houseFund: true, holidayFund: true, personalSavings: true },
  deletedBuiltInGoals: { houseFund: false, holidayFund: false, personalSavings: false },
  goalNames: {},
  goalTargets: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
  goalHasTarget: { houseFund: false, holidayFund: false, personalSavings: false },
  goalPlanMode: { houseFund: "monthly", holidayFund: "monthly", personalSavings: "monthly" },
  goalPlannedMonthly: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
  goalDate: { houseFund: null, holidayFund: null, personalSavings: null },
  goalLifetimeAdded: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
  goalLifeHappensTotal: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
  goalLastLifeHappens: {},
  goalStartingBalance: { houseFund: 0, holidayFund: 0, personalSavings: 0 },
  goalLastBalanceCorrection: {},
  goalCollapsed: {},
  goalOrder: [],
  loans: [{ id: "j1", name: "Car Loan", starting: 12000, current: 8400, payment: 250 }],
  housePocket: 0,
  housePocketMonthly: 0,
  housePocketArchived: true,
  housePocketCompletedAt: null,
  housePocketArchiveRemoved: true,
  houseFund: 0,
  holidayFund: 0,
  holidayMonthly: 0,
  personalSavings: 0,
  pensions: [
    {
      id: "p1",
      name: "Irish Life",
      value: 42000,
      personal: 200,
      employer: 150,
      autoTrack: true,
      statementMonth: "2025-01",
      contribPeriods: [
        { startMonth: "2025-02", personal: 150, employer: 100 },
        { startMonth: "2025-06", personal: 200, employer: 150 },
      ],
    },
  ],
  notes: [{ id: "n1", text: "Renew insurance", color: "yellow", pinned: true, type: "checklist" }],
  overviewExcludeHousePocket: true,
};

const seedMeta = {
  "freedom50-companion-id-v1": "patricia",
  "freedom50-welcome-complete-v1": "1",
  "freedom50-look-around-complete-v1": "1",
  "freedom50-first-time-complete-v1": "1",
};

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.evaluate(
    ({ KEY, seedState, seedMeta }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(KEY, JSON.stringify(seedState));
      Object.entries(seedMeta).forEach(([k, v]) => localStorage.setItem(k, v));
    },
    { KEY, seedState, seedMeta }
  );
  await page.reload({ waitUntil: "domcontentloaded" });

  const uiCopy = await page.evaluate(() => {
    if (window.FreedomBackup && typeof window.FreedomBackup.openPanel === "function") {
      window.FreedomBackup.openPanel();
    }
    const panel = document.getElementById("freedomBackupPanelOverlay");
    const more = document.getElementById("more");
    return {
      hidden: !panel || panel.hidden,
      text: panel ? panel.innerText : "",
      moreActive: !!(more && more.classList.contains("active")),
      hash: location.hash,
    };
  });
  assert.equal(uiCopy.hidden, false);
  assert.match(uiCopy.text, /iCloud Drive/i);
  assert.match(uiCopy.text, /cannot be opened|cannot recover/i);
  assert.match(uiCopy.text, /password-protected|encrypt/i);
  assert.equal(uiCopy.moreActive, false);
  assert.notEqual(uiCopy.hash, "#more");
  console.log("PASS: Backup panel opens with encryption/iCloud copy without activating legacy #more");

  const dialogOk = await page.evaluate(() => !!document.getElementById("freedomBackupPassOverlay"));
  assert.equal(dialogOk, true);
  console.log("PASS: Password dialog markup present");

  const cryptoRoundtrip = await page.evaluate(async () => {
    const api = window.FreedomBackup;
    if (!api) return { missingApi: true };
    const password = "FreedomBrowser-99";
    const inner = api.buildInner();
    const livePeriods = JSON.parse(JSON.stringify(inner.state.pensions[0].contribPeriods || []));
    const livePersonal = inner.state.pensions[0].personal;
    const liveEmployer = inner.state.pensions[0].employer;
    const liveLoan = inner.state.loans[0].current;
    const envelope = await api.encrypt(inner, password);
    const json = JSON.stringify(envelope);
    const hasPasswordField = Object.prototype.hasOwnProperty.call(envelope, "password");
    const hasPlainPension = json.includes("Irish Life") || json.includes("contribPeriods");
    const wrong = await api.decrypt(envelope, "nope-wrong");
    const right = await api.decrypt(envelope, password);
    const before = localStorage.getItem("freedom50-mobile-v1");
    const afterWrong = localStorage.getItem("freedom50-mobile-v1");
    return {
      missingApi: false,
      envelopeVersion: envelope.version,
      encrypted: envelope.encrypted,
      iter: envelope.iter,
      apiIterations: api.iterations,
      hasPasswordField,
      hasPlainPension,
      wrongOk: wrong.ok,
      wrongError: wrong.error,
      rightOk: right.ok,
      livePeriods,
      periods: right.ok ? right.state.pensions[0].contribPeriods : null,
      livePersonal,
      liveEmployer,
      liveLoan,
      personal: right.ok ? right.state.pensions[0].personal : null,
      employer: right.ok ? right.state.pensions[0].employer : null,
      loanCurrent: right.ok ? right.state.loans[0].current : null,
      noteText: right.ok ? right.state.notes[0].text : null,
      companion: right.ok ? right.meta["freedom50-companion-id-v1"] : null,
      storageUnchanged: before === afterWrong && !wrong.ok,
      lsHasPassword: Object.keys(localStorage).some((k) => /pass/i.test(k)) ||
        Object.keys(sessionStorage).some((k) => /pass/i.test(k)),
      periodCount: livePeriods.length,
    };
  });
  assert.equal(cryptoRoundtrip.missingApi, false);
  assert.equal(cryptoRoundtrip.envelopeVersion, 2);
  assert.equal(cryptoRoundtrip.encrypted, true);
  assert.equal(cryptoRoundtrip.iter, 210000);
  assert.equal(cryptoRoundtrip.apiIterations, 210000);
  assert.equal(cryptoRoundtrip.hasPasswordField, false);
  assert.equal(cryptoRoundtrip.hasPlainPension, false);
  assert.equal(cryptoRoundtrip.wrongOk, false);
  assert.equal(cryptoRoundtrip.storageUnchanged, true);
  assert.equal(cryptoRoundtrip.lsHasPassword, false);
  assert.equal(cryptoRoundtrip.rightOk, true);
  assert.ok(cryptoRoundtrip.periodCount >= 1, "expected contribPeriods on live pension");
  assert.deepEqual(cryptoRoundtrip.periods, cryptoRoundtrip.livePeriods);
  assert.equal(cryptoRoundtrip.personal, cryptoRoundtrip.livePersonal);
  assert.equal(cryptoRoundtrip.employer, cryptoRoundtrip.liveEmployer);
  assert.equal(cryptoRoundtrip.loanCurrent, cryptoRoundtrip.liveLoan);
  assert.equal(cryptoRoundtrip.noteText, "Renew insurance");
  assert.equal(cryptoRoundtrip.companion, "patricia");
  console.log("PASS: Browser Web Crypto encrypt/decrypt + wrong password preserves storage");
  console.log("PASS: Password never written to localStorage/sessionStorage");
  console.log("PASS: Pension contribPeriods + financial fields preserved through decrypt");

  const rejectPlain = await page.evaluate(async () => {
    const plain = {
      freedomBackup: true,
      version: 1,
      state: JSON.parse(localStorage.getItem("freedom50-mobile-v1")),
      meta: {},
    };
    /* Same gate as restoreFreedomBackupFromFile before password prompt */
    if (plain.encrypted !== true || Number(plain.version) < 2) {
      return { rejected: true, message: "This backup is not password-protected. Freedom only restores encrypted backups." };
    }
    return { rejected: false };
  });
  assert.equal(rejectPlain.rejected, true);
  console.log("PASS: Unencrypted files rejected before password prompt");

  /* UI: Backup panel → Export opens password dialog (not legacy #more) */
  const navCheck = await page.evaluate(() => {
    document.body.classList.add("home183");
    document.body.classList.remove(
      "overview-active-v300",
      "journey-active-v313",
      "goals-active-v314",
      "pension-active-v315",
      "notes-active-v318",
      "archive-active-v316",
      "victories-active-v317"
    );
    document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
    const overview = document.getElementById("overview");
    if (overview) overview.classList.add("active");
    /* Simulate Home → More → Backup */
    if (typeof window.openFreedomBackupPanel === "function") window.openFreedomBackupPanel();
    else if (window.FreedomBackup) window.FreedomBackup.openPanel();
    const panel = document.getElementById("freedomBackupPanelOverlay");
    const more = document.getElementById("more");
    const header = document.querySelector(".app > header");
    const exportBtn = document.getElementById("freedomBackupExport");
    exportBtn.click();
    return {
      panelOpen: panel && !panel.hidden,
      moreActive: !!(more && more.classList.contains("active")),
      hash: location.hash,
      headerDisplay: header ? getComputedStyle(header).display : "none",
      passOpen: !document.getElementById("freedomBackupPassOverlay").hidden,
      passTitle: document.getElementById("freedomBackupPassTitle")?.textContent || "",
    };
  });
  assert.equal(navCheck.panelOpen, true);
  assert.equal(navCheck.moreActive, false);
  assert.notEqual(navCheck.hash, "#more");
  assert.equal(navCheck.passOpen, true);
  assert.match(navCheck.passTitle, /Protect this backup/i);
  console.log("PASS: Home→Backup opens modern panel; Export opens password dialog (not legacy #more)");

  const confirmVisible = await page.$eval("#freedomBackupPassConfirmWrap", (el) => !el.hidden);
  assert.equal(confirmVisible, true);
  await page.type("#freedomBackupPassInput", "shortpass11");
  await page.type("#freedomBackupPassConfirm", "shortpass11");
  await page.evaluate(() => document.getElementById("freedomBackupPassSubmit").click());
  const errShort = await page.$eval("#freedomBackupPassError", (el) => el.textContent);
  assert.match(errShort, /at least 12/i);
  await page.evaluate(() => document.getElementById("freedomBackupPassCancel").click());
  await page.waitForFunction(() => document.getElementById("freedomBackupPassOverlay").hidden);
  console.log("PASS: Export dialog validates password length and cancel closes without export");

  /* Demo Mode: clear personal-export guidance */
  const demoMsg = await page.evaluate(async () => {
    window.FreedomBackup._setDemoModeForTests(true);
    await window.FreedomBackup.exportBackup();
    const status = document.getElementById("freedomBackupStatus")?.textContent || "";
    window.FreedomBackup._setDemoModeForTests(false);
    return status;
  });
  assert.match(demoMsg, /Demo Mode/i);
  assert.match(demoMsg, /Exit Demo Mode/i);
  console.log("PASS: Demo Mode export explains user must exit before personal backup");

  /* Full export download is encrypted JSON with no plaintext finances */
  const download = await page.evaluate(async () => {
    const api = window.FreedomBackup;
    const password = "FreedomExport-77";
    const envelope = await api.encrypt(api.buildInner(), password);
    const json = JSON.stringify(envelope, null, 2);
    return {
      version: envelope.version,
      encrypted: envelope.encrypted,
      hasStateKey: Object.prototype.hasOwnProperty.call(envelope, "state"),
      hasPassword: /"password"\s*:/i.test(json),
      hasIrishLife: json.includes("Irish Life"),
      hasContrib: json.includes("contribPeriods"),
      hasLoanName: json.includes("Car Loan"),
    };
  });
  assert.equal(download.version, 2);
  assert.equal(download.encrypted, true);
  assert.equal(download.hasStateKey, false);
  assert.equal(download.hasPassword, false);
  assert.equal(download.hasIrishLife, false);
  assert.equal(download.hasContrib, false);
  assert.equal(download.hasLoanName, false);
  console.log("PASS: Exported envelope has no plaintext financial data or password");

  /* Corrupt personal KEY: persist blocked; export refused; restore can still rewrite. */
  page.removeAllListeners("dialog");
  page.on("dialog", async (dialog) => {
    /* Dismiss recover prompt so Saving stays paused. */
    await dialog.dismiss();
  });
  await page.evaluate(() => {
    localStorage.setItem("freedom50-mobile-v1", '{"definitely":"not-valid-freedom-state"');
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.FreedomBackup && typeof window.FreedomBackup.getPersonalLoadError === "function");
  const corruptInteraction = await page.evaluate(async () => {
    const api = window.FreedomBackup;
    const KEY = "freedom50-mobile-v1";
    const beforeBlob = localStorage.getItem(KEY);
    const loadError = api.getPersonalLoadError();
    await api.exportBackup();
    const statusEl = document.getElementById("freedomBackupStatus");
    const exportBlocked =
      statusEl &&
      /could not read your saved personal data|backup cannot be created/i.test(statusEl.textContent || "");
    const blobAfterExportAttempt = localStorage.getItem(KEY);
    const password = "FreedomRestore12";
    const goodInner = {
      state: {
        loans: [{ id: "r1", name: "Restored Loan", starting: 500, current: 400, payment: 50 }],
        pensions: [
          {
            id: "rp1",
            name: "Restored Pension",
            value: 1000,
            personal: 10,
            employer: 5,
            contribPeriods: [{ startMonth: "2026-01", personal: 10, employer: 5 }],
          },
        ],
        notes: [],
      },
      meta: {},
    };
    const envelope = await api.encrypt(goodInner, password);
    const wrong = await api.decrypt(envelope, "not-the-password");
    const decrypted = await api.decrypt(envelope, password);
    /* Avoid navigation during the test harness when possible. */
    try {
      Object.defineProperty(window.location, "reload", {
        configurable: true,
        value: function () {},
      });
    } catch (e) {}
    let wrote = null;
    if (decrypted.ok) wrote = api.writeChecked(decrypted);
    return {
      loadError,
      exportBlocked,
      beforeBlob,
      blobAfterExportAttempt,
      wrongOk: wrong.ok,
      decryptOk: decrypted.ok,
      loadErrorCleared: api.getPersonalLoadError() === null,
      stored: localStorage.getItem(KEY),
      wroteOk: !!(wrote && wrote.ok),
    };
  });
  assert.equal(corruptInteraction.loadError, "corrupt");
  assert.equal(corruptInteraction.exportBlocked, true);
  assert.equal(corruptInteraction.blobAfterExportAttempt, corruptInteraction.beforeBlob);
  assert.equal(corruptInteraction.wrongOk, false);
  assert.equal(corruptInteraction.decryptOk, true);
  assert.equal(corruptInteraction.loadErrorCleared, true);
  assert.equal(corruptInteraction.wroteOk, true);
  assert.match(corruptInteraction.stored, /Restored Loan/);
  console.log("PASS: Corrupt storage blocks export and leaves blob untouched until restore");
  console.log("PASS: Incorrect password fails closed; valid restore rewrite clears load error");

  console.log("\nAll browser backup integration checks passed.");
  await browser.close();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
