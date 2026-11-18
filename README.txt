Freedom at 50 — deploy-ready web app

Files:
- index.html
- manifest.webmanifest
- service-worker.js
- icon-192.png
- icon-512.png

Deployment:
Upload the entire folder to any static host such as GitHub Pages, Netlify, or Vercel.
(Native Capacitor iOS files under ios/ and native/ are separate and do not change GitHub Pages behaviour.)

After deployment on iPhone:
1. Open the live URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Launch Freedom at 50 from the new icon.

The app stores figures locally in the browser on that device.

Native iOS (Capacitor preparation):
See native/CAPACITOR-IOS.md for bundle ID, sync commands, and opening the Xcode project.
