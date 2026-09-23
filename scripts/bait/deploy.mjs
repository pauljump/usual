#!/usr/bin/env node
// Deploy Usual Bait as one Cloudflare Worker across the zones in deploy/bait-worker.json.
//
//   node scripts/bait/deploy.mjs                    dry run: show what would change
//   node scripts/bait/deploy.mjs --apply            create D1, upload the Worker, add missing routes
//   … --apply --only tryusual.com                   limit route changes to some zones
//   … --wipe                                        empty every Bait table (after a live test)
//   … --seed backfill.sqlite                        merge a real backfill into D1 (see backfill.mjs)
//
// Needs CLOUDFLARE_API_KEY, CLOUDFLARE_EMAIL and BAIT_SECRET in the environment.
// Existing routes that belong to another Worker are reported, never replaced.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL("../../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("deploy/bait-worker.json", ROOT), "utf8"));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes("--" + name);
const value = (name) => argv[argv.indexOf("--" + name) + 1];
const apply = flag("apply");
const only = flag("only") ? value("only").split(",") : null;
const { CLOUDFLARE_API_KEY: key, CLOUDFLARE_EMAIL: email, BAIT_SECRET: secret } = process.env;
if (!key || !email) throw new Error("Load CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL from /Users/mini-home/.secrets first.");
const auth = { "X-Auth-Key": key, "X-Auth-Email": email };

