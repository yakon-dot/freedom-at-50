/**
 * Notes layout: fixed "+ Add note" stays in place and above Note cards.
 * At rest, the first card starts below the button. While scrolling, cards may
 * pass under it but must not paint over it (stacking).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /#notes \.notes-actions\{/);
assert.match(index, /position:fixed;z-index:20/);
assert.equal(/#notes \.notes-actions\{[^}]*position:sticky/s.test(index), false);
assert.equal(
  /Stationary; under the list so scrolling cards pass over/.test(index),
  false
);
assert.match(
  index,
  /padding:calc\(var\(--notes-safe-top\) \+ var\(--notes-paper-bottom\) \+ 72px\)/
);
console.log("PASS: source contracts for fixed Notes Add button stacking");

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
    const addCard = document.getElementById("addNoteCard");
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
      actionsZ: getComputedStyle(actions).zIndex,
      listZ: getComputedStyle(list).zIndex,
      addCardZ: addCard ? getComputedStyle(addCard).zIndex : "0",
      actionsPosition: getComputedStyle(actions).position,
      titles: cardRects.map(c => c.title),
      cards: cardRects,
      scrollY: window.scrollY || document.scrollingElement?.scrollTop || 0
    };
  });
}

function assertStackingBeatsList(layout, label) {
  const actionsZ = Number(layout.actionsZ);
  const listZ = Number(layout.listZ);
  const addCardZ = Number(layout.addCardZ);
  assert.ok(
    actionsZ > listZ,
    `${label}: Add note stacking (${actionsZ}) must beat list (${listZ})`
  );
  assert.ok(
    actionsZ > addCardZ,
    `${label}: Add note stacking (${actionsZ}) must beat add form (${addCardZ})`
  );
}

function assertCardsBelowButton(layout, label) {
  assert.ok(layout.cards.length >= 1, `${label}: expected note cards`);
  for (const card of layout.cards) {
    assert.ok(
      card.top >= layout.btnBottom - 1,
      `${label}: card "${card.title}" top ${card.top} must be below Add note bottom ${layout.btnBottom}`
    );
  }
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

  /* At rest: fixed button above every card; newest first. */
  let layout = await measureLayout(page);
  assert.equal(layout.actionsPosition, "fixed");
  assert.equal(layout.titles[0], "First Note");
  assert.equal(layout.titles[1], "Second Note");
  assertCardsBelowButton(layout, "initial");
  assertStackingBeatsList(layout, "initial");
  console.log("PASS: initial layout keeps fixed Add note above cards");

  /* Create another note and re-check visual order + scroll stay. */
  const beforeScroll = layout.scrollY;
  await page.evaluate(() => document.getElementById("toggleAddNote")?.click());
  await page.waitForSelector("#addNoteCard:not([hidden]) #newNoteTitle", {
    timeout: 5000
  });
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
  await new Promise(r => setTimeout(r, 150));

  layout = await measureLayout(page);
  assert.equal(layout.titles[0], "Brand New Note");
  assertCardsBelowButton(layout, "after create");
  assertStackingBeatsList(layout, "after create");
  assert.ok(
    Math.abs(layout.scrollY - beforeScroll) < 180,
    `scroll jumped from ${beforeScroll} to ${layout.scrollY}`
  );
  console.log("PASS: after create, fixed Add note still above all cards");

  /* While scrolling, button stays fixed; cards may pass under but not over. */
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
  assertStackingBeatsList(layout, "after scroll");
  const overlapping = layout.cards.filter(
    c => c.top < layout.btnBottom && c.bottom > layout.btnTop
  );
  assert.ok(
    overlapping.length >= 1,
    "expected at least one Note card under the fixed Add note band while scrolling"
  );
  console.log("PASS: fixed Add note stays visible above scrolling Notes");

  await browser.close();
  console.log("PASS: Notes Add button fixed stacking");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
