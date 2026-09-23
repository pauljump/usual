// Scripted checks for Usual Bait: bait, trips, attribution, store and dashboard.
// Prints one JSON receipt. Exercised by tests/test_bait.py.
import assert from "node:assert/strict";
import http from "node:http";
import { createBait, baitMiddleware, d1Store, _internal } from "../src/usual/bait/bait.js";
import { sqliteD1 } from "../scripts/bait/sqlite-d1.mjs";

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const events = [];
const store = d1Store(sqliteD1(), { cacheSeconds: 0 });
const bait = createBait({ secret: "test-secret", store, dashboard: "shop.example.com/bait/live",
  onEvent: (e) => events.push(e) });
const req = (path, init = {}) => new Request("https://shop.example.com" + path, init);
const scanner = { ip: "203.0.113.9", asn: 14061, asOrg: "DigitalOcean, LLC", country: "NL" };
const settle = () => new Promise((r) => setTimeout(r, 30));

await check("bait only on scanner paths", async () => {
  for (const p of ["/.env", "/.env.production", "/app/.env", "/.git/config", "/.aws/credentials", "/.npmrc",
    "/wp-config.php.bak", "/secrets.json", "/.docker/config.json", "/prod.env"]) {
    assert.equal((await bait.handle(req(p), scanner))?.status, 200, p);
  }
  for (const p of ["/", "/about", "/wp-config.php", "/environment", "/api/v0/tracks", "/bait/live/x"]) {
    assert.equal(await bait.handle(req(p)), null, p);
  }
});
const env = await (await bait.handle(req("/.env"), scanner)).text();
await check("every credential unique, no fixed tell", async () => {
  const tokens = env.match(/(?<![A-Za-z0-9])[A-Za-z0-9]{65}(?![A-Za-z0-9])/g);
  assert.ok(tokens.length >= 12);
  assert.equal(new Set(tokens).size, tokens.length);
  assert.ok(new Set(tokens.map((t) => t[0])).size > 5);
  assert.match(env, /^APP_URL=https:\/\/shop\.example\.com$/m);
});
events.length = 0;
const admin = env.match(/ADMIN_URL=https:\/\/[^/]+(\/\S+)/)[1];
const api = env.match(/INTERNAL_API_TOKEN=(\S+)/)[1];
const dbpw = env.match(/DB_PASSWORD=(\S+)/)[1];
const user = { ip: "198.51.100.7", asn: 24940, asOrg: "Hetzner Online GmbH", country: "DE" };
await check("trips via url, bearer, body and git basic auth", async () => {
  assert.equal((await bait.handle(req(admin), user)).status, 401);
  assert.equal((await bait.handle(req("/api/internal/users", { headers: { authorization: "Bearer " + api } }), user)).status, 401);
  const body = JSON.stringify({ u: "a", p: dbpw });
  assert.equal((await bait.handle(req("/login", { method: "POST", body,
    headers: { "content-length": String(body.length), "content-type": "application/json" } }), user)).status, 401);
  const git = await (await bait.handle(req("/.git/config"), scanner)).text();
  const token = git.match(/deploy:([A-Za-z0-9]{65})@/)[1];
  assert.equal((await bait.handle(req("/_git/shop.git/info/refs",
    { headers: { authorization: "Basic " + btoa("deploy:" + token) } }), scanner)).status, 401);
  const trips = events.filter((e) => e.type === "tripped");
  assert.deepEqual(trips.map((t) => t.credential), ["admin-url", "internal-api-token", "database-password", "git-remote"]);
  assert.deepEqual(trips.map((t) => t.where), ["url", "header", "body", "header"]);
  assert.deepEqual(trips.map((t) => t.sameIp), [false, false, false, true]);
  assert.equal(trips[0].served.ip, "203.0.113.9");
  assert.equal(trips[0].served.asn, 14061);
  assert.equal(trips[0].served.country, "NL");
  assert.ok(!trips[0].path.includes(admin.split("/")[2]), "token redacted from path");
});
await check("wrong key and look-alikes are ignored", async () => {
  const other = createBait({ secret: "other", onEvent: () => {} });
  assert.equal(await other.handle(req(admin)), null);
  assert.equal(await bait.handle(req("/x/" + "a".repeat(65))), null);
  assert.equal(_internal.ipText(_internal.ipBytes("2001:db8::1")), "2001:db8::1");
});
await check("leaderboard counts and attribution", async () => {
  await bait.handle(req(admin), user);
  await settle();
  const s = await store.stats();
  assert.equal(s.totals.scrapes, 12);
  assert.ok(s.totals.credentialsHandedOut >= 20);
  assert.equal(s.totals.credentialsCameBack, 4);
  assert.equal(s.totals.timesUsed, 5);
  assert.equal(s.mostWanted[0].credential, "admin-url");
  assert.equal(s.mostWanted[0].uses, 2);
  assert.equal(s.mostWanted[0].scrapedBy.org, "DigitalOcean, LLC");
  assert.equal(s.mostWanted[0].firstUsedBy.org, "Hetzner Online GmbH");
  assert.equal(s.speed.handoffShare, 0.75);
  assert.equal(s.scrapers[0].credentialsLeaked, 4);
  assert.equal(s.users.find((u) => u.asn === 24940).credentials, 3);
  assert.equal(s.credentials.find((c) => c.credential === "stripe-secret").watchable, false);
  assert.ok(!JSON.stringify(s).includes("203.0.113.9") && !JSON.stringify(s).includes("198.51.100.7"), "no IPs in public stats");
});
await check("backfilled scans count but mint nothing", async () => {
  const s0 = await store.stats();
  await store.record({ type: "served", backfilled: true, at: "2026-08-01T00:00:00Z", site: "shop.example.com",
    file: "env", path: "/.env", credentials: 0, ip: "192.0.2.1", asn: 64500, country: "US" });
  const s1 = await store.stats();
  assert.equal(s1.totals.scrapes, s0.totals.scrapes + 1);
  assert.equal(s1.totals.backfilledScrapes, 1);
  assert.equal(s1.totals.credentialsHandedOut, s0.totals.credentialsHandedOut);
  assert.equal(s1.since, "2026-08-01T00:00:00.000Z");
});
await check("dashboard only on its host and path", async () => {
  const page = await bait.handle(req("/bait/live/"));
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await page.text(), /We poison the/);
  const json = await (await bait.handle(req("/bait/live/stats.json"))).json();
  assert.equal(json.totals.credentialsCameBack, 4);
  assert.equal(await bait.handle(new Request("https://other.example.com/bait/live/")), null);
});
await check("drip spreads the response", async () => {
  const slow = createBait({ secret: "x", drip: 1, onEvent: () => {} });
  const started = Date.now();
  await (await slow.handle(req("/.env"))).text();
  assert.ok(Date.now() - started >= 800);
});
await check("node middleware passes everything else through", async () => {
  const middleware = baitMiddleware(createBait({ secret: "x", onEvent: () => {} }));
  const server = http.createServer((q, s) => middleware(q, s, () => s.end("origin"))).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(base + "/")).text(), "origin");
  const response = await fetch(base + "/.env");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /DB_PASSWORD=/);
  server.close();
});
console.log(JSON.stringify({ status: "passed", kind: "scripted-client", checks, live_cloudflare: false }));
