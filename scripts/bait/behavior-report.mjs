#!/usr/bin/env node
// Read a local SQLite capture only. No fetches, migrations, or provider calls.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const VERSION = 'hosting-login-v1';
const ACTIONS = new Set(['hosting-upload-attempt', 'hosting-write-attempt',
  'hosting-mail-account-attempt', 'hosting-backup-attempt', 'hosting-schedule-attempt']);
const STEPS = new Set(['company-login', 'company-home', 'company-employees', 'company-projects',
  'company-notes', 'company-message', 'company-exports', 'export-start', 'export-poll', 'export-chunk',
  'hosting-login', 'hosting-home', 'hosting-file-list', 'hosting-file-read', 'hosting-mail-list',
  'hosting-database-list', 'hosting-unknown', ...ACTIONS]);
const METHODS = new Set(['GET', 'HEAD', 'POST']);

export function behaviorReport(db, { includeSynthetic = false, now = Date.now() } = {}) {
  const exists = name => Boolean(db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', name));
  const columns = exists('bait_learning_visit') ? db.prepare('PRAGMA table_info(bait_learning_visit)').all().map(c => c.name) : [];
  if (!exists('bait_hosting_experiment') || !columns.includes('method')) {
    throw new Error('No hosting experiment schema in this local capture. No observations or zero counts have been inferred.');
  }
  const sessions = db.prepare(`SELECT * FROM bait_hosting_experiment WHERE version = ?
    AND (source = 'runtime' OR (? = 1 AND source = 'synthetic')) ORDER BY created, id LIMIT 100`).all(VERSION, includeSynthetic ? 1 : 0);
  const query = db.prepare(`SELECT v.step, v.method, v.observed_ms, c.held_ms, c.bytes, c.ended
    FROM bait_learning_visit v JOIN bait_tarpit_connection c ON c.id = v.id
    WHERE v.journey = ? ORDER BY v.observed_ms, v.rowid LIMIT 20000`);
  const summaries = sessions.filter(s => ['company-slow', 'protocol-fast'].includes(s.arm)).map((s, i) => {
    const rows = query.all(s.journey);
    const login = rows.find(r => ['company-login', 'hosting-login'].includes(r.step));
    // A follow-up requires a retained login and a later/equal observation time.
    // Pruned/evicted traces must not silently become a reconstructed trajectory.
    const followups = login ? rows.filter(r => !['company-login', 'hosting-login'].includes(r.step)
      && Number(r.observed_ms) >= Number(login.observed_ms)) : [];
    const complete = Boolean(login && ['completed', 'busy'].includes(login.ended));
    return { id: 'session-' + (i + 1), cohort: s.cohort, arm: s.arm, source: s.source,
      createdAt: new Date(s.created).toISOString(), observationWindowClosed: now >= s.expires,
      traceStatus: !login ? 'login-not-retained-or-not-streamed' : complete ? 'login-response-completed' : 'login-response-incomplete',
      login: Boolean(login), complete, followup: followups.length > 0,
      actions: [...new Set(followups.filter(r => ACTIONS.has(r.step) || r.step === 'export-start').map(r => r.step))],
      sourcePlanRecorded: Boolean(s.source_plan_id), credentialRecorded: Boolean(s.credential_id),
      steps: rows.slice(0, 20).map(r => ({ at: new Date(r.observed_ms).toISOString(),
        operation: STEPS.has(r.step) ? r.step : 'unclassified', method: METHODS.has(r.method) ? r.method : 'unknown',
        heldMs: r.held_ms, bytesGenerated: r.bytes,
        responseEnd: ['completed', 'busy', 'capped', 'disconnected'].includes(r.ended) ? r.ended : 'checkpoint-only' })),
      retainedRequests: rows.length, stepsTruncated: rows.length > 20 };
  });
  const arms = ['company-slow', 'protocol-fast'].map(arm => {
    const members = summaries.filter(s => s.arm === arm);
    const cohorts = [...new Set(members.map(s => s.cohort))].map(id => members.filter(s => s.cohort === id));
    const count = predicate => cohorts.filter(group => group.some(predicate)).length;
    return { arm, enrolledSessions: members.length, cohorts: cohorts.length,
      cohortsWithObservedLogin: count(s => s.login), cohortsWithCompletedLogin: count(s => s.complete),
      cohortsWithFollowup: count(s => s.followup), cohortsWithActionAttempt: count(s => s.actions.length > 0),
      sessionsWithoutRetainedLogin: members.filter(s => !s.login).length,
      openSessionWindows: members.filter(s => !s.observationWindowClosed).length };
  });
  const seen = new Set();
  const candidates = summaries.filter(s => s.login && s.actions.length).filter(s => {
    const signature = [...s.actions].sort().join(',');
    if (seen.has(signature)) return false;
    seen.add(signature); return true;
  }).slice(0, 10).map(s => ({
    id: s.id, experiment: VERSION, source: s.source, arm: s.arm,
    status: s.source === 'synthetic' ? 'fixture-only' : 'needs-value-and-provenance-review',
    observation: 'A recognized issued credential opened a decoy session, followed by an attempted operation.',
    actions: s.actions, sourcePlanRecorded: s.sourcePlanRecorded, credentialRecorded: s.credentialRecorded,
    steps: s.steps, stepsTruncated: s.stepsTruncated,
    limitations: ['Requests show attempted API use; no command, upload, mail or real account operation was executed.',
      'This does not establish a phishing campaign, an identified operator, novelty or buyer value.',
      'Synthetic validation below reconstructs only retained operation labels; it is not a raw exploit replay.'],
    validationFixture: { provenance: 'synthetic-derived-from-operation-labels',
      operations: s.steps.map(step => ({ method: step.method, operation: step.operation })),
      expectedActions: s.steps.filter(step => ACTIONS.has(step.operation) || step.operation === 'export-start').map(step => step.operation) },
  }));
  return {
    schema: 'bait-behavior-report-v1', experiment: VERSION, generatedAt: new Date(now).toISOString(),
    source: 'Local SQLite capture. No live provider queries.',
    syntheticIncluded: includeSynthetic, sourcesPresent: [...new Set(summaries.map(s => s.source))],
    interpretation: 'Runtime observations can include owner tests or humans. Cohorts group one host/network/tool combination, not unique bots. Arms change both response format and timing; no single-factor causal claim is supported. Incomplete observation windows and evicted traces limit comparisons.',
    enrollmentLimit: 100, arms, candidatePacks: candidates,
    commercialEvidence: { payingCustomers: null, revenue: null, renewalRate: null,
      explanation: 'This capture contains behavior observations, not sales evidence.' },
  };
}

export function behaviorMarkdown(report) {
  const lines = ['# Bait behavior experiment', '', report.source, '', report.interpretation, '',
    report.syntheticIncluded ? '**Includes synthetic fixtures. Not evidence of real bot activity.**' : 'Synthetic fixture sessions excluded.', '',
    '| Response | Cohorts | Completed login | Follow-up | Action attempted | Open session windows |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const a of report.arms) lines.push(`| ${a.arm} | ${a.cohorts} | ${a.cohortsWithCompletedLogin} | ${a.cohortsWithFollowup} | ${a.cohortsWithActionAttempt} | ${a.openSessionWindows} |`);
  lines.push('', 'Enrollment counts are sessions; comparison counts are approximate cohorts. Repeated logins do not create new cohorts.', '',
    `Candidate behavior packs: ${report.candidatePacks.length}. Each still needs novelty, usefulness and provenance review.`, '');
  for (const pack of report.candidatePacks) {
    lines.push(`## ${pack.id} — ${pack.status}`, '', pack.observation, '', ...pack.steps.map(s => `- ${s.at}: ${s.method} ${s.operation}`), '', ...pack.limitations.map(s => '- ' + s), '');
  }
  lines.push('Revenue and willingness to pay: unknown. No sales data is present.', '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || flags.some(f => !['--json', '--include-synthetic'].includes(f))) throw new Error('Usage: behavior-report.mjs /private/local.sqlite [--json] [--include-synthetic]');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const report = behaviorReport(db, { includeSynthetic: flags.includes('--include-synthetic') });
    console.log(flags.includes('--json') ? JSON.stringify(report, null, 2) : behaviorMarkdown(report));
  } finally { db.close(); }
}
