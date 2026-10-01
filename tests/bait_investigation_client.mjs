import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBait, d1Store } from '../src/usual/bait/bait.js';
import { sqliteD1 } from '../scripts/bait/sqlite-d1.mjs';
import { investigationReport, investigationMarkdown } from '../scripts/bait/investigation-report.mjs';

globalThis.fetch = async () => { throw new Error('External network is forbidden'); };
const file = join(mkdtempSync(join(tmpdir(), 'bait-investigation-')), 'synthetic.sqlite');
const db = sqliteD1(file), pending = [], events = [], checks = [];
const store = d1Store(db, { cacheSeconds: 0 });
const bait = createBait({ secret: 'investigation-fixture-only', tarpit: true, learning: true,
  tarpitSeconds: .01, store, experimentSource: 'synthetic', onEvent: e => events.push(e) });
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const cf = { asn: 64500, country: 'US', tlsVersion: 'TLSv1.3', tlsCipher: 'AEAD-AES128-GCM-SHA256',
  httpProtocol: 'HTTP/2', tlsClientCiphersSha1: 'fixture-a', tlsClientExtensionsSha1: 'fixture-b',
  tlsClientHelloLength: '508', tlsClientRandom: 'never-store-this-random' };
async function request(path, { ip = '192.0.2.1', edge = cf, ...init } = {}) {
  const req = new Request('https://fixture.example' + path, init);
  Object.defineProperty(req, 'cf', { value: edge });
  const response = await bait.handleWithOrigin(req, async () => new Response('origin'),
    { ip, waitUntil: p => pending.push(p) });
  const body = await response.text(); await settle();
  return { response, body };
}
async function check(name, fn) { await fn(); checks.push(name); }
let login, cookie, password;
await check('a signed session retains network changes without collecting raw request material', async () => {
  const env = await request('/.env');
  login = new URL(env.body.match(/^ADMIN_LOGIN_URL=(.+)$/m)[1]).pathname;
  password = env.body.match(/^DB_PASSWORD=(.+)$/m)[1];
  const signed = await request(login, { method: 'POST', body: new URLSearchParams({ password }) });
  cookie = signed.response.headers.get('set-cookie').split(';')[0];
  await request(login.replace(/login$/, 'employees'), { ip: '198.51.100.2',
    edge: { ...cf, asn: 64501, country: 'GB' }, headers: { cookie, 'user-agent': 'fixture-client-2',
      'x-forwarded-for': '203.0.113.99', 'x-real-ip': '203.0.113.98' } });
  const trace = db.raw.prepare('SELECT evidence FROM bait_learning_visit').all();
  assert.ok(trace.every(r => JSON.parse(r.evidence).source === 'synthetic'));
  const report = investigationReport(db.raw, { includeSynthetic: true });
  const session = report.sessions.find(s => s.retainedRequests === 2);
  assert.deepEqual(session.asns, [64500, 64501]);
  assert.equal(session.transitions[0].asnChanged, true);
  assert.equal(session.transitions[0].egressChanged, true);
  assert.equal(session.transitions[0].toolChanged, true);
  assert.equal(session.transitions[0].transportChanged, false);
  assert.equal(report.operatorIdentity.status, 'unknown');
  const serialized = JSON.stringify(report);
  for (const value of [password, cookie, '192.0.2.1', '198.51.100.2', '203.0.113.99', 'fixture.example', 'never-store-this-random']) assert.ok(!serialized.includes(value), value);
  const publicStats = JSON.stringify(await store.stats());
  for (const r of trace) assert.ok(!publicStats.includes(JSON.parse(r.evidence).network));
});

