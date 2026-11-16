# Freedom Web Push Lab

Version `0.1.1`

This is a temporary, isolated diagnostic app for comparing two Web Push encryption implementations on an iPhone:

1. `@block65/webcrypto-web-push` running in a Cloudflare Worker, matching Freedom's current sender library and runtime.
2. `web-push` providing an independent encryption implementation in the same isolated Cloudflare runtime. A standalone Node host variant is also included for later use if runtime isolation becomes necessary.

It is not part of the Freedom PWA. It has its own manifest, service worker, app identity, subscription and test-only VAPID keys. Subscriptions are never stored by either sender.

## What the test distinguishes

The iPhone page records safe stages without exposing endpoints or keys:

- the test service worker and installed-app state;
- notification permission and subscription creation;
- encryption metadata from each sender;
- the push service HTTP status and APNs identifier, if returned;
- whether the service worker received and parsed decrypted payload bytes;
- whether the service worker requested notification display;
- whether a tap reached the service worker or the declarative navigation URL.

An APNs `201` is shown as "Apple accepted" rather than "delivered," because acceptance does not prove successful decryption or display.

## Isolation and secrets

- Do not reuse Freedom production VAPID keys.
- Generate one new test-only VAPID pair and configure the same pair on both temporary senders.
- Do not put the private key in the browser or commit it.
- The public key is returned by `/api/config`, as required for browser subscription.
- No KV, database, scheduled trigger or Freedom endpoint is used.
- Both send endpoints require a temporary access code held as a Worker secret.
- The endpoints accept only the fixed diagnostic message and server-generated navigation URL.
- No broadcast or subscription-list endpoint exists.
- The temporary senders should be removed after diagnosis.

## Deployment model, after explicit approval

The Cloudflare Worker serves the standalone HTTPS app and both independent encryption methods. Configure:

Cloudflare Worker secrets/variables:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `APP_ORIGIN`
- `LAB_ACCESS_CODE`

The optional standalone Node sender uses:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `APP_ORIGIN`
- `PORT`, if required by the host

The repository's `npm run deploy` command intentionally refuses to deploy. Deployment must remain an explicit, reviewed action.

## iPhone test sequence

1. Open the separate HTTPS Push Lab link in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Open **Push Lab** from the Home Screen.
4. Enter the temporary access code supplied with the link.
5. Tap **Enable test notifications** and allow notifications.
6. Tap **Test A: Current Cloudflare method**.
7. Read the banner. It must say **Freedom Push Lab** and the exact diagnostic sentence.
8. Tap the banner. Confirm Push Lab opens and records the tap.
9. Return to Push Lab and tap **Test B: Independent Node method**.
10. Repeat the same banner and tap checks.
11. Tap **Copy safe diagnostics** and share only that output. It excludes the subscription endpoint and keys.

Run one sender at a time so the observed banner can be matched unambiguously.

## Removal after testing

Delete only the temporary Worker named `freedom-web-push-lab`. Removing that Worker also removes its encrypted test VAPID keys, access code, HTTPS endpoints and uploaded lab assets. It does not touch `freedom-reminders`, GitHub Pages or any Freedom subscription.

After the Worker is removed, delete the **Push Lab** icon from the iPhone Home Screen. Its local test subscription will no longer have a sender or valid private key and cannot receive another lab notification.
