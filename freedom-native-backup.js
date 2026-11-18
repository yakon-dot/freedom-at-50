/**
 * Freedom native encrypted-backup delivery (Capacitor iOS only).
 *
 * WKWebView ignores <a download>, so native export writes a temporary JSON file
 * via Filesystem and opens the system share sheet (Files / iCloud Drive / etc.).
 * Encryption format stays in index.html — this module only delivers bytes.
 * No-ops on the PWA.
 */
(function (global) {
  "use strict";

  var CACHE_DIR = "CACHE";
  var ENCODING_UTF8 = "utf8";

  function isNativePlatform() {
    try {
      var cap = global.Capacitor;
      return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function getCapPlugin(name, methodName) {
    if (!isNativePlatform()) return null;
    try {
      var cap = global.Capacitor;
      if (!cap) return null;
      var plugins = cap.Plugins || {};
      if (plugins[name] && typeof plugins[name][methodName] === "function") {
        return plugins[name];
      }
      if (typeof cap.registerPlugin !== "function") return null;
      var proxy = cap.registerPlugin(name);
      if (proxy && typeof proxy[methodName] === "function") return proxy;
      return proxy || null;
    } catch (e) {
      return null;
    }
  }

  function isShareCancelled(error) {
    if (!error) return false;
    var msg = String(error.message || error.errorMessage || error || "").toLowerCase();
    return (
      error.code === "SHARE_CANCELLED" ||
      /cancel|cancelled|canceled|abort/.test(msg)
    );
  }

  /**
   * Write encrypted JSON to cache and open the iOS share sheet.
   * @returns {{ok:boolean, mode?:string, cancelled?:boolean, error?:string, uri?:string}}
   */
  async function shareEncryptedJson(jsonText, filename) {
    if (!isNativePlatform()) {
      return { ok: false, skipped: true, error: "not-native" };
    }
    var text = String(jsonText || "");
    var name = String(filename || "freedom-backup.json").replace(/[^\w.\-]+/g, "_");
    if (!text) return { ok: false, error: "Backup file was empty." };

    var fs = getCapPlugin("Filesystem", "writeFile");
    var share = getCapPlugin("Share", "share");
    if (!fs || typeof fs.writeFile !== "function") {
      return {
        ok: false,
        error: "Freedom could not prepare a backup file on this iPhone. Try again after reopening Freedom."
      };
    }
    if (!share || typeof share.share !== "function") {
      return {
        ok: false,
        error: "Freedom could not open the iOS share sheet. Update Freedom and try again."
      };
    }

    try {
      await fs.writeFile({
        path: name,
        data: text,
        directory: CACHE_DIR,
        encoding: ENCODING_UTF8
      });
    } catch (e) {
      return {
        ok: false,
        error: "Freedom could not write the encrypted backup on this iPhone."
      };
    }

    var uri = "";
    try {
      if (typeof fs.getUri === "function") {
        var got = await fs.getUri({ path: name, directory: CACHE_DIR });
        uri = got && got.uri ? String(got.uri) : "";
      }
    } catch (e) {}
    if (!uri) {
      return {
        ok: false,
        error: "Freedom wrote the backup but could not open it for sharing."
      };
    }

    try {
      await share.share({
        title: "Freedom backup",
        url: uri,
        dialogTitle: "Save Freedom backup"
      });
      return { ok: true, mode: "share", uri: uri };
    } catch (e) {
      if (isShareCancelled(e)) {
        return { ok: false, cancelled: true, error: "Export cancelled. No backup file was saved." };
      }
      return {
        ok: false,
        error: (e && e.message) || "Freedom could not open the share sheet for this backup."
      };
    }
  }

  global.FreedomNativeBackup = {
    isNative: isNativePlatform,
    shareEncryptedJson: shareEncryptedJson,
    isShareCancelled: isShareCancelled
  };
})(typeof window !== "undefined" ? window : globalThis);
