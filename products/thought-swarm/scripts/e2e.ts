// End-to-end run against real pages without an Anthropic key: real fetching,
// hashing, storage, receipts and scoreboard, with an offline stand-in for the
// model call. Set ANTHROPIC_API_KEY to use the real digester instead.
//   npx tsx scripts/e2e.ts <url> [...]
import { ClaudeDigester } from "../src/digest.js";
import { OfflineDigester } from "../src/offline.js";
import { PageFetcher } from "../src/fetcher.js";
import { App } from "../src/http.js";
import { sqliteDb } from "../src/sqlite.js";
import { SwarmStore } from "../src/store.js";
import { Swarm } from "../src/swarm.js";

  },
};

const store = new SwarmStore(await sqliteDb(":memory:"));
await store.init();
const base = "https://swarm.example";
const app = new App({
  store,
  publicBaseUrl: base,
  swarm: new Swarm({
    store,
    fetcher: new PageFetcher(),
    digester: process.env.ANTHROPIC_API_KEY ? new ClaudeDigester() : new OfflineDigester(),
    publicBaseUrl: base,
    agentSalt: "e2e",
  }),
});

const urls = process.argv.slice(2);
for (const agent of ["alice", "bob", "carol", "dave"]) {
  for (const url of urls) {
    const t0 = Date.now();
    const res = await app.handle(new Request(`${base}/read?agent=${agent}&url=${encodeURIComponent(url)}`, { headers: { "x-forwarded-for": "9.9.9.9" } }));
    const body: any = await res.json();
    console.log(`\n[${agent}] ${url} -> HTTP ${res.status} in ${Date.now() - t0} ms`);
    console.log(body.receipt_line ?? body.error);
  }
}
const stats: any = await (await app.handle(new Request(`${base}/stats`))).json();
console.log("\n/stats all_time:", stats.all_time);
console.log("/stats top pages:", stats.top_pages_24h);
