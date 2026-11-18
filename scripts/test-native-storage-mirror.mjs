/**
 * Native storage safeguard tests:
 * hydrate decisions, failed writes, overwrite protection, PWA no-op path.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const nativeSrc = fs.readFileSync(path.join(root, "freedom-native-storage.js"), "utf8");

assert.match(index, /freedom-native-storage\.js/);
assert.match(index, /freedomQueueNativeMirrorAfterLocalWrite/);
assert.match(index, /freedomNativeBootHydrate/);
assert.match(index, /freedomNativeStorageReady/);
assert.match(index, /freedomCompleteAppBoot/);
assert.match(index, /Reset was cancelled so your data cannot come back unexpectedly/);
assert.match(index, /could not update the native recovery copy/);
assert.match(index, /FreedomNativeStorage/);
assert.match(nativeSrc, /DIRECTORY_DATA|"DATA"/);
assert.match(nativeSrc, /registerPlugin\("Filesystem"\)/);
assert.match(nativeSrc, /plugins\.Filesystem/);
assert.match(nativeSrc, /decideHydrateAction/);
assert.match(nativeSrc, /enqueueMirrorOp/);
assert.match(nativeSrc, /mirrorEpoch/);
assert.match(nativeSrc, /empty-local-rich-mirror/);
assert.equal(/Preferences/.test(nativeSrc), false, "Do not store financial mirrors in UserDefaults Preferences");
const capAppSpm = fs.readFileSync(
  path.join(root, "ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift"),
  "utf8"
);
assert.match(capAppSpm, /import FilesystemPlugin/);
assert.match(capAppSpm, /FreedomCapAppSPMPluginAnchor/);
assert.match(capAppSpm, /FilesystemPlugin\.self/);
assert.match(capAppSpm, /dead-strip|NSClassFromString|packageClassList/);
/* Local notifications anchor is added in the native-notifications step; tolerate either state during partial checkouts. */
if (/import LocalNotificationsPlugin/.test(capAppSpm)) {
  assert.match(capAppSpm, /LocalNotificationsPlugin\.self/);
}
const capConfig = JSON.parse(
  fs.readFileSync(path.join(root, "ios/App/App/capacitor.config.json"), "utf8")
);
assert.ok(
  Array.isArray(capConfig.packageClassList) &&
    capConfig.packageClassList.includes("FilesystemPlugin"),
  "packageClassList must include FilesystemPlugin for native registration"
);
console.log("PASS: source contracts for native storage mirror + SPM plugin anchor");

function loadNativeApi(capacitorMock) {
  const sandbox = {
    window: {},
    globalThis: {},
    console
  };
  sandbox.window.Capacitor = capacitorMock;
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(nativeSrc, sandbox, { filename: "freedom-native-storage.js" });
  return sandbox.window.FreedomNativeStorage;
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    _map: map
  };
}

const sampleState = {
  loans: [{ name: "Card", starting: 1000, current: 400, payment: 50 }],
  customGoals: [{ id: "g1", name: "House", current: 200, target: 5000 }],
  pensions: [],
  notes: [{ id: "n1", text: "keep" }],
  archivedJourneys: [],
  archivedGoals: [],
  archivedPensions: [],
  victories: []
};

const metaKeys = [
  "freedom50-welcome-complete-v1",
  "freedom50-companion-id-v1"
];

{
  const api = loadNativeApi(undefined);
  assert.equal(api.isNative(), false);
  const decision = api.decideHydrateAction({
    local: { status: "valid", state: sampleState },
    mirror: { ok: true, envelope: { version: 1, state: { loans: [] }, meta: {} } }
  });
  assert.equal(decision.action, "keep-local");
  assert.equal(decision.seedMirror, true);
  console.log("PASS: valid localStorage wins over mirror (no overwrite)");
}

{
  const api = loadNativeApi(undefined);
  const decision = api.decideHydrateAction({
    local: { status: "missing", state: null },
    mirror: { ok: true, envelope: { version: 1, state: sampleState, meta: { "freedom50-companion-id-v1": "patricia" } } }
  });
  assert.equal(decision.action, "restore-from-mirror");
  assert.equal(decision.state.loans[0].name, "Card");
  assert.equal(decision.meta["freedom50-companion-id-v1"], "patricia");
  console.log("PASS: missing localStorage restores from mirror");
}

{
  const api = loadNativeApi(undefined);
  for (const status of ["corrupt", "unreadable"]) {
    const decision = api.decideHydrateAction({
      local: { status, state: null },
      mirror: { ok: true, envelope: { version: 1, state: sampleState, meta: {} } }
    });
    assert.equal(decision.action, "restore-from-mirror", status);
  }
  const noMirror = api.decideHydrateAction({
    local: { status: "corrupt", state: null },
    mirror: { ok: false, reason: "missing" }
  });
  assert.equal(noMirror.action, "needs-user-recover");
  console.log("PASS: corrupt/unreadable localStorage restores mirror or asks user");
}

