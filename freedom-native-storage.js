/**
 * Freedom native storage safeguard (Capacitor iOS only).
 *
 * localStorage remains the live store for both PWA and native WebView.
 * On native iOS, a mirror is written to the app Data directory via
 * @capacitor/filesystem so WebView localStorage loss can be recovered.
 *
 * Privacy: the mirror is plaintext JSON inside the app sandbox (iOS Data
 * Protection). It is not application-level encrypted. Prefer encrypted
 * Backup & export for off-device copies. This module no-ops on the web PWA.
 */
(function (global) {
  "use strict";

  var MIRROR_VERSION = 1;
  var MIRROR_PATH = "freedom-native-mirror-v1.json";
  var DIRECTORY_DATA = "DATA";
  var ENCODING_UTF8 = "utf8";

  function isNativePlatform() {
    try {
      var cap = global.Capacitor;
      return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function getFilesystem() {
    if (!isNativePlatform()) return null;
    try {
      var cap = global.Capacitor;
      if (!cap || typeof cap.registerPlugin !== "function") return null;
      if (!cap.isPluginAvailable || !cap.isPluginAvailable("Filesystem")) return null;
      return cap.registerPlugin("Filesystem");
    } catch (e) {
      return null;
    }
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function parseMirrorEnvelope(raw) {
    if (raw == null || raw === "") return { ok: false, reason: "empty" };
    var parsed = null;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return { ok: false, reason: "corrupt" };
    }
    if (!isPlainObject(parsed)) return { ok: false, reason: "corrupt" };
    if (Number(parsed.version) !== MIRROR_VERSION) return { ok: false, reason: "version" };
    if (!isPlainObject(parsed.state)) return { ok: false, reason: "state" };
    if (parsed.meta != null && !isPlainObject(parsed.meta)) return { ok: false, reason: "meta" };
    return {
      ok: true,
      envelope: {
        version: MIRROR_VERSION,
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
        state: parsed.state,
        meta: isPlainObject(parsed.meta) ? parsed.meta : {}
      }
    };
  }

  function classifyLocalStorageRaw(raw, loadError) {
    if (loadError === "unreadable") return { status: "unreadable", state: null };
    if (loadError === "corrupt") return { status: "corrupt", state: null };
    if (raw == null || raw === "") return { status: "missing", state: null };
    try {
      var saved = JSON.parse(raw);
      if (!isPlainObject(saved)) return { status: "corrupt", state: null };
      return { status: "valid", state: saved };
    } catch (e) {
      return { status: "corrupt", state: null };
    }
  }

  /**
   * Pure decision helper — safe to unit test without Capacitor.
   * Never chooses to overwrite valid localStorage with empty/default data.
   */
  function decideHydrateAction(input) {
    var ls = input && input.local ? input.local : { status: "missing", state: null };
    var mirror = input && input.mirror && input.mirror.ok ? input.mirror.envelope : null;

    if (ls.status === "valid") {
      return { action: "keep-local", seedMirror: true, localState: ls.state };
    }
    if (mirror) {
      if (ls.status === "missing" || ls.status === "corrupt" || ls.status === "unreadable") {
        return {
          action: "restore-from-mirror",
          state: mirror.state,
          meta: mirror.meta || {},
          reason: ls.status
        };
      }
    }
    if (ls.status === "corrupt" || ls.status === "unreadable") {
      return { action: "needs-user-recover", reason: ls.status };
    }
    return { action: "empty" };
  }

  function buildEnvelope(state, meta) {
    return {
      version: MIRROR_VERSION,
      savedAt: new Date().toISOString(),
      state: state,
      meta: isPlainObject(meta) ? meta : {}
    };
  }

  async function readMirrorEnvelope() {
    var fs = getFilesystem();
    if (!fs) return { ok: false, reason: "unavailable" };
    try {
      var result = await fs.readFile({
        path: MIRROR_PATH,
        directory: DIRECTORY_DATA,
        encoding: ENCODING_UTF8
      });
      return parseMirrorEnvelope(result && result.data);
    } catch (e) {
      var message = String((e && e.message) || e || "");
      if (/does not exist|not found|ENOENT|MISSING/i.test(message)) {
        return { ok: false, reason: "missing" };
      }
      return { ok: false, reason: "read-error", error: e };
    }
  }

  async function writeSnapshot(state, meta) {
    if (!isNativePlatform()) return { ok: true, skipped: true };
    if (!isPlainObject(state)) return { ok: false, error: "invalid-state" };
    var fs = getFilesystem();
    if (!fs) return { ok: false, error: "filesystem-unavailable" };
    var envelope = buildEnvelope(state, meta);
    try {
      await fs.writeFile({
        path: MIRROR_PATH,
        data: JSON.stringify(envelope),
        directory: DIRECTORY_DATA,
        encoding: ENCODING_UTF8,
        recursive: true
      });
      return { ok: true, savedAt: envelope.savedAt };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function clearMirror() {
    if (!isNativePlatform()) return { ok: true, skipped: true };
    var fs = getFilesystem();
    if (!fs) return { ok: false, error: "filesystem-unavailable" };
    try {
      await fs.deleteFile({
        path: MIRROR_PATH,
        directory: DIRECTORY_DATA
      });
      return { ok: true };
    } catch (e) {
      var message = String((e && e.message) || e || "");
      if (/does not exist|not found|ENOENT|MISSING/i.test(message)) {
        return { ok: true, missing: true };
      }
      return { ok: false, error: e };
    }
  }

  function collectMetaFromStorage(storage, metaKeys) {
    var meta = {};
    var keys = Array.isArray(metaKeys) ? metaKeys : [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      try {
        var value = storage.getItem(key);
        if (value != null) meta[key] = value;
      } catch (e) {}
    }
    return meta;
  }

  async function mirrorFromLocalStorage(options) {
    options = options || {};
    if (!isNativePlatform()) return { ok: true, skipped: true };
    var storage = options.storage || global.localStorage;
    var storageKey = options.storageKey || "freedom50-mobile-v1";
    var metaKeys = options.metaKeys || [];
    var raw = null;
    try {
      raw = storage.getItem(storageKey);
    } catch (e) {
      return { ok: false, error: e };
    }
    var classified = classifyLocalStorageRaw(raw, null);
    if (classified.status !== "valid") {
      return { ok: false, error: "local-invalid", status: classified.status };
    }
    /* Never mirror an intentional empty wipe unless caller allows it. */
    if (options.requireRecords && typeof options.hasSavedRecords === "function") {
      if (!options.hasSavedRecords(classified.state) && options.allowEmpty !== true) {
        /* Still mirror established empty personal shells when meta says onboarding done. */
        var metaProbe = collectMetaFromStorage(storage, metaKeys);
        if (metaProbe["freedom50-welcome-complete-v1"] !== "1") {
          return { ok: false, error: "refuse-empty-overwrite" };
        }
      }
    }
    var meta = collectMetaFromStorage(storage, metaKeys);
    return writeSnapshot(classified.state, meta);
  }

  function applyMirrorToLocalStorage(storage, storageKey, metaKeys, snapshot) {
    if (!snapshot || !isPlainObject(snapshot.state)) {
      return { ok: false, error: "invalid-snapshot" };
    }
    try {
      storage.setItem(storageKey, JSON.stringify(snapshot.state));
    } catch (e) {
      return { ok: false, error: e };
    }
    var keys = Array.isArray(metaKeys) ? metaKeys : [];
    var meta = isPlainObject(snapshot.meta) ? snapshot.meta : {};
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      try {
        if (Object.prototype.hasOwnProperty.call(meta, key) && meta[key] != null) {
          storage.setItem(key, String(meta[key]));
        } else {
          storage.removeItem(key);
        }
      } catch (e) {}
    }
    return { ok: true };
  }

  async function hydrateLocalStorage(options) {
    options = options || {};
    if (!isNativePlatform()) {
      return { ok: true, skipped: true, action: "skipped" };
    }
    var storage = options.storage || global.localStorage;
    var storageKey = options.storageKey || "freedom50-mobile-v1";
    var metaKeys = options.metaKeys || [];
    var loadError = options.loadError || null;
    var raw = null;
    try {
      raw = storage.getItem(storageKey);
    } catch (e) {
      loadError = loadError || "unreadable";
      raw = null;
    }
    var local = classifyLocalStorageRaw(raw, loadError);
    var mirror = await readMirrorEnvelope();
    var decision = decideHydrateAction({ local: local, mirror: mirror });

    if (decision.action === "keep-local") {
      var seed = await writeSnapshot(
        decision.localState,
        collectMetaFromStorage(storage, metaKeys)
      );
      return {
        ok: !!seed.ok,
        action: "keep-local",
        seeded: !!seed.ok,
        seedError: seed.ok ? null : seed.error
      };
    }

    if (decision.action === "restore-from-mirror") {
      var applied = applyMirrorToLocalStorage(storage, storageKey, metaKeys, {
        state: decision.state,
        meta: decision.meta
      });
      if (!applied.ok) {
        return { ok: false, action: "restore-from-mirror", error: applied.error };
      }
      if (options.reload !== false && typeof options.reloadFn === "function") {
        options.reloadFn();
        return { ok: true, action: "restore-from-mirror", reloaded: true, reason: decision.reason };
      }
      if (options.reload !== false && global.location && typeof global.location.reload === "function") {
        global.location.reload();
        return { ok: true, action: "restore-from-mirror", reloaded: true, reason: decision.reason };
      }
      return { ok: true, action: "restore-from-mirror", reloaded: false, reason: decision.reason };
    }

    return {
      ok: true,
      action: decision.action,
      reason: decision.reason || null
    };
  }

  global.FreedomNativeStorage = {
    version: MIRROR_VERSION,
    path: MIRROR_PATH,
    isNative: isNativePlatform,
    parseMirrorEnvelope: parseMirrorEnvelope,
    classifyLocalStorageRaw: classifyLocalStorageRaw,
    decideHydrateAction: decideHydrateAction,
    readMirrorEnvelope: readMirrorEnvelope,
    writeSnapshot: writeSnapshot,
    clearMirror: clearMirror,
    mirrorFromLocalStorage: mirrorFromLocalStorage,
    hydrateLocalStorage: hydrateLocalStorage,
    applyMirrorToLocalStorage: applyMirrorToLocalStorage,
    collectMetaFromStorage: collectMetaFromStorage
  };
})(typeof window !== "undefined" ? window : globalThis);
