import { doccDataUrl, renderDocc } from "./docc.js";
import { extractText, type Extracted } from "./extract.js";
import { AGENT_TOKEN, isAllowed, parseRobots } from "./robots.js";
import { assertPublicTarget, normalizeUrl } from "./url.js";
import { streamFiling } from "./filing.js";

export const USER_AGENT = `Mozilla/5.0 (compatible; ${AGENT_TOKEN}/0.1; +https://thoughtswarm.tryusual.com)`;
export const MAX_PAGE_BYTES = 20_000_000;
const ROBOTS_TTL_MS = 60 * 60 * 1000;
const TEXT_TYPES = /^(text\/(html|plain|markdown|x-markdown)|application\/(xhtml\+xml|json))/i;

export class FetchError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export interface FetchedPage extends Extracted {
  url: string; // normalized final URL after redirects
  contentType: string;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class PageFetcher {
  private robots = new Map<string, { at: number; rules: ReturnType<typeof parseRobots> }>();

  constructor(private readonly fetchFn: FetchFn = (i, init) => fetch(i, init), private readonly timeoutMs = 15_000) {}

  async fetchPage(normalizedUrl: string): Promise<FetchedPage> {
    assertPublicTarget(normalizedUrl);
    await this.checkRobots(normalizedUrl);

    const docc = doccDataUrl(normalizedUrl);
    if (docc) {
      const page = await this.fetchDocc(normalizedUrl, docc);
      if (page) return page;
    }

    const res = await this.get(normalizedUrl, "text/html,text/markdown;q=0.9,text/plain;q=0.8,*/*;q=0.1");
    if (!res.ok) throw new FetchError(`The page returned HTTP ${res.status}.`, res.status === 404 ? 404 : 502);
    const finalUrl = normalizeUrl(res.url || normalizedUrl);
    if (finalUrl !== normalizedUrl) assertPublicTarget(finalUrl);

    const contentType = res.headers.get("content-type") ?? "text/html";
    if (!TEXT_TYPES.test(contentType)) {
      throw new FetchError(`Only text pages are supported, this one is ${contentType.split(";")[0]}.`, 415);
    }
    // A filing consists of many sibling page containers. Readability scoring
    // can otherwise select just one table or page and silently lose the rest.
    const target = new URL(finalUrl);
    const filing = /(^|\.)sec\.gov$/i.test(target.hostname) && target.pathname.startsWith("/Archives/edgar/data/");
    if (filing && /html/i.test(contentType) && typeof HTMLRewriter !== "undefined") {
      let bytes = 0;
      const capped = res.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > MAX_PAGE_BYTES) throw new FetchError(`The response exceeds the ${MAX_PAGE_BYTES.toLocaleString("en-US")} byte download limit.`, 413);
          controller.enqueue(chunk);
        },
      }));
      const extracted = await streamFiling(new Response(capped, { headers: res.headers }));
      if (extracted.text.length < 80) throw new FetchError("The page had no readable text.", 422);
      return { ...extracted, url: finalUrl, contentType };
    }
    const body = await readCapped(res, MAX_PAGE_BYTES);
    const extracted = /html/i.test(contentType) ? extractText(body, { wholeDocument: filing }) : { title: "", text: body.trim() };
    if (/^(page not found|404\b|not found\b)/i.test(extracted.title)) {
      throw new FetchError("The source returned a Page Not Found page (even though its HTTP status was successful).", 404);
    }
    if (extracted.text.length < 80) {
      const scripted = /html/i.test(contentType) && (body.match(/<script\b/gi)?.length ?? 0) > 3;
      throw new FetchError(
        scripted
          ? "This page builds its text with JavaScript in the browser, and the swarm can only read pages that ship their text in the HTML."
          : "The page had no readable text.",
        422,
      );
    }
    return { ...extracted, url: finalUrl, contentType };
  }

  // Apple's docs pages are empty shells filled in from a JSON file; read that instead.
  // Returns null when there's no JSON for the page, so the caller falls back to the HTML.
  private async fetchDocc(normalizedUrl: string, dataUrl: string): Promise<FetchedPage | null> {
    const res = await this.get(dataUrl, "application/json");
    if (!res.ok) return null;
    let doc: unknown;
    try {
      doc = JSON.parse(await readCapped(res, MAX_PAGE_BYTES));
    } catch {
      return null;
    }
    const extracted = renderDocc(doc);
    if (extracted.text.length < 80) return null;
    return { ...extracted, url: normalizedUrl, contentType: "application/json" };
  }

  private async checkRobots(normalizedUrl: string): Promise<void> {
    const url = new URL(normalizedUrl);
    const cached = this.robots.get(url.origin);
    let rules = cached && Date.now() - cached.at < ROBOTS_TTL_MS ? cached.rules : null;
    if (!rules) {
      try {
        const res = await this.get(`${url.origin}/robots.txt`, "text/plain");
        // Some sites send real rules with an error status (Stack Overflow answers 418 with "Disallow: /"),
        // so any body that looks like robots.txt is obeyed. A site that refuses to show us its robots.txt
        // (401/403) is refusing us. Other failures (404, 5xx, network) mean there are no rules to follow.
        const body = await readCapped(res, 500_000).catch(() => "");
        if (res.ok || /^\s*user-agent\s*:/im.test(body)) rules = parseRobots(body);
        else if (res.status === 401 || res.status === 403) rules = parseRobots("User-agent: *\nDisallow: /");
        else rules = [];
      } catch {
        rules = [];
      }
      this.robots.set(url.origin, { at: Date.now(), rules });
    }
    if (!isAllowed(rules, url.pathname + url.search)) {
      throw new FetchError("This site's robots.txt asks crawlers not to read this page, so the swarm won't.", 403);
    }
  }

  private async get(url: string, accept: string): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, {
        headers: { "user-agent": USER_AGENT, accept },
        redirect: "follow",
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new FetchError(ctrl.signal.aborted ? "The page took too long to respond." : `Could not reach the page (${(err as Error).message}).`);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new FetchError(`The response exceeds the ${max.toLocaleString("en-US")} byte download limit.`, 413);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
