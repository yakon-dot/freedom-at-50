/**
 * Demo Mode Pension sticky note: exact approved copy, demo-only, dismissible.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
const APPROVED =
  "Keep track of your pension savings here, whether you have one pension or several.\n\nAdd each pension to see how much you've built towards your future.";
const APPROVED_SOURCE =
  "Keep track of your pension savings here, whether you have one pension or several.\\n\\nAdd each pension to see how much you've built towards your future.";

assert.match(index, /pensionFirst/);
assert.match(index, /handleDemoPensionShown/);
assert.equal(index.includes(APPROVED_SOURCE), true);
assert.match(index, /data-note-id="pensionFirst"/);
console.log("PASS: source contracts for Demo pension sticky note");

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

async function noteText(page) {
  return page.evaluate(() => {
    const note = document.querySelector('.patricia-note[data-note-id="pensionFirst"]');
    if (!note) return null;
    return [...note.querySelectorAll(".patricia-note-text")]
      .map(el => el.textContent.trim())
      .filter(Boolean)
      .join("\n\n");
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  /* Personal Pension: no pension sticky note */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.page === "function", { timeout: 20000 });
    await page.evaluate(() => {
      document.body.classList.remove("home183");
      if (typeof window.hideHome === "function") window.hideHome();
      window.page("pension");
    });
    await new Promise(r => setTimeout(r, 1200));
    const personal = await page.evaluate(() => ({
      demo: document.body.classList.contains("demo-mode-active"),
      note: !!document.querySelector('.patricia-note[data-note-id="pensionFirst"]'),
      addBtn: !!document.getElementById("toggleAddPension")
    }));
    assert.equal(personal.demo, false);
    assert.equal(personal.note, false);
    assert.equal(personal.addBtn, true);
    console.log("PASS: personal Pension screen has no demo sticky note");
    await page.close();
  }

  /* Demo Pension: sticky note with approved wording */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await seedEstablished(page);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.enterDemo === "function", { timeout: 20000 });
    await page.evaluate(() => {
      window.enterDemo();
      document.body.classList.remove("home183");
      if (typeof window.hideHome === "function") window.hideHome();
      window.page("pension");
    });
    await page.waitForFunction(
      () => !!document.querySelector('.patricia-note[data-note-id="pensionFirst"] .patricia-note-text'),
      { timeout: 15000 }
    );
    const text = await noteText(page);
    assert.equal(text, APPROVED.replace(/\n\n/g, "\n\n"));
    const layout = await page.evaluate(() => {
      const note = document.querySelector('.patricia-note[data-note-id="pensionFirst"]');
      const addBtn = document.getElementById("toggleAddPension");
      const layer = document.getElementById("patriciaNoteLayer");
      return {
        sticky: note.classList.contains("is-demo-sticky"),
        centered: layer.classList.contains("is-sticky-centered"),
        addPresent: !!addBtn,
        closePresent: !!note.querySelector(".patricia-note-close")
      };
    });
    assert.equal(layout.sticky, true);
    assert.equal(layout.centered, true);
    assert.equal(layout.addPresent, true);
    assert.equal(layout.closePresent, true);
    /* Dismiss persists for the demo session (close is armed after enter animation). */
    await page.waitForSelector(
      '.patricia-note[data-note-id="pensionFirst"].patricia-note-close-ready .patricia-note-close',
      { timeout: 10000 }
    );
    await page.evaluate(() => {
      const btn = document.querySelector(
        '.patricia-note[data-note-id="pensionFirst"] .patricia-note-close'
      );
      btn.style.pointerEvents = "auto";
      btn.click();
    });
    await page.waitForFunction(
      () => !document.querySelector('.patricia-note[data-note-id="pensionFirst"]'),
      { timeout: 5000 }
    );
    await page.evaluate(() => {
      window.page("goals");
      window.page("pension");
    });
    await new Promise(r => setTimeout(r, 1200));
    const afterDismiss = await page.evaluate(
      () => !!document.querySelector('.patricia-note[data-note-id="pensionFirst"]')
    );
    assert.equal(afterDismiss, false);
    console.log("PASS: Demo Pension sticky note shows, matches copy, dismisses once");
    await page.close();
  }

  /* Small iPhone width still mounts the note */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
    await seedEstablished(page);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.enterDemo === "function", { timeout: 20000 });
    await page.evaluate(() => {
      window.enterDemo();
      document.body.classList.remove("home183");
      if (typeof window.hideHome === "function") window.hideHome();
      window.page("pension");
    });
    await page.waitForFunction(
      () => !!document.querySelector('.patricia-note[data-note-id="pensionFirst"]'),
      { timeout: 15000 }
    );
    const small = await page.evaluate(() => {
      const note = document.querySelector('.patricia-note[data-note-id="pensionFirst"]');
      const r = note.getBoundingClientRect();
      return { width: r.width, left: r.left, right: r.right, vw: window.innerWidth };
    });
    assert.ok(small.width > 120);
    assert.ok(small.left >= 0);
    assert.ok(small.right <= small.vw + 1);
    console.log("PASS: Demo pension sticky fits small iPhone viewport");
    await page.close();
  }

  await browser.close();
  console.log("PASS: demo pension sticky note flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
