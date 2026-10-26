import { renderDigest, type Digest, type Digester } from "./digest.js";
import { estimateTokens } from "./extract.js";
import { outline, section as findSection, type SectionResult } from "./sections.js";
import { sha256Hex, type PageFetcher } from "./fetcher.js";
import type { DigestRow, SwarmStore } from "./store.js";
import { domainOf, normalizeUrl } from "./url.js";

export interface Receipt {
  hit: boolean;
  first_read_at: number;
  agents_on_page: number;
  reads_on_page: number;
  page_tokens: number;
  digest_tokens: number; // what this read returned: digest, outline and any section
  tokens_saved: number; // for this read: 0 on a miss
  tokens_saved_on_page: number;
  page_url: string; // public stats page for the domain
}

export interface ReadResult {
  url: string;
  title: string;
  content_hash: string;
  digest: Digest;
  markdown: string; // digest, page outline, and the requested section if any
  section?: SectionResult;
  receipt: Receipt;
  receipt_line: string;
}

export interface ReadEvent {
  url: string;
  domain: string;
  hit: boolean;
  tokens_saved: number;
  at: number;
}

export interface SwarmOptions {
  store: SwarmStore;
  fetcher: PageFetcher;
  digester: Digester;
  publicBaseUrl: string;
  agentSalt: string;
  now?: () => number;
  onRead?: (e: ReadEvent) => void | Promise<void>;
}

export class Swarm {
  private inflight = new Map<string, Promise<DigestRow>>();

  constructor(private readonly o: SwarmOptions) {}

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }

  // Fetching is cheap and keeps answers current; digesting is the expensive
  // step, done once per (page content, recipe) for everyone.
  async read(rawUrl: string, agentId: string, opts: { allowMiss?: () => boolean; seed?: boolean; section?: string } = {}): Promise<ReadResult> {
    const page = await this.o.fetcher.fetchPage(normalizeUrl(rawUrl));
    const contentHash = await sha256Hex(page.text);
    const key = await sha256Hex([page.url, contentHash, this.o.digester.recipe].join("\n"));

    let row = await this.o.store.getDigest(key);
    let hit = row !== null;
    if (!row) {
      if (opts.allowMiss && !opts.allowMiss()) throw new RateLimited();
      let job = this.inflight.get(key);
      if (!job) {
        job = (async () => {
          const digest = await this.o.digester.digest({ url: page.url, title: page.title, text: page.text });
          if (page.attribution) digest.attribution = page.attribution;
          const newRow = {
            key,
            url: page.url,
            content_hash: contentHash,
            recipe: this.o.digester.recipe,
            title: digest.title || page.title,
            digest_json: JSON.stringify(digest),
            page_tokens: estimateTokens(page.text),
            digest_tokens: estimateTokens(renderDigest(digest, page.url)),
            created_at: this.now(),
          };
          await this.o.store.putDigest(newRow);
          return (await this.o.store.getDigest(key)) ?? newRow;
        })().finally(() => this.inflight.delete(key));
        this.inflight.set(key, job);
        row = await job;
      } else {
        // Another request is digesting this exact page right now; share it.
        row = await job;
        hit = true;
      }
    }

    const digest = JSON.parse(row.digest_json) as Digest;
    // The outline and section come from the live page text on every read, so
    // they need no model call and are never stale.
    const sec = opts.section?.trim() ? findSection(page.text, opts.section) : undefined;
    const markdown = renderRead(renderDigest(digest, row.url), outline(page.text), sec);
    const served = estimateTokens(markdown);
    const saved = hit ? Math.max(0, row.page_tokens - served) : 0;
    const at = this.now();
    const domain = domainOf(row.url);
    // Seeding (pre-loading pages before launch) is not a read by an agent, so
    // it never counts toward reads, agents or savings.
    if (!opts.seed) await this.o.store.recordRead({
      url: row.url,
      domain,
      digest_key: key,
      agent: await sha256Hex(this.o.agentSalt + "\n" + agentId),
      hit,
      tokens_saved: saved,
      at,
    });
    const stats = await this.o.store.pageStats(row.url);
    const receipt: Receipt = {
      hit,
      first_read_at: Math.min(row.created_at, stats.first_read_at ?? at),
      agents_on_page: stats.agents,
      reads_on_page: stats.reads,
      page_tokens: row.page_tokens,
      digest_tokens: served,
      tokens_saved: saved,
      tokens_saved_on_page: stats.tokens_saved,
      page_url: `${this.o.publicBaseUrl.replace(/\/$/, "")}/p/${domain}`,
    };
    if (!opts.seed) await Promise.resolve(this.o.onRead?.({ url: row.url, domain, hit, tokens_saved: saved, at })).catch(() => {});
    return { url: row.url, title: row.title, content_hash: contentHash, digest, markdown, ...(sec ? { section: sec } : {}), receipt, receipt_line: receiptLine(receipt, at) };
  }
}

function renderRead(digest: string, pageOutline: string, sec?: SectionResult): string {
  const out = [digest];
  if (pageOutline) {
    out.push("", "## Sections on this page", "The digest above is short. For any section below, ask the swarm for it by its name or number to get its full text.", "", pageOutline);
  }
  if (sec) {
    out.push("", `## Section: ${sec.query}`);
    out.push(sec.found ? `Full text of this part of the page, copied from the live page:\n\n${sec.text}` : `Nothing on this page matches "${sec.query}". Try a heading or rule number from the outline.`);
  }
  return out.join("\n");
}

export class RateLimited extends Error {
  constructor() {
    super("This address has asked the swarm to digest a lot of new pages recently. Cached pages still work; new ones resume within the hour.");
  }
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString("en-US");
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function receiptLine(r: Receipt, now: number): string {
  const agents = `${r.agents_on_page.toLocaleString("en-US")} agent${r.agents_on_page === 1 ? " has" : "s have"} read this page`;
  if (r.hit) {
    return [
      `⬡ swarm receipt · served from cache · first read ${ago(now - r.first_read_at)} · ${agents}`,
      `  ${r.tokens_saved.toLocaleString("en-US")} tokens saved for you · ${compact(r.tokens_saved_on_page)} saved on this page so far · ${r.page_url}`,
    ].join("\n");
  }
  const next = Math.max(0, r.page_tokens - r.digest_tokens);
  return [
    `⬡ swarm receipt · you're the first agent to read this version of the page · ${agents}`,
    `  the next agent saves about ${next.toLocaleString("en-US")} tokens · ${r.page_url}`,
  ].join("\n");
}
