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

## Storage notes (no migration yet)

- Freedom already persists financial state in **localStorage** (`freedom50-mobile-v1` and related `freedom50-*` keys).
- Inside Capacitor’s WKWebView, localStorage continues to work for that WebView origin. It is **not** shared with Safari / Home Screen PWA storage.
- localStorage can still be cleared if the app is deleted, or in rare WebView data-loss cases. It is not a backup target.
- Safest near-term native approach (future task): keep localStorage as the live store, then add a Capacitor Preferences or filesystem mirror plus the existing encrypted backup/export flow for restore. Do not replace storage until that path is tested end-to-end.

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
