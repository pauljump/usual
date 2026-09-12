// A deterministic DOM/client stub: this checks JS behavior, never device escape.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2], 'utf8');

function client(ua, {dataset, clipboardWorks = true} = {}) {
  class Element {
    constructor() { this.style = {}; this.children = []; this.events = {}; this.nodes = {}; this.classList = {add() {}, remove() {}}; }
    set innerHTML(value) {
      this.markup = value;
      for (const [,id] of value.matchAll(/\bid="([^"]+)"/g)) this.nodes[id] = new Element();
    }
    get innerHTML() { return this.markup || ''; }
    attachShadow() { this.shadowRoot = new Element(); return this.shadowRoot; }
    querySelector(selector) { return this.nodes[selector.slice(1)] || null; }
    appendChild(child) { this.children.push(child); child.parentNode = this; }
    removeChild(child) { this.children = this.children.filter(x => x !== child); child.parentNode = null; }
    addEventListener(name, handler) { this.events[name] = handler; }
    removeEventListener(name) { delete this.events[name]; }
    setAttribute() {}
    select() {}
    setSelectionRange() {}
  }
  const body = new Element();
  const document = {body, documentElement: body, readyState: 'complete', hidden: false,
    currentScript: dataset ? {dataset} : null,
    createElement() { return new Element(); },
    getElementById(id) { return body.children.find(x => x.id === id) || null; },
    addEventListener() {}, removeEventListener() {}, execCommand() { return clipboardWorks; }};
  const calls = {network: [], analytics: [], clipboard: [], timers: []};
  const location = {href: 'https://example.com/selected?x=1', hostname: 'example.com'};
  const navigator = {userAgent: ua, platform: 'test', maxTouchPoints: 0,
    sendBeacon(...args) { calls.network.push(args); },
    clipboard: {writeText(text) { calls.clipboard.push(text); return clipboardWorks ? Promise.resolve() : Promise.reject(new Error('denied')); }}};
  const window = {document, navigator, location, console: {warn() {}},
    addEventListener() {}, removeEventListener() {},
    gtag(...args) { calls.analytics.push(args); },
    open() { return {focus() {}}; }};
  const context = {window, document, navigator, location, URL, Blob,
    console: window.console,
    setTimeout(fn) { calls.timers.push(fn); },
    fetch(...args) { calls.network.push(args); return Promise.resolve(); },
    CSSStyleSheet: class { replaceSync() {} }};
  vm.runInNewContext(source, context, {filename: 'escape-webview.js', timeout: 1000});
  return {api: window.EscapeWebview, calls, location, body,
    host: () => document.getElementById('escape-webview-root'),
    root: () => document.getElementById('escape-webview-root')?.shadowRoot};
}

async function run() {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1';
  const xIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Twitter for iPhone/12.21';
  const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36';
  for (const ua of [safari, desktop, 'UnknownNewClient/1.0']) {
    const c = client(ua, {dataset: {auto: '', analytics: 'off'}});
    assert.equal(c.api.isInApp(), false);
    assert.equal(c.host(), null);
    assert.deepEqual(c.calls.network, []);
  }
  const x = client(xIOS, {dataset: {auto: '', analytics: 'off'}});
  assert.equal(x.api.isInApp(), true);
  assert.equal(x.api.app().key, 'x');
  assert.match(x.root().innerHTML, /the address bar/);
  assert.match(x.root().innerHTML, /Open in browser/);
  assert.equal(x.location.href, 'https://example.com/selected?x=1', 'iOS does not navigate automatically');
  assert.deepEqual(x.calls.network, []);
  assert.deepEqual(x.calls.analytics, []);
  x.root().querySelector('#eh-copy').events.click();
  await Promise.resolve();
  assert.deepEqual(x.calls.clipboard, ['https://example.com/selected?x=1']);
  assert.equal(x.root().querySelector('#eh-copy').textContent, 'Copied ✓');
  x.api.init({analytics: false});
  assert.equal(x.body.children.length, 1, 'repeated init does not duplicate the overlay');
  x.root().querySelector('#eh-x').events.click();
  assert.equal(x.host(), null, 'dismiss removes the overlay');

  const denied = client(xIOS, {dataset: {auto: '', analytics: 'off'}, clipboardWorks: false});
  denied.root().querySelector('#eh-copy').events.click();
  await Promise.resolve();
  assert.equal(denied.root().querySelector('#eh-copy').textContent, 'Copy failed');

  const android = client('Mozilla/5.0 (Linux; Android 14) Instagram 350', {dataset: {auto: '', analytics: 'off'}});
  assert.match(android.location.href, /^intent:\/\//, 'script attempts an intent; no device outcome is asserted');
  assert.ok(android.root().querySelector('#eh-go'));
  assert.deepEqual(android.calls.network, []);

  const forced = client(desktop);
  forced.api.init({force: true, auto: false, analytics: false, telemetry: false});
  assert.ok(forced.host());
  assert.doesNotMatch(forced.root().innerHTML, /undefined/);
  assert.match(forced.root().innerHTML, /button/);
  assert.equal(forced.location.href, 'https://example.com/selected?x=1');

  for (const url of ['javascript:alert(1)', 'data:text/html,secret', 'file:///etc/passwd', 'java\tscript:alert(1)']) {
    const invalid = client(xIOS);
    invalid.api.init({url, analytics: false});
    assert.equal(invalid.host(), null);
    const deep = client(xIOS);
    deep.api.init({app: {ios: url}, analytics: false});
    assert.doesNotMatch(deep.root().innerHTML, /Open in the app/);
    assert.deepEqual(deep.calls.network, []);
  }
  const escaped = client(xIOS);
  escaped.api.init({app: {ios: 'https://example.com/" onclick="alert(1)'}, analytics: false});
  assert.doesNotMatch(escaped.root().innerHTML, /href="[^"]*" onclick="/);
  assert.match(escaped.root().innerHTML, /&quot;/);
  process.stdout.write(JSON.stringify({status: 'passed', kind: 'scripted-client', device_verified: false,
    checks: ['normal and unsupported clients', 'iOS guided rendering', 'copy success and failure',
      'dismiss and duplicate init', 'Android intent attempt', 'forced desktop fallback',
      'unsafe URL and deep-link rejection', 'HTML escaping', 'telemetry and analytics disabled']}) + '\n');
}
run().catch(error => { process.stderr.write(error.stack + '\n'); process.exit(1); });
