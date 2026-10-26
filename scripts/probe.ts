// Fetch real pages through the swarm's fetcher and show what a digest would be built from.
//   npx tsx scripts/probe.ts <url> [...]
import { estimateTokens } from "../src/extract.js";
import { PageFetcher, sha256Hex } from "../src/fetcher.js";
import { normalizeUrl } from "../src/url.js";

const fetcher = new PageFetcher();
for (const raw of process.argv.slice(2)) {
  try {
    const a = await fetcher.fetchPage(normalizeUrl(raw));
    const b = await fetcher.fetchPage(normalizeUrl(raw));
    const [ha, hb] = [await sha256Hex(a.text), await sha256Hex(b.text)];
    console.log(`\n${a.url}\n  title: ${a.title}\n  tokens: ${estimateTokens(a.text)}  stable hash across two fetches: ${ha === hb}`);
    console.log("  " + a.text.slice(0, 400).replace(/\n/g, "\n  "));
  } catch (err) {
    console.log(`\n${raw}\n  error: ${(err as Error).message}`);
  }
}
