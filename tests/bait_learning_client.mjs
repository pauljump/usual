import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBait, d1Store, _internal } from '../src/usual/bait/bait.js';
import { sqliteD1 } from '../scripts/bait/sqlite-d1.mjs';

const db = sqliteD1(process.env.BAIT_LOCAL_TEST_DB || ':memory:'), pending = [], events = [], checks = [];
const store = d1Store(db, { cacheSeconds: 0 });
const opts = { secret: 'learning-local-only', learning: true, tarpit: true, tarpitSeconds: .01, store,
  dashboard: '/bait/live', onEvent: e => events.push(e) };
const bait = createBait(opts);
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const context = { ip: '203.0.113.5', waitUntil: p => pending.push(p) };
const req = (path, init) => new Request('https://shop.example.com' + path, init);
const origin = async () => new Response('origin missing', { status: 404 });
const get = (path, ctx = context, init) => bait.handleWithOrigin(req(path, init), origin, ctx);
async function check(name, fn) { await fn(); await settle(); checks.push(name); }

await check('origin response controls eligibility, including after promotion', async () => {
  for (const status of [200, 301, 401, 403, 429, 500]) {
    const r = await bait.handleWithOrigin(req('/wp-login.php'), async () => new Response('real page', { status }), context);
    assert.equal(r.status, status); assert.equal(await r.text(), 'real page');
  }
  for (const path of ['/about', '/checkout', '/favicon.ico', '/usual.zip', '/shell.php/../../about', '/random.exe']) {
    assert.equal((await get(path)).status, 404);
  }
  assert.equal((await get('/wp-login.php', context, { method: 'HEAD' })).status, 404);
  assert.equal((await get('/wp-login.php', context, { method: 'DELETE' })).status, 404);
  const before = (await store.stats()).computeBurned.requestsServed;
  assert.equal(before, 0);
  for (let i = 0; i < 3; i++) await (await get('/wp-login.php', { ...context, ip: i ? '198.51.100.9' : context.ip })).text();
  assert.equal((await store.learningStats()).promotedPaths, 1);
  assert.equal(await (await bait.handleWithOrigin(req('/wp-login.php'), async () => new Response('now a real login'), context)).text(), 'now a real login');
});

let env;
await check('stable plans, learned paths propagated to fresh rooms, and deep follow-ups', async () => {
  env = await (await get('/.env')).text();
  assert.match(env, /https:\/\/shop.example.com\/wp-login.php/);
  assert.equal(await (await createBait(opts).handle(req('/.env'), { ...context, ip: '192.0.2.5' })).text(), env);
  let path = new URL(env.match(/https:\/\/shop.example.com\/_archive\/h\/[^\s]+/)[0]).pathname;
  const match = path.match(/^(.*\/h\/[a-f0-9]{32}\/1\/[a-f0-9]{16}\/)/);
  path = match[1] + '.env';
  for (let i = 1; i < 7; i++) {
    const r = await get(path), body = await r.text();
    assert.ok(body.length < 65536);
    assert.match(r.headers.get('link'), new RegExp('/' + (i + 1) + '/'));
    path = new URL(r.headers.get('link').match(/<([^>]+)>/)[1]).pathname.replace(/(?:repo.git\/HEAD|index.json)$/, '.env');
  }
  const crossHost = await bait.handle(new Request('https://other.example.com' + path), context);
  assert.equal(crossHost, null);
  await settle();
  const stats = await store.stats();
  assert.ok(stats.learning.recipes.some(r => r.followups >= 6));
  assert.ok(stats.computeBurned.deepRequests >= 5);
  assert.ok(!JSON.stringify(stats.learning).includes(context.ip));
  assert.ok(!JSON.stringify(stats.learning).includes('shop.example.com'));
});

