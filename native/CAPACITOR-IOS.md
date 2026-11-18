# Freedom — Capacitor iOS (preparation)

Freedom remains a static PWA on GitHub Pages. Capacitor adds a separate native iOS shell that loads a staged copy of the same web assets.

## Bundle identifier

Locked in `capacitor.config.json`:

- **App name:** `Freedom`
- **Bundle ID:** `com.yakondot.freedom`

Rationale: reverse-DNS from the GitHub org `yakon-dot`, hyphen removed (common Apple ID style), with a short product segment. Treat this as permanent before App Store / push certificates are created.

## Environment requirements

- Node.js 20+ (22+ fine)
- Xcode 26.6+ with iOS Simulator support
- Point the active developer directory at full Xcode, not Command Line Tools:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

If Xcode lives elsewhere (for example Downloads), use that path instead.

- CocoaPods is **not** required. This project uses Swift Package Manager (`npx cap add ios` default in Capacitor 8).

## Commands

```bash
npm install
npm run cap:prepare   # copies PWA assets → www/ (gitignored)
npm run cap:sync      # prepare + sync into ios/
npm run cap:open      # opens the Xcode project
```

Or open directly:

```bash
open ios/App/App.xcodeproj
```

In Xcode: select an iPhone simulator or device → Run.

After any change to root web files that should appear in the native app:

```bash
npm run cap:sync
```

## What stays untouched

- Root `index.html`, `service-worker.js`, manifest, push config, and wallpapers remain the GitHub Pages / PWA source of truth.
- No framework rewrite.
- Demo Mode, onboarding, calculations, companion copy, and Web Push code paths are not migrated in this step.

## Native storage safeguard

- **Live store (unchanged):** WebView `localStorage` (`freedom50-mobile-v1` + onboarding/companion meta keys). GitHub Pages / PWA behaviour is unchanged — `freedom-native-storage.js` no-ops unless `Capacitor.isNativePlatform()` is true.
- **Native mirror:** `@capacitor/filesystem` file `freedom-native-mirror-v1.json` in the app **Data** directory (iOS Documents sandbox). Chosen instead of Preferences/UserDefaults because Apple documents UserDefaults as unencrypted and unsuitable for personal/sensitive data.
- **On save (native only):** after a successful `localStorage` write, Freedom mirrors state + backup meta keys. The “Saved locally ✓” toast appears only if the mirror write also succeeds; mirror failure shows the existing save-failure warning.
- **On launch (native only):** valid localStorage always wins. If localStorage is missing/corrupt/unreadable and a valid mirror exists, Freedom restores into localStorage and reloads. It never overwrites valid local data with empty/default data.
- **Encrypted Backup & export** remains the off-device recovery path (password-protected). Reset / fresh-start clears the native mirror too.

### Privacy / security

- The native mirror is **plaintext JSON** inside the app sandbox, covered by iOS Data Protection for app container files (available after first unlock). It is **not** application-level encrypted.
- Risk accepted for automatic recovery without a password when WebView storage is cleared. Off-device or shared copies should still use encrypted Backup & export.
- Uninstalling the app removes localStorage and the mirror. Device backups may include the sandbox file depending on the user’s backup settings.

## Notifications notes (no native push yet)

- Current reminders use **Web Push** + the service worker (and a Cloudflare Worker).
- WKWebView does not provide the same Web Push / service-worker notification behaviour as Safari PWA.
- Future native work should use `@capacitor/push-notifications` (APNs) with a carefully tested bridge; leave the PWA Web Push path intact for GitHub Pages users.

## After cloning

`ios/App/App/public` is gitignored (Capacitor default). Always run sync before opening Xcode:

```bash
npm install
npm run cap:sync
npm run cap:open
```

## Verification limits

- `npm run cap:sync` and the Capacitor staging test are verified with Node.
- Full Xcode compile/run was **not** completed in the agent environment: the active developer directory was Command Line Tools, and Xcode 26.6 was present under Downloads (`/Users/uxdesigner/Downloads/Xcode.app`). Point `xcode-select` at full Xcode, then build once locally so SPM can resolve `capacitor-swift-pm` 8.6.2.
