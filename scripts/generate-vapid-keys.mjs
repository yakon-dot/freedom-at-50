#!/usr/bin/env node
/** Generate VAPID keys for Freedom reminders. Private key stays out of git. */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log(JSON.stringify({
  publicKey: keys.publicKey,
  privateKey: keys.privateKey,
  subject: "mailto:freedom-at-50-notifications@example.com",
  note: "Put publicKey in freedom-push-config.js. Put privateKey in Cloudflare secret VAPID_PRIVATE_KEY only."
}, null, 2));
