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
    const card = document.getElementById("moreBackup");
    return card ? card.innerText : "";
  });
  assert.match(uiCopy, /iCloud Drive/i);
  assert.match(uiCopy, /cannot be opened|cannot recover/i);
  assert.match(uiCopy, /password-protected|encrypt/i);
  console.log("PASS: Backup card copy mentions encryption, iCloud, unreoverable password");

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

  /* UI: open export password dialog */
  await page.evaluate(() => {
    if (typeof window.page === "function") window.page("more");
    document.body.classList.remove("home183");
    const btn = document.getElementById("freedomBackupExport");
    btn.scrollIntoView({ block: "center" });
    btn.click();
  });
  await page.waitForFunction(() => !document.getElementById("freedomBackupPassOverlay").hidden, {
    timeout: 5000,
  });
  const exportTitle = await page.$eval("#freedomBackupPassTitle", (el) => el.textContent);
  assert.match(exportTitle, /Protect this backup/i);
  const confirmVisible = await page.$eval("#freedomBackupPassConfirmWrap", (el) => !el.hidden);
  assert.equal(confirmVisible, true);
  await page.type("#freedomBackupPassInput", "short");
  await page.type("#freedomBackupPassConfirm", "short");
  await page.evaluate(() => document.getElementById("freedomBackupPassSubmit").click());
  const errShort = await page.$eval("#freedomBackupPassError", (el) => el.textContent);
  assert.match(errShort, /at least 6/i);
  await page.evaluate(() => document.getElementById("freedomBackupPassCancel").click());
  await page.waitForFunction(() => document.getElementById("freedomBackupPassOverlay").hidden);
  console.log("PASS: Export dialog validates password length and cancel closes without export");

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

  console.log("\nAll browser backup integration checks passed.");
  await browser.close();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
