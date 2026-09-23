#!/usr/bin/env node
// Seed a Bait leaderboard with real secret-file scans from Cloudflare's logs.
//
// Cloudflare keeps about 30 days of request detail on the free plan. Every
// request for a path Bait would have answered becomes a backfilled "served"
// event: real time, site, path, country and network. No credentials were handed
// out before Bait went live, so backfilled scans mint none and trip none.
//
//   CLOUDFLARE_API_KEY=… CLOUDFLARE_EMAIL=… node scripts/bait/backfill.mjs --out bait.sqlite
//   … --zones tryslopify.com,tryusual.com      only these zones
//   … --days 30                                window (Cloudflare caps it near 30)
//   … --until 2026-09-23T15:00:00Z             stop where live recording began (no double counting)
//   … --scans scans.json                       reuse (or save) fetched scans instead of re-querying
//   … --simulate-trips                         LOCAL PREVIEW ONLY: pretend every
//                                              credential was handed out and used
//
// Network names come from Team Cymru's public IP-to-ASN DNS service.

import { promises as dns } from "node:dns";
import { d1Store, _internal } from "../../src/usual/bait/bait.js";
import { sqliteD1 } from "./sqlite-d1.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) =>
  arg.startsWith("--") ? [arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : null).filter(Boolean));
const out = args.out || "bait-backfill.sqlite";
const days = Math.min(Number(args.days || 30), 30);
const simulate = Boolean(args["simulate-trips"]);
const key = process.env.CLOUDFLARE_API_KEY;
const email = process.env.CLOUDFLARE_EMAIL;
if (!args.scans && (!key || !email)) throw new Error("Set CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL (read-only analytics use).");
const headers = { "X-Auth-Key": key, "X-Auth-Email": email, "Content-Type": "application/json" };

async function api(path) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, { headers });
  const body = await response.json();
  if (!body.success) throw new Error(JSON.stringify(body.errors));
  return body.result;
}

async function graphql(query) {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers,
    body: JSON.stringify({ query }) });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

// Cloudflare filters are LIKE patterns; Bait's own regexes make the final call.
const LIKES = ["%.env%", "%/.git/config", "%/.aws/%", "%.npmrc", "%/.docker/config.json", "%wp-config.php%",
  "%secrets.json", "%credentials.json", "%appsettings%.json"];

async function scans(zone) {
  const rows = [];
  const end = args.until ? Date.parse(args.until) : Date.now() - 60_000;
  const start = end - days * 86400_000 + 3600_000;
  for (let from = start; from < end; from += 86400_000) {
    const to = Math.min(from + 86400_000, end);
    const filter = `{datetime_geq:"${new Date(from).toISOString()}",datetime_lt:"${new Date(to).toISOString()}",` +
      `OR:[${LIKES.map((like) => `{clientRequestPath_like:${JSON.stringify(like)}}`).join(",")}]}`;
    const data = await graphql(`{viewer{zones(filter:{zoneTag:"${zone.id}"}){g:httpRequestsAdaptiveGroups(limit:10000,` +
      `filter:${filter},orderBy:[datetime_ASC]){count dimensions{datetime clientRequestPath clientIP clientCountryName ` +
      `userAgent clientRequestHTTPHost}}}}}`);
    const groups = data.viewer.zones[0]?.g || [];
    if (groups.length === 10000) console.warn(`[backfill] ${zone.name}: day ${new Date(from).toISOString().slice(0, 10)} hit the 10k row cap`);
    for (const group of groups) {
      const d = group.dimensions;
      if (!_internal.FILES.some((f) => f.pattern.test(d.clientRequestPath))) continue;
      rows.push({ ...d, count: group.count });
    }
  }
  return rows;
}

const reversed = (ip) => ip.includes(":")
  ? ip.split("::").length > 1 ? null : ip.split(":").map((g) => g.padStart(4, "0")).join("").split("").reverse().join(".")
  : ip.split(".").reverse().join(".");

async function networkFor(ip, cache) {
  if (cache.has(ip)) return cache.get(ip);
  let result = { asn: null, org: null };
  try {
    const name = reversed(ip);
    if (name) {
      const zone = ip.includes(":") ? "origin6.asn.cymru.com" : "origin.asn.cymru.com";
      const [[origin]] = await dns.resolveTxt(`${name}.${zone}`);
      const asn = Number(origin.split("|")[0].trim().split(" ")[0]);
      if (asn) {
        const [[described]] = await dns.resolveTxt(`AS${asn}.asn.cymru.com`);
        // "HANDLE - Company Name, CC" reads as "Company Name".
        const org = described.split("|").pop().trim().replace(/, [A-Z]{2}$/, "").replace(/^\S+ - /, "");
        result = { asn, org };
      }
    }
  } catch { /* unresolvable addresses stay unknown */ }
  cache.set(ip, result);
  return result;
}