{
  const api = loadNativeApi(undefined);
  const empty = api.decideHydrateAction({
    local: { status: "missing", state: null },
    mirror: { ok: false, reason: "missing" }
  });
  assert.equal(empty.action, "empty");
  const bad = api.parseMirrorEnvelope('{"version":1,"state":[]}');
  assert.equal(bad.ok, false);
  const emptyLocalRichMirror = api.decideHydrateAction({
    local: {
      status: "valid",
      state: { loans: [], customGoals: [], pensions: [], notes: [] }
    },
    mirror: {
      ok: true,
      envelope: { version: 1, state: sampleState, meta: { "freedom50-companion-id-v1": "patricia" } }
    }
  });
  assert.equal(emptyLocalRichMirror.action, "restore-from-mirror");
  assert.equal(emptyLocalRichMirror.reason, "empty-local-rich-mirror");
  console.log("PASS: empty devices stay empty; empty local cannot wipe richer mirror at boot");
}

{
  const files = new Map();
  let writeShouldFail = false;
  const api = loadNativeApi({
    isNativePlatform: () => true,
    isPluginAvailable: name => name === "Filesystem",
    registerPlugin: () => ({
      async readFile({ path }) {
        if (!files.has(path)) {
          const err = new Error("File does not exist");
          throw err;
        }
        return { data: files.get(path) };
      },
      async writeFile({ path, data }) {
        if (writeShouldFail) throw new Error("disk full");
        files.set(path, data);
        return { uri: path };
      },
      async deleteFile({ path }) {
        files.delete(path);
      }
    })
  });

  assert.equal(api.isNative(), true);
  const storage = memoryStorage({
    "freedom50-mobile-v1": JSON.stringify(sampleState),
    "freedom50-welcome-complete-v1": "1",
    "freedom50-companion-id-v1": "patricia"
  });

  const mirrored = await api.mirrorFromLocalStorage({
    storage,
    storageKey: "freedom50-mobile-v1",
    metaKeys,
    allowEmpty: true
  });
  assert.equal(mirrored.ok, true);
  assert.equal(files.size, 1);

  storage.removeItem("freedom50-mobile-v1");
  storage.removeItem("freedom50-welcome-complete-v1");
  storage.removeItem("freedom50-companion-id-v1");

  let reloaded = false;
  const hydrated = await api.hydrateLocalStorage({
    storage,
    storageKey: "freedom50-mobile-v1",
    metaKeys,
    loadError: null,
    reloadFn: () => {
      reloaded = true;
    }
  });
  assert.equal(hydrated.action, "restore-from-mirror");
  assert.equal(hydrated.reloaded, true);
  assert.equal(reloaded, true);
  const restored = JSON.parse(storage.getItem("freedom50-mobile-v1"));
  assert.equal(restored.customGoals[0].name, "House");
  assert.equal(storage.getItem("freedom50-companion-id-v1"), "patricia");
  console.log("PASS: persistence + recovery round-trip via mocked Filesystem");

  writeShouldFail = true;
  const failed = await api.writeSnapshot(sampleState, {});
  assert.equal(failed.ok, false);
  console.log("PASS: failed native writes report ok:false");

  writeShouldFail = false;
  const keepStorage = memoryStorage({
    "freedom50-mobile-v1": JSON.stringify(sampleState),
    "freedom50-companion-id-v1": "kevin"
  });
  files.clear();
  files.set(
    api.path,
    JSON.stringify({
      version: 1,
      savedAt: "2020-01-01T00:00:00.000Z",
      state: { loans: [], customGoals: [], pensions: [], notes: [] },
      meta: { "freedom50-companion-id-v1": "patricia" }
    })
  );
  const keep = await api.hydrateLocalStorage({
    storage: keepStorage,
    storageKey: "freedom50-mobile-v1",
    metaKeys,
    loadError: null,
    reload: false
  });
  assert.equal(keep.action, "keep-local");
  assert.equal(JSON.parse(keepStorage.getItem("freedom50-mobile-v1")).loans[0].name, "Card");
  assert.equal(keepStorage.getItem("freedom50-companion-id-v1"), "kevin");
  const seeded = api.parseMirrorEnvelope(files.get(api.path));
  assert.equal(seeded.ok, true);
  assert.equal(seeded.envelope.state.loans[0].name, "Card");
  assert.equal(seeded.envelope.meta["freedom50-companion-id-v1"], "kevin");
  console.log("PASS: hydrate never overwrites valid local data; seeds mirror from local");

  await api.clearMirror();
  assert.equal(files.has(api.path), false);
  console.log("PASS: clearMirror removes native snapshot");
}

{
  const api = loadNativeApi({
    isNativePlatform: () => false,
    isPluginAvailable: () => false,
    registerPlugin: () => {
      throw new Error("should not register on web");
    }
  });
  const result = await api.hydrateLocalStorage({
    storage: memoryStorage(),
    storageKey: "freedom50-mobile-v1",
    metaKeys,
    reload: false
  });
  assert.equal(result.skipped, true);
  const mirror = await api.mirrorFromLocalStorage({
    storage: memoryStorage({ "freedom50-mobile-v1": JSON.stringify(sampleState) }),
    storageKey: "freedom50-mobile-v1",
    metaKeys,
    allowEmpty: true
  });
  assert.equal(mirror.skipped, true);
  console.log("PASS: web/PWA path no-ops without touching Filesystem");
}

