/**
 * Published legal & support link contracts (no network / device required).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const legalSrc = fs.readFileSync(path.join(root, "freedom-legal-links.js"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-capacitor-web.mjs"), "utf8");
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const PRIVACY = "https://yakon-dot.github.io/freedom-website/privacy/";
const TERMS = "https://yakon-dot.github.io/freedom-website/terms/";
const SUPPORT = "https://yakon-dot.github.io/freedom-website/support/";

assert.match(index, /freedom-legal-links\.js/);
assert.match(index, /Legal &amp; Support/);
assert.match(index, /data-more183="privacy">Privacy Policy</);
assert.match(index, /data-more183="terms">Terms of Use</);
assert.match(index, /data-more183="support">Contact Support</);
assert.match(index, /id="freedomPaywallPrivacy"/);
assert.match(index, /id="freedomPaywallTerms"/);
assert.match(index, new RegExp(`href="${PRIVACY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
assert.match(index, new RegExp(`href="${TERMS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
assert.match(legalSrc, new RegExp(PRIVACY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(legalSrc, new RegExp(TERMS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(legalSrc, new RegExp(SUPPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(index, /FreedomLegalLinks\.openKey/);
assert.match(prepare, /freedom-legal-links\.js/);
assert.match(sw, /freedom-legal-links\.js/);
assert.equal(!!pkg.dependencies["@capacitor/browser"], true);
console.log("PASS: More + paywall legal markup and wiring");

const opened = [];
const sandbox = {
  console,
  window: null,
  document: {
    createElement() {
      return {
        style: {},
        click() {
          opened.push({ mode: "anchor", href: this.href });
        },
        remove() {}
      };
    },
    body: {
      appendChild() {}
    }
  },
  open(url, target) {
    opened.push({ mode: "window-open", url, target });
    return { closed: false };
  },
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: {
      Browser: {
        async open({ url }) {
          opened.push({ mode: "capacitor-browser", url });
        }
      }
    },
    registerPlugin() {
      return null;
    }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(legalSrc, sandbox, { filename: "freedom-legal-links.js" });

assert.equal(sandbox.FreedomLegalLinks.urls.privacy, PRIVACY);
assert.equal(sandbox.FreedomLegalLinks.urls.terms, TERMS);
assert.equal(sandbox.FreedomLegalLinks.urls.support, SUPPORT);

opened.length = 0;
const nativeResult = await sandbox.FreedomLegalLinks.openKey("privacy");
assert.equal(nativeResult.ok, true);
assert.equal(nativeResult.mode, "capacitor-browser");
assert.equal(opened[0].url, PRIVACY);

sandbox.Capacitor.isNativePlatform = () => false;
opened.length = 0;
const webResult = await sandbox.FreedomLegalLinks.openKey("terms");
assert.equal(webResult.ok, true);
assert.equal(webResult.mode, "window-open");
assert.equal(opened[0].url, TERMS);
assert.equal(opened[0].target, "_blank");
console.log("PASS: FreedomLegalLinks opens externally (native Browser + web window.open)");

const placeholderLegalHref =
  /example\.(com|org)|placeholder|replace[\s_-]*me|insert[\s_-]*url|changeme|TODO|TBD|FIXME|about:blank|javascript:|localhost|127\.0\.0\.1|your[\s_-]*domain|coming[\s_-]*soon/i;
const legalHrefPattern = /href\s*=\s*["']([^"']*(?:privacy|terms)[^"']*)["']/gi;
let legalHref;
while ((legalHref = legalHrefPattern.exec(index)) !== null) {
  assert.equal(placeholderLegalHref.test(legalHref[1]), false, legalHref[1]);
  assert.match(legalHref[1], /^https:\/\/yakon-dot\.github\.io\/freedom-website\//);
}
console.log("PASS: no placeholder Privacy/Terms URLs");

console.log("PASS: legal & support link contracts");
