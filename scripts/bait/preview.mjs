#!/usr/bin/env node
// Local preview from SQLite: node scripts/bait/preview.mjs bait.sqlite [port]
// Or a previously saved public JSON snapshot, without contacting any provider:
// node scripts/bait/preview.mjs --snapshot /private/path/stats.json [port]
// Local company + replay test, isolated in memory: node scripts/bait/preview.mjs --company [port]
import http from "node:http";
import { readFileSync } from "node:fs";
import { createBait, baitMiddleware, d1Store, dashboardPage } from "../../src/usual/bait/bait.js";
import { sqliteD1 } from "./sqlite-d1.mjs";

const args = process.argv.slice(2);
const snapshot = args[0] === "--snapshot";
const [file = "bait-backfill.sqlite", port = "8787"] = snapshot ? args.slice(1) : args;
if (args[0] === "--company") {
  const db = sqliteD1(), store = d1Store(db, { cacheSeconds: 0 });
  await store.stats();
  db.raw.prepare("INSERT OR REPLACE INTO bait_meta(key,value) VALUES ('notice',?)").run("SIMULATED · Local browser test. No public traffic or counts.");
  const bait = createBait({ secret: "local-company-preview", store, dashboard: "/_bait",
    learning: true, tarpit: true, tarpitSeconds: .05, onEvent() {} });
  const pending = [];
  const context = { ip: "127.0.0.1", waitUntil: p => pending.push(p) };
  http.createServer(async (req, res) => {
    try {
      const base = "http://" + req.headers.host;
      if (req.url === "/") {
        const env = await (await bait.handle(new Request(base + "/.env"), context)).text();
        const login = new URL(env.match(/^ADMIN_LOGIN_URL=(.+)$/m)[1]).pathname;
        const password = env.match(/^DB_PASSWORD=(.+)$/m)[1];
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Bait test</title><main style="max-width:720px;margin:60px auto;font:18px/1.6 system-ui;padding:24px"><h1>Local Bait test</h1><p>Simulated traffic, in memory only. No provider calls or public counters.</p><p><a href="${login}">Open the login</a></p><p>Username: deploy</p><label>Fake password<textarea readonly style="width:100%;height:120px">${password}</textarea></label><form method="post" action="${login}"><input type="hidden" name="password" value="${password}"><button>Sign in with the fake password</button></form><p><a href="/_bait/">View the local score and replays</a></p></main>`);
        return;
      }
      const body = [];
      let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16384) { res.writeHead(413).end(); return; } body.push(chunk); }
      const request = new Request(base + req.url, { method: req.method, headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(body) } : {}) });
      const response = await bait.handleWithOrigin(request, async () => new Response("Local preview only", { status: 404 }), context);
      res.writeHead(response.status, { ...Object.fromEntries(response.headers), "cache-control": "no-store" });
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch { res.writeHead(500).end("Local preview failed"); }
    finally { await Promise.all(pending.splice(0)); }
  }).listen(Number(args[1] || 8793), "127.0.0.1", () => console.log(`Bait company preview (local test only): http://127.0.0.1:${args[1] || 8793}/`));
} else if (snapshot) {
  const saved = JSON.parse(readFileSync(file, "utf8"));
  if (!saved.totals) throw new Error("Snapshot must contain public Bait stats.");
  const stats = { ...saved, preview: { source: "saved public stats", live: false } };
  http.createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    res.setHeader("cache-control", "no-store");
    if (path === "/_bait/stats.json") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stats));
    } else if (path === "/_bait/" || path === "/_bait") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:" }).end(dashboardPage());
    } else res.writeHead(404).end("Local preview only");
  }).listen(Number(port), "127.0.0.1", () => console.log(`Bait product preview (saved snapshot): http://127.0.0.1:${port}/_bait/`));
} else {
const bait = createBait({ secret: "local-preview", store: d1Store(sqliteD1(file), { cacheSeconds: 0 }), dashboard: "/_bait" });
const middleware = baitMiddleware(bait);
http.createServer((req, res) => middleware(req, res, () => {
  res.writeHead(302, { location: "/_bait/" }).end();
})).listen(Number(port), "127.0.0.1", () => console.log(`Bait leaderboard: http://127.0.0.1:${port}/_bait/`));
}
