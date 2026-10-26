# escape-webview

Links opened inside the **X, Instagram, Facebook, TikTok, LINE, …** apps run in a
stripped-down in-app browser (a webview). Sign-in, browser extensions, saved
passwords and payment autofill often break there. `escape-webview` detects that
situation and gets the user into their **real browser** — automatically where the
OS allows it, and with a clean one-tap card where it doesn't.

One file, no dependencies, no build step. 10 KB gzipped. MIT.

**[Try it: pauljump.github.io/escape-webview](https://pauljump.github.io/escape-webview/)**
— the project runs the widget on its own homepage. Open that link from inside X
and the card appears. Open it in Safari and nothing happens, which is the point.

**Point your coding agent at this repo and it installs itself** — [`AGENTS.md`](AGENTS.md)
is written for Claude Code, Codex, Cursor or similar:

> Install https://github.com/pauljump/escape-webview into this site. Follow AGENTS.md.

---

## Two ways to use it

### 1. Wrap your links (nothing to add to your site)

Put both files at the root of any static host (Cloudflare Pages, GitHub Pages,
Netlify, Vercel) — they must sit next to each other:

```
your-deploy/
  index.html          <- copy of interstitial/index.html
  escape-webview.js   <- copy of src/escape-webview.js
```

**Then edit `ALLOW_HOSTS` in `index.html`.** It ships empty and an empty list
forwards nothing — that's deliberate. A `?u=` endpoint that accepts any URL is an
open redirect, and phishing crawlers find those fast. List each hostname you
actually link to (subdomains are not implied):

```js
var ALLOW_HOSTS = ['yoursite.com', 'www.yoursite.com'];
```

Now share links shaped like:

```
https://go.yoursite.com/?u=https://yoursite.com/the-real-page
```

Post *that* URL on X. When it opens in the in-app browser, the card appears.
In a normal browser it redirects straight through — the user sees nothing.

Optional query params: `&name=Your%20Site`, `&app_ios=…`, `&app_android=…`.

### 2. One line on your own page

Self-host `src/escape-webview.js` (one file, no build step). Self-hosting also
keeps you inside a strict `script-src 'self'` CSP:

```html
<script src="/escape-webview.js" data-auto></script>
```

It runs on page load, does nothing in a normal browser, and shows the card when
it detects an in-app browser. Optional attributes:

| Attribute | Purpose |
|---|---|
| `data-name="My Site"` | Label shown in the card |
| `data-app-ios="https://…"` | Universal link / scheme for your iOS app |
| `data-app-android="https://…"` | Universal link / scheme for your Android app |
| `data-force` | Also show in desktop browsers (for development) |
| `data-url="https://…"` | Escape to a different URL than the current page |

> Not on npm yet — `npm i escape-webview` will 404 until it's published. Copy the
> single file from [`src/`](src/) for now.

### Programmatic

```js
// Load src/escape-webview.js first (a <script> tag without data-auto).

if (EscapeWebview.isInApp()) {
  EscapeWebview.init({
    url: 'https://yoursite.com/post',
    name: 'Your Site',
    app: { ios: 'https://yoursite.com/post', android: 'https://yoursite.com/post' }
  });
}
```

---

## What actually happens per platform

| Situation | Behaviour |
|---|---|
| **Android** in-app browser | Auto-jumps to the default browser via an `intent://` URL. "Open in browser" button is the backup. |
| **iOS** in-app browser | iOS gives webviews **no** way to launch Safari programmatically. The card offers: **Copy link**, **Open in Chrome / Firefox** (if installed), a best-effort "Try to open", and app-specific instructions for the built-in "Open in browser" menu item. |
| **App installed** + `app` deep link configured | "Open in the app" button (universal link / custom scheme). |
| **Normal browser** | Snippet: nothing. Interstitial: instant redirect. |

The honest summary: **Android escape is automatic; iOS is assisted, not automatic.**
That's an Apple platform limitation, not something any library can work around.

---

## Detected apps

X (Twitter), Instagram, Threads, Facebook, Messenger, TikTok, Reddit, WhatsApp,
LinkedIn, Pinterest, Snapchat, LINE, WeChat, KakaoTalk, the Google app, Slack,
Discord.

> **X on Android** opens links in Chrome Custom Tabs, which report a plain Chrome
> User-Agent and are undetectable. That's fine — Custom Tabs *are* the real
> browser, with your cookies and passwords. The problem this library solves is
> the iOS in-app webview.

> **Only X's instructions are device-verified** (X for iPhone 12.21, iOS 26.6).
> The wording for Instagram, Facebook and TikTok comes from their documented
> UI — and documentation was wrong about X, so treat it as a starting point.
> If you catch one being wrong, the fix is one line in the `GUIDE` table in
> [`src/escape-webview.js`](src/escape-webview.js). PRs very welcome.

Detection is allowlist-based on the User-Agent string, so normal Safari / Chrome
users are never shown the overlay by mistake. Add more in `APPS` in
[`src/escape-webview.js`](src/escape-webview.js).

## Content Security Policy

The card is styled with a constructable stylesheet inside a Shadow DOM, so it
renders under a strict `style-src 'self'` (no `'unsafe-inline'` needed). If you
self-host `escape-webview.js`, `script-src 'self'` is enough — no CDN entry
required. Engines without constructable stylesheets (iOS Safari < 16.4) fall back
to an injected `<style>`, which a strict `style-src` will block. On that path the
host element is positioned inline instead, so the card is still a full-screen
overlay with working buttons — it just loses the card styling.

---

## Analytics

**Your own: zero config.** If `gtag`, `plausible`, `posthog`, `umami`, `fathom`
or `dataLayer` is already on the page, the widget emits to it automatically.
Events are prefixed `escape_webview_`:

| Event | Meaning |
|---|---|
| `shown` | Card displayed |
| `copy` / `copy_failed` | Copy link tapped |
| `escape_click` | An escape button tapped |
| `escaped` | The app actually handed off |
| `escape_blocked` | The app refused |
| `dismiss` | "Not now" |

Turn it off with `data-analytics="off"`. For anything custom:

```js
EscapeWebview.on(function (event, data) {   // data = { event, app, os }
  myAnalytics.track(event, data);
});
```

**Project telemetry: opt-in, off by default.**

```html
<script src="/escape-webview.js" defer data-auto data-telemetry></script>
```

That sends `{ event, app, os, domain, v }` to the maintainers — no URL, no path,
no referrer, no visitor ID, no cookie, no fingerprint — and honours Do Not Track
and Global Privacy Control. It exists so the project can count installs and see
which apps block which techniques.

It is **off unless you add that attribute**, and it should stay off unless you
mean it: enabling it transmits your visitors' data to a third party and can make
you a data controller under GDPR/CCPA. A tool whose entire premise is *"in-app
browsers take things from you"* has no business quietly taking something back.
Point it at your own collector instead with `data-telemetry="https://you/…"`.

---

## Develop

```
npm run serve   # http://localhost:8080/examples/snippet.html
```

Test on a phone by opening the served URL from a DM to yourself in the target app.

## Contributing

Issues and PRs welcome — especially new in-app browser fingerprints and better
per-app iOS instructions. No CLA.
