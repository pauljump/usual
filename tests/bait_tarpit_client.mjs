import assert from 'node:assert/strict';
import http from 'node:http';
import { createBait, baitMiddleware, d1Store } from '../src/usual/bait/bait.js';
import { sqliteD1 } from '../scripts/bait/sqlite-d1.mjs';

const events = [], pending = [];
const db = sqliteD1();
const store = d1Store(db, { cacheSeconds: 0 });
const opts = { secret: 'local-only-test', tarpit: true, tarpitSeconds: .015, store,
  dashboard: '/bait/live', onEvent: e => events.push(e) };
const bait = createBait(opts);
const request = (path, init) => new Request('https://shop.example.com' + path, init);
const context = { ip: '203.0.113.5', waitUntil: p => pending.push(p) };
const get = path => bait.handle(request(path), context);
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); }
let env;
await check('stable bodies, every format links deeper, bounded URLs and wide tree', async () => {
  env = await (await get('/.env')).text();
  const other = createBait({ ...opts, store: undefined, onEvent: () => {} });
  assert.equal(await (await other.handle(request('/.env'), { ip: '198.51.100.9' })).text(), env);
  const urls = [...env.matchAll(/https:\/\/shop\.example\.com(\/_archive\/[^\s]+)/g)].map(m => m[1]);
  assert.equal(new Set(urls).size, 9);
  for (const url of urls) {
    const body = await (await get(url)).text();
    assert.match(body, /\/_archive\/2\//);
    if (url.endsWith('.json')) JSON.parse(body);
  }
  let dir = urls[0];
  for (let depth = 1; depth < 80; depth++) {
    const body = await (await get(dir)).text();
    dir = body.match(/href="([^"\s]+\/)"/)[1];
    assert.match(dir, new RegExp('/_archive/' + (depth + 1) + '/'));
    assert.ok(dir.length < 100);
  }
  assert.notEqual(await (await get('/prod.env')).text(), env);
  await settle();
});
await check('real persisted measurements, deep counts and no IPs in public stats', async () => {
  const samples = events.filter(e => e.type === 'tarpit');
  const s = await store.stats();
  assert.equal(s.timeWasted.milliseconds, samples.reduce((n,e) => n + e.heldMs, 0));
  assert.equal(s.computeBurned.bytesGenerated, samples.reduce((n,e) => n + e.bytes, 0));
  assert.equal(s.computeBurned.requestsServed, samples.length);
  assert.equal(s.computeBurned.deepRequests, samples.filter(e => e.depth >= 2).length);
  assert.ok(!JSON.stringify(s).includes(context.ip));
  assert.ok(!JSON.stringify(s).includes('shop.example.com'));
  assert.equal((await d1Store(db, { cacheSeconds: 0 }).stats()).timeWasted.milliseconds, s.timeWasted.milliseconds);
});
await check('stable loot still trips and preserves first scrape attribution', async () => {
  const token = env.match(/INTERNAL_API_TOKEN=(\S+)/)[1];
  const response = await bait.handle(request('/api/internal/users', { headers: { authorization: 'Bearer ' + token } }), context);
  assert.equal(response.status, 401);
  const trip = events.find(e => e.type === 'tripped');
  assert.equal(trip.served.ip, context.ip);
  assert.ok(trip.secondsSinceServed < 60);
  const awsId = env.match(/AWS_ACCESS_KEY_ID=(\S+)/)[1];
  assert.equal((await bait.handle(request('/_s3/', { headers: { authorization: `AWS4-HMAC-SHA256 Credential=${awsId}/region/service` } }), context)).status, 401);
  await settle();
});
await check('HEAD, dashboard and ordinary pages do not earn tarpit credit', async () => {
  const before = (await store.stats()).computeBurned.requestsServed;
  assert.equal((await bait.handle(request('/.env', { method: 'HEAD' }), context)).body, null);
  assert.equal(await get('/about'), null);
  assert.equal(await get('/_archive/not-a-room/'), null);
  const page = await (await get('/bait/live')).text();
  assert.match(page, /Time wasted/); assert.match(page, /Compute burned/);
  await (await get('/bait/live/stats.json')).json();
  await settle();
  assert.equal((await store.stats()).computeBurned.requestsServed, before);
});
await check('early cancel counts actual bytes and time once, stops sleeping', async () => {
  const local = [], tasks = [];
  const slow = createBait({ ...opts, tarpitSeconds: 5, onEvent: e => local.push(e) });
  const response = await slow.handle(request('/.env'), { waitUntil: p => tasks.push(p) });
  assert.equal(local.filter(e => e.type === 'tarpit').length, 0);
  const reader = response.body.getReader();
  const first = await reader.read();
  const reading = reader.read();
  await new Promise(r => setTimeout(r, 40));
  await reader.cancel(); await reading;
  await Promise.all(tasks);
  const samples = local.filter(e => e.type === 'tarpit');
  assert.equal(samples.length, 1); assert.equal(samples[0].bytes, first.value.length);
  assert.ok(samples[0].heldMs >= 30 && samples[0].heldMs < 1000);
  const before = await store.stats();
  await store.record(samples[0]);
  await store.record({ ...samples[0], bytes: 1, heldMs: 0 });
  const after = await store.stats();
  assert.deepEqual(after.computeBurned, before.computeBurned);
  assert.deepEqual(after.timeWasted, before.timeWasted);
});
await check('request abort cancels a sleeping pull', async () => {
  const local = [], abort = new AbortController();
  const slow = createBait({ ...opts, store: undefined, tarpitSeconds: 5, onEvent: e => local.push(e) });
  const r = await slow.handle(request('/.env', { signal: abort.signal }));
  const reader = r.body.getReader(); await reader.read();
  const read = reader.read(); abort.abort();
  assert.equal((await read).done, true);
  assert.equal(local.filter(e => e.type === 'tarpit').length, 1);
});
await check('completed stream takes its measured budget; zero historical credit', async () => {
  const local = [];
  const slow = createBait({ ...opts, store: undefined, tarpitSeconds: .15, onEvent: e => local.push(e) });
  const started = performance.now();
  const body = await (await slow.handle(request('/secrets.json'))).text();
  assert.ok(performance.now() - started >= 130);
  const sample = local.find(e => e.type === 'tarpit');
  assert.equal(sample.bytes, new TextEncoder().encode(body).length);
  assert.equal(sample.ended, 'completed');
  const before = (await store.stats()).timeWasted;
  await store.record({ ...sample, backfilled: true });
  await store.record({ ...sample, simulated: true });
  assert.deepEqual((await store.stats()).timeWasted, before);
});
await check('Node client disconnect ends stream and accounting promptly', async () => {
  const local = [];
  const middleware = baitMiddleware(createBait({ ...opts, store: undefined, tarpitSeconds: 5, onEvent: e => local.push(e) }));
  const server = http.createServer((q,s) => middleware(q,s, () => s.end('origin'))).listen(0);
  await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${server.address().port}/.env`, res => {
      res.once('data', () => { res.destroy(); resolve(); });
    }); req.on('error', reject);
  });
  await new Promise(r => setTimeout(r, 40));
  server.close();
  const samples = local.filter(e => e.type === 'tarpit');
  assert.equal(samples.length, 1); assert.equal(samples[0].ended, 'disconnected');
  assert.ok(samples[0].heldMs < 1000);
});
await check('checkpoint while open, then final delta; survives duplicate concurrent writes', async () => {
  const local = [], tasks = [];
  const measured = d1Store(sqliteD1(), { cacheSeconds: 0 });
  const slow = createBait({ ...opts, store: measured, tarpitSeconds: 30, onEvent: e => local.push(e) });
  const response = await slow.handle(request('/.env'), { waitUntil: p => tasks.push(p) });
  const reader = response.body.getReader();
  await reader.read();
  // Hold the stream open without requesting another chunk.
  await new Promise(r => setTimeout(r, 10100));
  await Promise.all(tasks);
  const during = await measured.stats();
  assert.ok(during.timeWasted.milliseconds >= 9900);
  assert.equal(during.computeBurned.requestsServed, 1);
  await reader.cancel(); await Promise.all(tasks);
  const samples = local.filter(e => e.type === 'tarpit');
  assert.equal(samples.length, 2);
  await Promise.all(samples.flatMap(e => [measured.record(e), measured.record(e)]));
  const after = await measured.stats();
  assert.equal(after.timeWasted.milliseconds, samples[1].heldMs);
  assert.equal(after.computeBurned.bytesGenerated, samples[1].bytes);
  assert.equal(after.computeBurned.requestsServed, 1);
});
await check('additive upgrade preserves old totals and replaces pre-tarpit cache', async () => {
  const old = sqliteD1();
  old.raw.exec(`CREATE TABLE bait_totals (id INTEGER PRIMARY KEY, since INTEGER,
    served INTEGER DEFAULT 0, minted INTEGER DEFAULT 0, trips INTEGER DEFAULT 0,
    came_back INTEGER DEFAULT 0, backfilled INTEGER DEFAULT 0);
    INSERT INTO bait_totals VALUES (1, 1234567890, 72, 44, 2, 1, 20);
    CREATE TABLE bait_cache (key TEXT PRIMARY KEY, at INTEGER, body TEXT);`);
  old.raw.prepare('INSERT INTO bait_cache VALUES (?, ?, ?)').run('stats', Math.floor(Date.now()/1000), '{}');
  const upgraded = await d1Store(old).stats();
  assert.equal(upgraded.totals.scrapes, 72);
  assert.equal(upgraded.totals.credentialsCameBack, 1);
  assert.equal(upgraded.timeWasted.milliseconds, 0);
  assert.equal(upgraded.computeBurned.bytesGenerated, 0);
});
console.log(JSON.stringify({ status: 'passed', checks, live_cloudflare: false }));
