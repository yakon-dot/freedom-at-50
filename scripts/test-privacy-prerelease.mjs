/**
 * Pre-release privacy cleanup contracts (no device calls).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const pushCfg = fs.readFileSync(path.join(root, "freedom-push-config.js"), "utf8");
const nativeNotif = fs.readFileSync(path.join(root, "freedom-native-notifications.js"), "utf8");
const capPrivacy = fs.readFileSync(
  path.join(root, "node_modules/@capacitor/ios/Capacitor/Capacitor/PrivacyInfo.xcprivacy"),
  "utf8"
);
const appDelegate = fs.readFileSync(path.join(root, "ios/App/App/AppDelegate.swift"), "utf8");
const sceneDelegate = fs.readFileSync(path.join(root, "ios/App/App/SceneDelegate.swift"), "utf8");
const docs = fs.readFileSync(path.join(root, "native/CAPACITOR-IOS.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

/* 1. Reset Freedom cancels native local notifications before wipe. */
assert.match(
  index,
  /async function resetFreedomFreshStart\([\s\S]*?disableMonthlyReminders\([\s\S]*?clearMirror/
);
assert.match(index, /leftover notifications cannot arrive after your data is wiped/);
assert.match(nativeNotif, /disableMonthlyReminders/);
console.log("PASS: Reset Freedom cancels iOS local notifications before wipe");

/* 2. VAPID contact uses official support email; personal Gmail removed from push config. */
assert.match(pushCfg, /vapidSubject:\s*"mailto:freedom\.support@icloud\.com"/);
assert.equal(/dorothy\.yakon@gmail\.com/.test(pushCfg), false);
assert.match(pushCfg, /vapidPublicKey:\s*"BA_eBVERzQPN_6tVV_S8KqJinG74gRVbhZxeNmWm2yaDiB_NcBOX_wUZ4Zek7A0Sj-DnqobkSi5ScxyHpuoFIys"/);
console.log("PASS: Web Push VAPID subject uses freedom.support@icloud.com");

/* 3. Privacy Manifest posture — SDKs ship manifests; App Swift avoids required-reason APIs. */
assert.match(capPrivacy, /NSPrivacyTracking/);
assert.match(capPrivacy, /<false\/>/);
assert.equal(/UserDefaults|NSUserDefaults|NSURLContentModificationDateKey|getattrlist|stat\(|systemUptime|mach_absolute_time/.test(appDelegate), false);
assert.equal(/UserDefaults|NSUserDefaults|NSURLContentModificationDateKey|getattrlist|stat\(|systemUptime|mach_absolute_time/.test(sceneDelegate), false);
assert.equal(fs.existsSync(path.join(root, "ios/App/App/PrivacyInfo.xcprivacy")), false);
assert.match(docs, /Privacy Manifests \(required-reason APIs\)/);
assert.equal(!!pkg.dependencies["@revenuecat/purchases-capacitor"], true);
console.log("PASS: no speculative App PrivacyInfo; Capacitor manifest present; App Swift clean");

/* 4. No Privacy Policy / Terms of Use links in the shipped UI yet (site unpublished). */
assert.equal(/privacy[\s_-]*policy/i.test(index) && /href\s*=\s*["'][^"']*privacy/i.test(index), false);
assert.equal(/terms[\s_-]*of[\s_-]*use|terms[\s_-]*of[\s_-]*service/i.test(index) && /href\s*=\s*["'][^"']*terms/i.test(index), false);
assert.equal(/yakon-dot\.github\.io\/freedom-at-50\/(privacy|terms)/i.test(index), false);
console.log("PASS: no invented Privacy Policy / Terms URLs in app UI");

console.log("PASS: pre-release privacy cleanup contracts");