await check('valid fake credentials open synthetic APIs; arbitrary credentials do not', async () => {
  const token = env.match(/INTERNAL_API_TOKEN=(\S+)/)[1];
  let r = await get('/api/internal/users', context, { headers: { authorization: 'Bearer ' + token } });
  assert.equal(r.status, 200);
  const page = await r.json(); assert.equal(page.has_more, true); assert.equal(page.data.length, 12);
  r = await get('/api/internal/users?cursor=' + page.next_cursor, context, { headers: { authorization: 'Bearer ' + token } });
  assert.notEqual((await r.json()).next_cursor, page.next_cursor);
  const ai = env.match(/OPENAI_API_KEY=(\S+)/)[1];
  r = await get('/_internal/openai/v1/chat/completions', context, { method: 'POST', body: 'never-store-this-prompt',
    headers: { authorization: 'Bearer ' + ai, 'content-length': '23' } });
  assert.equal((await r.json()).object, 'chat.completion');
  const aws = env.match(/AWS_ACCESS_KEY_ID=(\S+)/)[1];
  r = await get('/_s3/bucket?list-type=2', context, { headers: { authorization: `AWS4-HMAC-SHA256 Credential=${aws}/region/service` } });
  assert.match(await r.text(), /<IsTruncated>true/);
  assert.equal((await get('/api/internal/users', context, { headers: { authorization: 'Bearer arbitrary-key' } })).status, 404);
  await settle();
  assert.ok(!JSON.stringify(db.raw.prepare('SELECT * FROM bait_learning_visit').all()).includes('never-store-this-prompt'));
  const handoff = db.raw.prepare(`SELECT v.credential_id, p.path FROM bait_learning_visit v
    JOIN bait_learning_plan p ON p.id = v.source_plan_id WHERE v.credential_use = 1 LIMIT 1`).get();
  assert.match(handoff.credential_id, /^[a-f0-9]{10}$/); assert.equal(handoff.path, '/.env');
  assert.ok((await store.learningStats()).recipes.reduce((n, r) => n + r.credentialUses, 0) >= 4);
});

