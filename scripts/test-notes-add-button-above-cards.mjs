/**
 * Notes layout (fixed Add note + Journey/Goals-style card stack):
 * - At the top, the first Note starts directly below "+ Add note".
 * - New Notes insert at the top of the list, still below the button when at top.
 * - While scrolling, cards pass in front of the fixed button (original stacking).
 * - Saving must not leave the newest Note overlapping the button band.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /#notes \.notes-actions\{/);
assert.match(index, /position:fixed;z-index:3/);
assert.match(
  index,
  /Stationary; under the list so scrolling cards pass over/
);
assert.equal(/#notes \.notes-actions\{[^}]*position:sticky/s.test(index), false);
assert.equal(/#notes \.notes-actions\{[^}]*z-index:20/s.test(index), false);
assert.match(
  index,
  /padding:calc\(var\(--notes-safe-top\) \+ var\(--notes-paper-bottom\) \+ 72px\)/
);
assert.match(index, /notesComposeFormBlockHeight/);
assert.match(index, /withNotesScrollPreserved\(\(\)=>\{[\s\S]*?\},-composeShrink\)/);
console.log("PASS: source contracts for Notes list under fixed Add note");

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

function noteFixture(id, title, createdAt) {
  return {
    id,
    title,
    body: `${title} body`,
    color: "yellow",
    pinned: false,
    collapsed: true,
    editing: false,
    createdAt,
    checklist: []
  };
}

const SAVED_STATE = {
  loans: [],
  customGoals: [],
  pensions: [],
  notes: [
    noteFixture("note-d", "Fourth Note", "2026-11-18T15:00:00.000Z"),
    noteFixture("note-c", "Third Note", "2026-11-18T16:00:00.000Z"),
    noteFixture("note-b", "Second Note", "2026-11-18T17:00:00.000Z"),
    noteFixture("note-a", "First Note", "2026-11-18T18:00:00.000Z")
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

async function openNotes(page) {
  await page.evaluate(() => {
    document.body.classList.remove("home183");
    window.hideHome?.();
    window.page("notes");
  });
  await page.waitForSelector("#notes.page.active #toggleAddNote", {
    timeout: 15000
  });
  await page.waitForSelector("#notesList .note-card", { timeout: 15000 });
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const btn = document.getElementById("toggleAddNote");
    const actions = document.querySelector("#notes .notes-actions");
    const list = document.getElementById("notesList");
    const cards = [...document.querySelectorAll("#notesList .note-card")];
    const btnRect = btn.getBoundingClientRect();
    const cardRects = cards.map(card => {
      const r = card.getBoundingClientRect();
      return {
        title: card.querySelector(".note-title")?.textContent?.trim() || "",
        top: r.top,
        bottom: r.bottom
      };
    });
    return {
      btnTop: btnRect.top,
      btnBottom: btnRect.bottom,
      btnCenterX: btnRect.left + btnRect.width / 2,
      btnCenterY: btnRect.top + btnRect.height / 2,
      actionsZ: getComputedStyle(actions).zIndex,
      listZ: getComputedStyle(list).zIndex,
      actionsPosition: getComputedStyle(actions).position,
      titles: cardRects.map(c => c.title),
      cards: cardRects,
      scrollY: window.scrollY || document.scrollingElement?.scrollTop || 0
    };
  });
}

function assertFirstCardBelowButton(layout, label) {
  assert.ok(layout.cards.length >= 1, `${label}: expected note cards`);
  const first = layout.cards[0];
  assert.ok(
    first.top >= layout.btnBottom - 1,
    `${label}: first card "${first.title}" top ${first.top} must be below Add note bottom ${layout.btnBottom}`
  );
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
  await openNotes(page);

  let layout = await measureLayout(page);
  assert.equal(layout.actionsPosition, "fixed");
  assert.equal(Number(layout.actionsZ), 3);
  assert.ok(
    Number(layout.listZ) > Number(layout.actionsZ),
    `list stacking (${layout.listZ}) must beat Add note (${layout.actionsZ}) so cards pass over`
  );
  assert.equal(layout.titles[0], "First Note");
  assertFirstCardBelowButton(layout, "initial");
  console.log("PASS: at top, first Note starts below fixed Add note");

  /* Create while slightly scrolled with compose open — form height must not leave
     the newest Note overlapping the button. */
  await page.evaluate(() => document.getElementById("toggleAddNote")?.click());
  await page.waitForSelector("#addNoteCard:not([hidden]) #newNoteTitle", {
    timeout: 5000
  });
  await page.evaluate(() => window.scrollTo({ top: 80, behavior: "instant" }));
  await new Promise(r => setTimeout(r, 80));
  await page.evaluate(() => {
    const titleEl = document.getElementById("newNoteTitle");
    const bodyEl = document.getElementById("newNoteBody");
    titleEl.value = "Brand New Note";
    titleEl.dispatchEvent(new Event("input", { bubbles: true }));
    bodyEl.value = "Fresh";
    bodyEl.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("addNote")?.click();
  });
  await page.waitForFunction(
    () =>
      (JSON.parse(localStorage.getItem("freedom50-mobile-v1")).notes || []).some(
        n => n && n.title === "Brand New Note"
      ),
    { timeout: 8000 }
  );
  await new Promise(r => setTimeout(r, 180));

  layout = await measureLayout(page);
  assert.equal(layout.titles[0], "Brand New Note");
  assertFirstCardBelowButton(layout, "after create with compose scroll");
  console.log("PASS: after create, newest Note starts below Add note");

  /* Second create from the true top. */
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await new Promise(r => setTimeout(r, 80));
  await page.evaluate(() => document.getElementById("toggleAddNote")?.click());
  await page.waitForSelector("#addNoteCard:not([hidden]) #newNoteTitle", {
    timeout: 5000
  });
  await page.evaluate(() => {
    const titleEl = document.getElementById("newNoteTitle");
    const bodyEl = document.getElementById("newNoteBody");
    titleEl.value = "Second New Note";
    titleEl.dispatchEvent(new Event("input", { bubbles: true }));
    bodyEl.value = "Again";
    bodyEl.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("addNote")?.click();
  });
  await page.waitForFunction(
    () =>
      (JSON.parse(localStorage.getItem("freedom50-mobile-v1")).notes || []).some(
        n => n && n.title === "Second New Note"
      ),
    { timeout: 8000 }
  );
  await new Promise(r => setTimeout(r, 180));
  layout = await measureLayout(page);
  assert.equal(layout.titles[0], "Second New Note");
  assertFirstCardBelowButton(layout, "after second create at top");
  console.log("PASS: multiple creates keep newest Note below Add note at top");

  /* While scrolling, cards pass in front of the fixed button. */
  const fixedTop = layout.btnTop;
  await page.mouse.wheel({ deltaY: 320 });
  await new Promise(r => setTimeout(r, 120));
  layout = await measureLayout(page);
  assert.ok(layout.scrollY > 40, `expected some scroll, got ${layout.scrollY}`);
  assert.equal(layout.actionsPosition, "fixed");
  assert.ok(
    Math.abs(layout.btnTop - fixedTop) < 2,
    `fixed Add note moved from ${fixedTop} to ${layout.btnTop}`
  );
  const overlapping = layout.cards.filter(
    c => c.top < layout.btnBottom && c.bottom > layout.btnTop
  );
  assert.ok(
    overlapping.length >= 1,
    "expected at least one Note card overlapping the fixed Add note band while scrolling"
  );
  const topEl = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return {
      id: el.id || "",
      className: typeof el.className === "string" ? el.className : "",
      inCard: !!el.closest("#notesList .note-card")
    };
  }, { x: layout.btnCenterX, y: layout.btnCenterY });
  assert.ok(
    topEl && topEl.inCard,
    `expected a Note card in front of Add note while scrolling, got ${JSON.stringify(topEl)}`
  );
  console.log("PASS: while scrolling, Notes pass in front of fixed Add note");

  await browser.close();
  console.log("PASS: Notes list positioning under fixed Add note");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
