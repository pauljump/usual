// Finds pages an agent has already read and decides which are safe to give to
// the swarm. Used by scripts/contribute.ts; kept here so it is tested.
//
// Contributing only ever sends a URL. The swarm fetches the public page itself,
// without cookies, and obeys the site's robots.txt, so a page that needs a
// login or that asks crawlers to stay away never gets in. These checks are a
// second line: they keep URLs that look private or carry secrets from leaving
// the contributor's machine at all.

import { UrlError, assertPublicTarget, normalizeUrl } from "./url.js";

// Sites whose terms or robots.txt rule them out, and sites that only ever hold
// someone's private material.
const BLOCKED_HOSTS = [
  "stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com", "askubuntu.com",
  "reddit.com", "redd.it",
  "docs.google.com", "drive.google.com", "mail.google.com", "calendar.google.com", "sheets.google.com",
  "dropbox.com", "dropboxusercontent.com", "box.com", "onedrive.live.com", "sharepoint.com",
  "slack.com", "notion.so", "notion.site", "figma.com", "linear.app", "atlassian.net",
  "claude.ai", "chatgpt.com", "chat.openai.com", "console.anthropic.com", "platform.openai.com",
  "dash.cloudflare.com", "console.aws.amazon.com", "console.cloud.google.com", "portal.azure.com",
  "vercel.com", "app.netlify.com", "appstoreconnect.apple.com", "idmsa.apple.com",
  "ngrok.io", "ngrok-free.app", "ngrok.app", "trycloudflare.com", "ts.net",
];
const BLOCKED_PATHS: [string, RegExp][] = [["developer.apple.com", /^\/forums(\/|$)/]];
// Job boards: one posting is public, but the list of them is someone's job search.
const PERSONAL_HOSTS = ["greenhouse.io", "lever.co", "myworkdayjobs.com", "ashbyhq.com", "workable.com", "smartrecruiters.com"];
const SEARCH_PARAM = /^(q|query|term|search|s|keyword|keywords)$/i;
const ACCOUNT_PATH = /^(signup|sign-up|login|log-in|signin|sign-in|register|account|accounts|checkout|subscribe|subscriptions|cart)$/i;
const SECRET_PARAM = /(^|_|-)(token|key|apikey|secret|sig|signature|auth|password|passwd|pwd|session|sid|code|credential|jwt|otp)s?($|_|-)|^x-amz-|^x-goog-/i;

export type Verdict = { ok: true; url: string } | { ok: false; reason: string };

export function checkUrl(raw: string, extraBlockedHosts: string[] = []): Verdict {
  raw = raw.trim();
  // Reader proxies wrap the real page: https://r.jina.ai/https://example.com/x
  const wrapped = raw.match(/^https?:\/\/r\.jina\.ai\/(https?:\/\/.+)$/i);
  if (wrapped) raw = wrapped[1];
  if (!URL.canParse(raw)) return { ok: false, reason: "not a URL" };
  if (/redacted/i.test(raw)) return { ok: false, reason: "redacted in the transcript" };
  let url: string;
  try {
    url = normalizeUrl(raw);
    assertPublicTarget(url);
  } catch (err) {
    return { ok: false, reason: err instanceof UrlError ? "not a public page" : "not a URL" };
  }
  const u = new URL(url);
  const host = u.hostname;
  const onHost = (h: string) => host === h || host.endsWith("." + h);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || u.port) return { ok: false, reason: "IP address or custom port" };
  if (BLOCKED_HOSTS.some(onHost)) return { ok: false, reason: "excluded site" };
  if (extraBlockedHosts.map((h) => h.toLowerCase().replace(/^www\./, "")).some(onHost)) return { ok: false, reason: "your excluded site" };
  if (BLOCKED_PATHS.some(([h, p]) => onHost(h) && p.test(u.pathname))) return { ok: false, reason: "excluded site" };
  if ([...u.searchParams.keys()].some((k) => SECRET_PARAM.test(k))) return { ok: false, reason: "looks like it carries a secret" };
  if (PERSONAL_HOSTS.some(onHost) || /^\/jobs(\/|$)/.test(u.pathname) && onHost("linkedin.com")) return { ok: false, reason: "job posting" };
  if (host.startsWith("api.") || /\/(api|rest|webservices|graphql)(\/|$)|\/api\.php$/i.test(u.pathname)) return { ok: false, reason: "API call, not a document" };
  if ([...u.searchParams.keys()].some((k) => SEARCH_PARAM.test(k)) || /\/search(\/|$)/i.test(u.pathname)) return { ok: false, reason: "search, not a document" };
  if (u.pathname.split("/").some((seg) => ACCOUNT_PATH.test(seg))) return { ok: false, reason: "account or signup page" };
  if (u.pathname.split("/").some(looksLikeToken)) return { ok: false, reason: "looks like a private link" };
  return { ok: true, url };
}

// Long random-looking path segments are usually share, invite or reset links.
function looksLikeToken(segment: string): boolean {
  return segment.length >= 32 && /^[A-Za-z0-9_-]+$/.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment);
}

// Pulls the URLs an agent fetched out of one line of a Claude Code transcript
// (~/.claude/projects/**/*.jsonl). Only WebFetch calls count: those are pages
// the agent actually read. Search queries and pages it merely saw in results
// are left alone.
export function fetchedUrls(line: string): string[] {
  let entry: any;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((c: any) => c?.type === "tool_use" && c.name === "WebFetch" && typeof c.input?.url === "string")
    .map((c: any) => c.input.url as string);
}

// A plain URL list: one URL per line; blank lines and # comments are ignored.
// A contribute-plan.tsv works too: the first http(s) field on each line is used.
export function listedUrls(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .flatMap((l) => l.split(/\s+/).filter((f) => /^https?:\/\//i.test(f)).slice(0, 1));
}
