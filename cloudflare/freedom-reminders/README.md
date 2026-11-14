# Freedom reminders (Cloudflare Worker)

Minimal Web Push backend for optional monthly Freedom check-ins.

Freedom itself stays on GitHub Pages. This Worker only:

- accepts push subscriptions
- removes them on opt-out
- sends one fixed notification near month-end
- offers a self-test and an admin test send

## Do not deploy without approval

This folder is prepared for review. Do not run `wrangler deploy` until credentials and costs are confirmed.

## Secrets (never commit)

| Secret | Purpose |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Same public key as `freedom-push-config.js` |
| `VAPID_PRIVATE_KEY` | Private VAPID key — Cloudflare secret only |
| `VAPID_SUBJECT` | Optional contact `mailto:` for VAPID |
| `ADMIN_TOKEN` | Bearer token for `POST /admin/test` |

Optional: `ALLOWED_ORIGIN` (CORS allowlist; default `*`).

## KV

Binding name: `REMINDERS`

Stores only:

- `sub:<hash>:<len>` → `{ endpoint, keys.p256dh, keys.auth, expirationTime, updatedAt }`
- `meta:lastBroadcast` → `YYYY-MM` (dedupe)

No accounts, names, or financial data.

## Cron

`0 17 28-31 * *` (17:00 UTC on days 28–31). The handler sends only when that UTC day is the last calendar day of the month, and only if `meta:lastBroadcast` is not already this month.

## Endpoints

- `POST /subscribe` — body: PushSubscription JSON
- `POST /unsubscribe` — body: `{ endpoint }`
- `POST /test-self` — body: `{ endpoint }` (sends only if that endpoint is stored)
- `POST /admin/test` — `Authorization: Bearer <ADMIN_TOKEN>`; optional `{ endpoint }` or broadcast all
- `GET /health` — liveness

## Setup sketch (after approval)

1. Cloudflare account with Workers + KV enabled.
2. `npx wrangler login`
3. Create KV namespace; put ids in `wrangler.toml`.
4. `npx wrangler secret put VAPID_PRIVATE_KEY` (and public/subject/admin).
5. Deploy; put the Worker URL into `freedom-push-config.js` `apiBase`.
6. Redeploy GitHub Pages so the app points at the Worker.
