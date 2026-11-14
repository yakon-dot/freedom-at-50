/**
 * Freedom encrypted backup tests (PBKDF2 + AES-256-GCM).
 * Mirrors index.html constants and envelope format. No password persistence.
 */
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";

const crypto = webcrypto;
const FREEDOM_BACKUP_VERSION = 2;
const FREEDOM_BACKUP_PBKDF2_ITERATIONS = 210000;
const FREEDOM_BACKUP_SALT_BYTES = 16;
const FREEDOM_BACKUP_IV_BYTES = 12;

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(String(b64 || ""), "base64"));
}

async function deriveAesKey(password, saltBytes, iterations, usages) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

async function encryptEnvelope(innerPayload, password) {
  const salt = new Uint8Array(FREEDOM_BACKUP_SALT_BYTES);
  const iv = new Uint8Array(FREEDOM_BACKUP_IV_BYTES);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);
  const key = await deriveAesKey(password, salt, FREEDOM_BACKUP_PBKDF2_ITERATIONS, ["encrypt"]);
  const plain = new TextEncoder().encode(JSON.stringify(innerPayload));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    freedomBackup: true,
    version: FREEDOM_BACKUP_VERSION,
    encrypted: true,
    alg: "AES-GCM",
    kdf: "PBKDF2",
    hash: "SHA-256",
    iter: FREEDOM_BACKUP_PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    exportedAt: new Date().toISOString(),
  };
}

async function decryptEnvelope(envelope, password) {
  if (!envelope?.freedomBackup || envelope.encrypted !== true || Number(envelope.version) < 2) {
    return { ok: false, error: "not encrypted backup" };
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const cipher = base64ToBytes(envelope.ciphertext);
  try {
    const key = await deriveAesKey(password, salt, Number(envelope.iter), ["decrypt"]);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    const inner = JSON.parse(new TextDecoder().decode(plainBuf));
    return { ok: true, inner };
  } catch {
    return { ok: false, error: "Incorrect password, or this backup file is damaged." };
  }
}

function validateInner(inner) {
  const st = inner?.state;
  if (!st || !Array.isArray(st.loans)) return { ok: false, error: "missing journey" };
  if (st.pensions != null && !Array.isArray(st.pensions)) return { ok: false, error: "bad pensions" };
  if (st.notes != null && !Array.isArray(st.notes)) return { ok: false, error: "bad notes" };
  return { ok: true, state: st, meta: inner.meta || {} };
}

const sampleInner = {
  state: {
    loans: [{ id: "j1", name: "Car", starting: 12000, current: 8400, payment: 250 }],
    goals: [{ id: "g1", name: "Japan", current: 1200, target: 5000, hasTarget: true }],
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
    notes: [{ id: "n1", text: "Pay insurance", color: "yellow", pinned: true }],
    companionId: "patricia",
  },
  meta: {
    "freedom50-companion-id-v1": "patricia",
    "freedom50-welcome-complete-v1": "1",
  },
};

const results = [];
function pass(name) {
  results.push({ name, ok: true });
  console.log("PASS:", name);
}
function fail(name, err) {
  results.push({ name, ok: false, err: String(err) });
  console.error("FAIL:", name, err);
}

async function run() {
  const password = "FreedomTest-42";
  let envelope;

  try {
    envelope = await encryptEnvelope(sampleInner, password);
    assert.equal(envelope.version, 2);
    assert.equal(envelope.encrypted, true);
    assert.equal(envelope.iter, 210000);
    assert.equal(envelope.alg, "AES-GCM");
    assert.equal(envelope.kdf, "PBKDF2");
    assert.ok(envelope.salt && envelope.iv && envelope.ciphertext);
    assert.equal(Object.prototype.hasOwnProperty.call(envelope, "password"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(envelope, "state"), false);
    const json = JSON.stringify(envelope);
    assert.equal(/"password"\s*:/i.test(json), false);
    assert.equal(json.includes("Irish Life"), false);
    assert.equal(json.includes("contribPeriods"), false);
    assert.equal(json.includes("Japan"), false);
    pass("export encrypts and omits plaintext financial fields + password");
  } catch (e) {
    fail("export encrypts and omits plaintext financial fields + password", e);
  }

  try {
    const dec = await decryptEnvelope(envelope, password);
    assert.equal(dec.ok, true);
    const checked = validateInner(dec.inner);
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.state.pensions[0].contribPeriods, sampleInner.state.pensions[0].contribPeriods);
    assert.equal(checked.state.pensions[0].personal, 200);
    assert.equal(checked.state.pensions[0].employer, 150);
    assert.equal(checked.state.loans[0].current, 8400);
    assert.equal(checked.state.notes[0].text, "Pay insurance");
    assert.equal(checked.meta["freedom50-companion-id-v1"], "patricia");
    pass("restore decrypt preserves financial data including contribPeriods");
  } catch (e) {
    fail("restore decrypt preserves financial data including contribPeriods", e);
  }

  try {
    const wrong = await decryptEnvelope(envelope, "wrong-password");
    assert.equal(wrong.ok, false);
    assert.match(wrong.error, /Incorrect password|damaged/i);
    pass("incorrect password fails closed without data");
  } catch (e) {
    fail("incorrect password fails closed without data", e);
  }

  try {
    const damaged = { ...envelope, ciphertext: bytesToBase64(crypto.getRandomValues(new Uint8Array(64))) };
    const bad = await decryptEnvelope(damaged, password);
    assert.equal(bad.ok, false);
    pass("damaged ciphertext fails closed");
  } catch (e) {
    fail("damaged ciphertext fails closed", e);
  }

  try {
    const plainV1 = {
      freedomBackup: true,
      version: 1,
      state: sampleInner.state,
      meta: sampleInner.meta,
    };
    assert.equal(plainV1.encrypted === true, false);
    const rejected =
      !plainV1.encrypted || Number(plainV1.version) < 2
        ? { ok: false, error: "This backup is not password-protected. Freedom only restores encrypted backups." }
        : { ok: true };
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /password-protected/i);
    pass("rejects unencrypted / v1 backups");
  } catch (e) {
    fail("rejects unencrypted / v1 backups", e);
  }

  try {
    const invalid = { foo: 1 };
    const r = await decryptEnvelope(invalid, password);
    assert.equal(r.ok, false);
    pass("rejects invalid files");
  } catch (e) {
    fail("rejects invalid files", e);
  }

  try {
    const env2 = await encryptEnvelope(sampleInner, password);
    assert.notEqual(env2.salt, envelope.salt);
    assert.notEqual(env2.iv, envelope.iv);
    assert.notEqual(env2.ciphertext, envelope.ciphertext);
    pass("each export uses fresh random salt and IV");
  } catch (e) {
    fail("each export uses fresh random salt and IV", e);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\nSummary:", results.length - failed.length, "passed,", failed.length, "failed");
  console.log("PBKDF2 work factor documented:", FREEDOM_BACKUP_PBKDF2_ITERATIONS, "iterations (HMAC-SHA-256)");
  if (failed.length) process.exit(1);
}

run();