{
  let registerCalls = 0;
  const injected = {
    async writeFile() {
      return { uri: "injected" };
    },
    async readFile() {
      return { data: "{}" };
    },
    async deleteFile() {}
  };
  const apiInjected = loadNativeApi({
    isNativePlatform: () => true,
    isPluginAvailable: () => false,
    Plugins: { Filesystem: injected },
    registerPlugin: () => {
      registerCalls += 1;
      throw new Error("should prefer injected Plugins.Filesystem");
    }
  });
  const fsInjected = apiInjected.getFilesystem();
  assert.equal(fsInjected, injected);
  assert.equal(registerCalls, 0);

  const apiRegister = loadNativeApi({
    isNativePlatform: () => true,
    isPluginAvailable: () => false,
    Plugins: {},
    registerPlugin: name => {
      registerCalls += 1;
      assert.equal(name, "Filesystem");
      return {
        async writeFile() {
          return { uri: "proxy" };
        }
      };
    }
  });
  registerCalls = 0;
  const fsProxy = apiRegister.getFilesystem();
  assert.equal(registerCalls, 1);
  assert.equal(typeof fsProxy.writeFile, "function");

  const apiMissing = loadNativeApi({
    isNativePlatform: () => true,
    isPluginAvailable: () => false,
    Plugins: {},
    registerPlugin: () => null
  });
  assert.equal(apiMissing.getFilesystem(), null);
  console.log("PASS: getFilesystem prefers JSExport proxy and still registers when headers lag");
}

{
  const prepare = fs.readFileSync(path.join(root, "scripts/prepare-capacitor-web.mjs"), "utf8");
  assert.match(prepare, /freedom-native-storage\.js/);
  const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.match(sw, /freedom-native-storage\.js/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(pkg.dependencies["@capacitor/filesystem"]);
  console.log("PASS: Capacitor prepare + SW + package include native storage assets");
}

{
  const files = new Map();
  const writeLog = [];
  let releaseFirstWrite = null;
  let firstWriteStarted = false;
  const api = loadNativeApi({
    isNativePlatform: () => true,
    isPluginAvailable: name => name === "Filesystem",
    registerPlugin: () => ({
      async readFile({ path }) {
        if (!files.has(path)) throw new Error("File does not exist");
        return { data: files.get(path) };
      },
      async writeFile({ path, data }) {
        if (!firstWriteStarted) {
          firstWriteStarted = true;
          await new Promise(resolve => {
            releaseFirstWrite = resolve;
          });
        } else {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        const parsed = JSON.parse(data);
        writeLog.push(parsed.state.tag);
        files.set(path, data);
        return { uri: path };
      },
      async deleteFile({ path }) {
        files.delete(path);
      }
    })
  });

  const storage = memoryStorage({
    "freedom50-mobile-v1": JSON.stringify({ ...sampleState, tag: "first" })
  });
  const first = api.mirrorFromLocalStorage({
    storage,
    storageKey: "freedom50-mobile-v1",
    metaKeys,
    allowEmpty: true
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(typeof releaseFirstWrite, "function", "first write should be waiting");

  storage.setItem(
    "freedom50-mobile-v1",
    JSON.stringify({ ...sampleState, tag: "second" })
  );
  const second = api.mirrorFromLocalStorage({
    storage,
    storageKey: "freedom50-mobile-v1",
    metaKeys,
    allowEmpty: true
  });

  releaseFirstWrite();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, true);
  assert.deepEqual(writeLog, ["first", "second"]);
  const finalEnvelope = api.parseMirrorEnvelope(files.get(api.path));
  assert.equal(finalEnvelope.ok, true);
  assert.equal(finalEnvelope.envelope.state.tag, "second");
  console.log("PASS: rapid consecutive saves serialize; newest state wins after delayed writes");

  storage.setItem(
    "freedom50-mobile-v1",
    JSON.stringify({ ...sampleState, tag: "stale-after-clear" })
  );
  const stale = api.mirrorFromLocalStorage({
    storage,
    storageKey: "freedom50-mobile-v1",
    metaKeys,
    allowEmpty: true
  });
  const cleared = api.clearMirror();
  const staleResult = await stale;
  const clearResult = await cleared;
  assert.equal(clearResult.ok, true);
  assert.equal(files.has(api.path), false);
  assert.ok(
    staleResult.ok === false || staleResult.ok === true,
    "stale write settles without throwing"
  );
  if (staleResult.ok) {
    /* If the stale write landed before clear ran, clear must still leave no file. */
    assert.equal(files.has(api.path), false);
  } else {
    assert.equal(staleResult.error, "superseded");
  }
  console.log("PASS: clearMirror invalidates in-flight writes so reset cannot resurrect data");
}

console.log("Summary: native storage mirror tests passed");
