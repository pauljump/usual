#!/usr/bin/env node
// Private investigation of an existing LOCAL capture. No network or DB writes.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const FAMILIES = ['secrets', 'git', 'debug', 'wordpress', 'php', 'backup', 'ai', 'storage', 'registry', 'api'];
const STEPS = new Set(['config-read', 'git-head', 'git-packs', 'git-refs', 'git-miss', 'git-object',
  'git-config-read', 'model-list', 'message-request', 'completion-request', 'storage-list',
  'storage-pagination', 'registry-read', 'api-read', 'api-pagination', 'company-login-form',
  'company-login', 'company-home', 'company-employees', 'company-projects', 'company-notes',
  'company-message', 'company-exports', 'export-start', 'export-poll', 'export-chunk',
  'hosting-login', 'hosting-home', 'hosting-file-list', 'hosting-file-read', 'hosting-mail-list',
  'hosting-database-list', 'hosting-upload-attempt', 'hosting-write-attempt',
  'hosting-mail-account-attempt', 'hosting-backup-attempt', 'hosting-schedule-attempt', 'hosting-unknown']);
const hash = value => /^[a-f0-9]{24}$/.test(value || '') ? value : null;
const unique = values => [...new Set(values.filter(v => v !== null && v !== undefined))];
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;

function evidence(text) {
  try {
    const v = JSON.parse(text);
    if (v?.version !== 1 || !['runtime', 'synthetic'].includes(v.source)) return null;
    return { source: v.source, day: /^\d{4}-\d{2}-\d{2}$/.test(v.day || '') ? v.day : null,
      network: hash(v.network), transport: hash(v.transport),
      asn: Number.isInteger(v.asn) && v.asn > 0 ? v.asn : null,
      country: /^[A-Z]{2}$/.test(v.country || '') ? v.country : null };
  } catch { return null; }
}

export function investigationReport(db, { includeSynthetic = false } = {}) {
  const columns = db.prepare('PRAGMA table_info(bait_learning_visit)').all().map(c => c.name);
  if (!columns.includes('evidence')) throw new Error('This capture predates investigation evidence. Missing attribution is unknown, not zero.');
  const raw = db.prepare(`SELECT v.*, c.held_ms, c.bytes, c.ended FROM bait_learning_visit v
    LEFT JOIN bait_tarpit_connection c ON c.id = v.id ORDER BY v.observed_ms DESC, v.rowid DESC LIMIT 20001`).all();
  const selected = raw.slice(0, 20000).reverse();
  let missing = 0, excludedSynthetic = 0;
  const rows = [];
  for (const r of selected) {
    const e = evidence(r.evidence);
    if (!e) { missing++; continue; }
    if (e.source === 'synthetic' && !includeSynthetic) { excludedSynthetic++; continue; }
    rows.push({ ...r, e, tool: hash(r.tool), journey: hash(r.journey), ref: 'observation-' + (rows.length + 1) });
  }
  const observations = rows.map(r => ({ id: r.ref, source: r.e.source, at: iso(r.observed_ms),
    family: FAMILIES.includes(r.family) ? r.family : 'unknown',
    operation: STEPS.has(r.step) ? r.step : 'unclassified',
    method: ['GET', 'POST', 'HEAD'].includes(r.method) ? r.method : 'unknown',
    asn: r.e.asn, country: r.e.country, dailyEgressGroup: r.e.network,
    toolGroup: r.tool, transportGroup: r.e.transport,
    heldMs: r.held_ms ?? null, bytesGenerated: r.bytes ?? null,
    responseEnd: ['completed', 'busy', 'capped', 'disconnected'].includes(r.ended) ? r.ended : 'checkpoint-only' }));
  const byRef = new Map(observations.map(r => [r.id, r]));
  const groups = key => {
    const result = new Map();
    for (const row of rows) if (key(row)) {
      const id = key(row);
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(row);
    }
    return [...result.values()].sort((a, b) => b.length - a.length);
  };
  const comparison = (a, b) => ({
    from: a.ref, to: b.ref,
    asnChanged: a.e.asn && b.e.asn ? a.e.asn !== b.e.asn : null,
    egressChanged: a.e.day && a.e.day === b.e.day && a.e.network && b.e.network ? a.e.network !== b.e.network : null,
    toolChanged: a.tool && b.tool ? a.tool !== b.tool : null,
    transportChanged: a.e.transport && b.e.transport ? a.e.transport !== b.e.transport : null,
  });
  const summarize = (members, prefix, i, meaning) => {
    const transitions = members.slice(1).map((r, j) => comparison(members[j], r))
      .filter(t => [t.asnChanged, t.egressChanged, t.toolChanged, t.transportChanged].includes(true));
    return { id: prefix + '-' + (i + 1), meaning, retainedRequests: members.length,
      asns: unique(members.map(r => r.e.asn)), countries: unique(members.map(r => r.e.country)),
      credentialUseRequests: members.filter(r => r.credential_use).length,
      transitions: transitions.slice(0, 40), transitionsTruncated: transitions.length > 40,
      steps: members.slice(0, 40).map(r => byRef.get(r.ref)), stepsTruncated: members.length > 40 };
  };
  const sessionGroups = groups(r => r.journey ? r.e.source + ':' + r.journey : null);
  const credentialGroups = groups(r => /^[a-f0-9]{10,64}$/.test(r.credential_id || '')
    ? r.e.source + ':' + r.credential_id : null);
  const toolGroups = groups(r => r.tool ? r.e.source + ':' + r.tool : null);
  return {
    schema: 'bait-investigation-v1', generatedAt: new Date().toISOString(),
    source: 'Read-only local SQLite capture; no live traffic refresh or provider call.',
    interpretation: 'Observations of our decoys, not identities or a complete view of bot activity. Runtime traffic can include owner tests and humans. TLS can describe a proxy. No geolocation here locates an operator.',
    syntheticIncluded: includeSynthetic,
    coverage: { retainedRowsExamined: selected.length, inputTruncated: raw.length > 20000,
      rowsWithoutEvidence: missing, excludedSynthetic, includedObservations: rows.length,
      firstObservedAt: rows.length ? iso(rows[0].observed_ms) : null,
      lastObservedAt: rows.length ? iso(rows.at(-1).observed_ms) : null,
      missingAsn: rows.filter(r => !r.e.asn).length, missingTransport: rows.filter(r => !r.e.transport).length,
      missingEgress: rows.filter(r => !r.e.network).length,
      limitation: 'Only retained measured streams are included. Seven-day/20,000-row pruning, HEAD, unstreamed responses, origin-only traffic and third-party endpoints leave gaps. No follow-up in this capture does not prove a bot stopped.' },
    families: FAMILIES.map(family => {
      const members = rows.filter(r => r.family === family);
      return { family, observedRequests: members.length, linkedUrlRequests: members.filter(r => r.followup).length,
        credentialUseRequests: members.filter(r => r.credential_use).length,
        status: members.length ? 'observed-in-capture' : 'not-observed-in-capture' };
    }),
    sessions: sessionGroups.slice(0, 100).map((r, i) => summarize(r, 'session', i,
      'Requests presented the same verified signed session. Network changes show session reuse across visible networks; copied cookies or proxy rotation remain possible.')),
    credentialTrails: credentialGroups.slice(0, 100).map((r, i) => summarize(r, 'credential', i,
      'Requests share a recorded credential digest. Legacy digests are truncated and can collide. Path-stable credentials can be collected by multiple readers; this does not prove a handoff or a single operator.')),
    toolLookalikes: toolGroups.slice(0, 50).map((members, i) => ({ id: 'tool-' + (i + 1),
      requests: members.length, asns: unique(members.map(r => r.e.asn)),
      dailyEgressGroups: unique(members.map(r => r.e.network)).length,
      meaning: 'Matching request characteristics only; common software and spoofing can produce this match. These groups are never merged into an operator identity.' })),
    omittedGroups: { sessions: Math.max(0, sessionGroups.length - 100), credentials: Math.max(0, credentialGroups.length - 100), tools: Math.max(0, toolGroups.length - 50) },
    observationsWithoutSessionOrCredential: rows.filter(r => !r.journey && !r.credential_id).length,
    operatorIdentity: { status: 'unknown', explanation: 'Visible network, token possession and attempted actions do not establish the real person, organization or machine behind a proxy.' },
  };
}

