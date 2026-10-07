#!/usr/bin/env node
// Deterministic, private reporting over saved evidence. No network or model calls.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const labels = {
  'config-read': 'Requested a decoy configuration file',
  'git-head': 'Requested the Git HEAD reference', 'git-refs': 'Requested Git references',
  'git-object': 'Requested a Git object', 'git-config-read': 'Requested the decoy configuration Git object',
  'model-list': 'Requested the decoy model list',
  'message-request': 'Reached the decoy AI message handler',
  'completion-request': 'Reached the decoy AI completion handler',
  'storage-list': 'Requested a decoy storage listing', 'storage-pagination': 'Requested another storage page',
  'company-login': 'Opened a decoy company session using a recognized credential',
  'company-employees': 'Requested the fictional employee directory',
  'company-projects': 'Requested fictional project records',
  'company-notes': 'Requested fictional company notes',
  'export-start': 'Requested a decoy export', 'export-poll': 'Requested export status',
  'export-chunk': 'Requested a batch of fictional export records',
  'hosting-login': 'Opened a decoy hosting session using a recognized credential',
  'hosting-file-list': 'Requested a hosting file listing', 'hosting-file-read': 'Requested a decoy hosting file',
  'hosting-mail-list': 'Requested a mail-account listing',
  'hosting-database-list': 'Requested a database listing',
  'hosting-upload-attempt': 'Attempted a file upload to the decoy',
  'hosting-write-attempt': 'Attempted a file write in the decoy',
  'hosting-mail-account-attempt': 'Attempted to create a mail account in the decoy',
  'hosting-backup-attempt': 'Requested a hosting backup',
  'hosting-schedule-attempt': 'Attempted to schedule a job in the decoy',
};
const commonGaps = [
  'Observations cover our instrumented endpoints only; use at real providers, private sharing and resale are not visible.',
  'Runtime traffic may include humans, owner checks and defensive scanners; automation and intent are not established by a user agent.',
  'A credential links observations, not a person. Stable credentials can have multiple readers and short legacy digests can collide.',
  'A request or completed response does not establish that the client read the content or achieved an operation on a real service.',
];
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const cleanMethod = v => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(v) ? v : 'unknown';
const asn = v => Number.isInteger(v) && v > 0 ? v : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const kinds = new Set(['redis-url', 'database-url', 'database-password', 'mail-password', 'openai-key', 'anthropic-key', 'aws-access-key', 'internal-api-token', 'admin-url', 'jwt-secret', 'git-remote', 'npm-token', 'docker-auth']);
function endpoint(path) {
  // Never copy arbitrary paths, queries or embedded credentials into narrative output.
  if (typeof path !== 'string') return 'unclassified';
  const p = path.split('?')[0];
  if (/(?:^|\/)login\/?$/.test(p)) return 'login';
  if (/\/chat\/completions\/?$/.test(p)) return 'chat-completions';
  if (/\/messages\/?$/.test(p)) return 'messages';
  if (/\/models\/?$/.test(p)) return 'models';
  return 'unclassified';
}

