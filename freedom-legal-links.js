/**
 * Published Freedom website legal & support URLs.
 * Opens externally so the in-app WebView / local data stay intact.
 */
(function (global) {
  "use strict";

  var URLS = {
    privacy: "https://yakon-dot.github.io/freedom-website/privacy/",
    terms: "https://yakon-dot.github.io/freedom-website/terms/",
    support: "https://yakon-dot.github.io/freedom-website/support/"
  };

  function isNativePlatform() {
    try {
      var cap = global.Capacitor;
      return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function getBrowserPlugin() {
    if (!isNativePlatform()) return null;
    try {
      var cap = global.Capacitor;
      if (!cap) return null;
      var plugins = cap.Plugins || {};
      if (plugins.Browser && typeof plugins.Browser.open === "function") {
        return plugins.Browser;
      }
      if (typeof cap.registerPlugin === "function") {
        var proxy = cap.registerPlugin("Browser");
        if (proxy && typeof proxy.open === "function") return proxy;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Open a published legal/support page outside the app WebView.
   * Native: Capacitor Browser (SFSafariViewController) when available.
   * Web/PWA: new tab/window. Never navigates the app document itself.
   */
  async function open(url) {
    var href = String(url || "").trim();
    if (!href) return { ok: false, error: "missing-url" };

    try {
      var browser = getBrowserPlugin();
      if (browser) {
        await browser.open({ url: href });
        return { ok: true, mode: "capacitor-browser" };
      }
    } catch (e) {
      /* fall through */
    }

    try {
      var opened = global.open(href, "_blank", "noopener,noreferrer");
      if (opened) return { ok: true, mode: "window-open" };
    } catch (e2) {
      /* fall through */
    }

    try {
      var a = global.document && global.document.createElement("a");
      if (a) {
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.display = "none";
        global.document.body.appendChild(a);
        a.click();
        a.remove();
        return { ok: true, mode: "anchor-click" };
      }
    } catch (e3) {
      return { ok: false, error: String(e3 && e3.message ? e3.message : e3) };
    }

    return { ok: false, error: "open-failed" };
  }

  function openKey(key) {
    var href = URLS[key];
    return open(href);
  }

  global.FreedomLegalLinks = {
    urls: URLS,
    open: open,
    openKey: openKey
  };
})(typeof window !== "undefined" ? window : globalThis);
