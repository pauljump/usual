/*!
 * escape-webview v1.0.0
 * Break out of in-app browsers (X, Instagram, Facebook, TikTok, LINE, ...) into
 * the user's real browser -- or, when the OS forbids that, show a one-tap card
 * with a working alternative.
 *
 * MIT License. https://github.com/pauljump/escape-webview
 *
 * Usage (snippet mode, on your own page):
 *   <script src="/escape-webview.js" data-auto></script>
 *
 * Usage (programmatic):
 *   EscapeWebview.init({ url: 'https://example.com/post', name: 'Example',
 *                      app: { ios: 'https://...', android: 'https://...' } });
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  var W = window, D = document, UA = navigator.userAgent || '';

  /* ---- in-app browser fingerprints ---------------------------------------- */
  /* Only known tokens are matched, so a normal Safari/Chrome user is never
     shown the overlay by accident. */
  var APPS = [
    { re: /Twitter/i,                     key: 'x',        name: 'X' },
    { re: /Instagram/i,                   key: 'instagram', name: 'Instagram' },
    { re: /Messenger(?:ForiOS|Lite)|\bMessenger\b/i,
                                          key: 'facebook', name: 'Messenger' },
    { re: /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, key: 'facebook', name: 'Facebook' },
    { re: /musical_ly|Bytedance|TikTok/i, key: 'tiktok',   name: 'TikTok' },
    { re: /Barcelona/i,                   key: 'instagram', name: 'Threads' },
    { re: /Reddit\//i,                    key: 'menu',     name: 'Reddit' },
    { re: /WhatsApp/i,                    key: 'menu',     name: 'WhatsApp' },
    { re: /LinkedInApp/i,                 key: 'menu',     name: 'LinkedIn' },
    { re: /Pinterest/i,                   key: 'menu',     name: 'Pinterest' },
    { re: /Snapchat/i,                    key: 'menu',     name: 'Snapchat' },
    { re: /\bLine\//i,                    key: 'menu',     name: 'LINE' },
    { re: /MicroMessenger/i,              key: 'menu',     name: 'WeChat' },
    { re: /KAKAOTALK/i,                   key: 'menu',     name: 'KakaoTalk' },
    { re: /GSA\//i,                       key: 'menu',     name: 'the Google app' },
    { re: /\bSlack\b/i,                   key: 'menu',     name: 'Slack' },
    { re: /Discord/i,                     key: 'menu',     name: 'Discord' }
  ];

  /* Each app's own "leave this browser" affordance, described precisely enough
     to draw a replica of it. Verified against X for iPhone 12.21 on iOS 26.6:
     the control is the kebab next to the address in the BOTTOM bar, and the
     item is "Open in browser" -- not the share icon, and not "Open in Safari".
     Other apps are from their documented UI; correct them as you verify. */
  var GUIDE = {
    x: {
      // Verified on device: tapping anywhere on the address pill opens the
      // sheet. The kebab works too but is a far smaller target, so aim at
      // the pill.
      tap: 'the address bar', where: 'at the bottom of this screen',
      pointer: 'down', bar: true,
      menu: [['share', 'Share'], ['globe', 'Open in browser'], ['copy', 'Copy link']]
    },
    instagram: {
      tap: 'the \u2022\u2022\u2022 button', where: 'at the top right',
      pointer: 'up', bar: false,
      menu: [['copy', 'Copy link'], ['globe', 'Open in external browser']]
    },
    facebook: {
      tap: 'the \u2022\u2022\u2022 button', where: 'at the top right',
      pointer: 'up', bar: false,
      menu: [['copy', 'Copy link'], ['globe', 'Open in external browser']]
    },
    tiktok: {
      tap: 'the \u2022\u2022\u2022 button', where: 'at the top right',
      pointer: 'up', bar: false,
      menu: [['share', 'Share'], ['globe', 'Open in browser']]
    },
    menu: {
      tap: 'the \u2022\u2022\u2022 button', where: 'in this browser\u2019s toolbar',
      pointer: null, bar: false,
      menu: [['globe', 'Open in browser']]
    }
  };

  // Inline so the card never makes a network request for chrome it needs now.
  var ICONS = {
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M12 4 7 9M12 4l5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/></svg>',
    copy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>'
  };

  var ANDROID_HINT =
    'Tap \u22ee at the top-right, then \u201cOpen in browser\u201d or \u201cOpen in Chrome\u201d.';

  function detect() {
    for (var i = 0; i < APPS.length; i++) {
      if (APPS[i].re.test(UA)) return APPS[i];
    }
    return null;
  }

  var isIOS = /iPhone|iPod|iPad/i.test(UA) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(UA);

  /* ---- helpers ----------------------------------------------------------- */
  function safeHttp(u) {
    try {
      var p = new URL(u, location.href);
      if (p.protocol === 'http:' || p.protocol === 'https:') return p.href;
    } catch (e) {}
    return null;
  }

  // Deep links legitimately use custom schemes (myapp://) or https universal
  // links, so safeHttp() is too strict here. Deny the script-bearing schemes
  // instead: esc() stops attribute breakout but would happily emit
  // href="javascript:...", which fires on tap.
  var BAD_SCHEME = /^(?:javascript|data|vbscript|file|blob):/i;
  function safeDeepLink(u) {
    if (!u || typeof u !== 'string') return null;
    // Browsers ignore control characters and whitespace when resolving a URL,
    // so "java\tscript:alert(1)" still executes. Normalise before testing.
    var clean = u.replace(/[\u0000-\u0020]/g, '');
    return BAD_SCHEME.test(clean) ? null : u;
  }

  // Android: an intent:// URL asks the OS to hand the link to a real browser
  // instead of re-opening it inside the current app's webview.
  function toIntent(url) {
    var rest = url.replace(/^https?:\/\//i, '').split('#')[0];
    return 'intent://' + rest +
      '#Intent;scheme=https;action=android.intent.action.VIEW;' +
      'category=android.intent.category.BROWSABLE;' +
      'S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
  }

  function chromeUrl(u) {
    return u.replace(/^https:/i, 'googlechromes:').replace(/^http:/i, 'googlechrome:');
  }

  // Ask the OS to handle a custom scheme from a subframe. Webviews that block
  // top-level scheme navigation sometimes still honour this; the iframe is torn
  // down either way so nothing is left behind.
  function iframeHit(href) {
    try {
      var f = D.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.style.display = 'none';
      f.style.width = f.style.height = '0';
      f.style.border = '0';
      (D.body || D.documentElement).appendChild(f);
      try { f.contentWindow.location.href = href; } catch (e) { f.src = href; }
      setTimeout(function () { f.parentNode && f.parentNode.removeChild(f); }, 2000);
    } catch (e) {}
  }
  function firefoxUrl(u) {
    return 'firefox://open-url?url=' + encodeURIComponent(u);
  }

  function copy(text, done) {
    var settled = false;
    function finish(ok) { if (!settled) { settled = true; done(ok); } }

    function legacy() {
      try {
        var ta = D.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');   // stops iOS zooming to a keyboard
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        D.body.appendChild(ta);
        ta.select();
        try { ta.setSelectionRange(0, text.length); } catch (e) {}  // iOS needs this
        var ok = D.execCommand('copy');
        D.body.removeChild(ta);
        finish(!!ok);
      } catch (e) { finish(false); }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      // A denied clipboard permission can leave this promise pending forever,
      // which would strand the button with no feedback and emit no event.
      // Fall back rather than hang.
      setTimeout(function () { if (!settled) legacy(); }, 1200);
      try {
        navigator.clipboard.writeText(text).then(
          function () { finish(true); },
          function () { if (!settled) legacy(); });
      } catch (e) { legacy(); }
      return;
    }
    legacy();
  }

  /* ---- analytics --------------------------------------------------------- */
  /* Two separate consumers, deliberately kept apart:
       1. The site owner's own analytics. Auto-detected on the page, so a
          zero-config install still reports. First-party, their data.
       2. Optional anonymous telemetry to the project. OFF unless the installer
          asks for it. A tool whose whole premise is "in-app browsers are bad
          for you" has no business silently tracking anyone. */

  var TELEMETRY_URL = 'https://pulse.polyfeeds.dev/api/escape-webview';
  var listeners = [];

  // Do Not Track / Global Privacy Control. Applies to the project's telemetry
  // only -- the owner's first-party analytics is their call, not ours.
  function optedOut() {
    try {
      if (navigator.globalPrivacyControl) return true;
      var d = navigator.doNotTrack || W.doNotTrack || navigator.msDoNotTrack;
      return d === '1' || d === 'yes';
    } catch (e) { return false; }
  }

  function sinks(name, d) {
    var label = 'escape_webview_' + name;
    // Each guarded separately: one broken analytics library must not stop the
    // others, and must never break the card.
    try { if (typeof W.gtag === 'function') W.gtag('event', label, d); } catch (e) {}
    try { if (typeof W.plausible === 'function') W.plausible(label, { props: d }); } catch (e) {}
    try { if (W.posthog && W.posthog.capture) W.posthog.capture(label, d); } catch (e) {}
    try {
      if (W.umami) (typeof W.umami.track === 'function' ? W.umami.track : W.umami)(label, d);
    } catch (e) {}
    try { if (W.fathom && W.fathom.trackEvent) W.fathom.trackEvent(label); } catch (e) {}
    try {
      if (W.dataLayer && W.dataLayer.push) {
        var g = {};
        for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) g[k] = d[k];
        // After the copy, not before: d carries its own `event` key and would
        // otherwise overwrite the GTM event name with the bare event type.
        g.event = label;
        W.dataLayer.push(g);
      }
    } catch (e) {}
  }

  function beacon(url, d) {
    try {
      var body = JSON.stringify(d);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      } else {
        fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'text/plain' },
          keepalive: true, body: body
        })['catch'](function () {});
      }
    } catch (e) {}
  }

  function emit(cfg, name, extra) {
    var d = {
      event: name,
      app: cfg._app || 'unknown',
      os: isIOS ? 'ios' : isAndroid ? 'android' : 'other'
    };
    if (extra) for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) d[k] = extra[k];
    }

    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](name, d); } catch (e) {}
    }
    if (cfg.analytics !== false) sinks(name, d);

    if (cfg.telemetry && !optedOut()) {
      // Deliberately no URL, no path, no referrer, no visitor id, no cookie.
      // Hostname is what makes an install countable; nothing here identifies
      // a person or what they were reading.
      beacon(typeof cfg.telemetry === 'string' ? cfg.telemetry : TELEMETRY_URL, {
        event: d.event, app: d.app, os: d.os,
        domain: location.hostname,
        v: VERSION
      });
    }
  }

  /* ---- overlay UI ------------------------------------------------------- */
  function render(cfg, app) {
    if (D.getElementById('escape-webview-root')) return;

    var host = D.createElement('div');
    host.id = 'escape-webview-root';
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
    var root = shadow || host;

    var appName = app ? app.name : 'this app';
    cfg._app = appName;
    var hintKey = app ? app.key : 'menu';
    var deepLink = safeDeepLink(isIOS ? (cfg.app && cfg.app.ios)
                                      : isAndroid ? (cfg.app && cfg.app.android) : null);

    var css = [
      ':host{all:initial;position:fixed;inset:0;z-index:2147483647}',
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
      '.wrap{position:fixed;inset:0;display:flex;align-items:flex-end;justify-content:center;',
      '  background:rgba(0,0,0,.55);backdrop-filter:blur(2px)}',
      '@media(min-width:560px){.wrap{align-items:center}}',
      '.card{width:100%;max-width:420px;margin:12px;padding:22px;border-radius:18px;',
      '  background:#fff;color:#0b0b0c;box-shadow:0 20px 60px rgba(0,0,0,.35)}',
      '@media(prefers-color-scheme:dark){.card{background:#161618;color:#f4f4f5}}',
      'h1{margin:0 0 6px;font-size:17px;font-weight:650;letter-spacing:-.01em}',
      'p{margin:0 0 16px;font-size:13.5px;line-height:1.45;opacity:.72}',
      'a.btn,button.btn{display:block;width:100%;margin:8px 0 0;padding:13px 16px;border:0;',
      '  border-radius:12px;font-size:15px;font-weight:600;text-align:center;text-decoration:none;',
      '  cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.primary{background:#0b0b0c;color:#fff}',
      '@media(prefers-color-scheme:dark){.primary{background:#f4f4f5;color:#0b0b0c}}',
      '.ghost{background:transparent;color:inherit;border:1px solid rgba(128,128,128,.35)}',
      '.chips{display:flex;gap:8px;margin-top:10px}',
      '.chips .btn{margin:0}',
      '.hint{margin-top:16px;padding:11px 13px;border-radius:11px;font-size:12.5px;line-height:1.4;',
      '  background:rgba(128,128,128,.12)}',
      '.hint[hidden]{display:none}',
      // The step list is the thing that actually works on iOS, so it gets the
      // visual weight a primary action would normally get.
      'ol.steps{margin:0 0 18px;padding:14px 16px 14px 34px;border-radius:12px;',
      '  background:rgba(128,128,128,.12);font-size:14px;line-height:1.5}',
      'ol.steps li{margin:2px 0}',
      'ol.steps b{font-weight:680}',
      'p.or{margin:14px 0 0;font-size:12px;text-align:center;opacity:.5}',

      /* Coach mark: an echo of the control to tap, then a large arrow aimed at
         where the real one sits. The whole pill is the target -- it is a far
         bigger hit area than the kebab inside it. */
      '.aim{margin:14px 0 0}',

      '.bar{position:relative;display:flex;align-items:center;gap:10px;',
      '  padding:12px 12px 12px 18px;border-radius:999px;font-size:14px;',
      '  letter-spacing:-.01em;background:rgba(128,128,128,.18);',
      '  box-shadow:0 0 0 2px currentColor}',
      /* Apps whose target is a small ••• button, not an address bar. A
         full-width pill misrepresented the size of the real control. */
      '.bar.dots-only{width:52px;height:38px;margin:0 auto;padding:0;',
      '  justify-content:center;border-radius:12px}',
      '@media(prefers-reduced-motion:no-preference){',
      '  .bar{animation:ehglow 2s ease-in-out infinite}}',
      '@keyframes ehglow{0%,100%{box-shadow:0 0 0 2px currentColor}',
      '  50%{box-shadow:0 0 0 5px rgba(128,128,128,.28)}}',
      '.host{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;',
      '  white-space:nowrap;opacity:.6}',
      '.kb{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;',
      '  justify-content:center;gap:2.5px;width:24px;height:24px}',
      '.kb.wide{flex-direction:row}',
      '.kb i{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.55}',

      /* The arrow is the last thing in the card, aimed out of it at the real
         control sitting just below. Sized to be unmissable. */
      '.aimdown{margin:10px 0 -6px}',
      '.chev{margin:0 auto;width:28px;height:44px;opacity:.9}',
      '.chev.up{margin:0 auto 8px;transform:rotate(180deg)}',
      '.chev svg{width:100%;height:100%;display:block}',
      '@media(prefers-reduced-motion:no-preference){',
      '  .aimdown .chev{animation:ehb 1.5s ease-in-out infinite}',
      '  .chev.up{animation:ehbu 1.5s ease-in-out infinite}}',
      '@keyframes ehb{0%,100%{transform:translateY(0)}50%{transform:translateY(7px)}}',
      '@keyframes ehbu{0%,100%{transform:rotate(180deg) translateY(0)}',
      '  50%{transform:rotate(180deg) translateY(7px)}}',

      'p.cta{margin:0 0 2px;font-size:15px;line-height:1.5}',
      'p.cta b{font-weight:680}',

      '.foot{display:flex;gap:8px;margin:18px 0 22px}',
      '.tbtn{flex:1;padding:12px 10px;border:0;border-radius:11px;cursor:pointer;',
      '  font-size:14px;font-weight:600;color:inherit;',
      '  background:rgba(128,128,128,.16);-webkit-tap-highlight-color:transparent}',
      '.tbtn.quiet{background:transparent;opacity:.45;font-weight:500}',
      '.tbtn.done{background:rgba(18,138,75,.16);color:#12894b}',
      '@media(prefers-color-scheme:dark){.tbtn.done{color:#4ade80}}',

      '.dismiss{margin-top:14px;font-size:12px;opacity:.5;background:none;border:0;color:inherit;',
      '  width:100%;cursor:pointer}',
      '.ok{opacity:1;color:#128a4b;font-weight:600}'
    ].join('');

    var h = [];
    h.push('<div class="wrap"><div class="card" role="dialog" aria-modal="true">');
    h.push('<h1>Open in your browser</h1>');
    h.push('<p>' + esc(appName) + '\u2019s built-in browser blocks sign-in, saved passwords and extensions.</p>');

    if (deepLink) {
      h.push('<a class="btn primary" href="' + esc(deepLink) + '">Open in the app</a>');
    }

    if (isAndroid) {
      h.push('<button class="btn primary" id="eh-go">Open in browser</button>');
      h.push('<button class="btn ghost" id="eh-copy">Copy link</button>');
      h.push('<div class="hint">' + esc(ANDROID_HINT) + '</div>');

    } else if (isIOS) {
      // No programmatic escape exists here (11 of 11 schemes blocked in X,
      // window.open only yields another in-app tab), so the card has exactly
      // one job: move the eye to the real control and name the real label.
      //
      // An earlier version drew the whole menu, which read as tappable and
      // pulled taps away from the actual gesture. One focal point instead.
      var g = GUIDE[hintKey] || GUIDE.menu;
      // NB: not `host` -- that name already holds the card element in this
      // function scope, and `var` would clobber it.
      var shownHost = '';
      try { shownHost = new URL(cfg.url).hostname.replace(/^www\./, ''); } catch (e) {}

      var arrow = '<div class="chev"><svg viewBox="0 0 24 40" fill="none" ' +
        'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
        'stroke-linejoin="round"><path d="M12 3v33"/><path d="M4 28l8 8 8-8"/>' +
        '</svg></div>';
      var pill = g.bar
        ? '<div class="bar"><span class="host">' + esc(shownHost) + '</span>' +
          '<span class="kb"><i></i><i></i><i></i></span></div>'
        : '<div class="bar dots-only"><span class="kb wide">' +
          '<i></i><i></i><i></i></span></div>';
      var cta = '<p class="cta">Tap <b>' + esc(g.tap) + '</b> ' + esc(g.where) +
                ', then choose <b>' + esc(pickLabel(g)) + '</b>.</p>';

      // Secondary actions sit up top, out of the way. The instruction then runs
      // uninterrupted into the target: sentence, replica of the control, arrow,
      // and immediately below the card, the real thing.
      h.push('<div class="foot">');
      h.push('<button class="tbtn" id="eh-copy">Copy link</button>');
      h.push('<button class="tbtn quiet" id="eh-x">Not now</button>');
      h.push('</div>');

      if (g.pointer === 'up') {
        h.push('<div class="aim" aria-hidden="true"><div class="chev up">' +
               arrow + '</div>' + pill + '</div>');
        h.push(cta);
      } else {
        h.push(cta);
        h.push('<div class="aim" aria-hidden="true">' + pill + '</div>');
        if (g.pointer) h.push('<div class="aimdown" aria-hidden="true">' + arrow + '</div>');
      }

      h.push('<div class="hint" id="eh-note" hidden></div>');

    } else {
      h.push('<a class="btn primary" href="' + esc(cfg.url) +
             '" target="_blank" rel="noopener">Open in browser</a>');
      h.push('<button class="btn ghost" id="eh-copy">Copy link</button>');
      h.push('<div class="hint">Or use the app\u2019s own menu: ' +
             esc(GUIDE.menu.trigger) + ' \u2192 ' + esc(pickLabel(GUIDE.menu)) + '.</div>');
    }

    if (!(isIOS && !isAndroid)) {
      h.push('<button class="dismiss" id="eh-x">Keep viewing here</button>');
    }
    h.push('</div></div>');

    // Style via a constructable stylesheet: not subject to style-src CSP, so the
    // card renders even on sites with a strict `style-src 'self'` policy.
    var styled = false;
    if (shadow) {
      try {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
        styled = true;
      } catch (e) {}
    }
    var markup = h.join('');
    if (!styled) {
      // Fallback for engines without constructable sheets (iOS Safari < 16.4).
      // The injected <style> is subject to style-src, so a strict CSP will drop
      // it -- position the host inline regardless, so the card is still a modal
      // rather than unstyled text at the foot of the page.
      markup = '<style>' + css + '</style>' + markup;
      host.style.position = 'fixed'; host.style.top = 0; host.style.left = 0;
      host.style.right = 0; host.style.bottom = 0; host.style.zIndex = 2147483647;
    }
    root.innerHTML = markup;
    (D.body || D.documentElement).appendChild(host);
    emit(cfg, 'shown');

    // querySelector works on both a ShadowRoot and a plain Element host.
    var $ = function (id) { return root.querySelector('#' + id); };

    var go = $('eh-go');
    if (go) go.addEventListener('click', function () {
      emit(cfg, 'escape_click');
      location.href = toIntent(cfg.url);
    });

    var copyBtn = $('eh-copy');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      copy(cfg.url, function (ok) {
        emit(cfg, ok ? 'copy' : 'copy_failed');
        // Terse and self-reverting: this is the secondary action. An earlier
        // build expanded to a three-line banner that dominated the card and
        // pulled attention off the gesture that actually works.
        copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
        copyBtn.classList.add(ok ? 'done' : 'quiet');
        if (ok) setTimeout(function () {
          copyBtn.textContent = 'Copy link';
          copyBtn.classList.remove('done');
        }, 2400);
      });
    });

    // Tapping a custom scheme for an app that isn't installed does nothing at
    // all on iOS -- no error, no navigation, no way to feature-detect first.
    // That reads as "the button is broken". So: watch for the page going
    // hidden (which is what a successful hand-off looks like) and if it hasn't
    // happened shortly after the tap, say so instead of leaving them guessing.
    function wireEscape(id, label, scheme) {
      var el = $(id), note = $('eh-note');
      if (!el || !note) return;
      el.addEventListener('click', function () {
        emit(cfg, 'escape_click', { via: label.toLowerCase() });
        var left = false;
        var onLeave = function () { left = true; };
        D.addEventListener('visibilitychange', onLeave);
        W.addEventListener('pagehide', onLeave);
        W.addEventListener('blur', onLeave);

        // The anchor's own href is the top-level attempt. Some in-app browsers
        // refuse top-level custom-scheme navigation but still let a subframe
        // reach the OS handler, so race a hidden iframe against it. Whichever
        // the host app permits wins; if it forbids both, nothing happens and
        // the timeout below explains why.
        setTimeout(function () { if (!left && !D.hidden) iframeHit(scheme); }, 120);

        setTimeout(function () {
          D.removeEventListener('visibilitychange', onLeave);
          W.removeEventListener('pagehide', onLeave);
          W.removeEventListener('blur', onLeave);
          if (left || D.hidden) { emit(cfg, 'escaped', { via: label.toLowerCase() }); return; }
          emit(cfg, 'escape_blocked', { via: label.toLowerCase() });
          note.hidden = false;
          note.textContent = label + ' didn’t open. ' + esc(appName) +
            ' blocks apps from launching other apps, so use the steps above ' +
            '— or copy the link and paste it in ' + label + '.';
        }, 1800);
      });
    }
    wireEscape('eh-chrome', 'Chrome', chromeUrl(cfg.url));
    wireEscape('eh-firefox', 'Firefox', firefoxUrl(cfg.url));

    // The only route out of X's webview that the OS actually honours. A
    // returned Window means the host app kept it in-context (a tab inside the
    // same in-app browser), which is not an escape -- so say so rather than
    // claim success.
    var openBtn = $('eh-open');
    if (openBtn) openBtn.addEventListener('click', function () {
      var note = $('eh-note'), w = null, inContext = false;
      try { w = W.open(cfg.url, '_blank'); } catch (e) {}
      if (w) { inContext = true; try { w.focus(); } catch (e) {} }
      setTimeout(function () {
        if (D.hidden) return;                    // left the app; nothing to say
        if (!note) return;
        note.hidden = false;
        note.textContent = inContext
          ? 'That opened a new tab inside ' + appName +
            ', not your browser. Use the steps above.'
          : appName + ' blocked that. Use the steps above, or copy the link.';
      }, 1800);
    });

    var x = $('eh-x');
    if (x) x.addEventListener('click', function () {
      emit(cfg, 'dismiss');
      host.parentNode && host.parentNode.removeChild(host);
    });
  }

  function pickLabel(g) {
    for (var i = 0; i < g.menu.length; i++) {
      if (g.menu[i][0] === 'globe') return g.menu[i][1];
    }
    return 'Open in browser';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- public API ------------------------------------------------------ */
  var API = {
    version: VERSION,
    isInApp: function () { return !!detect(); },
    app: detect,

    // Subscribe to card events: on(function (name, data) { ... }).
    // Returns an unsubscribe function.
    on: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    init: function (opts) {
      opts = opts || {};
      var url = safeHttp(opts.url || location.href);
      if (!url) { if (W.console) console.warn('[escape-webview] no valid http(s) url'); return; }
      var cfg = {
        url: url, name: opts.name || null, app: opts.app || null,
        analytics: opts.analytics !== false,
        telemetry: opts.telemetry || false
      };
      var app = detect();

      if (!app && !opts.force) return;               // normal browser: do nothing

      // Android can usually leave silently -- try once, then show the card as backup.
      if (app && isAndroid && opts.auto !== false) {
        try { location.href = toIntent(url); } catch (e) {}
      }
      var show = function () { render(cfg, app || { name: 'this app', key: 'menu' }); };
      if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', show);
      else show();
    }
  };

  W.EscapeWebview = API;

  /* ---- auto-init from the <script> tag -------------------------------- */
  var cs = D.currentScript;
  if (cs && cs.dataset && !('manual' in cs.dataset)) {
    var d = cs.dataset;
    if ('auto' in d || 'url' in d || 'appIos' in d || 'appAndroid' in d) {
      API.init({
        url: d.url || location.href,
        name: d.name,
        force: d.force === '' || d.force === 'true',
        auto: d.auto !== 'false',
        app: (d.appIos || d.appAndroid) ? { ios: d.appIos, android: d.appAndroid } : null,
        analytics: d.analytics !== 'off',
        // data-telemetry           -> project endpoint
        // data-telemetry="https://..." -> your own collector
        telemetry: ('telemetry' in d) ? (d.telemetry || true) : false
      });
    }
  }
  if (W.EscapeWebviewConfig) API.init(W.EscapeWebviewConfig);
})();