async function cf(path, init = {}) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, { ...init,
    headers: { ...auth, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const body = await response.json();
  if (!body.success) throw new Error(`${init.method || "GET"} ${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
}

const account = (await cf("/accounts"))[0].id;
const databases = await cf(`/accounts/${account}/d1/database?name=${config.d1Database}`);
let database = databases.find((d) => d.name === config.d1Database);

async function query(sql, params = []) {
  return cf(`/accounts/${account}/d1/database/${database.uuid}/query`, { method: "POST", body: JSON.stringify({ sql, params }) });
}

if (flag("wipe") || flag("seed")) {
  if (!database) throw new Error("No D1 database yet; deploy first.");
  const tables = (await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'bait_%'"))[0].results.map((r) => r.name);
  if (flag("wipe")) {
    for (const table of tables) await query(`DELETE FROM ${table}`);
    await query(`INSERT OR IGNORE INTO bait_totals (id, since) VALUES (1, CAST(strftime('%s','now') AS INTEGER))`);
    console.log(`wiped ${tables.length} tables`);
  }
  if (flag("seed")) {
    // Merge, never overwrite: live events may already be counted. Counters add up,
    // raw log rows get fresh ids, and "since" keeps the earliest time.
    const MERGE = {
      bait_totals: { key: ["id"], add: ["served", "minted", "trips", "came_back", "backfilled"], min: ["since"] },
      bait_network: { key: ["asn"], add: ["scrapes", "leaked", "uses", "credentials_used"], min: ["fastest"], max: ["last_at"], keep: ["org", "country"] },
      bait_file: { key: ["file"], add: ["served", "minted"] },
      bait_path: { key: ["path"], add: ["hits"] },
      bait_site: { key: ["site"], add: ["served", "trips"] },
      bait_day: { key: ["day"], add: ["served", "trips"] },
      bait_slot: { key: ["slot"], add: ["uses", "came_back"] },
      bait_meta: { key: ["key"], replace: ["value"] },
    };
    const local = new DatabaseSync(value("seed"), { readOnly: true });
    const quote = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" || typeof v === "bigint" ? String(v)
      : "'" + String(v).replace(/'/g, "''") + "'";
    let statements = [];
    const flush = async () => { if (statements.length) await query(statements.join(";\n")); statements = []; };
    for (const { name } of local.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'bait_%' AND name != 'bait_cache'").all()) {
      if (!tables.includes(name)) throw new Error(`D1 is missing ${name}; request any page through the Worker first so it creates its tables.`);
      const rows = local.prepare(`SELECT * FROM ${name}`).all();
      const rule = MERGE[name];
      if (!rule && ["bait_token", "bait_trip"].includes(name) && rows.length) throw new Error(`${name} has rows; only real backfills (no trips) can be seeded.`);
      for (const original of rows) {
        const row = { ...original };
        if (!rule) delete row.id;
        const columns = Object.keys(row);
        let sql = `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${columns.map((c) => quote(row[c])).join(", ")})`;
        if (rule) {
          const sets = [
            ...(rule.add || []).map((c) => `${c} = ${c} + excluded.${c}`),
            ...(rule.min || []).map((c) => `${c} = min(coalesce(${c}, excluded.${c}), coalesce(excluded.${c}, ${c}))`),
            ...(rule.max || []).map((c) => `${c} = max(coalesce(${c}, excluded.${c}), coalesce(excluded.${c}, ${c}))`),
            ...(rule.keep || []).map((c) => `${c} = coalesce(${c}, excluded.${c})`),
            ...(rule.replace || []).map((c) => `${c} = excluded.${c}`),
          ];
          sql += ` ON CONFLICT(${rule.key.join(", ")}) DO UPDATE SET ${sets.join(", ")}`;
        }
        statements.push(sql);
        if (statements.length >= 300) await flush();
      }
      await flush();
      console.log(`seeded ${name}: ${rows.length} rows`);
    }
    await query(`DELETE FROM bait_cache`);
  }
  process.exit(0);
}

const plan = [];
if (!database) plan.push(`create D1 database ${config.d1Database}`);
plan.push(`upload Worker ${config.worker} from ${config.main}`);
const zones = (await cf("/zones?per_page=50")).filter((z) => config.zones[z.name] && (!only || only.includes(z.name)));
const wanted = [];
for (const zone of zones) {
  // "paths" zones already have a *.zone/* Worker. Only an equally specific host plus a
  // longer path beats it, so Bait's paths use the same *.zone host.
  const patterns = config.zones[zone.name] === "all" ? [`*${zone.name}/*`] : config.pathRoutes.map((p) => `*.${zone.name}${p}`);
  const existing = await cf(`/zones/${zone.id}/workers/routes`);
  for (const stale of existing.filter((r) => r.script === config.worker && !patterns.includes(r.pattern))) {
    stale.zone = zone;
    wanted.push({ zone, pattern: stale.pattern, remove: stale.id });
    plan.push(`remove stale route ${stale.pattern}`);
  }
  for (const pattern of patterns) {
    const found = existing.find((r) => r.pattern === pattern);
    if (!found) { wanted.push({ zone, pattern }); plan.push(`add route ${pattern}`); }
    else if (found.script !== config.worker) plan.push(`SKIP ${pattern}: owned by ${found.script || "no Worker"}`);
  }
}
console.log(plan.map((line) => (apply ? "• " : "[dry run] ") + line).join("\n"));
if (!apply) process.exit(0);
if (!secret) throw new Error("Load BAIT_SECRET from /Users/mini-home/.secrets first.");

if (!database) database = await cf(`/accounts/${account}/d1/database`, { method: "POST", body: JSON.stringify({ name: config.d1Database }) });
const form = new FormData();
form.append("metadata", JSON.stringify({
  main_module: "bait.js", compatibility_date: config.compatibilityDate,
  bindings: [
    { type: "d1", name: "BAIT_DB", id: database.uuid },
    { type: "secret_text", name: "BAIT_SECRET", text: secret },
    ...Object.entries(config.vars).map(([name, text]) => ({ type: "plain_text", name, text })),
  ],
}));
form.append("bait.js", new Blob([readFileSync(new URL(config.main, ROOT))], { type: "application/javascript+module" }), "bait.js");
await cf(`/accounts/${account}/workers/scripts/${config.worker}`, { method: "PUT", body: form });
console.log(`uploaded ${config.worker} (D1 ${database.uuid})`);
for (const { zone, pattern, remove } of wanted) {
  if (remove) {
    await cf(`/zones/${zone.id}/workers/routes/${remove}`, { method: "DELETE" });
    console.log(`removed route ${pattern}`);
    continue;
  }
  await cf(`/zones/${zone.id}/workers/routes`, { method: "POST",
    body: JSON.stringify({ pattern, script: config.worker, request_limit_fail_open: config.failOpen }) });
  console.log(`route ${pattern}`);
}
