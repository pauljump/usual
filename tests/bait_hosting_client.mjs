import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBait, d1Store } from '../src/usual/bait/bait.js';
import { sqliteD1 } from '../scripts/bait/sqlite-d1.mjs';
import { behaviorReport } from '../scripts/bait/behavior-report.mjs';

// Every HTTP request is an in-process Request. Any accidental external fetch fails.
globalThis.fetch = async () => { throw new Error('External network is forbidden in this test'); };
const db = sqliteD1(), pending = [], events = [], checks = [];
const store = d1Store(db, { cacheSeconds: 0 });
const end = new Date(Date.now() + 3600000).toISOString();
const options = { secret: 'hosting-experiment-test-only', learning: true, tarpit: true,
  tarpitSeconds: .025, store, loginExperimentUntil: end, loginExperimentHosts: ['shop.example.com'],
  experimentSource: 'synthetic', onEvent: e => events.push(e) };
let bait = createBait(options), ip = '203.0.113.1';
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const get = (path, init = {}, host = 'shop.example.com') => bait.handleWithOrigin(
  new Request('https://' + host + path, init), async () => new Response('real origin'),
  { ip, waitUntil: p => pending.push(p) });
async function check(name, fn) { await fn(); await settle(); checks.push(name); }
let password, treatment, control;
async function login() {
  const response = await get('/config/.env:2083/login/?login_only=1', {
    method: 'POST', body: new URLSearchParams({ user: 'deploy', pass: password }) });
  const text = await response.text(); await settle();
  return { ip, response, text, cookie: response.headers.get('set-cookie')?.split(';')[0],
    json: response.headers.get('content-type') === 'application/json' ? JSON.parse(text) : null };
}
const use = (suffix, init = {}) => get(treatment.json.security_token + '/' + suffix,
  { ...init, headers: { cookie: treatment.cookie, ...init.headers } });

await check('qualifying chunked login is accepted, both arms can enroll, no live provider', async () => {
  password = (await (await get('/.env')).text()).match(/^DB_PASSWORD=(.+)$/m)[1]; await settle();
  for (let i = 1; i <= 30 && !(treatment && control); i++) {
    ip = '203.0.113.' + i;
    const result = await login();
    if (result.json) treatment ||= result; else control ||= result;
  }
  assert.ok(treatment && control);
  assert.equal(treatment.json.status, 1);
  assert.match(treatment.json.security_token, /^\/cpsess\d{10}$/);
  assert.equal(treatment.json.redirect, treatment.json.security_token + '/frontend/jupiter/index.html');
  assert.match(control.text, /Signed in/);
  assert.match(treatment.response.headers.get('set-cookie'), /Path=\/cpsess\d{10}\/; HttpOnly; Secure; SameSite=Strict/);
  const row = db.raw.prepare("SELECT * FROM bait_hosting_experiment WHERE id=?").get(treatment.json.security_token.slice(1));
  assert.equal(row.source, 'synthetic'); assert.equal(row.arm, 'protocol-fast');
  assert.ok(row.source_plan_id); assert.ok(row.credential_id);
});

await check('stable cohort assignment survives retries and a new process instance', async () => {
  ip = treatment.ip;
  bait = createBait(options);
  const again = await login();
  assert.ok(again.json); assert.notEqual(again.json.security_token, treatment.json.security_token);
  const rows = db.raw.prepare("SELECT * FROM bait_hosting_experiment WHERE arm='protocol-fast'").all();
  assert.equal(new Set(rows.map(r => r.cohort)).size, 1);
});

await check('signed session is required and scoped to host and issued session', async () => {
  const root = treatment.json.security_token;
  assert.equal((await get(root + '/execute/Email/list_pops')).status, 401);
  assert.equal((await get(root + '/execute/Email/list_pops', { headers: { cookie: treatment.cookie.slice(0, -3) + '000' } })).status, 401);
  assert.equal(await (await get(root + '/execute/Email/list_pops', { headers: { cookie: treatment.cookie } }, 'other.example.com')).text(), 'real origin');
  const other = db.raw.prepare("SELECT id FROM bait_hosting_experiment WHERE arm='protocol-fast' AND id != ?").get(root.slice(1));
  assert.equal((await get('/' + other.id + '/execute/Email/list_pops', { headers: { cookie: treatment.cookie } })).status, 401);
  assert.equal(await (await get('/cpsess9999999999/execute/Email/list_pops')).text(), 'real origin');
  assert.equal((await use('execute/Email/list_pops', { method: 'DELETE' })).status, 405);
});

