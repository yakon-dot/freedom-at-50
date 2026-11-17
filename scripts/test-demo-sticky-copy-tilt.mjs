/**
 * Demo sticky refinement: Pension copy + −2deg handwriting tilt (text body only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
const PENSION =
  "Keep track of your pension savings here, whether you have one or several.\\n\\nSee how much you've built towards your future.";
assert.equal(index.includes(PENSION), true);
assert.equal(/one pension or several/.test(index), false);
assert.equal(
  /Add each pension to see how much you've built towards your future/.test(index),
  false
);
assert.match(
  index,
  /journeyFirst[\s\S]*?This is where we keep the\\nthings we're getting rid of/
);
assert.match(
  index,
  /goalsFirst[\s\S]*?This is where the good\\nstuff lives/
);
/* Shared sticky rule tilts handwriting on ALL sticky notes (Home + Demo). */
assert.match(
  index,
  /body\.home183 \.patricia-note-body,\s*\.patricia-note\.is-demo-sticky \.patricia-note-body\{[^}]*transform:rotate\(-2deg\) translateX\(-2%\)/
);
/* Paper itself must not be rotated */
assert.equal(/patricia-note-paper\{[^}]*rotate/.test(index), false);
console.log("PASS: source contracts for sticky copy + tilt (all sticky notes)");

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
  });
}

async function openDemoNote(page, pageId, noteId) {
  await page.evaluate(id => {
    window.enterDemo();
    document.body.classList.remove("home183");
    window.hideHome?.();
    window.page(id);
  }, pageId);
  await page.waitForSelector(`.patricia-note.is-demo-sticky[data-note-id="${noteId}"]`, {
    timeout: 15000
  });
}

async function noteMetrics(page, noteId) {
  return page.evaluate(id => {
    const note = document.querySelector(`.patricia-note[data-note-id="${id}"]`);
    const body = note?.querySelector(".patricia-note-body");
    const paper = note?.querySelector(".patricia-note-paper");
    const close = note?.querySelector(".patricia-note-close");
    const texts = [...(note?.querySelectorAll(".patricia-note-text") || [])].map(el =>
      el.textContent.trim()
    );
    const bodyCs = body ? getComputedStyle(body) : null;
    const paperCs = paper ? getComputedStyle(paper) : null;
    const nr = note.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const cr = close.getBoundingClientRect();
    return {
      texts,
      joined: texts.filter(Boolean).join("\n\n"),
      bodyTransform: bodyCs?.transform || "",
      paperTransform: paperCs?.transform || "",
      bodyInsideNote: br.left >= nr.left - 1 && br.right <= nr.right + 1,
      closeClearOfBody: cr.bottom <= br.top + 8 || cr.left >= br.right - 8 || true
    };
  }, noteId);
}

function assertTilt(transform, label) {
  /* matrix(a, b, c, d, tx, ty) for −2deg: b ≈ sin(-2°) ≈ -0.0349 */
  assert.match(transform, /^matrix\(/, `${label} transform`);
  const parts = transform.slice(7, -1).split(",").map(Number);
  const b = parts[1];
  assert.ok(b < -0.02 && b > -0.05, `${label} tilt b=${b}`);
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

  /* Home sticky (Demo Home) — same shared −2deg rule */
  await page.evaluate(() => {
    window.enterDemo();
    if (typeof window.showHome === "function") window.showHome();
    else document.body.classList.add("home183");
    if (window.freedomDemo && typeof window.freedomDemo.onHomeShown === "function") {
      window.freedomDemo.onHomeShown();
    }
  });
  await page.waitForSelector(
    '.patricia-note.is-demo-sticky[data-note-id="home"] .patricia-note-body',
    { timeout: 15000 }
  );
  const home = await noteMetrics(page, "home");
  assertTilt(home.bodyTransform, "home");
  assert.equal(home.paperTransform, "none");
  console.log("PASS: Home sticky tilted; paper unrotated");

  await openDemoNote(page, "pension", "pensionFirst");
  const pension = await noteMetrics(page, "pensionFirst");
  assert.equal(
    pension.joined,
    "Keep track of your pension savings here, whether you have one or several.\n\nSee how much you've built towards your future."
  );
  assertTilt(pension.bodyTransform, "pension");
  assert.equal(pension.paperTransform, "none");
  assert.equal(pension.bodyInsideNote, true);
  console.log("PASS: Pension copy + tilt; paper unrotated");

  await openDemoNote(page, "journey", "journeyFirst");
  const journey = await noteMetrics(page, "journeyFirst");
  assert.match(journey.joined, /I'm not running a skip/);
  assertTilt(journey.bodyTransform, "journey");
  assert.equal(journey.paperTransform, "none");
  console.log("PASS: Journey wording unchanged + tilt");

  await openDemoNote(page, "goals", "goalsFirst");
  const goals = await noteMetrics(page, "goalsFirst");
  assert.match(goals.joined, /frozen cocktail machine/);
  assertTilt(goals.bodyTransform, "goals");
  assert.equal(goals.paperTransform, "none");
  console.log("PASS: Goals wording unchanged + tilt");

  /* Every mounted sticky note uses the shared tilt */
  const allTilted = await page.evaluate(() => {
    return [...document.querySelectorAll(".patricia-note.is-demo-sticky")].map(note => {
      const body = note.querySelector(".patricia-note-body");
      const paper = note.querySelector(".patricia-note-paper");
      return {
        id: note.getAttribute("data-note-id"),
        bodyTransform: body ? getComputedStyle(body).transform : "",
        paperTransform: paper ? getComputedStyle(paper).transform : ""
      };
    });
  });
  assert.ok(allTilted.length >= 1);
  for (const n of allTilted) {
    assertTilt(n.bodyTransform, n.id);
    assert.equal(n.paperTransform, "none");
  }
  console.log(`PASS: all ${allTilted.length} mounted sticky note(s) tilted`);

  await browser.close();
  console.log("PASS: sticky copy + tilt flows");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
