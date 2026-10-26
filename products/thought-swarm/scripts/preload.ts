// Pre-loads the swarm before launch: asks the deployed service to digest every
// URL in seeds/urls.txt. Seeding needs the admin token and is not counted as
// agent reads, so the first real agent on each page gets a cache hit.
//   SWARM_URL=https://thoughtswarm.tryusual.com SWARM_ADMIN_TOKEN=... npx tsx scripts/preload.ts [--concurrency 6]
// Resumable: finished URLs are appended to seeds/done.txt and skipped next run.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const base = (process.env.SWARM_URL ?? "").replace(/\/$/, "");
const token = process.env.SWARM_ADMIN_TOKEN;
if (!base || !token) {
  console.error("Set SWARM_URL and SWARM_ADMIN_TOKEN.");
  process.exit(1);
}
const concurrency = Number(process.argv[process.argv.indexOf("--concurrency") + 1]) || 6;
const urls = readFileSync("seeds/urls.txt", "utf8").split("\n").filter(Boolean);
const done = new Set(existsSync("seeds/done.txt") ? readFileSync("seeds/done.txt", "utf8").split("\n").filter(Boolean) : []);
const todo = urls.filter((u) => !done.has(u));
console.log(`${urls.length} URLs, ${done.size} already done, ${todo.length} to go, ${concurrency} at a time.`);

let ok = 0, cached = 0, skipped = 0, failed = 0, pageTokens = 0, digestTokens = 0;
const reasons = new Map<string, number>();
const started = Date.now();

async function one(url: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${base}/read?seed=1&url=${encodeURIComponent(url)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(180_000),
    }).catch((e) => e as Error);
    if (res instanceof Error || res.status === 503 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    const body: any = await res.json().catch(() => ({}));
    if (res.ok) {
      body.receipt.hit ? cached++ : ok++;
      pageTokens += body.receipt.page_tokens;
      digestTokens += body.receipt.digest_tokens;
    } else {
      skipped++;
      const reason = String(body.error ?? res.status).slice(0, 80);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    appendFileSync("seeds/done.txt", url + "\n");
    return;
  }
  failed++;
}

let next = 0;
let finished = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < todo.length) {
      const url = todo[next++];
      await one(url);
      if (++finished % 50 === 0 || finished === todo.length) {
        const rate = finished / ((Date.now() - started) / 60_000);
        console.log(`${finished}/${todo.length} · digested ${ok} · already cached ${cached} · skipped ${skipped} · failed ${failed} · ${rate.toFixed(0)}/min`);
      }
    }
  }),
);

console.log(`\nDone. Digested ${ok}, already cached ${cached}, skipped ${skipped}, failed ${failed} (failed ones will retry on the next run).`);
console.log(`Pages hold ~${(pageTokens / 1e6).toFixed(1)}M tokens; digests ~${(digestTokens / 1e6).toFixed(1)}M (${pageTokens ? Math.round((100 * digestTokens) / pageTokens) : 0}% of page size).`);
if (reasons.size) {
  console.log("\nSkipped because:");
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${r}`);
}