await check('protocol-shaped inert operations record attempts without executing input', async () => {
  const home = await (await use('frontend/jupiter/index.html')).text(); assert.match(home, /Account: deploy/);
  const list = await (await use('execute/Email/list_pops')).json(); assert.equal(list.result.data[0].email, 'deploy@example.invalid');
  const add = await (await use('execute/Email/add_pop', { method: 'POST', body: new URLSearchParams({ email: 'secret-recipient@private.example', password: 'do-not-store-me' }) })).json();
  assert.equal(add.result.status, 1);
  const form = new FormData(); form.set('file', new Blob(['do-not-execute-this-content']), 'private-script.php');
  assert.equal((await (await use('execute/Fileman/upload_files?dest=%2Fprivate%2Fpayload.php', { method: 'POST', body: form })).json()).result.status, 1);
  const legacy = await (await use('json-api/cpanel', { method: 'POST', body: new URLSearchParams({
    cpanel_jsonapi_module: 'Cron', cpanel_jsonapi_func: 'add_line', command: 'never-execute-this', minute: '*' }) })).json();
  assert.equal(legacy.cpanelresult.event.result, 1);
  assert.equal((await (await use('execute/Cron/add_line_v2', { method: 'POST', body: new URLSearchParams({ command: 'never-execute-this' }) })).json()).result.status, 1);
  const unknown = await use('execute/PrivateCustomer/secretFunction?customer=do-not-store');
  assert.equal(unknown.status, 404); await unknown.text();
  await settle();
  const rows = db.raw.prepare('SELECT * FROM bait_learning_visit WHERE step LIKE ?').all('hosting-%');
  const serialized = JSON.stringify(rows);
  for (const privateValue of ['do-not-store', 'secret-recipient', 'private-script', 'do-not-execute',
    'never-execute', 'PrivateCustomer', password, treatment.cookie, treatment.json.security_token]) assert.ok(!serialized.includes(privateValue), privateValue);
  assert.ok(rows.some(r => r.step === 'hosting-mail-account-attempt' && r.method === 'POST'));
  assert.ok(rows.some(r => r.step === 'hosting-upload-attempt'));
  assert.ok(rows.some(r => r.step === 'hosting-schedule-attempt'));
});

await check('new streams count observed work exactly, duplicate checkpoints and HEAD do not inflate it', async () => {
  const before = await store.stats();
  await (await use('execute/Email/list_pops', { method: 'HEAD' })).text(); await settle();
  const event = events.find(e => e.type === 'tarpit' && e.learning?.step === 'hosting-login');
  assert.ok(event.heldMs < 1000); assert.ok(event.bytes > 0);
  await store.record(event); await store.record({ ...event, simulated: true, connectionId: 'not-real', heldMs: 900000 });
  assert.deepEqual((await store.stats()).timeWasted, before.timeWasted);
  const publicText = JSON.stringify((await store.stats()).replays);
  assert.ok(publicText.includes('Attempted a file upload'));
  for (const value of [password, treatment.cookie, 'shop.example.com', 'secret-recipient']) assert.ok(!publicText.includes(value));
});