await check('credentials can link separate sessions but are not claimed as unique operators', async () => {
  await request(login, { ip: '198.51.100.3', edge: { ...cf, asn: 64502 },
    method: 'POST', body: new URLSearchParams({ password }) });
  const report = investigationReport(db.raw, { includeSynthetic: true });
  assert.equal(report.sessions.length, 2);
  assert.ok(report.credentialTrails.some(c => c.asns.includes(64502) && c.asns.includes(64500)));
  assert.match(report.credentialTrails[0].meaning, /multiple readers/);
  assert.ok(report.toolLookalikes.some(t => t.asns.includes(64500) && t.asns.includes(64502)));
  assert.match(report.toolLookalikes[0].meaning, /never merged/);
});

await check('missing edge metadata remains unknown and forged headers do not supply transport evidence', async () => {
  await request(login.replace(/login$/, 'notes'), { ip: null, edge: {},
    headers: { cookie, 'x-forwarded-for': '203.0.113.99', 'tls-client-ciphers-sha1': 'pretend' } });
  const report = investigationReport(db.raw, { includeSynthetic: true });
  assert.equal(report.coverage.missingTransport, 1);
  assert.equal(report.coverage.missingEgress, 1);
  assert.equal(report.coverage.missingAsn, 1);
  const step = report.sessions.find(s => s.retainedRequests === 3).steps.at(-1);
  assert.equal(step.asn, null); assert.equal(step.dailyEgressGroup, null); assert.equal(step.transportGroup, null);
});

await check('a daily group rotation alone is not reported as a changed egress', async () => {
  const last = db.raw.prepare('SELECT id, evidence FROM bait_learning_visit ORDER BY observed_ms DESC, rowid DESC LIMIT 1').get();
  const e = { ...JSON.parse(last.evidence), day: '2026-01-01', network: 'a'.repeat(24), asn: 64501 };
  db.raw.prepare('UPDATE bait_learning_visit SET evidence = ? WHERE id = ?').run(JSON.stringify(e), last.id);
  const report = investigationReport(db.raw, { includeSynthetic: true });
  const changedTool = report.sessions.find(s => s.retainedRequests === 3).transitions.at(-1);
  assert.equal(changedTool.egressChanged, null); assert.equal(changedTool.asnChanged, false);
});

await check('synthetic, old and malformed evidence are explicit rather than invented live results', async () => {
  const empty = investigationReport(db.raw);
  assert.equal(empty.coverage.includedObservations, 0);
  assert.ok(empty.coverage.excludedSynthetic > 0); assert.equal(empty.coverage.firstObservedAt, null);
  assert.ok(empty.families.every(f => f.status === 'not-observed-in-capture'));
  const id = db.raw.prepare('SELECT id FROM bait_learning_visit LIMIT 1').get().id;
  db.raw.prepare('UPDATE bait_learning_visit SET evidence = ? WHERE id = ?').run('{broken', id);
  assert.equal(investigationReport(db.raw).coverage.rowsWithoutEvidence, 1);
  const old = sqliteD1(); old.raw.exec('CREATE TABLE bait_learning_visit (id TEXT)');
  assert.throws(() => investigationReport(old.raw), /predates investigation evidence/); old.raw.close();
});

await check('duplicate and simulated checkpoints add no observation or public credit', async () => {
  const event = events.find(e => e.type === 'tarpit' && e.learning);
  const before = db.raw.prepare('SELECT count(*) AS n FROM bait_learning_visit').get().n;
  const totals = (await store.stats()).timeWasted;
  await store.record(event);
  await store.record({ ...event, simulated: true, connectionId: 'invented', heldMs: 1000000 });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM bait_learning_visit').get().n, before);
  assert.deepEqual((await store.stats()).timeWasted, totals);
});

await check('report command is read-only and makes no network calls', async () => {
  const before = readFileSync(file);
  const result = spawnSync(process.execPath, ['--no-warnings', 'scripts/bait/investigation-report.mjs', file, '--json', '--include-synthetic'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.sessions.length > 0);
  assert.match(investigationMarkdown(report), /Synthetic fixtures included/);
  assert.deepEqual(readFileSync(file), before);
});
db.raw.close();
console.log(JSON.stringify({ status: 'passed', checks, live_cloudflare: false }));
