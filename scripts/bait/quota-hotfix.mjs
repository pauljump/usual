// Narrow, receipt-backed deployment of the quota fix onto the deployed module.
// Invoked through deploy.mjs --quota-fix /private/receipt-directory [--apply].
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OLD = '          run(`DELETE FROM bait_learning_visit WHERE at < ? OR id IN\n' +
  '            (SELECT id FROM bait_learning_visit ORDER BY at DESC, id DESC LIMIT -1 OFFSET ?)`,\n' +
  '            Math.floor(Date.now() / 1000) - 7 * 86400, LEARNING_LIMITS.traceRows),';
const NEW = '          // Quota fix: indexed expiry and insertion-window cleanup; no full-history checkpoint scan.\n' +
  '          run(`DELETE FROM bait_learning_visit WHERE at < ?`, Math.floor(Date.now() / 1000) - 7 * 86400),\n' +
  '          run(`DELETE FROM bait_learning_visit WHERE rowid <=\n' +
  '            (SELECT max(rowid) FROM bait_learning_visit) - ?`, LEARNING_LIMITS.traceRows),';
const sha = text => createHash('sha256').update(text).digest('hex');
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

export function quotaPatch(source) {
  if (source.split(OLD).length !== 2 || source.includes(NEW)) throw new Error('Expected exactly one known unfixed cleanup block; refusing unrelated source.');
  return source.replace(OLD, NEW);
}

export async function deployQuotaFix({ auth, worker, directory, apply = false, fetcher = fetch, log = console.log }) {
  if (!directory || directory.startsWith('--')) throw new Error('--quota-fix requires a private receipt directory');
  const save = (name, data) => writeFileSync(join(directory, name), data, { mode: 0o600 });
  const api = async (path, init = {}) => {
    const response = await fetcher('https://api.cloudflare.com/client/v4' + path,
      { ...init, headers: auth, redirect: 'error' });
    if (!response.ok) throw new Error(`Cloudflare ${init.method || 'GET'} failed: HTTP ${response.status}`);
    return response;
  };
  const json = async path => {
    const body = await (await api(path)).json();
    if (!body.success) throw new Error('Cloudflare read failed: ' + JSON.stringify(body.errors));
    return body.result;
  };
  const accounts = await json('/accounts');
  if (accounts.length !== 1) throw new Error('Expected one account; refusing ambiguous deployment');
  const base = `/accounts/${accounts[0].id}/workers/scripts/${worker}`;
  const source = async () => {
    const response = await api(base);
    const entries = [...(await response.formData()).entries()];
    if (entries.length !== 1 || entries[0][0] !== 'bait.js') throw new Error('Expected exactly one bait.js module');
    return typeof entries[0][1] === 'string' ? entries[0][1] : entries[0][1].text();
  };
  const original = await source();
  const settings = await json(base + '/settings');
  const deployments = await json(base + '/deployments');
  const active = deployments.deployments?.[0];
  if (!active || active.versions?.length !== 1 || active.versions[0].percentage !== 100) {
    throw new Error('Expected one active version serving 100% of traffic');
  }
  if (settings.bindings?.some(b => !['plain_text', 'd1', 'secret_text'].includes(b.type))) throw new Error('Unexpected binding type');
  if (Object.keys(settings.placement || {}).length) throw new Error('Unexpected placement configuration');
  const candidate = quotaPatch(original);
  const receipt = { worker, account: accounts[0].id, originalSha256: sha(original), candidateSha256: sha(candidate),
    settingsSha256: sha(stable(settings)), deploymentId: active.id, activeVersion: active.versions[0].version_id };
  const plan = [
    `patch deployed ${worker} (${original.match(/export const VERSION = "([^"]+)"/)?.[1] || 'unknown version'})`,
    'replace one full-history cleanup query with two indexed range deletes',
    'preserve current bindings, secret, compatibility settings and usage model',
    'no routes, new features, schema, billing, subscription or resource changes',
    'no live D1 query, traffic replay, counter seed or reset',
    `source SHA-256: ${receipt.originalSha256}`,
    `candidate SHA-256: ${receipt.candidateSha256}`,
  ].map(line => (apply ? '[apply] ' : '[dry run] ') + line).join('\n');
  if (!apply) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    save('base.mjs', original); save('candidate.mjs', candidate);
    save('before-settings.json', JSON.stringify(settings, null, 2));
    save('before-deployments.json', JSON.stringify(deployments, null, 2));
    save('quota-plan.json', JSON.stringify(receipt, null, 2)); save('dry-run.txt', plan + '\n');
    log(plan); return receipt;
  }
  const reviewed = JSON.parse(readFileSync(join(directory, 'quota-plan.json'), 'utf8'));
  if (stable(reviewed) !== stable(receipt) || sha(readFileSync(join(directory, 'candidate.mjs'))) !== receipt.candidateSha256) {
    throw new Error('Source, settings, deployment or candidate changed since dry run; refusing upload');
  }
  log(plan);
  const metadata = { main_module: 'bait.js', keep_bindings: ['plain_text', 'd1', 'secret_text'] };
  for (const key of ['compatibility_date', 'compatibility_flags', 'usage_model', 'tags', 'tail_consumers', 'logpush', 'limits', 'observability']) {
    if (settings[key] !== undefined) metadata[key] = settings[key];
  }
  const form = new FormData(); form.append('metadata', JSON.stringify(metadata));
  form.append('bait.js', new Blob([candidate], { type: 'application/javascript+module' }), 'bait.js');
  const uploaded = await (await api(base, { method: 'PUT', body: form })).json();
  if (!uploaded.success) throw new Error('Worker upload failed: ' + JSON.stringify(uploaded.errors));
  save('upload.json', JSON.stringify(uploaded, null, 2));
  const deployedSource = await source();
  const afterSettings = await json(base + '/settings');
  const afterDeployments = await json(base + '/deployments');
  save('after-settings.json', JSON.stringify(afterSettings, null, 2));
  save('after-deployments.json', JSON.stringify(afterDeployments, null, 2));
  if (sha(deployedSource) !== receipt.candidateSha256 || stable(settings) !== stable(afterSettings)) {
    throw new Error('Upload accepted but verification differs; inspect saved receipt before any further action');
  }
  const after = afterDeployments.deployments?.[0];
  if (!after || after.versions?.length !== 1 || after.versions[0].percentage !== 100 || after.id === active.id) {
    throw new Error('Upload accepted but active deployment verification failed');
  }
  const verified = { ...receipt, verifiedAt: new Date().toISOString(), deploymentId: after.id,
    activeVersion: after.versions[0].version_id, settingsPreserved: true, sourceVerified: true };
  save('verified.json', JSON.stringify(verified, null, 2));
  log('Verified deployed source and unchanged settings: ' + after.id);
  return verified;
}
