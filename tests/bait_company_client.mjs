import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { createBait, d1Store, dashboardPage } from '../src/usual/bait/bait.js';
import { sqliteD1 } from '../scripts/bait/sqlite-d1.mjs';

const db = sqliteD1(), pending = [], events = [], checks = [];
const store = d1Store(db, { cacheSeconds: 0 });
const bait = createBait({ secret: 'company-local-only', learning: true, tarpit: true,
  tarpitSeconds: .01, store, dashboard: '/bait/live', onEvent: e => events.push(e) });
const context = { ip: '203.0.113.11', waitUntil: p => pending.push(p) };
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const get = (path, init = {}, host = 'shop.example.com') => bait.handleWithOrigin(
  new Request('https://' + host + path, init), async () => new Response('real origin', { status: 404 }), context);
async function check(name, fn) { await fn(); await settle(); checks.push(name); }
let env, root, password, cookie;
const authed = (path, init = {}) => get(root + path, { ...init, headers: { cookie, ...init.headers } });

await check('public scripts parse and empty stats invent no visits', async () => {
  new Script(dashboardPage().match(/<script>([\s\S]+)<\/script>/)[1]);
  assert.deepEqual((await store.stats()).replays.items, []);
  env = await (await get('/.env')).text();
  root = new URL(env.match(/^ADMIN_LOGIN_URL=(.+)$/m)[1]).pathname.replace(/login$/, '');
  password = env.match(/^DB_PASSWORD=(.+)$/m)[1];
  assert.match(root, /^\/_archive\/company\/[a-f0-9]{32}\/$/);
});

await check('the note is behind a login and unrelated origin routes survive', async () => {
  const form = await get(root + 'login'), text = await form.text();
  assert.match(text, /<form method="post"/); assert.ok(!text.includes('paulljump'));
  assert.match(form.headers.get('content-security-policy'), /form-action 'self'/);
  const protectedPage = await get(root + 'notes/message');
  assert.equal(protectedPage.status, 303); assert.equal(protectedPage.headers.get('location'), root + 'login');
  const bad = await get(root + 'login', { method: 'POST', body: new URLSearchParams({ password: 'not-bait' }) });
  assert.equal(bad.status, 401); assert.equal(bad.headers.get('set-cookie'), null);
  const real = await bait.handleWithOrigin(new Request('https://shop.example.com/login', {
    method: 'POST', body: 'ordinary-password' }), async () => new Response('real login'), context);
  assert.equal(await real.text(), 'real login');
});

await check('issued password authenticates without Content-Length; session has strict scope', async () => {
  const req = { method: 'POST', body: new URLSearchParams({ username: 'deploy', password }) };
  const response = await get(root + 'login', req);
  assert.equal(response.status, 200); assert.match(await response.text(), /Signed in/);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie.includes('Path=' + root));
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict; Max-Age=86400/);
  cookie = setCookie.split(';')[0];
  await settle(); assert.deepEqual((await store.stats()).replays.items, []);
  const forged = cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0');
  assert.equal((await get(root + 'home', { headers: { cookie: forged } })).status, 303);
  assert.equal((await get(root + 'home', { headers: { cookie: cookie.replace(/=\d+/, '=1000000000') } })).status, 303);
  assert.equal((await get(root + 'home', { headers: { cookie } }, 'other.example.com')).status, 404);
  const other = await (await get('/.env.production')).text();
  const otherRoot = new URL(other.match(/^ADMIN_LOGIN_URL=(.+)$/m)[1]).pathname.replace(/login$/, '');
  assert.equal((await get(otherRoot + 'home', { headers: { cookie } })).status, 303);
});

await check('consistent fictional company and approved note, no removed tagline', async () => {
  const pages = [];
  for (const path of ['home', 'employees', 'projects', 'notes', 'notes/message']) {
    const r = await authed(path); assert.equal(r.status, 200); pages.push(await r.text());
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  }
  const company = pages[0].match(/<strong>([^<]+)<\/strong>/)[1];
  assert.ok(pages.every(page => page.includes(company)));
  assert.match(pages[1], /\.invalid/);
  assert.match(pages[4], /If you think this is clever, get me some followers on X:/);
  assert.match(pages[4], /href="https:\/\/x.com\/paulljump"/);
  assert.ok(!pages[4].includes('My need for attention'));
  assert.equal((await authed('notes/message', { method: 'DELETE' })).status, 405);
});

