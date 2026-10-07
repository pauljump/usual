import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotActivityReport, investigationActivityReport, activityMarkdown } from '../scripts/bait/activity-report.mjs';

globalThis.fetch = () => { throw new Error('Network forbidden'); };
const event = { at: '2026-10-01T22:00:00Z', id: 'abcdef1234', credential: 'redis-url',
  method: 'POST', path: '/login/?password=never-print', where: 'body', secondsSinceScrape: 120000,
  scrapedBy: { asn: 100 }, usedBy: { asn: 200 }, userAgent: '<script>never-print</script>' };
const snapshot = recent => ({ generatedAt: '2026-10-02T23:00:00Z', totals: { timesUsed: 318 }, recent });
test('reports Redis replay as HTTP submission, not Redis access or a successful login', () => {
  const r = snapshotActivityReport(snapshot([event]));
  const s = r.trails[0].steps[0];
  assert.equal(s.endpointClass, 'login');
  assert.equal(s.secondsSinceFirstRecordedCollection, 120000);
  assert.match(r.trails[0].interpretation, /not evidence of a Redis connection/);
  assert.match(s.result, /unavailable/);
  assert.equal(s.evidenceRef, 'stats.json#/recent/0');
  assert.equal(r.summary.probes, null);
  assert.ok(!JSON.stringify(r).includes('never-print'));
});
test('preserves retries and source references without inventing independent operators', () => {
  const r = snapshotActivityReport(snapshot([event, { ...event, at: '2026-10-01T20:00:00Z' }]));
  assert.equal(r.trails.length, 1);
  assert.equal(r.trails[0].steps.length, 2);
  assert.equal(r.trails[0].steps[0].evidenceRef, 'stats.json#/recent/1');
  assert.match(r.trails[0].linkBasis, /not a verified session or operator/);
});
test('missing or malformed evidence does not become a zero activity claim', () => {
  assert.throws(() => snapshotActivityReport({}), /Expected/);
  const r = snapshotActivityReport(snapshot([{ ...event, at: 'invalid' }, { ...event, id: 'invalid' }]));
  assert.equal(r.coverage.omittedMalformedEvents, 2);
  assert.equal(r.coverage.firstVisibleReuseAt, null);
  assert.match(activityMarkdown(r), /does not mean no activity/);
});
test('unknown paths and credential text cannot inject into the report', () => {
  const r = snapshotActivityReport(snapshot([{ ...event, path: '/secret-value', credential: '<img secret-value>', method: '<script>' }]));
  assert.equal(r.trails[0].steps[0].endpointClass, 'unclassified');
  assert.ok(!JSON.stringify(r).includes('secret-value'));
});
test('private report preserves evidence, synthetic provenance and truncation limits', () => {
  const r = investigationActivityReport({ schema: 'bait-investigation-v1', generatedAt: '2026-10-02T23:00:00Z',
    syntheticIncluded: true, coverage: { limitation: 'Retention is limited.' }, omittedGroups: { sessions: 2 },
    credentialTrails: [], sessions: [{ meaning: 'Signed session', retainedRequests: 41, stepsTruncated: true,
      steps: [{ at: event.at, source: 'synthetic', method: 'POST', operation: 'hosting-upload-attempt', responseEnd: 'completed' }] }] });
  assert.match(r.trails[0].steps[0].observed, /Attempted a file upload/);
  assert.equal(r.trails[0].steps[0].evidenceRef, 'investigation.json#/sessions/0/steps/0');
  assert.equal(r.trails[0].steps[0].provenance, 'synthetic');
  assert.match(activityMarkdown(r), /Includes synthetic/);
  assert.match(activityMarkdown(r), /truncated/);
  assert.match(r.gaps.join(' '), /totals must not be added/);
});
