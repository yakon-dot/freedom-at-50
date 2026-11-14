/* Freedom at 50 — public Web Push config only.
   Private VAPID keys never belong here or in any GitHub Pages asset. */
window.FREEDOM_PUSH = {
  /* Set after Cloudflare Worker deploy, e.g. "https://freedom-reminders.<account>.workers.dev" */
  apiBase: "",
  vapidPublicKey: "BFPyGIciDrTzc1TGVqjo8obBZvOMR02K5OJkibyWVwiuAQWxSrpEMdsZVSbI128qDzX98eA6MQAejyphAwL75vg",
  vapidSubject: "mailto:freedom-at-50-notifications@example.com"
};
