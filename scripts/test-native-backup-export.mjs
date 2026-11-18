/**
 * Native encrypted backup delivery + password visibility contracts.
 * Encryption format stays covered by test-encrypted-backup.mjs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const nativeSrc = fs.readFileSync(path.join(root, "freedom-native-backup.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-capacitor-web.mjs"), "utf8");
const capAppSpm = fs.readFileSync(
  path.join(root, "ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift"),
  "utf8"
);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(index, /freedom-native-backup\.js/);
assert.match(index, /freedomDeliverEncryptedBackupFile/);
assert.match(index, /FreedomNativeBackup\.shareEncryptedJson/);
assert.match(index, /iOS share sheet/);
assert.match(index, /Export cancelled\. No backup file was saved/);
assert.match(index, /freedomBackupPassVisibility/);
assert.match(index, /freedomBackupPassConfirmVisibility/);
assert.match(index, /Show password/);
assert.match(index, /Hide password/);
assert.match(index, /wireFreedomBackupPasswordVisibility/);
assert.match(index, /resetFreedomBackupPasswordVisibility/);
assert.match(sw, /freedom-native-backup\.js/);
assert.match(sw, /freedom-at-50-v1\.8\.6\.163/);
assert.match(prepare, /freedom-native-backup\.js/);
assert.equal(!!pkg.dependencies["@capacitor/share"], true);
assert.match(capAppSpm, /import SharePlugin/);
assert.match(capAppSpm, /SharePlugin\.self/);
assert.match(nativeSrc, /getCapPlugin\("Share",\s*"share"\)/);
assert.match(nativeSrc, /getCapPlugin\("Filesystem",\s*"writeFile"\)/);
assert.match(nativeSrc, /registerPlugin\(name\)/);
assert.match(nativeSrc, /CACHE/);
assert.equal(/a\.download/.test(nativeSrc), false, "Native module must not rely on <a download>");
/* PWA download path must remain for non-native. */
assert.match(index, /a\.download=filename/);
assert.match(index, /mode:"download"/);
console.log("PASS: source contracts for native backup export + password visibility");

function loadApi(capacitorMock) {
  const sandbox = {
    window: {},
    globalThis: {},
    console,
    String,
    Object,
    Promise,
    Error,
    Number,
    Array,
    RegExp
  };
  sandbox.window.Capacitor = capacitorMock;
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(nativeSrc, sandbox, { filename: "freedom-native-backup.js" });
  return sandbox.window.FreedomNativeBackup;
}

{
  const api = loadApi(undefined);
  assert.equal(api.isNative(), false);
  const skipped = await api.shareEncryptedJson("{}", "freedom-backup.json");
  assert.equal(skipped.skipped, true);
}

{
  const writes = [];
  const shares = [];
  const plugin = {
    writeFile: async (opts) => {
      writes.push(opts);
      return { uri: "file:///tmp/" + opts.path };
    },
    getUri: async (opts) => ({ uri: "file:///tmp/" + opts.path }),
    share: async (opts) => {
      shares.push(opts);
      return {};
    }
  };
  const api = loadApi({
    isNativePlatform: () => true,
    Plugins: { Filesystem: plugin, Share: plugin },
    registerPlugin: () => plugin
  });
  const json = JSON.stringify({ freedomBackup: true, encrypted: true, version: 2 });
  const ok = await api.shareEncryptedJson(json, "freedom-backup-2026-11-18.json");
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, "share");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].directory, "CACHE");
  assert.equal(writes[0].encoding, "utf8");
  assert.equal(writes[0].data, json);
  assert.equal(shares.length, 1);
  assert.match(shares[0].url, /freedom-backup-2026-11-18\.json/);
}

{
  const plugin = {
    writeFile: async () => ({ uri: "file:///tmp/x.json" }),
    getUri: async () => ({ uri: "file:///tmp/x.json" }),
    share: async () => {
      const err = new Error("Share cancelled");
      err.code = "SHARE_CANCELLED";
      throw err;
    }
  };
  const api = loadApi({
    isNativePlatform: () => true,
    Plugins: { Filesystem: plugin, Share: plugin },
    registerPlugin: () => plugin
  });
  const cancelled = await api.shareEncryptedJson("{}", "freedom-backup.json");
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.cancelled, true);
  assert.match(cancelled.error, /cancelled/i);
}

{
  const plugin = {
    writeFile: async () => {
      throw new Error("disk full");
    },
    share: async () => ({})
  };
  const api = loadApi({
    isNativePlatform: () => true,
    Plugins: { Filesystem: plugin, Share: plugin },
    registerPlugin: () => plugin
  });
  const failed = await api.shareEncryptedJson("{}", "freedom-backup.json");
  assert.equal(failed.ok, false);
  assert.equal(!!failed.cancelled, false);
  assert.match(failed.error, /could not write/i);
}

assert.equal(loadApi(undefined).isShareCancelled({ message: "cancelled by user" }), true);
assert.equal(loadApi(undefined).isShareCancelled({ message: "network" }), false);

console.log("PASS: native backup share, cancel, and write-failure paths");
