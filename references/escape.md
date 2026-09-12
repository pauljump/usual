# Escape

Help visitors leave a website's in-app browser when sign-in, saved passwords,
extensions, or payment autofill need their regular browser. Escape installs into
a website. [Pop](https://tryusual.com/pop/) changes the links a coding agent writes;
it is a separate tool. Neither requires Choices, history import, or an account.

Escape is a pinned integration of MIT-licensed
[escape-webview](https://github.com/pauljump/escape-webview), included in the
[Usual collection](https://github.com/pauljump/usual). That upstream repository
remains the widget's canonical source.

## Try

Open `/escape/demo/` on the local Usual preview. It is explicitly a **forced desktop
demonstration**: pressing the demo button renders the real widget with automatic
navigation, analytics, and telemetry disabled. A normal browser with the standard
snippet should correctly show no card. A rendered demo is not device verification.

## Install into an explicitly selected website

Identify that website's static directory and shared layout. Copy the distributed
`src/usual/vendor/escape_webview/escape-webview.js` into its static directory,
and keep `src/usual/vendor/escape_webview/LICENSE` alongside it as
`escape-webview.LICENSE`. Add this to its shared HTML:

```html
<script src="/escape-webview.js?v=1.0.0-usual.1" defer data-auto data-analytics="off"></script>
```

The website serves this file from its own origin. For a hosted Usual download the
same reviewed distribution file is available at `/escape/escape-webview.js`.
Inspect before copying. Preserve an existing site's asset or customization when
names conflict; choose another explicit filename or review a diff before replacing it.
Bump the cache version when updating. Do not point production pages at a mutable CDN.

The snippet disables automatic forwarding to an existing site's analytics. It omits
`data-telemetry`, so upstream telemetry stays off. Do not add telemetry or custom
network endpoints without the website owner's current approval. No third-party
fonts, styles, or script dependencies are required by the widget.

Self-hosting needs the site's `script-src` to allow its own origin. Do not weaken
the Content Security Policy to install it. Modern browsers use a constructable
stylesheet in Shadow DOM. Older browsers may use a fallback style that a strict
policy blocks; test the site's actual browser and CSP combination.

The first release supports the website snippet. The upstream interstitial wrapper
is not enabled by Usual. A broad `?u=` redirect is not installed.

## Use and verify

Normal browsers should show nothing. The widget detects known in-app-browser
user-agent tokens. Detection can miss apps or change as apps update; it is not
a complete inventory of browser capabilities.

On iOS the card provides the app's own menu gesture and Copy link. **It does not
escape automatically.** Upstream reports device verification only for X for
iPhone 12.21 on iOS 26.6. Usual has not independently repeated that device check.
Other menu instructions remain starting points that require actual device testing.

On detected Android webviews it attempts an `intent://` navigation and presents
a button fallback. A scripted intent attempt does not establish successful escape
on a real Android app or device. Chrome Custom Tabs can look like ordinary Chrome
and may already provide the regular browser session.

Verify in stages: inspect the copied script hash and layout inclusion; test normal
and spoofed in-app user agents in a browser; then open the actual website inside
the target app on the actual device. Record client/app/OS versions and the observed
gesture or handoff. Keep installation status separate from script, browser-render,
and device-behavior verification. Device checks remain pending for this Usual release.

## Inspect, edit, remove

The script is readable JavaScript with no build dependency. Configuration can add
`data-name="Your website"`; for a custom URL or app deep link, inspect the upstream
API and explicitly review the destination. The default uses the current page URL.

Remove the specific script tag to disable the widget. Remove the owned JS and
license only when no page uses them and you have inspected whether they were edited.
Preserve unrelated site changes and shared assets. Usual's local setup removal
retains copied website assets for that review.

## Source, license, and update strategy

Pinned upstream: `escape-webview` v1.0.0, commit
`8ded426d530638ea334bfd137345114973f3d602`.

The vendor directory contains the exact `escape-webview.upstream.js`, MIT `LICENSE`,
the chosen distribution `escape-webview.js`, and a `source.json` manifest with hashes.
The distribution has one recorded patch: `GUIDE.menu.trigger` → `GUIDE.menu.tap`.
The upstream generic fallback used a nonexistent field and rendered “undefined”; the
patch uses the existing field. No telemetry or navigation behavior is changed.

Distribution version: `1.0.0+usual.1`.
Distribution SHA-256: `cd94ccce483e2be8aa973feb345fdcdad80bce4511c37484df5eed571ac81c39`.
Upstream SHA-256: `d0bfd537046e22021070c26a33c6af8e54d9a073d9fed3bec37f948905268b46`.

To update, review an explicit upstream commit, replace the source snapshot and
license, review or retire the one-line patch, regenerate the distribution, and
update both hashes and the cache version. Only the distribution file is installed
or served. Never fetch “latest” at runtime. Keep MIT attribution in all copies.

`python3 -m pytest -q tests/test_collection_escape.py` checks exact pin and patch
reproducibility, synthetic client detection/render paths, iOS non-navigation,
Android intent attempts, copy success/failure, dismissal, duplicate initialization,
unsafe URL rejection, HTML escaping, and telemetry-disabled configuration.
Its JavaScript checks need Node and use a deterministic DOM stub. They do not prove
real browser layout, app escape, or device support; browser inspection and physical
device verification are separate records.