const db = sqliteD1(out);
const store = d1Store(db, { cacheSeconds: 0 });
const networks = new Map();
let served = [];
const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
if (args.scans && existsSync(args.scans)) {
  const saved = JSON.parse(readFileSync(args.scans, "utf8"));
  served = saved.served;
  for (const [ip, network] of saved.networks) networks.set(ip, network);
} else {
  const wanted = args.zones ? String(args.zones).split(",") : null;
  const zones = (await api("/zones?per_page=50")).filter((z) => !wanted || wanted.includes(z.name));
  for (const zone of zones) {
    const rows = await scans(zone);
    console.log(`[backfill] ${zone.name}: ${rows.reduce((sum, r) => sum + r.count, 0)} secret-file requests`);
    served.push(...rows);
  }
  const ips = [...new Set(served.map((r) => r.clientIP))];
  for (let i = 0; i < ips.length; i += 25) await Promise.all(ips.slice(i, i + 25).map((ip) => networkFor(ip, networks)));
  if (args.scans) writeFileSync(args.scans, JSON.stringify({ served, networks: [...networks] }));
}

const events = [];
for (const row of served) {
  const file = _internal.FILES.find((f) => f.pattern.test(row.clientRequestPath)).kind;
  const host = row.clientRequestHTTPHost.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
  const network = networks.get(row.clientIP);
  for (let i = 0; i < row.count; i++) {
    events.push({ type: "served", backfilled: true, at: row.datetime, site: host, file, path: row.clientRequestPath,
      credentials: simulate ? _internal.FILE_SLOTS[file].length : 0, ip: row.clientIP, asn: network.asn,
      asOrg: network.org, country: row.clientCountryName || null, userAgent: row.userAgent });
  }
}
events.sort((a, b) => a.at.localeCompare(b.at));
for (const event of events) await store.record(event);

if (simulate) {
  // Every credential gets used at least once, mostly within hours, often by another network.
  const pool = events.filter((e) => e.asn);
  const now = Date.now();
  const trips = [];
  for (const scrape of events) {
    // Only credentials pointing at our own sites can ever be seen coming back.
    for (const slot of _internal.FILE_SLOTS[scrape.file].filter((name) => _internal.WATCHABLE.has(name))) {
      const id = Math.random().toString(16).slice(2, 12);
      let delay = Math.round(Math.exp(1 + Math.random() * 11));
      for (let use = 0, uses = 1 + Math.floor(Math.random() ** 3 * 6); use < uses; use++) {
        const at = Date.parse(scrape.at) + delay * 1000;
        if (at > now) break;
        const user = Math.random() < 0.45 || !pool.length ? scrape : pool[Math.floor(Math.random() * pool.length)];
        trips.push({ type: "tripped", at: new Date(at).toISOString(), site: scrape.site, credentialId: id, credential: slot,
          file: scrape.file, secondsSinceServed: delay, sameIp: user === scrape, where: slot.includes("url") || slot === "git-remote" ? "url" : "header",
          method: "GET", path: slot === "admin-url" ? "/_internal/[bait]/login" : slot === "git-remote" ? "/_git/app.git/info/refs" : "/api/internal/users",
          ip: user.ip, asn: user.asn, asOrg: user.asOrg, country: user.country, userAgent: user.userAgent,
          served: { servedAt: scrape.at, ip: scrape.ip, asn: scrape.asn, country: scrape.country, file: scrape.file, slot } });
        delay += Math.round(Math.exp(2 + Math.random() * 10));
      }
    }
  }
  trips.sort((a, b) => a.at.localeCompare(b.at));
  for (const trip of trips) await store.record(trip);
  await db.prepare(`INSERT INTO bait_meta (key, value) VALUES ('notice', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind("SIMULATED: real scans from our sites, but every credential is pretended to have been handed out and used. Not real results.").run();
  console.log(`[backfill] simulated ${trips.length} uses (preview only)`);
} else {
  const first = events[0]?.at?.slice(0, 10);
  await db.prepare(`INSERT INTO bait_meta (key, value) VALUES ('notice', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(`Scans before Bait went live${first ? ` (from ${first})` : ""} are backfilled from Cloudflare logs. No credentials were handed out to them, so they can't come back.`).run();
}
console.log(`[backfill] ${events.length} scans from ${new Set(events.map((e) => e.ip)).size} addresses in ${networks.size ? new Set([...networks.values()].map((n) => n.asn)).size : 0} networks -> ${out}`);