await check('real Git client clones valid deterministic loose objects', async () => {
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const r = await bait.handleWithOrigin(new Request('http://' + incoming.headers.host + incoming.url), origin, context);
      outgoing.writeHead(r.status, Object.fromEntries(r.headers));
      for await (const chunk of r.body) outgoing.write(chunk);
      outgoing.end();
    } catch (e) { outgoing.writeHead(500).end(String(e)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const dir = await mkdtemp(join(tmpdir(), 'bait-git-test-'));
    const url = `http://127.0.0.1:${server.address().port}/.git`;
    await new Promise((resolve, reject) => {
      const child = spawn('git', ['-c', 'credential.helper=', 'clone', url, join(dir, 'repo')],
        { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
      let error = ''; child.stderr.on('data', b => error += b);
      child.on('error', reject); child.on('exit', code => code ? reject(new Error(error)) : resolve());
    });
    assert.match(await readFile(join(dir, 'repo/.env'), 'utf8'), /NEXT_CONFIG_URL=.*\/_archive\/h\//);
    assert.match(await readFile(join(dir, 'repo/README.md'), 'utf8'), /Configuration index/);
    const git = (...args) => execFileSync('git', args, { cwd: join(dir, 'repo'), encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    assert.equal(git('rev-list', '--count', 'HEAD').trim(), '3');
    assert.match(git('log', '--format=%s'), /remove production credentials/);
    assert.ok(!git('ls-tree', '--name-only', 'HEAD~1').includes('.env'));
    const oldEnv = git('show', 'HEAD~2:.env');
    assert.match(oldEnv, /DB_PASSWORD=/); assert.match(oldEnv, /ADMIN_LOGIN_URL=.*\/_archive\/company\//);
    assert.ok((await readFile(join(dir, 'repo/MIGRATION.md'), 'utf8')).includes(git('rev-parse', 'HEAD~1').trim()));
    git('fsck', '--full');
  } finally { server.close(); server.closeAllConnections(); }
});

await check('idempotent arm accounting, no simulation credit, private daily cohorts', async () => {
  const sample = events.find(e => e.type === 'tarpit' && e.learning);
  const before = await store.learningStats();
  await store.record(sample); await store.record({ ...sample, heldMs: 0, bytes: 1 });
  await store.record({ ...sample, connectionId: 'simulation', simulated: true, heldMs: 99999999 });
  assert.deepEqual(await store.learningStats(), before);
  const visits = db.raw.prepare('SELECT * FROM bait_learning_visit').all();
  assert.ok(visits.every(v => /^[a-f0-9]{24}$/.test(v.actor) && /^[a-f0-9]{24}$/.test(v.tool)));
  assert.ok(!JSON.stringify(visits).includes(context.ip));
  const publicStats = await store.stats();
  assert.equal(publicStats.learning.recipes.reduce((n, r) => n + r.bytesGenerated, 0), publicStats.computeBurned.bytesGenerated);
});

await check('learner explores, exploits observations, and keeps existing plans', async () => {
  const rows = ['archive', 'api', 'git'].map(recipe => ({ recipe, requests: 5, held_ms: recipe === 'git' ? 100000 : 100, followups: 0 }));
  assert.equal(_internal.chooseRecipe(rows, 1), 'git');
  assert.equal(_internal.chooseRecipe(rows, 0), 'archive');
  assert.equal(_internal.chooseRecipe([], 1), 'api');
  const plan = db.raw.prepare('SELECT * FROM bait_learning_plan LIMIT 1').get();
  assert.deepEqual(await store.assignPlan({ ...plan, seed: 999 }), plan);
});

await check('slow connection cap falls back immediately and releases on cancellation', async () => {
  const limited = createBait({ ...opts, maxActiveTarpits: 1, tarpitSeconds: 1 });
  const first = (await limited.handle(req('/.env'), context)).body.getReader(); await first.read();
  const t = performance.now();
  await (await limited.handle(req('/.env'), context)).text();
  assert.ok(performance.now() - t < 500);
  assert.ok(events.some(e => e.type === 'tarpit' && e.ended === 'busy'));
  await first.cancel();
  const third = (await limited.handle(req('/.env'), context)).body.getReader(); await third.read();
  const previous = events.filter(e => e.ended === 'busy').length;
  await third.cancel();
  assert.equal(events.filter(e => e.ended === 'busy').length, previous);
});

await check('learning disabled or storage unavailable preserves origin behavior', async () => {
  const disabled = createBait({ ...opts, learning: false });
  assert.equal((await disabled.handleWithOrigin(req('/wp-login.php'), origin)).status, 404);
  const broken = createBait({ ...opts, store: { ...store, assignPlan: async () => { throw new Error('local test failure'); } } });
  const old = console.error; console.error = () => {};
  try { assert.equal(await (await broken.handleWithOrigin(req('/wp-login.php'), origin)).text(), 'origin missing'); }
  finally { console.error = old; }
});

await check('unfamiliar probes stay 404 and enter a private review queue', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await get('/cgi-bin/status', { ...context, ip: i ? '198.51.100.2' : context.ip });
    assert.equal(r.status, 404); assert.equal(await r.text(), 'origin missing');
  }
  const candidate = db.raw.prepare("SELECT * FROM bait_learning_hook WHERE path = '/cgi-bin/status'").get();
  assert.equal(candidate.family, 'unclassified'); assert.equal(candidate.promoted, 0);
  assert.equal((await store.learningStats()).reviewCandidates, 1);
});

await check('learning tables enforce capacity and private trace retention', async () => {
  const boundedDb = sqliteD1(), cleanupQueries = [];
  const prepare = boundedDb.prepare;
  boundedDb.prepare = sql => {
    if (/DELETE FROM bait_learning_visit/.test(sql)) cleanupQueries.push(sql);
    return prepare(sql);
  };
  const boundedStore = d1Store(boundedDb, { cacheSeconds: 0 });
  const limited = createBait({ ...opts, store: boundedStore });
  await (await limited.handle(req('/.env'), context)).text(); await settle();
  boundedDb.raw.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<9999)
    INSERT INTO bait_learning_plan (id,site,path,family,recipe,created)
    SELECT 'capacity-'||x,'test.invalid','/'||x,'secrets','archive',0 FROM n;
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
    INSERT INTO bait_learning_hook (id,site,path,family,first_at,last_at)
    SELECT 'capacity-'||x,'test.invalid','/'||x,'secrets',0,0 FROM n;`);
  assert.equal(await boundedStore.assignPlan({ id: 'overflow', site: 'test.invalid', path: '/new', family: 'api', seed: 1 }), null);
  await boundedStore.observeProbe({ id: 'overflow', site: 'test.invalid', path: '/new', family: 'api', actor: 'client' });
  assert.equal(boundedDb.raw.prepare('SELECT count(*) AS n FROM bait_learning_hook').get().n, 1000);
  assert.equal((await limited.handleWithOrigin(req('/new.php'), origin, context)).status, 404);
  const initial = boundedDb.raw.prepare('SELECT * FROM bait_learning_visit LIMIT 1').get();
  const insert = boundedDb.raw.prepare(`INSERT INTO bait_learning_visit
    (id,at,site,path,actor,tool,family,recipe,plan_id,step,followup,credential_use)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  boundedDb.raw.exec('BEGIN');
  for (let i = 0; i < 20005; i++) insert.run('retention-' + i, i ? initial.at : 1, initial.site, initial.path,
    initial.actor, initial.tool, initial.family, initial.recipe, initial.plan_id, initial.step, 0, 0);
  boundedDb.raw.exec('COMMIT');
  await (await limited.handle(req('/.env'), context)).text(); await settle();
  assert.equal(boundedDb.raw.prepare('SELECT count(*) AS n FROM bait_learning_visit').get().n, 20000);
  assert.equal(boundedDb.raw.prepare("SELECT * FROM bait_learning_visit WHERE id = 'retention-0'").get(), undefined);
  // Validate the queries actually issued by the store. No full-table walk or
  // sorted OFFSET is allowed for a checkpoint that evicts nothing.
  assert.equal(new Set(cleanupQueries).size, 2);
  for (const sql of new Set(cleanupQueries)) {
    const plan = boundedDb.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(20000).map(r => r.detail).join('\n');
    assert.doesNotMatch(plan, /SCAN bait_learning_visit|TEMP B-TREE/);
    assert.match(plan, /SEARCH bait_learning_visit/);
  }
  const checkpoint = events.filter(e => e.type === 'tarpit').at(-1);
  const totals = boundedDb.raw.prepare('SELECT * FROM bait_tarpit').get();
  // A different table's rowid must not wipe history on a repeated checkpoint.
  boundedDb.raw.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY); INSERT INTO unrelated VALUES (1000000)');
  await boundedStore.record(checkpoint);
  assert.equal(boundedDb.raw.prepare('SELECT count(*) AS n FROM bait_learning_visit').get().n, 20000);
  assert.deepEqual(boundedDb.raw.prepare('SELECT * FROM bait_tarpit').get(), totals);
  // Expiry is independent of insertion order, even for a recently inserted row.
  boundedDb.raw.prepare('UPDATE bait_learning_visit SET at = 1 WHERE id = ?').run(checkpoint.connectionId);
  await boundedStore.record(checkpoint);
  assert.equal(boundedDb.raw.prepare('SELECT * FROM bait_learning_visit WHERE id = ?').get(checkpoint.connectionId), undefined);
  assert.deepEqual(boundedDb.raw.prepare('SELECT * FROM bait_tarpit').get(), totals);
});

console.log(JSON.stringify({ status: 'passed', live_cloudflare: false, checks }));