export function investigationMarkdown(report) {
  const lines = ['# Bait: what took the bait', '', report.source, '', report.interpretation, '',
    report.syntheticIncluded ? '**Synthetic fixtures included. This is not evidence of live bot activity.**' : 'Synthetic observations excluded.', '',
    `${report.coverage.includedObservations} observations included; ${report.coverage.rowsWithoutEvidence} retained rows lack attribution evidence.`, '',
    report.coverage.limitation, '', '| Door | Requests | Linked URL requests | Credential uses |', '| --- | ---: | ---: | ---: |'];
  for (const f of report.families) lines.push(`| ${f.family} | ${f.observedRequests} | ${f.linkedUrlRequests} | ${f.credentialUseRequests} |`);
  lines.push('', 'Zero means not observed in this capture, not absent from the world.', '');
  for (const group of [...report.sessions, ...report.credentialTrails]) {
    lines.push(`## ${group.id}`, '', group.meaning, '', `Visible networks: ${group.asns.map(a => 'AS' + a).join(', ') || 'unknown'}.`, '');
    for (const s of group.steps) lines.push(`- ${s.id} · ${s.at || 'unknown time'} · ${s.method} ${s.operation} · ${s.asn ? 'AS' + s.asn : 'unknown network'}`);
    for (const t of group.transitions) lines.push(`- ${t.from} → ${t.to}: ` +
      ['asnChanged', 'egressChanged', 'toolChanged', 'transportChanged'].filter(k => t[k] === true).join(', '));
    if (group.stepsTruncated || group.transitionsTruncated) lines.push('- Display truncated; retained request count is shown in JSON.');
    lines.push('');
  }
  lines.push('Operator identity: unknown. Matching tools are lookalikes, not identified people.', '',
    `Omitted groups: ${report.omittedGroups.sessions} sessions, ${report.omittedGroups.credentials} credentials, ${report.omittedGroups.tools} tools.`, '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || flags.some(f => !['--json', '--include-synthetic'].includes(f))) throw new Error('Usage: investigation-report.mjs /private/local.sqlite [--json] [--include-synthetic]');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const report = investigationReport(db, { includeSynthetic: flags.includes('--include-synthetic') });
    console.log(flags.includes('--json') ? JSON.stringify(report, null, 2) : investigationMarkdown(report));
  } finally { db.close(); }
}
