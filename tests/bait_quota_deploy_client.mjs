import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { quotaPatch, deployQuotaFix } from '../scripts/bait/quota-hotfix.mjs';
import { sqliteD1 } from '../scripts/bait/sqlite-d1.mjs';

const checks = [], root = mkdtempSync(join(tmpdir(), 'bait-quota-test-'));
const original = process.argv[2] ? readFileSync(process.argv[2], 'utf8') :
  'export const VERSION = "fixture";\n' + '          run(`DELETE FROM bait_learning_visit WHERE at < ? OR id IN\n' +
  '            (SELECT id FROM bait_learning_visit ORDER BY at DESC, id DESC LIMIT -1 OFFSET ?)`,\n' +
  '            Math.floor(Date.now() / 1000) - 7 * 86400, LEARNING_LIMITS.traceRows),';
const expected = quotaPatch(original);
assert.throws(() => quotaPatch(expected));
assert.throws(() => quotaPatch(original + original));
checks.push('patch refuses missing or ambiguous cleanup block');

const settings = { bindings: [{ name: 'BAIT_SECRET', type: 'secret_text' }, { name: 'BAIT_DB', type: 'd1', id: 'database' }],
  compatibility_date: '2026-09-01', compatibility_flags: [], usage_model: 'standard', logpush: false, placement: {} };
let current = original, active = 'before', calls = [];
const response = result => Response.json({ success: true, result });
const fetcher = async (url, init) => {
  const path = new URL(url).pathname, method = init.method || 'GET'; calls.push({ path, method });
  if (method === 'PUT') {
    assert.ok(path.endsWith('/workers/scripts/usual-bait'));
    const metadata = JSON.parse(init.body.get('metadata'));
    assert.deepEqual(metadata.keep_bindings, ['plain_text', 'd1', 'secret_text']);
    assert.equal(metadata.bindings, undefined); assert.equal(metadata.usage_model, settings.usage_model);
    current = await init.body.get('bait.js').text(); active = 'after';
    return response({ id: 'usual-bait', deployment_id: active });
  }
  if (path === '/client/v4/accounts') return response([{ id: 'account' }]);
  if (path.endsWith('/settings')) return response(settings);
  if (path.endsWith('/deployments')) return response({ deployments: [{ id: active, versions: [{ version_id: active, percentage: 100 }] }] });
  if (path.endsWith('/workers/scripts/usual-bait')) { const f = new FormData(); f.set('bait.js', new Blob([current]), 'bait.js'); return new Response(f); }
  throw new Error('Unexpected API operation: ' + path);
};
const args = { worker: 'usual-bait', directory: root, auth: {}, fetcher, log: () => {} };
await deployQuotaFix(args);
assert.ok(calls.every(c => c.method === 'GET')); assert.equal(current, original);
checks.push('dry run reads control metadata only and saves exact candidate');
settings.logpush = true;
await assert.rejects(deployQuotaFix({ ...args, apply: true }), /changed since dry run/);
assert.ok(calls.every(c => c.method === 'GET')); settings.logpush = false;
writeFileSync(join(root, 'candidate.mjs'), expected + '\n');
await assert.rejects(deployQuotaFix({ ...args, apply: true }), /changed since dry run/);
assert.ok(calls.every(c => c.method === 'GET')); writeFileSync(join(root, 'candidate.mjs'), expected);
checks.push('apply refuses metadata drift and candidate tampering before mutation');
const verified = await deployQuotaFix({ ...args, apply: true });
assert.equal(verified.sourceVerified, true); assert.equal(current, expected);
assert.equal(calls.filter(c => c.method !== 'GET').length, 1);
assert.ok(calls.every(c => !/d1\/|routes|subscriptions|billing/.test(c.path)));
checks.push('apply performs one Worker upload and verifies source/settings/deployment');

if (process.argv[2]) {
  const candidatePath = join(root, 'runtime.mjs'); writeFileSync(candidatePath, expected);
  const { d1Store, createBait } = await import(pathToFileURL(candidatePath).href);
  const db = sqliteD1(), queries = [], prepare = db.prepare;
  db.prepare = sql => { if (/DELETE FROM bait_learning_visit/.test(sql)) queries.push(sql); return prepare(sql); };
  const store = d1Store(db, { cacheSeconds: 0 }), pending = [], events = [];
  globalThis.fetch = async () => { throw Error('No external runtime calls'); };
  const bait = createBait({ secret: 'quota-test-only', store, learning: true, tarpit: true, tarpitSeconds: .01, onEvent: e => events.push(e) });
  const r = await bait.handle(new Request('https://local.invalid/.env'), { ip: '192.0.2.1', waitUntil: p => pending.push(p) });
  await r.text(); while (pending.length) await Promise.all(pending.splice(0));
  const initial = db.raw.prepare('SELECT * FROM bait_learning_visit LIMIT 1').get();
  const insert = db.raw.prepare(`INSERT INTO bait_learning_visit
    (id,at,site,path,actor,tool,family,recipe,plan_id,step,followup,credential_use)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,0)`);
  db.raw.exec('BEGIN');
  for (let i = 0; i < 20005; i++) insert.run('fixture-' + i, i ? initial.at : 1, initial.site,
    initial.path, initial.actor, initial.tool, initial.family, initial.recipe, initial.plan_id, initial.step);
  db.raw.exec('COMMIT');
  const event = events.find(e => e.type === 'tarpit');
  const totals = db.raw.prepare('SELECT * FROM bait_tarpit').get();
  await store.record(event);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM bait_learning_visit').get().n, 20000);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM bait_learning_visit WHERE at = 1').get().n, 0);
  assert.deepEqual(db.raw.prepare('SELECT * FROM bait_tarpit').get(), totals);
  const retained = db.raw.prepare('SELECT id FROM bait_learning_visit ORDER BY rowid DESC LIMIT 1').get().id;
  db.raw.prepare('UPDATE bait_learning_visit SET at=1 WHERE id=?').run(retained);
  db.raw.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY); INSERT INTO unrelated VALUES (1000000)');
  await store.record(event);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM bait_learning_visit').get().n, 19999);
  assert.deepEqual(db.raw.prepare('SELECT * FROM bait_tarpit').get(), totals);
  for (const sql of new Set(queries)) {
    const plan = db.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(20000).map(r => r.detail).join('\n');
    assert.doesNotMatch(plan, /SCAN bait_learning_visit|TEMP B-TREE/);
  }
  assert.equal(new Set(queries).size, 2);
  checks.push('exact deployed candidate preserves counters/expiry/cap and eliminates history scan on 20,005 synthetic visits');
  db.raw.close();
}
console.log(JSON.stringify({ status: 'passed', checks, live_cloudflare: false }));
