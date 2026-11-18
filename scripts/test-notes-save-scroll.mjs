/**
 * Creating/saving Notes must not jump the page to the top.
 * New Notes stay first under "+ Add note"; existing order otherwise preserved.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /function withNotesScrollPreserved/);
assert.match(index, /function restoreNotesScrollPos/);
assert.match(index, /function saveComposeNote/);
assert.match(index, /state\.notes\.unshift\(note\)/);
assert.match(index, /focus\(\{preventScroll:true\}\)/);
assert.equal(/window\.scrollTo\(\{top:0,behavior:"smooth"\}\)/.test(index), false);
assert.equal(/openAddNoteForm[\s\S]{0,400}window\.scrollTo\(\{top:0/.test(index), false);
console.log("PASS: source contracts for Notes save scroll");

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

function noteFixture(id, title, createdAt, extras = {}) {
  return {
    id,
    title,
    body: `${title} body`,
    color: "yellow",
    pinned: false,
    collapsed: true,
    editing: false,
    createdAt,
    checklist: [],
    ...extras
  };
}

const SAVED_STATE = {
  loans: [],
  customGoals: [],
  pensions: [],
  notes: [
    noteFixture("note-old-1", "Older Note One", "2024-01-01T12:00:00.000Z"),
    noteFixture("note-old-2", "Older Note Two", "2024-01-02T12:00:00.000Z"),
    noteFixture("note-old-3", "Older Note Three", "2024-01-03T12:00:00.000Z"),
    noteFixture("note-old-4", "Older Note Four", "2024-01-04T12:00:00.000Z"),
    noteFixture("note-old-5", "Older Note Five", "2024-01-05T12:00:00.000Z")
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
  await page.waitForSelector("#notes.page.active #notesList .note-card", {
    timeout: 15000
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
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await seedEstablished(page, SAVED_STATE);
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitHome(page);
  await openNotes(page);

  /* Scroll away from the top (wheel is reliable in this headless mobile viewport). */
  await page.mouse.wheel({ deltaY: 900 });
  await new Promise(r => setTimeout(r, 120));
  const beforeScroll = await page.evaluate(
    () => window.scrollY || document.scrollingElement?.scrollTop || 0
  );
  assert.ok(beforeScroll >= 200, `expected scrolled page, got ${beforeScroll}`);

  async function createNote(title) {
    await page.evaluate(() => {
      document.getElementById("toggleAddNote")?.click();
    });
    await page.waitForSelector("#addNoteCard:not([hidden]) #newNoteTitle", {
      timeout: 5000
    });
    const midScroll = await page.evaluate(
      () => window.scrollY || document.scrollingElement?.scrollTop || 0
    );
    assert.ok(
      midScroll > 120,
      `opening Add note jumped toward top from ${beforeScroll} to ${midScroll}`
    );
    await page.evaluate(t => {
      const titleEl = document.getElementById("newNoteTitle");
      const bodyEl = document.getElementById("newNoteBody");
      titleEl.value = t;
      titleEl.dispatchEvent(new Event("input", { bubbles: true }));
      bodyEl.value = `${t} details`;
      bodyEl.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("addNote")?.click();
    }, title);
    await page.waitForFunction(
      t => {
        const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1") || "{}");
        return (st.notes || []).some(n => n && n.title === t);
      },
      { timeout: 8000 },
      title
    );
    await new Promise(r => setTimeout(r, 180));
    const after = await page.evaluate(
      () => window.scrollY || document.scrollingElement?.scrollTop || 0
    );
    assert.ok(
      after > 120,
      `saving note jumped toward top from ${beforeScroll} to ${after}`
    );
    assert.ok(
      Math.abs(after - beforeScroll) < 180,
      `saving note shifted scroll too far from ${beforeScroll} to ${after}`
    );
  }

  await createNote("Fresh Note A");
  await createNote("Fresh Note B");

  const order = await page.evaluate(() => {
    const titles = [...document.querySelectorAll("#notesList .note-card .note-title, #notesList .note-card [data-note-title]")]
      .map(el => (el.value || el.textContent || "").trim())
      .filter(Boolean);
    const st = JSON.parse(localStorage.getItem("freedom50-mobile-v1"));
    return {
      titles,
      ids: (st.notes || []).map(n => n.id),
      noteTitles: (st.notes || []).map(n => n.title)
    };
  });

  assert.equal(order.noteTitles[0], "Fresh Note B");
  assert.equal(order.noteTitles[1], "Fresh Note A");
  assert.ok(order.noteTitles.includes("Older Note Five"));
  assert.equal(order.noteTitles.length, 7);

  /* Editing an existing note should also keep scroll. */
  await page.mouse.wheel({ deltaY: 500 });
  await new Promise(r => setTimeout(r, 120));
  const editBefore = await page.evaluate(
    () => window.scrollY || document.scrollingElement?.scrollTop || 0
  );
  assert.ok(editBefore >= 100, `expected scrolled page before edit, got ${editBefore}`);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll("#notesList .note-card")].find(el =>
      (el.textContent || "").includes("Older Note Five")
    );
    if (!card) return;
    if (card.classList.contains("is-collapsed")) {
      card.querySelector("[data-toggle-note]")?.click();
    }
  });
  await page.waitForSelector('#notesList .note-card:not(.is-collapsed) [data-note-edit]', {
    timeout: 5000
  });
  await page.evaluate(() => {
    const card = [...document.querySelectorAll("#notesList .note-card")].find(el =>
      (el.textContent || "").includes("Older Note Five")
    );
    card?.querySelector("[data-note-edit]")?.click();
  });
  await page.waitForSelector("#notesList [data-note-title]", { timeout: 5000 });
  await page.evaluate(() => {
    const input = document.querySelector("#notesList [data-note-title]");
    if (!input) return;
    input.value = "Older Note Five Edited";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () =>
      (JSON.parse(localStorage.getItem("freedom50-mobile-v1")).notes || []).some(
        n => n && n.title === "Older Note Five Edited"
      ),
    { timeout: 8000 }
  );
  await new Promise(r => setTimeout(r, 180));
  const editAfter = await page.evaluate(
    () => window.scrollY || document.scrollingElement?.scrollTop || 0
  );
  assert.ok(
    editAfter > 80,
    `editing note jumped toward top from ${editBefore} to ${editAfter}`
  );

  console.log("PASS: creating multiple Notes preserves scroll and top order");
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