export function snapshotActivityReport(data) {
  if (!iso(data?.generatedAt) || !data.totals || !Array.isArray(data.recent)) {
    throw new Error('Expected a saved Bait stats snapshot with generatedAt, totals and recent events.');
  }
  const groups = new Map();
  let omitted = 0;
  const events = [];
  data.recent.forEach((r, i) => {
    if (!iso(r.at) || !/^[a-f0-9]{10,64}$/.test(r.id || '')) { omitted++; return; }
    const kind = kinds.has(r.credential) ? r.credential : 'unclassified';
    const target = endpoint(r.path), method = cleanMethod(r.method);
    const delay = count(r.secondsSinceScrape);
    const e = { evidenceRef: `stats.json#/recent/${i}`, at: iso(r.at), credentialType: kind,
      method, endpointClass: target, credentialLocation: ['body', 'header', 'query', 'path'].includes(r.where) ? r.where : 'unknown',
      observed: `Submitted a recognized ${kind} credential in a ${method} request to ${target === 'unclassified' ? 'an unclassified endpoint' : 'a ' + target + ' endpoint'}.`,
      secondsSinceFirstRecordedCollection: delay,
      collectionAsn: asn(r.scrapedBy?.asn), reuseAsn: asn(r.usedBy?.asn),
      result: 'Credential submission recorded; authentication result and subsequent actions are unavailable in this snapshot.',
    };
    events.push(e);
    const key = r.id + ':' + kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  const trails = [...groups.values()].map((steps, i) => ({
    id: `credential-trail-${i + 1}`, linkBasis: 'Same recorded credential digest and type; not a verified session or operator.',
    steps: steps.sort((a, b) => a.at.localeCompare(b.at)),
    interpretation: steps.some(s => s.credentialType === 'redis-url' && s.endpointClass === 'login')
      ? 'Possible generic credential replay: a Redis URL was submitted to an HTTP login endpoint. This is not evidence of a Redis connection.'
      : 'Recognized credential reuse. Purpose and operator identity remain unknown.',
  }));
  return { schema: 'bait-activity-v1', captureAt: iso(data.generatedAt), mode: 'saved-public-stats',
    summary: { probes: count(data.totals.scrapes), distinctCredentialsReused: count(data.totals.credentialsCameBack),
      credentialSubmissions: count(data.totals.timesUsed), visibleRecentEvents: events.length },
    coverage: { recentEventsAreLimitedSample: true, omittedMalformedEvents: omitted,
      firstVisibleReuseAt: events.map(e => e.at).sort()[0] || null,
      lastVisibleReuseAt: events.map(e => e.at).sort().at(-1) || null },
    trails, gaps: [...commonGaps,
      'The recent-event list is a bounded sample, not a complete history. It cannot establish all activity between snapshots.',
      'No raw request bodies, response outcomes or verified session linkage are supplied by this stats snapshot.'],
  };
}

export function investigationActivityReport(data) {
  if (data?.schema !== 'bait-investigation-v1') throw new Error('Expected a saved Bait investigation report.');
  const convert = (g, type, index) => ({ id: `${type}-${index + 1}`, linkBasis: g.meaning,
    retainedRequests: g.retainedRequests, stepsTruncated: g.stepsTruncated,
    steps: g.steps.map((s, i) => ({ evidenceRef: `investigation.json#/${type === 'session' ? 'sessions' : 'credentialTrails'}/${index}/steps/${i}`,
      at: s.at, provenance: s.source, method: s.method,
      observed: labels[s.operation] || 'Requested a decoy route without a supported plain-language classification.',
      operation: s.operation, result: `Recorded response-stream end: ${s.responseEnd}.`,
    })), interpretation: 'This is a sequence of retained requests; intent and real-world success remain unknown.' });
  return { schema: 'bait-activity-v1', captureAt: data.coverage.lastObservedAt ?? null, sourceReportGeneratedAt: data.generatedAt, mode: 'saved-private-investigation',
    syntheticIncluded: data.syntheticIncluded, coverage: data.coverage,
    trails: [...data.sessions.map((g, i) => convert(g, 'session', i)),
      ...data.credentialTrails.map((g, i) => convert(g, 'credential', i))],
    gaps: [...commonGaps, data.coverage.limitation,
      'Session and credential views can contain the same requests; their totals must not be added.',
      'AI operation labels describe the selected handler; request-body validity and requested model are not recorded.',
      `Groups omitted by the source report: ${JSON.stringify(data.omittedGroups)}.`],
  };
}

export function activityMarkdown(report) {
  const lines = ['# Bait: what clients actually did', '', `${report.mode === 'saved-public-stats' ? 'Snapshot generated' : 'Latest retained observation'}: ${report.captureAt || 'unknown'}`, '',
    report.mode === 'saved-public-stats' ? `${report.summary.visibleRecentEvents} recent credential-submission events available; this is a limited sample.` : 'Private retained request sequences.', '',
    report.syntheticIncluded ? '**Includes synthetic observations. These are not evidence of live bot activity.**' : '',
    '**Observed actions**', ''];
  for (const trail of report.trails) {
    lines.push(`## ${trail.id}`, '', trail.linkBasis, '');
    for (const s of trail.steps) {
      lines.push(`- ${s.at}: ${s.observed} Evidence: ${s.evidenceRef}`, `  ${s.result}`);
      if (s.secondsSinceFirstRecordedCollection !== undefined) lines.push(
        `  Time since first recorded collection: ${s.secondsSinceFirstRecordedCollection === null ? 'unknown' : s.secondsSinceFirstRecordedCollection + ' seconds'}.`,
        `  Collection network: ${s.collectionAsn === null ? 'unknown' : 'AS' + s.collectionAsn}; reuse network: ${s.reuseAsn === null ? 'unknown' : 'AS' + s.reuseAsn}.`);
    }
    lines.push('', `Interpretation: ${trail.interpretation}`, '');
    if (trail.stepsTruncated) lines.push('Displayed steps are truncated.', '');
  }
  if (!report.trails.length) lines.push('No linked sequences available in this input. This does not mean no activity occurred.', '');
  lines.push('## What this report cannot tell us', '', ...report.gaps.map(g => '- ' + g), '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || flags.some(f => f !== '--json')) throw new Error('Usage: activity-report.mjs /private/saved-stats-or-investigation.json [--json]');
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const report = input.schema === 'bait-investigation-v1' ? investigationActivityReport(input) : snapshotActivityReport(input);
  console.log(flags.includes('--json') ? JSON.stringify(report, null, 2) : activityMarkdown(report));
}
