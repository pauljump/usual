// URL normalization and target checks. Two agents asking for the same page
// with cosmetic differences (fragment, tracking params, trailing slash, host
// case) must land on the same cache key.

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "ref_src",
]);

export class UrlError extends Error {}

export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UrlError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlError("Only http and https pages can be read.");
  }
  if (url.username || url.password) {
    throw new UrlError("URLs with credentials are never read or cached.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

export function domainOf(normalizedUrl: string): string {
  return new URL(normalizedUrl).hostname.replace(/^www\./, "");
}

// Blocks obvious private targets. Cloudflare Workers cannot reach private
// networks anyway; this matters when the Node server runs on a real host.
// It does not resolve DNS, so a public name pointing at a private IP is not
// caught here.
export function assertPublicTarget(normalizedUrl: string): void {
  const host = new URL(normalizedUrl).hostname;
  const bare = host.replace(/^\[|\]$/g, "");
  if (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare.endsWith(".internal") ||
    !bare.includes(".") && !bare.includes(":")
  ) {
    throw new UrlError("Only public pages can be read.");
  }
  if (isPrivateIp(bare)) throw new UrlError("Only public pages can be read.");
}

function isPrivateIp(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (host.includes(":")) {
    const h = host.toLowerCase();
    return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  }
  return false;
}

export function firstUrlIn(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"'`)\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}