await check('offline reports exclude synthetic sessions by default and collapse retries into cohorts', async () => {
  const empty = behaviorReport(db.raw);
  assert.equal(empty.candidatePacks.length, 0); assert.ok(empty.arms.every(a => a.enrolledSessions === 0));
  assert.equal(empty.commercialEvidence.revenue, null);
  const report = behaviorReport(db.raw, { includeSynthetic: true });
  const arm = report.arms.find(a => a.arm === 'protocol-fast');
  assert.ok(arm.enrolledSessions >= 2); assert.equal(arm.cohorts, 1); assert.equal(arm.cohortsWithActionAttempt, 1);
  assert.equal(report.candidatePacks.length, 1); assert.equal(report.candidatePacks[0].status, 'fixture-only');
  assert.ok(report.candidatePacks[0].validationFixture.expectedActions.includes('hosting-upload-attempt'));
  const serialized = JSON.stringify(report);
  for (const value of [password, treatment.cookie, treatment.json.security_token, 'shop.example.com', ip]) assert.ok(!serialized.includes(value));
  const tmp = mkdtempSync(join(tmpdir(), 'bait-hosting-test-'));
  const capture = join(tmp, 'synthetic.sqlite'); db.raw.prepare('VACUUM INTO ?').run(capture);
  const original = readFileSync(capture);
  const cli = spawnSync(process.execPath, ['--no-warnings', 'scripts/bait/behavior-report.mjs', capture, '--json', '--include-synthetic'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).candidatePacks[0].status, 'fixture-only');
  assert.deepEqual(readFileSync(capture), original);
  writeFileSync(join(tmp, 'synthetic-report.json'), cli.stdout);
});

await check('expired or missing traces do not become invented follow-ups', async () => {
  const id = treatment.json.security_token.slice(1);
  db.raw.prepare('UPDATE bait_hosting_experiment SET expires = 1 WHERE id = ?').run(id);
  assert.equal(await (await use('execute/Email/list_pops')).text(), 'real origin');
  const row = db.raw.prepare('SELECT * FROM bait_hosting_experiment WHERE id=?').get(id);
  db.raw.prepare("DELETE FROM bait_learning_visit WHERE journey=? AND step='hosting-login'").run(row.journey);
  const report = behaviorReport(db.raw, { includeSynthetic: true });
  assert.equal(report.candidatePacks.length, 0);
  assert.ok(report.arms.find(a => a.arm === 'protocol-fast').sessionsWithoutRetainedLogin > 0);
});

await check('no default activation, no ordinary login interception, enrollment cannot exceed 100', async () => {
  const before = db.raw.prepare('SELECT count(*) AS n FROM bait_hosting_experiment').get().n;
  bait = createBait({ ...options, loginExperimentUntil: undefined });
  assert.equal((await login()).json, null);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM bait_hosting_experiment').get().n, before);
  for (const override of [{ loginExperimentHosts: [] }, { loginExperimentUntil: 'not-a-date' },
    { loginExperimentUntil: new Date(Date.now() - 1000).toISOString() },
    { loginExperimentUntil: new Date(Date.now() + 8 * 86400000).toISOString() }]) {
    bait = createBait({ ...options, ...override }); assert.equal((await login()).json, null);
  }
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM bait_hosting_experiment').get().n, before);
  bait = createBait(options);
  const ordinary = await get('/login/?login_only=1', { method: 'POST', body: new URLSearchParams({ user: 'real', pass: 'not-bait' }) });
  assert.equal(await ordinary.text(), 'real origin');
  const oversized = await get('/config/.env:2083/login/?login_only=1', { method: 'POST',
    body: 'pass=' + password + '&padding=' + 'x'.repeat(65536) });
  assert.equal(await oversized.text(), 'real origin');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM bait_hosting_experiment').get().n, before);
  for (let i = 0; i < 110; i++) await store.enrollHosting({ id: 'cap-' + i, version: 'hosting-login-v1', site: 'cap.example', planId: 'p',
    cohort: 'cohort', arm: 'company-slow', journey: 'cap-' + i, created: Date.now(), expires: Date.now() + 1000, source: 'synthetic' });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM bait_hosting_experiment').get().n, 100);
  assert.equal((await login()).json, null);
});

await check('legacy captures are not silently interpreted as zero observations', async () => {
  const old = sqliteD1(); assert.throws(() => behaviorReport(old.raw), /No hosting experiment schema/); old.raw.close();
});

console.log(JSON.stringify({ status: 'passed', checks, live_cloudflare: false }));
db.raw.close();
