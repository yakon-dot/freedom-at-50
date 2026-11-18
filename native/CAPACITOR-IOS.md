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
- **SPM linking:** `CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift` retains a live `FilesystemPlugin` reference so Capacitor’s `packageClassList` + `NSClassFromString` registration can find the class. Depending on the package in `Package.swift` alone is not enough — unused SPM plugin classes can be dead-stripped, which surfaces in JS as `filesystem-unavailable`.
- **On save (native only):** after a successful `localStorage` write, Freedom mirrors state + backup meta keys on a **serialized write queue** (newest localStorage snapshot wins). The “Saved locally ✓” toast appears only if the mirror write also succeeds; mirror failure shows the existing save-failure warning.
- **On launch (native only):** hydrate finishes **before** the first interactive render/saves. Personal `persist()` stays blocked until ready. Valid localStorage usually wins; an empty local shell does **not** overwrite a richer valid mirror. Missing/corrupt/unreadable localStorage restores from a valid mirror and reloads.
- **Encrypted Backup & export** remains the off-device recovery path (password-protected). Restore reloads only after the native mirror write succeeds. Reset / fresh-start clears the native mirror **first** and aborts visibly if that clear fails.

### Privacy / security

- The native mirror is **plaintext JSON** inside the app sandbox, covered by iOS Data Protection for app container files (available after first unlock). It is **not** application-level encrypted.
- Risk accepted for automatic recovery without a password when WebView storage is cleared. Off-device or shared copies should still use encrypted Backup & export.
- Uninstalling the app removes localStorage and the mirror. Device backups may include the sandbox file depending on the user’s backup settings.

## Native monthly reminders (local notifications)

- **PWA path (unchanged):** Web Push + service worker + Cloudflare Worker (`0 17 28-31 * *` UTC, last calendar day only).
- **Native iOS path:** `@capacitor/local-notifications` schedules the next 12 end-of-month reminders at **17:00 local** on-device. No APNs, no Worker changes, no extra server cost.
- Why local (not APNs): Freedom’s reminder is a fixed monthly cadence with fixed copy. Local scheduling matches that without push certificates, Worker APNs integration, or ongoing push delivery cost. Trade-off: iOS may drop far-future local schedules if the app is unused for a long time — Freedom re-schedules the rolling 12-month window whenever reminders stay on and the app opens.
- **SPM linking:** `CapApp-SPM.swift` also retains `LocalNotificationsPlugin.self` (same dead-strip pattern as Filesystem).
- Tap handling uses the existing Home + one-shot companion check-in path (`freedomOpenHomeFromReminder` / `FreedomMonthlyReminderCheckIn`). Native and Web Push are mutually exclusive at runtime (`freedomRemindersNativeAvailable()`).
- **Apple Developer Program:** installing on a real iPhone / App Store still needs a paid membership (already required for the native shell). Local notifications do **not** need the Push Notifications capability, APNs keys, or App Store Connect push setup. Those are only required if Freedom later moves to remote APNs.

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
