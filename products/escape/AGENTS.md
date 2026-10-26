# Install escape-webview

You are an agent installing this widget into the user's website. Follow these
steps in order. This file is the contract — prefer it over guessing.

Also read as `CLAUDE.md` (symlinked). Works with Claude Code, Codex, Cursor, or
any agent that can read a repo and edit files.

---

## What this does

Links opened from X, Instagram, Facebook, TikTok and similar apps run inside a
stripped-down in-app browser. Sign-in, saved passwords, extensions and payment
autofill are unavailable there. This widget detects that and gets the user into
their real browser.

**One file, no dependencies, no build step.** 10 KB gzipped.

---

## Step 1 — Work out where static files live

Find the directory this site serves static assets from, and the HTML file (or
template/layout) that every page shares.

| Stack | Static dir | Shared HTML |
|---|---|---|
| Next.js | `public/` | `app/layout.tsx` or `pages/_document.*` |
| Astro | `public/` | `src/layouts/*.astro` |
| SvelteKit | `static/` | `src/app.html` |
| Nuxt | `public/` | `app.vue` or `nuxt.config` head |
| Rails | `public/` | `app/views/layouts/application.html.erb` |
| Django | `static/` | `templates/base.html` |
| Hugo / Jekyll | `static/` / `assets/` | `layouts/_default/baseof.html` / `_layouts/default.html` |
| Plain HTML | site root | every page, or the shared include |

If you cannot identify one confidently, **ask the user** rather than guessing.

## Step 2 — Copy the widget

Copy `src/escape-webview.js` into the static directory. Do not fetch it from a
CDN: self-hosting keeps the site inside a strict `script-src 'self'` CSP and
means no third party can change what runs on their page.

```bash
cp src/escape-webview.js <static-dir>/escape-webview.js
```

## Step 3 — Add one line to the shared HTML

Inside `<head>`, or immediately before `</body>`:

```html
<script src="/escape-webview.js?v=1" defer data-auto data-name="Site Name"></script>
```

- `data-auto` — required; without it nothing runs automatically.
- `data-name` — the site name shown in the card. Use the real product name.
- `?v=1` — **bump this whenever you update the file.** CDNs cache aggressively;
  without a bump, visitors keep the old copy.

## Step 4 — Check the Content Security Policy

If the site sends a CSP (check server config, meta tags, or the host's headers):

- `script-src` must allow `'self'`. Self-hosting per Step 2 satisfies this.
- **No `style-src` change is needed.** The card styles itself with a
  constructable stylesheet, which CSP does not govern.
- If you enable telemetry (Step 6), `connect-src` must allow the endpoint.

Do not add `'unsafe-inline'` for this widget. It does not need it.

## Step 5 — Verify

The card only appears inside an in-app browser, so a normal browser correctly
shows nothing. Verify by spoofing the User-Agent:

```bash
curl -s -A "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) \
AppleWebKit/605.1.15 Mobile/15E148 Twitter for iPhone/12.21" \
  https://<site>/ | grep -o 'escape-webview.js[^"]*'
```

That confirms it is wired in. To confirm it *renders*, load the page in a
headless browser with that UA and check for `#escape-webview-root`.

Then have the user post the link to X and open it from the app. **Tell them
what to expect:** on iOS the card teaches a two-tap gesture (tap the address
bar → "Open in browser"). It does not escape automatically, and it cannot —
see "Honest limits" below.

## Step 6 — Analytics (ask the user first)

**Their own analytics: automatic, nothing to configure.** If `gtag`, `plausible`,
`posthog`, `umami`, `fathom`, or `dataLayer` is already on the page, the widget
emits to it. Events are prefixed `escape_webview_`:

| Event | Meaning |
|---|---|
| `shown` | Card displayed |
| `copy` / `copy_failed` | Copy link tapped |
| `escape_click` | An escape button tapped |
| `escaped` | The app actually handed off |
| `escape_blocked` | The app refused |
| `dismiss` | "Not now" |

To turn that off: `data-analytics="off"`.

For anything custom:

```js
EscapeWebview.on(function (event, data) {
  // data = { event, app, os }
});
```

**Project telemetry: opt-in, off by default.** Adding `data-telemetry` sends an
anonymous ping to the project maintainers so they can count installs and see
which apps are blocking what.

```html
<script src="/escape-webview.js?v=1" defer data-auto data-telemetry></script>
```

It sends only `{ event, app, os, domain, v }` — no URL, no path, no referrer,
no visitor ID, no cookie, no fingerprint — and respects Do Not Track and Global
Privacy Control.

**Do not enable this without the user's explicit agreement.** It transmits their
visitors' data to a third party, which may make them a data controller under
GDPR/CCPA. Point them at `data-telemetry="https://their-own-endpoint"` if they
want the same events sent somewhere they control instead.

---

## Full attribute reference

| Attribute | Purpose |
|---|---|
| `data-auto` | Required. Run on load. |
| `data-name="X"` | Site name shown in the card |
| `data-url="https://…"` | Escape to a different URL than the current page |
| `data-app-ios="…"` | Universal link / scheme for your iOS app |
| `data-app-android="…"` | Universal link / scheme for your Android app |
| `data-force` | Also show in desktop browsers, for development |
| `data-analytics="off"` | Disable auto-detected analytics |
| `data-telemetry` | Opt in to anonymous project telemetry |
| `data-telemetry="https://…"` | Send those events to your own endpoint |

---

## Honest limits — tell the user these

Do not promise an automatic escape on iPhone. It does not exist.

- **Android: fully automatic.** An `intent://` URL hands the link to the real
  browser without the user doing anything.
- **iOS: guided, not automatic.** Measured in X for iPhone 12.21 on iOS 26.6,
  with a bogus-scheme control to catch false positives: **11 of 11 custom-scheme
  routes are blocked** (`googlechromes://`, `x-safari-https://`,
  `firefox://open-url`, `x-web-search://`, `googlechrome-x-callback://`,
  `shortcuts://`, and the same again via hidden iframe). `window.open` only
  yields another tab inside the same in-app browser. So on iOS the card teaches
  the host app's own menu gesture and offers Copy link.

The only clean iOS escape is a **universal link** to a native app you own, which
requires an App Store app and an `apple-app-site-association` file on the domain.

If a site genuinely works fine inside the in-app browser, the honest advice is
**not to install this**. Interrupting every visitor with a two-tap chore costs
more than it returns. It earns its place when sign-in, passwords, extensions or
payments are actually involved.

---

## Do not

- Do not load the widget from a CDN when a strict CSP is in play.
- Do not enable `data-telemetry` without asking.
- Do not add `'unsafe-inline'` to the CSP for this.
- Do not claim iOS auto-escape in any copy you write for the user.
- Do not install it on a site that has no reason to need it.
