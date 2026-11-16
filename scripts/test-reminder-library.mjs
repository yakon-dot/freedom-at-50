/**
 * Approved monthly reminder library (36 messages) + shuffled cycle rotation.
 * Confirms pool size/wording contracts, no-repeat within a cycle, cycle-boundary
 * avoid-last-as-first, and localStorage persistence across reloads.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const APPROVED = {
  patricia: [
    "That nudge was me. Freedom just keeps the door open — update a Journey or Goal if anything’s moved.",
    "Monthly check-in, as promised. Have a peek at your Journeys and Goals when you’re ready.",
    "Freedom pinged you because I asked. No drama — just a soft reminder to keep Journeys and Goals current.",
    "Surprise, it’s me again. If anything’s shifted, give your Journeys and Goals a quick once-over.",
    "That little ping? Entirely intentional. Pop into Journeys and Goals whenever you’ve got a minute.",
    "I kept my promise. Freedom brought you back; I’ll wait while you check Journeys and Goals.",
    "Not a lecture, just a hello. Update a Journey or Goal if life has moved the furniture around.",
    "Your monthly drop-in has arrived. Journeys and Goals are right there when you fancy a tidy-up.",
    "Freedom opened the door. I’m the one waving. Review Journeys and Goals if anything needs catching up.",
    "Still cheeky, still on your side. Glance at Journeys and Goals when you can be bothered.",
    "That notification was my idea. No rush. Just keep Journeys and Goals roughly in touch with real life.",
    "One calm check-in, then I’m quiet again. Nudge Journeys or Goals if something’s changed since last month."
  ],
  veronica: [
    "Freedom sent that gentle reminder so your plan doesn’t drift. Update your Journeys and Goals when you have a moment.",
    "A quiet monthly check-in. A small update to your Journeys or Goals is plenty.",
    "That was your monthly nudge. Whenever you’re ready, review your Journeys and Goals.",
    "Freedom brought you home for a soft check-in. Your Journeys and Goals can wait until you feel ready.",
    "Just a monthly visit, nothing more. If anything has changed, a light touch on Journeys or Goals will do.",
    "You’re not behind. This is only a reminder. Look over Journeys and Goals when you have a little space.",
    "Freedom held the door open for you. If anything has changed, refresh your Journeys and Goals.",
    "A gentle hello from me. Take a breath, then update Journeys or Goals if anything has moved.",
    "Your plan is still yours. This check-in is simply an invitation to glance at Journeys and Goals.",
    "No pressure at all. Freedom reminded you so Journeys and Goals can stay in step with life.",
    "I’m here if you want company while you look. Journeys and Goals are ready whenever you are.",
    "One soft monthly touchpoint. Review Journeys and Goals whenever that feels comfortable."
  ],
  kevin: [
    "That was your monthly Freedom check-in. Update Journeys and Goals if anything’s changed.",
    "Freedom nudged you on purpose. Update Journeys and Goals if anything’s moved, then you’re good.",
    "Monthly reminder delivered. Review Journeys and Goals and adjust what’s moved.",
    "Freedom brought you in for the monthly check. If numbers or plans have moved, update Journeys and Goals.",
    "Right on schedule. Open Journeys and Goals and tidy anything that’s out of date.",
    "Check-in complete on Freedom’s side. Your turn: scan Journeys and Goals for what’s changed.",
    "That was the monthly reminder doing its job. Update Journeys or Goals where life has moved on.",
    "Worth a short look. Journeys and Goals stay useful when they match what’s actually happening.",
    "Freedom opened Home for a reason. Review Journeys and Goals, then carry on.",
    "Monthly loop, no fuss. If anything’s shifted, put it into Journeys and Goals.",
    "Reminder received. Take a short look at Journeys and Goals and correct what needs correcting.",
    "That’s your check-in. Bring Journeys and Goals in line with the latest picture, and you’re set."
  ]
};

const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /freedom50-reminder-checkin-rotation-v1/);
assert.match(index, /shufflePoolIndices/);
assert.match(index, /FreedomMonthlyReminderCheckIn/);
assert.match(index, /"freedom50-reminder-checkin-rotation-v1"/);
for (const companion of Object.keys(APPROVED)) {
  for (const line of APPROVED[companion]) {
    assert.ok(
      index.includes(JSON.stringify(line).slice(1, -1)) || index.includes(line),
      `missing approved ${companion} line: ${line.slice(0, 48)}…`
    );
  }
}
console.log("PASS: source contracts for approved 36-message library + rotation key");

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
const ROTATION_KEY = "freedom50-reminder-checkin-rotation-v1";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () =>
      typeof window.FreedomMonthlyReminderCheckIn === "object" &&
      typeof window.FreedomMonthlyReminderCheckIn.pickLine === "function",
    { timeout: 20000 }
  );

  const poolCheck = await page.evaluate(approved => {
    const api = window.FreedomMonthlyReminderCheckIn;
    const out = {};
    for (const id of Object.keys(approved)) {
      const pool = api.pools[id] || [];
      out[id] = {
        length: pool.length,
        exact: JSON.stringify(pool) === JSON.stringify(approved[id])
      };
    }
    return out;
  }, APPROVED);
  for (const id of Object.keys(APPROVED)) {
    assert.equal(poolCheck[id].length, 12, `${id} pool size`);
    assert.equal(poolCheck[id].exact, true, `${id} pool wording must match approved addendum`);
  }
  console.log("PASS: live pools are exact 12×3 approved messages");

  /* Full cycle: every message once, no repeats; companions independent. */
  const cycle = await page.evaluate(key => {
    const api = window.FreedomMonthlyReminderCheckIn;
    localStorage.removeItem(key);
    localStorage.removeItem("freedom50-reminder-checkin-last-line-v1");
    const result = {};
    for (const companion of ["patricia", "veronica", "kevin"]) {
      const seen = new Set();
      const messages = [];
      const indices = [];
      for (let i = 0; i < 12; i++) {
        const picked = api.pickLine(companion);
        messages.push(picked.message);
        indices.push(picked.index);
        seen.add(picked.index);
      }
      const state = JSON.parse(localStorage.getItem(key) || "{}");
      result[companion] = {
        uniqueCount: seen.size,
        indices,
        messages,
        next: state[companion] && state[companion].next,
        order: state[companion] && state[companion].order
      };
    }
    return result;
  }, ROTATION_KEY);

  for (const companion of ["patricia", "veronica", "kevin"]) {
    assert.equal(cycle[companion].uniqueCount, 12, `${companion} no repeats in cycle`);
    assert.equal(cycle[companion].next, 12, `${companion} cycle exhausted`);
    assert.equal(cycle[companion].indices.length, 12);
    const sorted = cycle[companion].indices.slice().sort((a, b) => a - b);
    assert.deepEqual(sorted, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (let i = 0; i < 12; i++) {
      assert.equal(
        cycle[companion].messages[i],
        APPROVED[companion][cycle[companion].indices[i]]
      );
    }
  }
  console.log("PASS: each companion delivers all 12 once per shuffled cycle");

  /* Next cycle must not start with previous cycle's last message. */
  const boundary = await page.evaluate(key => {
    const api = window.FreedomMonthlyReminderCheckIn;
    const out = {};
    for (const companion of ["patricia", "veronica", "kevin"]) {
      const before = JSON.parse(localStorage.getItem(key) || "{}")[companion];
      const lastOfPrev = before.order[before.order.length - 1];
      /* Force reshuffle attempts that would otherwise put last-of-prev first. */
      const forced = [];
      for (let n = 0; n < 40; n++) {
        forced.push(api.shufflePoolIndices(12, lastOfPrev)[0]);
      }
      const nextPick = api.pickLine(companion);
      out[companion] = {
        lastOfPrev,
        nextFirst: nextPick.index,
        forcedFirstNeverLast: forced.every(i => i !== lastOfPrev)
      };
    }
    return out;
  }, ROTATION_KEY);
  for (const companion of ["patricia", "veronica", "kevin"]) {
    assert.notEqual(
      boundary[companion].nextFirst,
      boundary[companion].lastOfPrev,
      `${companion} new cycle must not start with previous last`
    );
    assert.equal(boundary[companion].forcedFirstNeverLast, true);
  }
  console.log("PASS: new cycle never starts with previous cycle's last message");

  /* Persist mid-cycle across reload (simulates close/reopen). */
  const midState = await page.evaluate(key => {
    const api = window.FreedomMonthlyReminderCheckIn;
    localStorage.removeItem(key);
    const delivered = [];
    for (let i = 0; i < 5; i++) {
      delivered.push(api.pickLine("patricia").index);
    }
    return {
      delivered,
      raw: localStorage.getItem(key)
    };
  }, ROTATION_KEY);
  assert.equal(midState.delivered.length, 5);
  assert.ok(midState.raw);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () =>
      typeof window.FreedomMonthlyReminderCheckIn === "object" &&
      typeof window.FreedomMonthlyReminderCheckIn.pickLine === "function",
    { timeout: 20000 }
  );

  const afterReload = await page.evaluate((key, prior, priorRaw) => {
    const api = window.FreedomMonthlyReminderCheckIn;
    const storedBeforePicks = localStorage.getItem(key);
    const entry = JSON.parse(storedBeforePicks || "{}").patricia || {};
    const rest = [];
    for (let i = 0; i < 7; i++) {
      rest.push(api.pickLine("patricia").index);
    }
    const all = prior.concat(rest);
    return {
      rawMatchesPrior: storedBeforePicks === priorRaw,
      nextBeforePicks: entry.next,
      rest,
      all,
      unique: new Set(all).size,
      next: JSON.parse(localStorage.getItem(key) || "{}").patricia?.next
    };
  }, ROTATION_KEY, midState.delivered, midState.raw);

  assert.equal(afterReload.rawMatchesPrior, true, "rotation JSON survives reload");
  assert.equal(afterReload.nextBeforePicks, 5);
  assert.equal(afterReload.unique, 12, "full cycle unique across reload boundary");
  assert.equal(afterReload.next, 12);
  for (const idx of midState.delivered) {
    assert.equal(afterReload.rest.includes(idx), false, `must not repeat pre-reload index ${idx}`);
  }
  console.log("PASS: rotation progress persists across reload / app session");

  await browser.close();
  console.log("PASS: monthly reminder library rotation");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