await check('exports advance by URL without jobs or providers, with bounded stable batches', async () => {
  const start = await (await authed('exports', { method: 'POST' })).text();
  let pagePath = start.match(/href="([^\"]+\/status\/0.html)"/)[1];
  const progressPage = await (await get(pagePath, { headers: { cookie } })).text();
  assert.match(progressPage, /Check the next batch/); assert.match(progressPage, /status\/1.html/);
  let path = pagePath.replace(/\.html$/, '.json');
  const first = await get(path, { headers: { cookie } });
  assert.equal(first.headers.get('retry-after'), '15');
  const status = await first.json(); assert.equal(status.batch, '0');
  const batch = await get(status.download_url, { headers: { cookie } }), content = await batch.text();
  assert.equal(content.trim().split('\n').length, 49); assert.ok(Buffer.byteLength(content) < 65536);
  assert.match(batch.headers.get('content-disposition'), /attachment/);
  assert.ok(batch.headers.get('link').includes(status.next_status_url));
  assert.equal(await (await get(status.download_url, { headers: { cookie } })).text(), content);
  const next = await (await get(status.next_status_url, { headers: { cookie } })).json();
  assert.equal(next.batch, '1'); assert.notEqual(next.download_url, status.download_url);
  assert.equal((await get(path.replace(/exports\/[a-f0-9]+/, 'exports/0000000000000000'), { headers: { cookie } })).status, 404);
  assert.ok(!db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().some(r => /job/.test(r.name)));
});

await check('replays reconcile to stored streams, omit private data, exclude HEAD and simulations', async () => {
  await settle();
  const before = (await store.stats()).replays;
  assert.equal(before.items.length, 1);
  const replay = before.items[0];
  assert.equal(replay.steps[0].action, 'Used an issued credential to log in');
  assert.ok(replay.steps.some(s => s.action === 'Opened the note from Paul'));
  const sums = db.raw.prepare(`SELECT count(*) AS n, sum(c.held_ms) AS held, sum(c.bytes) AS bytes
    FROM bait_learning_visit v JOIN bait_tarpit_connection c ON v.id=c.id WHERE journey=?`).get(replay.id);
  assert.equal(replay.requests, sums.n); assert.equal(replay.timeWastedMs, sums.held); assert.equal(replay.bytesGenerated, sums.bytes);
  const publicText = JSON.stringify(before);
  for (const privateValue of [context.ip, 'shop.example.com', password, cookie, root]) assert.ok(!publicText.includes(privateValue));
  assert.ok(!JSON.stringify(db.raw.prepare('SELECT * FROM bait_learning_visit').all()).includes(cookie));
  await (await authed('home', { method: 'HEAD' })).text(); await settle();
  const event = events.find(e => e.type === 'tarpit' && e.learning?.journey);
  await store.record(event); await store.record({ ...event, connectionId: 'fake', simulated: true, heldMs: 9999999 });
  assert.deepEqual((await store.stats()).replays, before);
});

await check('new login creates a separate replay; public step lists are bounded', async () => {
  for (let i = 0; i < 5; i++) await (await authed('projects')).text();
  const response = await get(root + 'login', { method: 'POST', body: new URLSearchParams({ password }) });
  await response.text(); const second = response.headers.get('set-cookie').split(';')[0];
  assert.notEqual(second, cookie);
  await (await get(root + 'home', { headers: { cookie: second } })).text(); await settle();
  const replays = (await store.stats()).replays.items;
  assert.equal(replays.length, 2); assert.ok(replays.every(r => r.steps.length <= 12));
  assert.ok(replays.some(r => r.requests === 2));
});

await check('additive replay migration preserves an older learning table', async () => {
  const old = sqliteD1();
  old.raw.exec('CREATE TABLE bait_learning_visit (id TEXT PRIMARY KEY, at INTEGER, site TEXT, path TEXT, actor TEXT, tool TEXT, family TEXT, recipe TEXT, plan_id TEXT, step TEXT, followup INTEGER, credential_use INTEGER)');
  old.raw.exec("INSERT INTO bait_learning_visit(id,at) VALUES ('legacy',1)");
  await d1Store(old).stats();
  const row = old.raw.prepare("SELECT * FROM bait_learning_visit WHERE id='legacy'").get();
  assert.equal(row.journey, null); assert.equal(row.observed_ms, null); old.raw.close();
});

console.log(JSON.stringify({ status: 'passed', checks, live_cloudflare: false }));
db.raw.close();
