import { renderDigest, type Digest, type Digester } from "./digest.js";
import { estimateTokens } from "./extract.js";
import { outline, section as findSection, type SectionResult } from "./sections.js";
import { sha256Hex, type FetchedPage, type PageFetcher } from "./fetcher.js";
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

  // Saved snapshots avoid network and extraction work until an explicit refresh.
  // The stored form of an agent id or IP. Raw ids are never stored.
  hashAgent(agentId: string): Promise<string> {
    return sha256Hex(this.o.agentSalt + "\n" + agentId);
  }

  async read(rawUrl: string, agentId: string, opts: { allowMiss?: () => boolean; seed?: boolean; section?: string; refresh?: boolean } = {}): Promise<ReadResult> {
    const normalized = normalizeUrl(rawUrl);
    if (!opts.refresh) {
      const cached = await this.o.store.latestDigest(normalized);
      if (cached) return this.readSnapshot(cached, agentId, opts);
    }
    const page = await this.o.fetcher.fetchPage(normalized);
    return this.ingest(page, agentId, opts, normalized);
  }

  // Trusted preload callers perform fetching and robots checks on the Mini.
  async ingest(page: FetchedPage, agentId: string, opts: { allowMiss?: () => boolean; seed?: boolean; section?: string; refresh?: boolean } = {}, normalized = page.url): Promise<ReadResult> {
    await this.o.store.alias(normalized, page.url);
    const contentHash = await sha256Hex(page.text);
    const key = await sha256Hex([page.url, contentHash, this.o.digester.recipe].join("\n"));

    let row = await this.o.store.getDigest(key);
    if (!row) {
      const prior = await this.o.store.latestDigest(page.url);
      if (prior?.content_hash === contentHash) row = prior;
    }
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

    await this.o.store.saveSource(row.key, page.text);
    return this.finishRead(row, hit, agentId, opts, page.text);
  }

  async readSnapshot(row: DigestRow, agentId: string, opts: {seed?: boolean; section?: string} = {}): Promise<ReadResult> {
    const source = opts.section ? await this.o.store.source(row.key) : undefined;
    const savedOutline = await this.o.store.sourceOutline(row.key);
    return this.finishRead(row, true, agentId, opts, source, savedOutline?.outline);
  }

  private async finishRead(row: DigestRow, hit: boolean, agentId: string,
    opts: { seed?: boolean; section?: string; refresh?: boolean }, source?: string, savedOutline?: string): Promise<ReadResult> {
    const digest = JSON.parse(row.digest_json) as Digest;
    // Exact sections and outlines use the same saved source as the digest.
    const sec = opts.section?.trim() && source ? findSection(source, opts.section) : undefined;
    const snapshot = `Source snapshot: ${new Date(row.created_at).toISOString()}. ${opts.refresh ? "Source checked during this read." : "Served from saved content; the source was not re-fetched. Use refresh=true to check for changes."}`;
    const missing = opts.section?.trim() && !source ? "\n\nExact section text was not saved with this older digest. Use refresh=true to capture it, or open the source link." : "";
    const markdown = renderRead(renderDigest(digest, row.url), source ? outline(source) : (savedOutline ?? ""), sec) + "\n\n" + snapshot + missing;
    const served = estimateTokens(markdown);
    const saved = hit ? Math.max(0, row.page_tokens - served) : 0;
    const at = this.now();
    const domain = domainOf(row.url);
    // Seeding (pre-loading pages before launch) is not a read by an agent, so
    // it never counts toward reads, agents or savings.
    if (!opts.seed) await this.o.store.recordRead({
      url: row.url,
      domain,
      digest_key: row.key,
      agent: await this.hashAgent(agentId),
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
    return { url: row.url, title: row.title, content_hash: row.content_hash, digest, markdown, ...(sec ? { section: sec } : {}), receipt, receipt_line: receiptLine(receipt, at) };
  }
}

function renderRead(digest: string, pageOutline: string, sec?: SectionResult): string {
  const out = [digest];
  if (pageOutline) {
    out.push("", "## Sections on this page", "The digest above is short. For any section below, ask the swarm for it by its name or number to get its full text.", "", pageOutline);
  }
  if (sec) {
    out.push("", `## Section: ${sec.query}`);
    out.push(sec.found ? `Full text of this part of the page, copied from the saved source snapshot:\n\n${sec.text}` : `Nothing on this page matches "${sec.query}". Try a heading or rule number from the outline.`);
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
