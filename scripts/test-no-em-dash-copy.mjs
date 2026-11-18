/**
 * Freedom copy rule: no em dashes (U+2014) in user-facing app text.
 * Block comments may still use them for developer notes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const EM = "\u2014";

function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}

function stripStyleTags(source) {
  return source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function assertNoEmDash(label, source) {
  const cleaned = stripStyleTags(stripHtmlComments(stripBlockComments(source)));
  const idx = cleaned.indexOf(EM);
  if (idx >= 0) {
    const start = Math.max(0, idx - 50);
    const end = Math.min(cleaned.length, idx + 50);
    const snippet = cleaned.slice(start, end).replace(/\s+/g, " ");
    assert.fail(`${label} still contains an em dash near: …${snippet}…`);
  }
}

const index = fs.readFileSync("index.html", "utf8");
assertNoEmDash("index.html", index);

const nativeBackup = fs.readFileSync("freedom-native-backup.js", "utf8");
assertNoEmDash("freedom-native-backup.js", nativeBackup);

/* Explicit contracts for previously found user-facing strings */
assert.equal(index.includes("Encryption happens on this device —"), false);
assert.equal(index.includes("Export cancelled —"), false);
assert.match(index, /Encryption happens on this device\. Freedom does not upload/);
assert.match(index, /Export cancelled\. No backup file was saved\./);
assert.match(
  nativeBackup,
  /Export cancelled\. No backup file was saved\./
);

console.log("PASS: no em dashes in user-facing Freedom copy");
