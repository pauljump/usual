#!/usr/bin/env node
// Serve a local Bait leaderboard from a SQLite store: node scripts/bait/preview.mjs bait.sqlite [port]
import http from "node:http";
import { createBait, baitMiddleware, d1Store } from "../../src/usual/bait/bait.js";
import { sqliteD1 } from "./sqlite-d1.mjs";

const [file = "bait-backfill.sqlite", port = "8787"] = process.argv.slice(2);
const bait = createBait({ secret: "local-preview", store: d1Store(sqliteD1(file), { cacheSeconds: 0 }), dashboard: "/_bait" });
const middleware = baitMiddleware(bait);
http.createServer((req, res) => middleware(req, res, () => {
  res.writeHead(302, { location: "/_bait/" }).end();
})).listen(Number(port), "127.0.0.1", () => console.log(`Bait leaderboard: http://127.0.0.1:${port}/_bait/`));
