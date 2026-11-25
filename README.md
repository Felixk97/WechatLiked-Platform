# My Apps — updated Netlify launcher

## Deploy
1. Upload the entire project ZIP to a Git repository and connect it to Netlify (or deploy using Netlify CLI with a build that bundles functions).
2. Set the `ADMIN_PASSWORD` environment variable in Netlify Site configuration. Use a unique, long password.
3. Deploy with `netlify.toml` at the repository root. Netlify serves `public/` and deploys `netlify/functions/`.
4. Confirm `/api/apps` returns JSON, then log in and add your applications.
5. Test iframe embedding and camera permissions on your actual Netlify app domains.

## Availability checks
`/api/status` checks any public `https://` app, custom domains included. The hostname is resolved once, rejected if any address is private or internal, and the request then connects to that exact address (TLS still verifies the certificate), so DNS rebinding can't redirect it inward. Redirects are not followed, and requests have timeouts.

## Notes
- Each embedded application must permit embedding from your launcher origin via its own CSP `frame-ancestors` policy.
- Cross-origin app content cannot be inspected for unsaved changes. The launcher confirms before closing tabs.
- The browser-based fullscreen API and camera permissions vary by platform.
- Production login-rate-limit counters stored in Blobs are not guaranteed atomic; for a publicly exposed high-risk admin endpoint, use an edge/WAF rate limiter or a transactional store.

## Version 8 changes
- Server-side revocable opaque admin sessions: logout deletes the session token from Blobs. Old cookies from earlier versions no longer authenticate.
- Stronger app import validation: reject invalid URLs, duplicate URLs/IDs and malformed image data instead of silently dropping records.
- Request size guard, safer tab handling, accurate max-tab toast, restricted service worker navigation caching.
- Optional tab limit: set `localStorage.setItem("maxTabs", "8")` in the browser console (1–12), then reload. Default remains six.

## Important production considerations
- Login attempt counters stored in Blobs are not atomic. Add a platform/WAF rate limiter for public exposure.
- Revoked sessions are removed on logout, but expired session records may remain in storage until cleaned up.
- Embedded Netlify apps need appropriate CSP `frame-ancestors` headers; cross-origin camera access requires browser/device testing.
- A static code review and syntax checks are not a substitute for a live Netlify deployment test.

## Version 9 workspace additions
- Grid, list and compact layouts; small/normal/large cards
- Optional folders and descriptions, searchable alongside categories
- Dashboard welcome summary, date, favorites and running app count
- Plain, soft-blue and warm backgrounds
- Configurable maximum of 1–12 embedded tabs
- Subtle card transitions respecting reduced-motion preferences

### Deployment and security limitations
- Deploy the full project via Netlify with ADMIN_PASSWORD configured.
- Existing apps are preserved by the backend, but back up your app collection before updating.
- These are source-level changes; live Netlify, PWA and camera/iframe behavior require device testing.
- Atomic distributed login rate limiting, synchronized cross-device analytics, and automated expired-session garbage collection are not implemented. They require additional infrastructure and production verification. Current per-IP limiting is best-effort.
- The parent launcher cannot override X-Frame-Options/CSP on child sites or inspect cross-origin unsaved forms.

## Version 10 offline improvements
- Optional manual cross-device sync of favorites, launch counts and display preferences using Netlify Blobs (`/api/sync`). Open **Sync across devices**, enter the same long private key on each device, Upload on one device and Download on another. Download **replaces** local settings and counts; concurrent edits are not merged. Do not use the admin password as the sync key. The key is not saved in browser storage, but data is not end-to-end encrypted and anyone possessing the key can overwrite it. Treat launch counts as convenience statistics, not audit logs.
- Iframe permissions explicitly include camera, microphone, clipboard-write and fullscreen; added camera guidance and an external tab fallback. Camera behavior still depends on browser, permissions policy and each app's own settings.
- Existing authentication and session expiry behavior retained; atomic rate limiting and automatic expired-session cleanup intentionally not prioritized.
- This is an offline build. Live Netlify deployment, Blob persistence and mobile camera permissions cannot be verified until deployment credits are available.

## Version 11 backend upgrades
- Status checks work for custom domains again, using the DNS-pinned connection described above.
- Each successful login now removes expired admin sessions and stale lockout records (up to 50 of each per login), so storage no longer fills with old entries.
- Request bodies in `/api/apps` and `/api/sync` are measured as received instead of trusting the Content-Length header, and non-object JSON is rejected cleanly instead of causing a server error.
- Unchanged and still best-effort: login attempt counting is not atomic, so add a WAF or edge rate limiter if the site is widely exposed.

## Version 12 changes
- **Automatic cross-device sync (merge, not replace).** Tick "Remember key and sync automatically" in the sync panel. The launcher then syncs on open, when you return to the tab, every 5 minutes, and a few seconds after you change a favorite, a setting or open an app. Favorites and settings follow the newest change on any device, and launch counts are kept per device and added up, so nothing is overwritten. Merging gives the same result in any order, so if two devices save at the same moment and one write is lost, the next sync restores it. The key is stored in this browser while auto-sync is on, and the data is not end-to-end encrypted.
- **Fixed in this version:** v10 had no route for `/api/sync`, so sync could never have worked. `sync.mjs` now declares it. Data saved by the old manual sync is migrated (favorites and settings; old usage counts are not carried over).
- **Embedding detection.** `/api/status` now also reads each app's `X-Frame-Options` and `Content-Security-Policy: frame-ancestors` headers, the same ones a browser enforces. Apps that refuse embedding are marked "opens in tab" and open in a new tab automatically. The "not loading" bar offers **Copy embed fix** (the `_headers` line for your own apps) and, for the admin, **Always open in new tab**.
- **Install help.** Chrome and Android show an Install button. iPhone and iPad show a one-time "Share, Add to Home Screen" tip. The viewer uses dynamic viewport height and blocks pull-to-refresh bounce.
- **Request limits.** `/api/apps` and `/api/sync` now stop reading as soon as a body passes the limit, so oversize requests can't use memory first. Array and non-object bodies are rejected.

Still untested on real hardware: embedded camera (Sample Tally) on Android and iPhone, PWA install and fullscreen on devices, TLS to real custom domains from Netlify's runtime, and the sync endpoint against live Blobs.

## V12 Android / iPhone readiness
Open Device setup & camera test on your phone, tap Test camera, confirm preview, then stop. Test Sample Tally's barcode scanner separately inside the iframe; parent camera permission does not guarantee embedded camera permission. Sample Tally must use HTTPS and allow embedding and camera through its own security policy. Android: Chrome Install app; iPhone: Safari Share → Add to Home Screen. Relaunch from home screen and check standalone indicator. iPhone may not support native fullscreen; immersive CSS mode is available. Actual device testing and live Netlify deployment have not been performed.

## V12 mobile-ready fixes
- The camera preview box no longer shows as an empty block before you tap Test camera (an inline style was overriding the `hidden` attribute).
- Leaving native fullscreen with Esc or a system gesture now also leaves immersive mode (that listener had been removed).
- The launcher's camera test is stopped automatically when you open any app, because some phones can't give the camera to two pages at once and the embedded scanner would fail.
- Iframe permissions use `camera *` style allow-lists. That also lets pages the app navigates to, or nests, use the camera. Narrow them back to plain `camera; microphone` if your apps embed third-party frames.
