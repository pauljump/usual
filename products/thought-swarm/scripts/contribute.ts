// Gives the swarm pages your agents have already read, so the next agent gets
// a cache hit instead of reading them again. Anyone can run it; no token.
//
//   npx tsx scripts/contribute.ts --from-claude            # pages your Claude Code agents fetched
//   npx tsx scripts/contribute.ts --file urls.txt          # your own list, one URL per line
//
// It starts as a dry run: it writes contribute-plan.tsv listing every URL as
// new, already in the swarm, or skipped (and why), and sends nothing. Read the
// plan, then add --send. Only URLs leave your machine, never page content or
// transcripts. Options:
//   --swarm <url>        default https://thoughtswarm.tryusual.com
//   --since YYYY-MM-DD   only transcripts changed since this date (with --from-claude)
//   --skip-host <host>   never send this host (repeatable), e.g. your own sites
//   --per-hour <n>       pace new digests (default 55; the swarm allows 60 an hour per address)
// Resumable: sent URLs are appended to contribute-done.txt and skipped next run.
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkUrl, fetchedUrls, listedUrls } from "../src/contribute.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const all = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const base = (opt("--swarm") ?? "https://thoughtswarm.tryusual.com").replace(/\/$/, "");
const send = args.includes("--send");
const perHour = Number(opt("--per-hour")) || 55;
const since = opt("--since") ? Date.parse(opt("--since")!) : 0;
const skipHosts = all("--skip-host");
const COST_PER_PAGE = [0.001, 0.003]; // Haiku 5.5, typical 5k to 20k token docs page

function* jsonlFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* jsonlFiles(p);
    else if (name.endsWith(".jsonl") && s.mtimeMs >= since) yield p;
  }
}

const raw: string[] = [];
if (args.includes("--from-claude")) {
  const dir = opt("--from-claude")?.startsWith("--") === false ? opt("--from-claude")! : join(homedir(), ".claude", "projects");
  let files = 0;
  for (const f of jsonlFiles(dir)) {
    files++;
    for (const line of readFileSync(f, "utf8").split("\n")) if (line.includes('"WebFetch"')) raw.push(...fetchedUrls(line));
  }
  console.log(`Read ${files} transcripts in ${dir}: ${raw.length} page fetches.`);
}
for (const f of all("--file")) raw.push(...listedUrls(readFileSync(f, "utf8")));
if (!raw.length) {
  console.error("Nothing to contribute. Pass --from-claude and/or --file urls.txt.");
  process.exit(1);
}

const plan = new Map<string, { status: string; reason: string; times: number }>();
const skipped = new Map<string, number>();
for (const r of raw) {
  const v = checkUrl(r, skipHosts);
  if (!v.ok) { skipped.set(v.reason, (skipped.get(v.reason) ?? 0) + 1); continue; }
  const e = plan.get(v.url);
  if (e) e.times++;
  else plan.set(v.url, { status: "new", reason: "", times: 1 });
}

// Already in the swarm? /document answers from saved digests only: no fetch,
// no model call, not counted as a read.
const urls = [...plan.keys()];
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < urls.length) {
    const u = urls[next++];
    const res = await fetch(`${base}/document?url=${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (res?.ok) plan.get(u)!.status = "already";
    await res?.body?.cancel();
  }
}));

const fresh = urls.filter((u) => plan.get(u)!.status === "new");
writeFileSync("contribute-plan.tsv", "status\ttimes_read\turl\n" + [...plan].sort((a, b) => b[1].times - a[1].times).map(([u, e]) => `${e.status}\t${e.times}\t${u}`).join("\n") + "\n");
console.log(`${plan.size} distinct public pages: ${plan.size - fresh.length} already in the swarm, ${fresh.length} new.`);
for (const [reason, n] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`  skipped ${n} fetches: ${reason}`);
console.log(`New digests would cost the swarm about $${(fresh.length * COST_PER_PAGE[0]).toFixed(2)} to $${(fresh.length * COST_PER_PAGE[1]).toFixed(2)} and take about ${Math.ceil(fresh.length / perHour)} hours at ${perHour} an hour.`);
console.log("Plan written to contribute-plan.tsv.");
if (!send) {
  console.log("Dry run: nothing sent. Check the plan, then re-run with --send.");
  process.exit(0);
}

const done = new Set(existsSync("contribute-done.txt") ? listedUrls(readFileSync("contribute-done.txt", "utf8")) : []);
const todo = fresh.filter((u) => !done.has(u));
const gap = 3_600_000 / perHour;
let added = 0, refused = 0;
for (const [i, u] of todo.entries()) {
  const started = Date.now();
  const res = await fetch(`${base}/read?contribute=1&url=${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(180_000) }).catch((e) => e as Error);
  if (res instanceof Error || res.status === 429 || res.status >= 500) {
    console.log(`Stopped at ${u}: ${res instanceof Error ? res.message : res.status}. Re-run later to continue.`);
    break;
  }
  const body: any = await res.json().catch(() => ({}));
  if (res.ok) added++;
  else { refused++; console.log(`  not added: ${u} (${String(body.error ?? res.status).slice(0, 100)})`); }
  appendFileSync("contribute-done.txt", u + "\n");
  if ((i + 1) % 25 === 0) console.log(`${i + 1}/${todo.length} · added ${added} · refused ${refused}`);
  if (i < todo.length - 1) await new Promise((r) => setTimeout(r, Math.max(0, gap - (Date.now() - started))));
}
console.log(`Done. Added ${added} pages to the swarm; ${refused} refused (robots.txt, login walls, not a document).`);
