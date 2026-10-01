#!/usr/bin/env node
// Private, read-only view of a LOCAL SQLite capture/export. Never fetches live D1.
// node scripts/bait/learning-report.mjs /private/path/bait.sqlite [--json]
import { DatabaseSync } from 'node:sqlite';
const [file, format] = process.argv.slice(2);
if (!file) throw new Error('Usage: learning-report.mjs /private/path/bait.sqlite [--json]');
const db = new DatabaseSync(file, { readOnly: true });
if (!db.prepare("SELECT name FROM sqlite_master WHERE name = 'bait_learning_visit'").get()) {
  throw new Error('This local database has no learning observations yet.');
}
const report = {
  source: 'local SQLite; not a live Cloudflare query',
  identity: 'Daily keyed client groups and tool fingerprints are approximate cohorts, not people. Shared networks/tools can merge groups.',
  candidates: db.prepare(`SELECT site, path, family, hits, clients, promoted, first_at, last_at
    FROM bait_learning_hook ORDER BY hits DESC, path LIMIT 100`).all(),
  recipes: db.prepare(`SELECT * FROM bait_learning_arm ORDER BY held_ms DESC`).all(),
  tools: db.prepare(`SELECT tool, count(*) AS requests, count(DISTINCT actor) AS daily_client_groups,
    sum(followup) AS followups, sum(credential_use) AS credential_uses
    FROM bait_learning_visit GROUP BY tool ORDER BY requests DESC LIMIT 30`).all(),
  credentialHandoffs: db.prepare(`SELECT v.credential_id, p.site AS source_site, p.path AS source_path,
    v.site AS reuse_site, v.tool AS reuse_tool, count(*) AS requests
    FROM bait_learning_visit v JOIN bait_learning_plan p ON p.id = v.source_plan_id
    WHERE v.credential_use = 1 GROUP BY v.credential_id, p.site, p.path, v.site, v.tool
    ORDER BY requests DESC LIMIT 100`).all(),
  recent: db.prepare(`SELECT v.*, c.held_ms, c.bytes, c.ended FROM bait_learning_visit v
    LEFT JOIN bait_tarpit_connection c ON c.id = v.id ORDER BY v.at DESC, v.id DESC LIMIT 100`).all(),
};
if (format === '--json') console.log(JSON.stringify(report, null, 2));
else {
  console.log(report.source + '\n' + report.identity);
  console.log('\nBait that kept them busy'); console.table(report.recipes);
  console.log('\nDoors they asked for'); console.table(report.candidates);
  console.log('\nTools that came back'); console.table(report.tools);
  console.log('\nWhere fake keys went next'); console.table(report.credentialHandoffs);
  console.log('\nRecent wrong turns (private hosts and paths)'); console.table(report.recent);
}
db.close();
