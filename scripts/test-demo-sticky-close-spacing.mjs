/**
 * Demo sticky-note close (X) spacing: nudged inward from the paper edge,
 * shared across Journey / Goals / Pension demo notes. Home sticky unchanged.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(
  index,
  /\.patricia-note\.is-demo-sticky \.patricia-note-close\{\s*top:calc\(3% \+ 6px\);right:calc\(7% \+ 11px\);/
);
assert.match(
  index,
  /body\.home183 \.patricia-note-close\{\s*top:3%;right:7%;/
);
assert.match(index, /\.patricia-note-close\{[^}]*width:44px;height:44px/);
console.log("PASS: source contracts for demo sticky close spacing");

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

async function openDemoPage(page, pageId, noteId) {
  await page.evaluate(id => {
    window.enterDemo();
    document.body.classList.remove("home183");
    if (typeof window.hideHome === "function") window.hideHome();
    window.page(id);
  }, pageId);
  await page.waitForSelector(`.patricia-note.is-demo-sticky[data-note-id="${noteId}"]`, {
    timeout: 15000
  });
}

async function closeMetrics(page, noteId) {
  return page.evaluate(id => {
    const note = document.querySelector(
      `.patricia-note.is-demo-sticky[data-note-id="${id}"]`
    );
    const btn = note?.querySelector(".patricia-note-close");
    if (!note || !btn) return null;
    const nr = note.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    return {
      width: br.width,
      height: br.height,
      insetRight: nr.right - br.right,
      insetTop: br.top - nr.top,
      fontSize: cs.fontSize,
      color: cs.color
    };
  }, noteId);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await seedEstablished(page);
  await page.goto(`${BASE}/index.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForFunction(() => typeof window.enterDemo === "function", {
    timeout: 20000
  });

  const cases = [
    ["journey", "journeyFirst"],
    ["goals", "goalsFirst"],
    ["pension", "pensionFirst"]
  ];

  for (const [pageId, noteId] of cases) {
    await openDemoPage(page, pageId, noteId);
    const m = await closeMetrics(page, noteId);
    assert.ok(m, `${noteId} close metrics`);
    assert.ok(m.width >= 44 && m.height >= 44, `${noteId} touch target`);
    /* ~7% of ~268px ≈ 19px previously; +11px ≈ 30px from paper edge to button box. */
    assert.ok(m.insetRight >= 26, `${noteId} right inset ${m.insetRight}`);
    assert.ok(m.insetTop >= 10, `${noteId} top inset ${m.insetTop}`);
    assert.match(m.fontSize, /19px/);
    assert.match(m.color, /92,\s*58,\s*46|5c3a2e/i);
    console.log(`PASS: ${noteId} close inset R=${m.insetRight.toFixed(1)} T=${m.insetTop.toFixed(1)}`);
  }

  await browser.close();
  console.log("PASS: demo sticky close spacing");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
