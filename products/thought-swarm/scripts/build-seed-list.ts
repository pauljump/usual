// Builds seeds/urls.txt, the pages to pre-load before launch, from the sites in
// seeds/sites.tsv. Run it somewhere with open internet (Paul's Mac mini):
//   npx tsx scripts/build-seed-list.ts [--max 10000]
import { readFileSync, writeFileSync } from "node:fs";
import { USER_AGENT } from "../src/fetcher.js";
import { normalizeUrl } from "../src/url.js";

const maxTotal = Number(process.argv[process.argv.indexOf("--max") + 1]) || 10_000;
const sites = readFileSync("seeds/sites.tsv", "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => {
    const [start, prefixes, max] = l.split("\t");
    return { start, prefixes: prefixes.split(",").map((p) => p.trim()), max: Number(max) };
  });

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    if (url.endsWith(".gz")) {
      const stream = res.body!.pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    }
    return await res.text();
  } catch {
    return null;
  }
}

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

async function sitemapUrls(origin: string, budget = 40): Promise<string[]> {
  const robots = (await get(`${origin}/robots.txt`)) ?? "";
  const queue = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (!queue.length) queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap-index.xml`);
  const out: string[] = [];
  const seen = new Set<string>();
  while (queue.length && budget-- > 0) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const xml = await get(sm);
    if (!xml) continue;
    if (/<sitemapindex/i.test(xml)) queue.push(...locs(xml));
    else out.push(...locs(xml));
  }
  return out;
}

async function linkedUrls(start: string): Promise<string[]> {
  const html = (await get(start)) ?? "";
  return [...html.matchAll(/href\s*=\s*(?:"([^"#]*)"|'([^'#]*)'|([^\s>#"']+))/gi)].flatMap((m) => {
    try {
      return [new URL(m[1] ?? m[2] ?? m[3], start).toString()];
    } catch {
      return [];
    }
  });
}

const all: string[] = [];
for (const site of sites) {
  const origin = new URL(site.start).origin;
  const keep = (u: string) => {
    try {
      const url = new URL(u);
      return url.origin === origin && site.prefixes.some((p) => url.pathname.startsWith(p)) && !/\.(png|jpe?g|gif|svg|pdf|zip|xml|json|txt)$/i.test(url.pathname);
    } catch {
      return false;
    }
  };
  let candidates = (await sitemapUrls(origin)).filter(keep);
  let source = "sitemap";
  if (candidates.length < 10) {
    candidates = [site.start, ...(await linkedUrls(site.start))].filter(keep);
    source = "links on the start page";
  }
  const unique = [...new Set(candidates.map((u) => { try { return normalizeUrl(u); } catch { return ""; } }).filter(Boolean))];
  unique.sort((a, b) => new URL(a).pathname.split("/").length - new URL(b).pathname.split("/").length || a.localeCompare(b));
  const picked = unique.slice(0, site.max);
  console.log(`${origin.padEnd(40)} ${String(picked.length).padStart(5)} of ${unique.length} (${source})`);
  all.push(...picked);
}

// Round-robin across sites so a --max cut keeps every site represented.
const bySite = new Map<string, string[]>();
for (const u of all) {
  const o = new URL(u).origin;
  bySite.set(o, [...(bySite.get(o) ?? []), u]);
}
const ordered: string[] = [];
while (ordered.length < Math.min(maxTotal, all.length)) {
  for (const list of bySite.values()) {
    const u = list.shift();
    if (u && ordered.length < maxTotal) ordered.push(u);
  }
}
writeFileSync("seeds/urls.txt", ordered.join("\n") + "\n");
console.log(`\nWrote ${ordered.length} URLs to seeds/urls.txt`);
