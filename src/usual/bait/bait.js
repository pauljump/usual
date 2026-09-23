// Usual Bait: answer secret scanners with a poisoned .env.
//
// Every fake credential is sealed with the scanner's IP, network, country, the
// file it asked for and the credential's slot. When one of them later comes back
// to your site, in a URL, header, basic-auth password or small body, Bait opens
// it and reports who scraped it, who used it, and how long that took.
//
// One file, no dependencies. Works as a Cloudflare Worker (default export), in
// any runtime with web Request/Response (Next.js middleware, Hono, Bun, Deno),
// and as Node/Express middleware (baitMiddleware).
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Usual contributors. https://github.com/pauljump/usual

export const VERSION = "0.1.0";

// 48 sealed bytes (12 IV + 28 payload + 8 tag) always encode to 65 base62 chars.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SEALED_BYTES = 48;
const TOKEN_LENGTH = 65;
const TOKEN_PATTERN = /(?<![A-Za-z0-9])[A-Za-z0-9]{65}(?![A-Za-z0-9])/g;
const MAX_CANDIDATES = 8;
const MAX_BODY_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Only paths no real site should ever serve publicly. Order matters: first match wins.
const FILES = [
  { kind: "aws", pattern: /\/\.aws\/(credentials|config)$/i },
  { kind: "git", pattern: /\/\.git\/config$/i },
  { kind: "npmrc", pattern: /\/\.npmrc$/i },
  { kind: "docker", pattern: /\/\.docker\/config\.json$/i },
  { kind: "wordpress", pattern: /\/wp-config\.php(\.bak|\.old|\.orig|\.save|\.swp|\.txt|~)$/i },
  { kind: "json", pattern: /\/(secrets|credentials|appsettings(\.production)?)\.json$/i },
  { kind: "env", pattern: /\/\.env([._-][\w.-]*)?(~)?$/i },
  { kind: "env", pattern: /\/[\w-]+\.env$/i },
];
const KINDS = ["env", "git", "aws", "npmrc", "docker", "wordpress", "json"];

// Slots name each credential. A trip tells you which one the scanner tried.
const SLOTS = [
  "database-password", "database-url", "redis-url", "stripe-secret", "openai-key",
  "aws-secret", "admin-url", "internal-api-token", "jwt-secret", "github-token",
  "sendgrid-key", "git-remote", "npm-token", "docker-auth", "mail-password",
  "aws-access-key", "anthropic-key",
];
// Append only: a credential's slot number is sealed into every token already handed out.
const slot = (name) => SLOTS.indexOf(name);

// A random high part fills the leading character, so tokens don't all start with 0-7.
const SPREAD = 62n ** BigInt(TOKEN_LENGTH) >> BigInt(SEALED_BYTES * 8);

function base62(bytes) {
  let value = BigInt(crypto.getRandomValues(new Uint32Array(1))[0]) % SPREAD;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = ALPHABET[Number(value % 62n)] + text;
    value /= 62n;
  }
  return text.padStart(TOKEN_LENGTH, "0");
}

function unbase62(text) {
  let value = 0n;
  for (const char of text) value = value * 62n + BigInt(ALPHABET.indexOf(char));
  const bytes = new Uint8Array(SEALED_BYTES);
  for (let i = SEALED_BYTES - 1; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

function ipBytes(ip) {
  const out = new Uint8Array(16);
  if (!ip) return out;
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i);
  if (v4) {
    out[10] = out[11] = 0xff;
    for (let i = 0; i < 4; i++) out[12 + i] = Number(v4[i + 1]) & 0xff;
    return out;
  }
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  groups.slice(0, 8).forEach((group, i) => {
    const n = parseInt(group, 16) || 0;
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 0xff;
  });
  return out;
}

function ipText(bytes) {
  if (bytes.every((b) => b === 0)) return null;
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return Array.from(bytes.slice(12)).join(".");
  }
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return groups.join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
}

// AWS access key ids are 20 characters, too short for a sealed token. They carry the
// minute and file they were served in, 12 random bits and a 32-bit HMAC tag instead.
// SigV4 sends the key id (never the secret) with every request, so it is the part
// that can come back when a tool honours AWS_ENDPOINT_URL.
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ACCESS_KEY_PATTERN = /(?<![A-Z0-9])AKIA[A-Z2-7]{16}(?![A-Z0-9])/g;

async function hmacFrom(secret) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode("usual-bait/aws-key/v1\0" + secret));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function accessKeyTag(hmac, payload) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmac, payload)).slice(0, 4);
}

// The minute's leading bits barely change, so the payload is masked with a keystream
// derived from the tag. Otherwise every key id would start with the same characters.
async function accessKeyMask(hmac, tag) {
  const input = new Uint8Array(5);
  input.set(tag, 0);
  input[4] = 0x6d;
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmac, input)).slice(0, 6);
}

async function sealAccessKey(hmac, visit, kind) {
  const bytes = new Uint8Array(10);
  const random = crypto.getRandomValues(new Uint8Array(2));
  new DataView(bytes.buffer).setUint32(0, Math.floor(visit.at / 60000));
  bytes[4] = (KINDS.indexOf(kind) << 4) | (random[0] & 15);
  bytes[5] = random[1];
  const tag = await accessKeyTag(hmac, bytes.slice(0, 6));
  const mask = await accessKeyMask(hmac, tag);
  for (let i = 0; i < 6; i++) bytes[i] ^= mask[i];
  bytes.set(tag, 6);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = "";
  for (let i = 0; i < 16; i++, value >>= 5n) text = BASE32[Number(value & 31n)] + text;
  return "AKIA" + text;
}

async function openAccessKey(hmac, keyId) {
  let value = 0n;
  for (const char of keyId.slice(4)) value = (value << 5n) | BigInt(BASE32.indexOf(char));
  const bytes = new Uint8Array(10);
  for (let i = 9; i >= 0; i--, value >>= 8n) bytes[i] = Number(value & 0xffn);
  const mask = await accessKeyMask(hmac, bytes.slice(6, 10));
  for (let i = 0; i < 6; i++) bytes[i] ^= mask[i];
  const tag = await accessKeyTag(hmac, bytes.slice(0, 6));
  if (tag.some((byte, i) => byte !== bytes[6 + i])) return null;
  const minute = new DataView(bytes.buffer).getUint32(0);
  return { servedAtMs: minute * 60000, servedAt: new Date(minute * 60000).toISOString(), ip: null, asn: null,
    country: null, file: KINDS[bytes[4] >> 4] || "unknown", slot: "aws-access-key" };
}

async function keyFrom(secret) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode("usual-bait/v1\0" + secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(key, visit, kind, slotIndex) {
  const payload = new Uint8Array(28);
  const view = new DataView(payload.buffer);
  view.setUint32(0, Math.floor(visit.at / 1000));
  payload.set(ipBytes(visit.ip), 4);
  view.setUint32(20, Number(visit.asn) >>> 0);
  payload.set(encoder.encode((visit.country || "--").slice(0, 2).padEnd(2, "-")), 24);
  payload[26] = KINDS.indexOf(kind);
  payload[27] = slotIndex;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 64 }, key, payload));
  const bytes = new Uint8Array(SEALED_BYTES);
  bytes.set(iv, 0);
  bytes.set(sealed, 12);
  return base62(bytes);
}

async function open(key, token) {
  const bytes = unbase62(token);
  if (!bytes) return null;
  try {
    const payload = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), tagLength: 64 }, key, bytes.slice(12)));
    const view = new DataView(payload.buffer);
    return {
      servedAt: new Date(view.getUint32(0) * 1000).toISOString(),
      servedAtMs: view.getUint32(0) * 1000,
      ip: ipText(payload.slice(4, 20)),
      asn: view.getUint32(20) || null,
      country: decoder.decode(payload.slice(24, 26)).replace(/-/g, "") || null,
      file: KINDS[payload[26]] || "unknown",
      slot: SLOTS[payload[27]] || "unknown",
    };
  } catch {
    return null;
  }
}

function randomText(length, alphabet = ALPHABET) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function base64(text) {
  return btoa(String.fromCharCode(...encoder.encode(text)));
}

// Credentials that point back at your own host are the ones you can watch get used.
// Third-party formats (Stripe, OpenAI, GitHub) are realistic decoration.
async function render(kind, visit, key, options, hmac) {
  const t = (name) => seal(key, visit, kind, slot(name));
  const host = visit.host;
  const app = (host.split(".").slice(-2, -1)[0] || "app").replace(/[^a-z0-9]/gi, "").toLowerCase() || "app";
  const aws = options.awsCanary || { accessKeyId: await sealAccessKey(hmac, visit, kind), secretAccessKey: randomText(40) };
  const wink = options.wink ? `# hello, reader. every value below is a tripwire (${randomText(6)}).\n` : "";
  if (kind === "git") {
    return `[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n` +
      `[remote "origin"]\n\turl = https://deploy:${await t("git-remote")}@${host}/_git/${app}.git\n` +
      `\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n`;
  }
  if (kind === "aws") {
    return `[default]\naws_access_key_id = ${aws.accessKeyId}\naws_secret_access_key = ${aws.secretAccessKey}\nregion = us-east-1\n` +
      (options.awsCanary ? "" : `endpoint_url = https://${host}/_s3\n`);
  }
  if (kind === "npmrc") {
    return `registry=https://${host}/_npm/\n//${host}/_npm/:_authToken=${await t("npm-token")}\nalways-auth=true\n`;
  }
  if (kind === "docker") {
    return JSON.stringify({ auths: { [host]: { auth: base64(`deploy:${await t("docker-auth")}`) } } }, null, 2) + "\n";
  }
  if (kind === "wordpress") {
    return `<?php\ndefine( 'DB_NAME', '${app}_prod' );\ndefine( 'DB_USER', '${app}' );\n` +
      `define( 'DB_PASSWORD', '${await t("database-password")}' );\ndefine( 'DB_HOST', 'db.${host}' );\n` +
      `define( 'AUTH_KEY', '${await t("jwt-secret")}' );\n$table_prefix = 'wp_';\n` +
      `define( 'WP_DEBUG', false );\nif ( ! defined( 'ABSPATH' ) ) {\n\tdefine( 'ABSPATH', __DIR__ . '/' );\n}\n`;
  }
  if (kind === "json") {
    return JSON.stringify({
      ConnectionStrings: { Default: `Server=db.${host};Database=${app};User Id=${app};Password=${await t("database-password")};` },
      Api: { BaseUrl: `https://${host}/api/internal`, Token: await t("internal-api-token") },
      Admin: { Url: `https://${host}/_internal/${await t("admin-url")}/login` },
      Stripe: { SecretKey: `sk_live_${await t("stripe-secret")}` },
    }, null, 2) + "\n";
  }
  return wink +
    `APP_NAME=${app}\nAPP_ENV=production\nAPP_DEBUG=false\nAPP_URL=https://${host}\n` +
    `APP_KEY=base64:${base64(randomText(32))}\n\n` +
    `DB_CONNECTION=pgsql\nDB_HOST=db.${host}\nDB_PORT=5432\nDB_DATABASE=${app}_prod\nDB_USERNAME=${app}\n` +
    `DB_PASSWORD=${await t("database-password")}\n` +
    `DATABASE_URL=postgres://${app}:${await t("database-url")}@db.${host}:5432/${app}_prod\n` +
    `REDIS_URL=redis://default:${await t("redis-url")}@cache.${host}:6379\n\n` +
    `ADMIN_URL=https://${host}/_internal/${await t("admin-url")}/login\n` +
    `INTERNAL_API_URL=https://${host}/api/internal\nINTERNAL_API_TOKEN=${await t("internal-api-token")}\n` +
    `JWT_SECRET=${await t("jwt-secret")}\n\n` +
    `MAIL_HOST=smtp.${host}\nMAIL_PORT=587\nMAIL_USERNAME=noreply@${host}\nMAIL_PASSWORD=${await t("mail-password")}\n\n` +
    `STRIPE_SECRET_KEY=sk_live_${await t("stripe-secret")}\n` +
    `OPENAI_API_KEY=sk-proj-${await t("openai-key")}\n` +
    `OPENAI_BASE_URL=https://${host}/_internal/openai/v1\n` +
    `ANTHROPIC_API_KEY=sk-ant-api03-${await t("anthropic-key")}\n` +
    `ANTHROPIC_BASE_URL=https://${host}/_internal/anthropic\n` +
    `SENDGRID_API_KEY=SG.${await t("sendgrid-key")}\n` +
    `GITHUB_TOKEN=ghp_${await t("github-token")}\n\n` +
    `AWS_ACCESS_KEY_ID=${aws.accessKeyId}\nAWS_SECRET_ACCESS_KEY=${options.awsCanary ? aws.secretAccessKey : await t("aws-secret")}\n` +
    `AWS_DEFAULT_REGION=us-east-1\nAWS_BUCKET=${app}-prod-uploads\n` +
    (options.awsCanary ? "" : `AWS_ENDPOINT_URL=https://${host}/_s3\n`);
}

function slowly(text, seconds) {
  const bytes = encoder.encode(text);
  const chunks = Math.min(bytes.length, Math.max(1, Math.round(seconds * 2)));
  const size = Math.ceil(bytes.length / chunks);
  let offset = 0;
  return new ReadableStream({
    async pull(controller) {
      if (offset > 0) await new Promise((resolve) => setTimeout(resolve, (seconds * 1000) / Math.max(1, chunks - 1)));
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
      if (offset >= bytes.length) controller.close();
    },
  });
}

function headerText(headers) {
  const parts = [];
  for (const [name, value] of headers) {
    if (name === "cookie" || name === "authorization" || name.startsWith("x-") || name === "proxy-authorization") {
      parts.push(value);
      const basic = value.match(/^Basic\s+([A-Za-z0-9+/=]+)/i);
      if (basic) {
        try { parts.push(atob(basic[1])); } catch { /* not base64 */ }
      }
    }
  }
  return parts.join("\n");
}

function redact(text, tokens) {
  return tokens.reduce((out, token) => out.split(token).join("[bait]"), text);
}

// A public, stable name for one poisoned credential that does not reveal it.
async function credentialId(token) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return Array.from(digest.slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
}

function dashboardMatch(dashboard, host, path) {
  if (!dashboard) return null;
  const slash = dashboard.indexOf("/");
  const wantHost = slash > 0 ? dashboard.slice(0, slash).toLowerCase() : null;
  const base = (slash > 0 ? dashboard.slice(slash) : dashboard).replace(/\/+$/, "");
  if (wantHost && wantHost !== host.toLowerCase()) return null;
  if (path === base || path === base + "/") return "page";
  if (path === base + "/stats.json") return "stats";
  return null;
}

/**
 * createBait({ secret, report, shareIps, drip, wink, awsCanary, onEvent, respond })
 *
 * secret     Required for tokens that survive restarts. Any long random string.
 * report     Optional URL. Each event is POSTed there (opt-in network). Off by default.
 * shareIps   Include raw scanner IPs in reports. Off by default.
 * drip       Seconds to spread each bait response over (a gentle tarpit). 0 = instant.
 * wink       Add a comment line telling human readers the file is a tripwire.
 * awsCanary  { accessKeyId, secretAccessKey } from canarytokens.org, to catch AWS use.
 * onEvent    Called with every event. Defaults to one JSON log line.
 * store      Where events are counted for the leaderboard, e.g. d1Store(env.BAIT_DB).
 * owner      Public ID the leaderboard credits instead of your hostnames (e.g. a GitHub handle).
 * dashboard  Path ("/_bait") or host+path ("example.com/bait/live") for the public
 *            leaderboard. Needs a store. Off when unset.
 */
export function createBait(options = {}) {
  let secret = options.secret;
  if (!secret) {
    secret = randomText(32);
    console.warn("[usual-bait] No secret set: tokens are only recognised until this process restarts.");
  }
  const keyPromise = keyFrom(secret);
  const hmacPromise = hmacFrom(secret);
  const drip = Math.max(0, Math.min(Number(options.drip) || 0, 60));
  const emit = options.onEvent || ((event) => console.log(JSON.stringify({ usual_bait: event })));

  function publish(event, waitUntil) {
    try { emit(event); } catch { /* a logging failure never breaks the site */ }
    if (options.store) {
      const saving = Promise.resolve().then(() => options.store.record(event))
        .catch((error) => console.error("[usual-bait] store", error));
      if (waitUntil) waitUntil(saving);
    }
    if (!options.report) return;
    const shared = { ...event, version: VERSION };
    if (!options.shareIps) {
      delete shared.ip;
      if (shared.served) delete shared.served.ip;
    }
    const sending = fetch(options.report, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(shared) }).catch(() => {});
    if (waitUntil) waitUntil(sending);
  }

  /** Inspect a plain visit. Returns a Response for bait or a tripped token, else null. */
  async function inspect(visit, waitUntil) {
    const key = await keyPromise;
    const hmac = await hmacPromise;
    visit = { at: Date.now(), ...visit };
    const file = FILES.find((f) => f.pattern.test(visit.path));
    if (file) {
      const body = await render(file.kind, visit, key, options, hmac);
      const accessKeys = options.awsCanary ? [] : [...new Set(body.match(ACCESS_KEY_PATTERN) || [])];
      publish({ type: "served", at: new Date(visit.at).toISOString(), site: visit.host, owner: options.owner || null,
        file: file.kind, path: visit.path,
        credentials: (body.match(TOKEN_PATTERN) || []).length + accessKeys.length + (file.kind === "docker" ? 1 : 0),
        accessKeys, ip: visit.ip, asn: visit.asn || null, asOrg: visit.asOrg || null, country: visit.country || null,
        userAgent: visit.userAgent || null, fingerprint: visit.fingerprint || null }, waitUntil);
      const headers = { "content-type": file.kind === "docker" || file.kind === "json" ? "application/json" : "text/plain; charset=utf-8",
        "cache-control": "no-store", "x-robots-tag": "noindex" };
      return new Response(drip ? slowly(body, drip) : body, { status: 200, headers });
    }
    const haystack = [visit.url, safeDecode(visit.url), visit.headerText, visit.bodyText].filter(Boolean).join("\n");
    const candidates = [...new Set(haystack.match(TOKEN_PATTERN) || [])].slice(0, MAX_CANDIDATES)
      .map((token) => ({ token, opener: () => open(key, token) }))
      .concat([...new Set(haystack.match(ACCESS_KEY_PATTERN) || [])].slice(0, 2).map((token) => ({ token,
        opener: async () => {
          const served = await openAccessKey(hmac, token);
          const known = served && options.store?.lookupAccessKey ? await options.store.lookupAccessKey(token).catch(() => null) : null;
          return served && known ? { ...served, ...known } : served;
        } })));
    for (const { token, opener } of candidates) {
      const served = await opener();
      if (!served) continue;
      const where = visit.bodyText?.includes(token) ? "body" : visit.headerText?.includes(token) ? "header" : "url";
      const { servedAtMs, ...scraped } = served;
      publish({ type: "tripped", at: new Date(visit.at).toISOString(), site: visit.host, owner: options.owner || null,
        credentialId: await credentialId(token), credential: scraped.slot, file: scraped.file,
        secondsSinceServed: Math.max(0, Math.round((visit.at - servedAtMs) / 1000)),
        sameIp: Boolean(visit.ip && visit.ip === scraped.ip), where, method: visit.method, path: redact(visit.path, [token]),
        ip: visit.ip, asn: visit.asn || null, asOrg: visit.asOrg || null, country: visit.country || null,
        userAgent: visit.userAgent || null, fingerprint: visit.fingerprint || null, served: scraped }, waitUntil);
      return typeof options.respond === "function" ? options.respond(scraped)
        : new Response(JSON.stringify({ error: "invalid_token" }), { status: 401,
          headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    return null;
  }

  /** Web-standard entry point. Pass { ip, asn, country, waitUntil } when you know them. */
  /** The leaderboard page and its JSON, when a store and dashboard path are set. */
  async function dashboard(host, path, method) {
    const view = options.store && (method === "GET" || method === "HEAD") ? dashboardMatch(options.dashboard, host, path) : null;
    if (view === "page") {
      return new Response(dashboardPage(), { headers: { "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300", "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:" } });
    }
    if (view === "stats") {
      return new Response(JSON.stringify(await options.store.stats({ awsCanary: Boolean(options.awsCanary), owner: options.owner })), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=30",
          "access-control-allow-origin": "*" } });
    }
    return null;
  }

  async function handle(request, context = {}) {
    const url = new URL(request.url);
    const page = await dashboard(url.host, url.pathname, request.method);
    if (page) return page;
    let bodyText = null;
    const length = Number(request.headers.get("content-length") || 0);
    if (request.body && length > 0 && length <= MAX_BODY_BYTES) {
      try { bodyText = await request.clone().text(); } catch { bodyText = null; }
    }
    const cf = request.cf || {};
    return inspect({
      host: url.host, path: url.pathname, url: url.pathname + url.search, method: request.method,
      headerText: headerText(request.headers), bodyText,
      ip: context.ip ?? request.headers.get("cf-connecting-ip") ?? null,
      asn: context.asn ?? cf.asn ?? null, asOrg: context.asOrg ?? cf.asOrganization ?? null,
      country: context.country ?? cf.country ?? null, userAgent: request.headers.get("user-agent"),
      fingerprint: fingerprintOf(request.headers, cf),
    }, context.waitUntil);
  }

  return { handle, inspect, dashboard, version: VERSION };
}

// Connection details that survive a scanner rotating its IPs and clouds. Grouping by
// them (with the wordlist it tries) is how networks become operators.
function fingerprintOf(headers, cf = {}) {
  const names = [...headers.keys()].filter((n) => !n.startsWith("cf-") && !["x-forwarded-for", "x-forwarded-proto", "x-real-ip", "cdn-loop"].includes(n));
  return JSON.stringify({ tls: cf.tlsVersion || null, cipher: cf.tlsCipher || null, http: cf.httpProtocol || null,
    headers: names.sort().join(","), accept: headers.get("accept") || null, lang: headers.get("accept-language") || null,
    encoding: headers.get("accept-encoding") || null });
}

function safeDecode(text) {
  try { return decodeURIComponent(text || ""); } catch { return text || ""; }
}

/**
 * Node/Express/Connect middleware. Reads the body only if a parser already did
 * (req.body); it never consumes the request stream your app needs.
 */
export function baitMiddleware(bait, { trustProxy = false } = {}) {
  return async function usualBait(req, res, next) {
    try {
      const forwarded = trustProxy ? String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
      }
      const url = req.originalUrl || req.url || "/";
      const body = req.body === undefined || req.body === null ? null
        : typeof req.body === "string" ? req.body : Buffer.isBuffer?.(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
      const host = String(req.headers.host || "localhost");
      const response = await bait.dashboard(host, url.split("?")[0], req.method) || await bait.inspect({
        host, path: url.split("?")[0], url, method: req.method,
        headerText: headerText(headers), bodyText: body && body.length <= MAX_BODY_BYTES ? body : null,
        ip: forwarded || req.socket?.remoteAddress || null, asn: null,
        country: trustProxy ? req.headers["cf-ipcountry"] || null : null, userAgent: req.headers["user-agent"] || null,
        fingerprint: fingerprintOf(headers, { httpProtocol: "HTTP/" + req.httpVersion }),
      });
      if (!response) return next();
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch (error) {
      next(error);
    }
  };
}

// ---------------------------------------------------------------------------
// Leaderboard store (Cloudflare D1, or anything with the same prepare/batch API)
//
// Every event updates small counter tables, so the public stats never scan the
// raw logs. A stats read touches a few hundred rows and is cached for a minute.

const FILE_SLOTS = {
  env: ["database-password", "database-url", "redis-url", "admin-url", "internal-api-token", "jwt-secret",
    "mail-password", "stripe-secret", "openai-key", "anthropic-key", "sendgrid-key", "github-token", "aws-secret",
    "aws-access-key"],
  git: ["git-remote"], aws: ["aws-access-key"], npmrc: ["npm-token"], docker: ["docker-auth"],
  wordpress: ["database-password", "jwt-secret"],
  json: ["database-password", "internal-api-token", "admin-url", "stripe-secret"],
};
// Credentials that point at the site itself. Only these can be seen when used;
// the rest get tested against Stripe, OpenAI, GitHub or SendGrid, out of sight.
const WATCHABLE = new Set(["openai-key", "anthropic-key", "aws-access-key",
  "database-password", "database-url", "redis-url", "admin-url", "internal-api-token",
  "jwt-secret", "mail-password", "git-remote", "npm-token", "docker-auth"]);
const LABELS = {
  "database-password": "DB_PASSWORD", "database-url": "DATABASE_URL", "redis-url": "REDIS_URL",
  "stripe-secret": "STRIPE_SECRET_KEY", "openai-key": "OPENAI_API_KEY", "aws-secret": "AWS_SECRET_ACCESS_KEY",
  "admin-url": "ADMIN_URL", "internal-api-token": "INTERNAL_API_TOKEN", "jwt-secret": "JWT_SECRET",
  "github-token": "GITHUB_TOKEN", "sendgrid-key": "SENDGRID_API_KEY", "git-remote": ".git/config remote",
  "npm-token": ".npmrc auth token", "docker-auth": ".docker registry auth", "mail-password": "MAIL_PASSWORD",
  "aws-access-key": "AWS_ACCESS_KEY_ID", "anthropic-key": "ANTHROPIC_API_KEY",
};
// Hosting networks read as the product people know. These are where scanners rent
// servers, not who runs them.
const CLOUDS = { 396982: "Google Cloud", 15169: "Google", 19527: "Google Cloud", 16509: "Amazon AWS", 14618: "Amazon AWS",
  8075: "Microsoft Azure", 14061: "DigitalOcean", 24940: "Hetzner", 213230: "Hetzner Cloud", 16276: "OVHcloud",
  63949: "Akamai Linode", 20473: "Vultr", 45102: "Alibaba Cloud", 132203: "Tencent Cloud", 31898: "Oracle Cloud",
  13335: "Cloudflare", 51167: "Contabo" };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bait_totals (id INTEGER PRIMARY KEY CHECK (id = 1), since INTEGER,
    served INTEGER NOT NULL DEFAULT 0, minted INTEGER NOT NULL DEFAULT 0,
    trips INTEGER NOT NULL DEFAULT 0, came_back INTEGER NOT NULL DEFAULT 0, backfilled INTEGER NOT NULL DEFAULT 0)`,
  `INSERT OR IGNORE INTO bait_totals (id, since) VALUES (1, CAST(strftime('%s','now') AS INTEGER))`,
  `CREATE TABLE IF NOT EXISTS bait_serve (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, site TEXT, path TEXT,
    file TEXT, credentials INTEGER, ip TEXT, asn INTEGER, org TEXT, country TEXT, user_agent TEXT)`,
  `CREATE TABLE IF NOT EXISTS bait_trip (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, site TEXT, token_id TEXT,
    slot TEXT, file TEXT, where_found TEXT, method TEXT, path TEXT, ip TEXT, asn INTEGER, org TEXT, country TEXT,
    user_agent TEXT, seconds INTEGER, served_at INTEGER, served_ip TEXT, served_asn INTEGER, served_country TEXT)`,
  `CREATE TABLE IF NOT EXISTS bait_token (id TEXT PRIMARY KEY, slot TEXT, file TEXT, site TEXT, served_at INTEGER,
    served_asn INTEGER, served_country TEXT, first_used_at INTEGER, first_asn INTEGER, first_org TEXT,
    first_country TEXT, last_used_at INTEGER, uses INTEGER NOT NULL DEFAULT 0, networks TEXT, countries TEXT)`,
  `CREATE TABLE IF NOT EXISTS bait_network (asn INTEGER PRIMARY KEY, org TEXT, country TEXT,
    scrapes INTEGER NOT NULL DEFAULT 0, leaked INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0,
    credentials_used INTEGER NOT NULL DEFAULT 0, fastest INTEGER, last_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS bait_slot (slot TEXT PRIMARY KEY, uses INTEGER NOT NULL DEFAULT 0,
    came_back INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS bait_file (file TEXT PRIMARY KEY, served INTEGER NOT NULL DEFAULT 0,
    minted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS bait_path (path TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS bait_site (site TEXT PRIMARY KEY, served INTEGER NOT NULL DEFAULT 0,
    trips INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS bait_day (day TEXT PRIMARY KEY, served INTEGER NOT NULL DEFAULT 0,
    trips INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS bait_cache (key TEXT PRIMARY KEY, at INTEGER, body TEXT)`,
  `CREATE TABLE IF NOT EXISTS bait_meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS bait_access_key (id TEXT PRIMARY KEY, at INTEGER, site TEXT, file TEXT, ip TEXT,
    asn INTEGER, country TEXT)`,
];
// Columns added after first release. Each may already exist; failures are expected.
const MIGRATIONS = [
  `ALTER TABLE bait_serve ADD COLUMN fingerprint TEXT`,
  `ALTER TABLE bait_trip ADD COLUMN fingerprint TEXT`,
  `ALTER TABLE bait_site ADD COLUMN owner TEXT`,
];

const clip = (text, length) => (text == null ? null : String(text).slice(0, length));
const day = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

const BUCKETS = [["<1m", 60], ["1-10m", 600], ["10-60m", 3600], ["1-6h", 21600],
  ["6-24h", 86400], ["1-7d", 604800], [">7d", Infinity]];

export function d1Store(db, { cacheSeconds = 60 } = {}) {
  let ready = null;
  const ensure = () => (ready ||= db.batch(SCHEMA.map((sql) => db.prepare(sql)))
    .then(() => Promise.all(MIGRATIONS.map((sql) => db.prepare(sql).run().catch(() => null))))
    .catch((error) => {
      ready = null;
      throw error;
    }));
  const run = (sql, ...args) => db.prepare(sql).bind(...args);

  async function record(event) {
    await ensure();
    const at = Math.floor(Date.parse(event.at) / 1000);
    const asn = Number(event.asn) || 0;
    if (event.type === "served") {
      await db.batch([
        run(`INSERT INTO bait_serve (at, site, path, file, credentials, ip, asn, org, country, user_agent, fingerprint)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, at, clip(event.site, 120), clip(event.path, 200), event.file,
          event.credentials || 0, event.ip || null, asn, clip(event.asOrg, 80), event.country || null, clip(event.userAgent, 300),
          clip(event.fingerprint, 1000)),
        ...(event.accessKeys || []).map((id) => run(`INSERT OR IGNORE INTO bait_access_key (id, at, site, file, ip, asn, country)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, id, at, clip(event.site, 120), event.file, event.ip || null, asn, event.country || null)),
        run(`UPDATE bait_totals SET served = served + 1, minted = minted + ?, backfilled = backfilled + ?,
          since = min(coalesce(since, ?), ?) WHERE id = 1`, event.credentials || 0, event.backfilled ? 1 : 0, at, at),
        run(`INSERT INTO bait_network (asn, org, country, scrapes, last_at) VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(asn) DO UPDATE SET scrapes = scrapes + 1, org = coalesce(excluded.org, org),
          country = coalesce(excluded.country, country), last_at = excluded.last_at`,
          asn, clip(event.asOrg, 80), event.country || null, at),
        run(`INSERT INTO bait_file (file, served, minted) VALUES (?, 1, ?)
          ON CONFLICT(file) DO UPDATE SET served = served + 1, minted = minted + excluded.minted`,
          event.file, event.credentials > 0 ? 1 : 0),
        run(`INSERT INTO bait_path (path, hits) VALUES (?, 1) ON CONFLICT(path) DO UPDATE SET hits = hits + 1`,
          clip(String(event.path).toLowerCase(), 80)),
        run(`INSERT INTO bait_site (site, owner, served) VALUES (?, ?, 1)
          ON CONFLICT(site) DO UPDATE SET served = served + 1, owner = coalesce(excluded.owner, owner)`,
          clip(event.site, 120), clip(event.owner, 40)),
        run(`INSERT INTO bait_day (day, served) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET served = served + 1`, day(at)),
      ]);
      return;
    }
    if (event.type !== "tripped") return;
    const served = event.served || {};
    const servedAt = Math.floor(Date.parse(served.servedAt) / 1000);
    const servedAsn = Number(served.asn) || 0;
    const token = await run(`SELECT uses, networks, countries FROM bait_token WHERE id = ?`, event.credentialId).first();
    const first = !token;
    const networks = token?.networks ? token.networks.split(",") : [];
    const countries = token?.countries ? token.countries.split(",") : [];
    const newNetwork = !networks.includes(String(asn));
    if (newNetwork && networks.length < 50) networks.push(String(asn));
    if (event.country && !countries.includes(event.country) && countries.length < 50) countries.push(event.country);
    await db.batch([
      run(`INSERT INTO bait_trip (at, site, token_id, slot, file, where_found, method, path, ip, asn, org, country,
          user_agent, seconds, served_at, served_ip, served_asn, served_country, fingerprint)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        at, clip(event.site, 120), event.credentialId, event.credential, event.file, event.where, clip(event.method, 10),
        clip(event.path, 200), event.ip || null, asn, clip(event.asOrg, 80), event.country || null,
        clip(event.userAgent, 300), event.secondsSinceServed, servedAt, served.ip || null, servedAsn, served.country || null,
        clip(event.fingerprint, 1000)),
      run(`UPDATE bait_totals SET trips = trips + 1, came_back = came_back + ? WHERE id = 1`, first ? 1 : 0),
      first
        ? run(`INSERT INTO bait_token (id, slot, file, site, served_at, served_asn, served_country, first_used_at,
            first_asn, first_org, first_country, last_used_at, uses, networks, countries)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          event.credentialId, event.credential, event.file, clip(event.site, 120), servedAt, servedAsn,
          served.country || null, at, asn, clip(event.asOrg, 80), event.country || null, at, networks.join(","), countries.join(","))
        : run(`UPDATE bait_token SET uses = uses + 1, last_used_at = ?, networks = ?, countries = ? WHERE id = ?`,
          at, networks.join(","), countries.join(","), event.credentialId),
      run(`INSERT INTO bait_network (asn, org, country, uses, credentials_used, fastest, last_at) VALUES (?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(asn) DO UPDATE SET uses = uses + 1, credentials_used = credentials_used + excluded.credentials_used,
          fastest = min(coalesce(fastest, excluded.fastest), excluded.fastest), org = coalesce(excluded.org, org),
          country = coalesce(excluded.country, country), last_at = excluded.last_at`,
        asn, clip(event.asOrg, 80), event.country || null, newNetwork ? 1 : 0, event.secondsSinceServed, at),
      ...(first ? [run(`INSERT INTO bait_network (asn, country, leaked) VALUES (?, ?, 1)
          ON CONFLICT(asn) DO UPDATE SET leaked = leaked + 1, country = coalesce(country, excluded.country)`,
        servedAsn, served.country || null)] : []),
      run(`INSERT INTO bait_slot (slot, uses, came_back) VALUES (?, 1, ?)
          ON CONFLICT(slot) DO UPDATE SET uses = uses + 1, came_back = came_back + excluded.came_back`,
        event.credential, first ? 1 : 0),
      run(`INSERT INTO bait_site (site, owner, trips) VALUES (?, ?, 1)
          ON CONFLICT(site) DO UPDATE SET trips = trips + 1, owner = coalesce(excluded.owner, owner)`,
        clip(event.site, 120), clip(event.owner, 40)),
      run(`INSERT INTO bait_day (day, trips) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET trips = trips + 1`, day(at)),
    ]);
  }

  // Hostnames stay private. Public stats credit each site's owner ID instead.
  async function compute({ awsCanary = false, owner: defaultOwner = "anonymous" } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const [totals, files, slots, tokens, scrapers, users, networkCount, paths, sites, days, recent, notice] = await Promise.all([
      run(`SELECT * FROM bait_totals WHERE id = 1`).first(),
      run(`SELECT file, minted FROM bait_file`).all(),
      run(`SELECT slot, uses, came_back FROM bait_slot`).all(),
      run(`SELECT t.*, n.org AS served_org FROM bait_token t LEFT JOIN bait_network n ON n.asn = t.served_asn`).all(),
      run(`SELECT asn, org, country, scrapes, leaked FROM bait_network WHERE scrapes > 0
        ORDER BY scrapes DESC, leaked DESC LIMIT 12`).all(),
      run(`SELECT asn, org, country, uses, credentials_used, fastest FROM bait_network WHERE uses > 0
        ORDER BY uses DESC, credentials_used DESC LIMIT 12`).all(),
      run(`SELECT count(*) AS n FROM bait_network WHERE scrapes > 0 OR uses > 0`).first(),
      run(`SELECT path, hits, (SELECT count(*) FROM bait_path) AS distinct_paths FROM bait_path ORDER BY hits DESC LIMIT 12`).all(),
      run(`SELECT site, owner, served, trips FROM bait_site`).all(),
      run(`SELECT day, served, trips FROM bait_day WHERE day >= ? ORDER BY day`, day(now - 29 * 86400)).all(),
      run(`SELECT r.at, r.slot, r.site, r.where_found, r.method, r.path, r.asn, r.org, r.country, r.user_agent, r.seconds,
        r.served_asn, r.served_country, r.token_id, n.org AS served_org FROM bait_trip r
        LEFT JOIN bait_network n ON n.asn = r.served_asn ORDER BY r.at DESC, r.id DESC LIMIT 20`).all(),
      run(`SELECT value FROM bait_meta WHERE key = 'notice'`).first(),
    ]);
    const ownerOf = Object.fromEntries(sites.results.map((row) => [row.site, row.owner || defaultOwner]));
    const members = {};
    for (const row of sites.results) {
      const member = (members[ownerOf[row.site]] ||= { owner: ownerOf[row.site], sites: 0, scans: 0, uses: 0 });
      member.sites += 1;
      member.scans += row.served;
      member.uses += row.trips;
    }
    const network = (asn, org, country) => ({ asn: asn || null, org: CLOUDS[asn] || org || (asn ? `AS${asn}` : "Unknown network"),
      country: country || null });
    const minted = {};
    for (const { file, minted: serves } of files.results) {
      for (const name of FILE_SLOTS[file] || []) {
        if ((name === "aws-secret" || name === "aws-access-key") && awsCanary) continue;
        minted[name] = (minted[name] || 0) + serves;
      }
    }
    const used = Object.fromEntries(slots.results.map((row) => [row.slot, row]));
    const firstUse = tokens.results.map((t) => ({ ...t, seconds: Math.max(0, t.first_used_at - t.served_at),
      networkCount: t.networks ? t.networks.split(",").length : 0 }));
    const fastest = firstUse.reduce((best, t) => (!best || t.seconds < best.seconds ? t : best), null);
    const seconds = firstUse.map((t) => t.seconds);
    const card = (t) => ({
      id: t.id, credential: t.slot, label: LABELS[t.slot] || t.slot, file: t.file, owner: ownerOf[t.site] || defaultOwner,
      scrapedAt: new Date(t.served_at * 1000).toISOString(), scrapedBy: network(t.served_asn, t.served_org, t.served_country),
      firstUsedBy: network(t.first_asn, t.first_org, t.first_country), secondsToFirstUse: t.seconds, uses: t.uses,
      networks: t.networkCount, countries: t.countries ? t.countries.split(",").filter(Boolean) : [],
      lastUsedAt: new Date(t.last_used_at * 1000).toISOString(),
    });
    const dayRows = Object.fromEntries(days.results.map((row) => [row.day, row]));
    return {
      version: VERSION,
      generatedAt: new Date(now * 1000).toISOString(),
      since: totals?.since ? new Date(totals.since * 1000).toISOString() : null,
      notice: notice?.value || null,
      totals: {
        scrapes: totals?.served || 0, backfilledScrapes: totals?.backfilled || 0, credentialsHandedOut: totals?.minted || 0,
        credentialsCameBack: totals?.came_back || 0, timesUsed: totals?.trips || 0,
        networks: networkCount?.n || 0, sites: sites.results.length, members: Object.keys(members).length, distinctPaths: paths.results[0]?.distinct_paths || 0,
      },
      speed: {
        medianSecondsToFirstUse: median(seconds),
        handoffShare: firstUse.length ? firstUse.filter((t) => t.first_asn !== t.served_asn).length / firstUse.length : null,
        fastest: fastest ? card(fastest) : null,
        histogram: BUCKETS.map(([label, limit], i) => ({ label,
          count: seconds.filter((s) => s < limit && (i === 0 || s >= BUCKETS[i - 1][1])).length })),
      },
      mostWanted: [...firstUse].sort((a, b) => b.uses - a.uses || b.networkCount - a.networkCount || a.seconds - b.seconds)
        .slice(0, 15).map(card),
      scrapers: scrapers.results.map((row) => ({ ...network(row.asn, row.org, row.country), scrapes: row.scrapes,
        credentialsLeaked: row.leaked })),
      users: users.results.map((row) => ({ ...network(row.asn, row.org, row.country), uses: row.uses,
        credentials: row.credentials_used, fastestSeconds: row.fastest })),
      credentials: Object.keys(LABELS).map((name) => ({ credential: name, label: LABELS[name], watchable: WATCHABLE.has(name),
        handedOut: minted[name] || 0, cameBack: used[name]?.came_back || 0, timesUsed: used[name]?.uses || 0 }))
        .filter((row) => row.handedOut || row.timesUsed)
        .sort((a, b) => b.timesUsed - a.timesUsed || b.handedOut - a.handedOut),
      paths: paths.results.map(({ path, hits }) => ({ path, hits })),
      members: Object.values(members).sort((a, b) => b.scans - a.scans),
      daily: Array.from({ length: 30 }, (_, i) => {
        const date = day(now - (29 - i) * 86400);
        return { day: date, scrapes: dayRows[date]?.served || 0, uses: dayRows[date]?.trips || 0 };
      }),
      recent: recent.results.map((row) => ({ at: new Date(row.at * 1000).toISOString(), credential: row.slot,
        label: LABELS[row.slot] || row.slot, id: row.token_id, owner: ownerOf[row.site] || defaultOwner, where: row.where_found, method: row.method,
        path: row.path, usedBy: network(row.asn, row.org, row.country), scrapedBy: network(row.served_asn, row.served_org, row.served_country),
        secondsSinceScrape: row.seconds, userAgent: clip(row.user_agent, 80) })),
    };
  }

  async function stats(options = {}) {
    await ensure();
    const now = Math.floor(Date.now() / 1000);
    const cached = await run(`SELECT at, body FROM bait_cache WHERE key = 'stats'`).first();
    if (cached && now - cached.at < cacheSeconds) return JSON.parse(cached.body);
    const fresh = await compute(options);
    await run(`INSERT INTO bait_cache (key, at, body) VALUES ('stats', ?, ?)
      ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body`, now, JSON.stringify(fresh)).run();
    return fresh;
  }

  async function lookupAccessKey(id) {
    await ensure();
    const row = await run(`SELECT ip, asn, country, site FROM bait_access_key WHERE id = ?`, id).first();
    return row ? { ip: row.ip, asn: row.asn || null, country: row.country } : null;
  }

  return { record, stats, compute, lookupAccessKey };
}

// ---------------------------------------------------------------------------
// The public leaderboard. Everything scanner-controlled (paths, user agents,
// network names) is inserted with textContent, never as markup.

export function dashboardPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bait · live leaderboard of poisoned credentials</title>
<meta name="description" content="Bots ask our sites for their secrets all day. Each gets a fake .env where every credential is unique. This is who scraped them, who used them, and how fast.">
<meta property="og:title" content="We poison the .env scanners. Here is who took the bait.">
<meta property="og:description" content="Every fake credential is unique. When one comes back, we know who scraped it, who used it, and how fast.">
<meta name="twitter:card" content="summary">
<style>
:root{--paper:#faf9f6;--card:#fff;--ink:#1e2c3d;--muted:#65717c;--line:#dcdfe0;--soft:#f0f2f3;--scrape:#7d8790;--use:#294c73;--accent:#294c73;--good:#2f7a55;--serif:Georgia,"Times New Roman",serif;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:"Helvetica Neue",Helvetica,Arial,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#121821;--card:#18202b;--ink:#eef1f4;--muted:#a3adb7;--line:#2b3542;--soft:#1f2934;--scrape:#8a949e;--use:#7fa6d6;--accent:#7fa6d6;--good:#7cc4a0;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-underline-offset:3px}.wrap{width:min(1180px,calc(100% - 40px));margin:auto}
header.top{display:flex;justify-content:space-between;align-items:center;padding:22px 0;border-bottom:1px solid var(--line);font:11px var(--mono);letter-spacing:.07em;text-transform:uppercase}
.brand{font:400 28px var(--serif);letter-spacing:-.05em;text-transform:none;text-decoration:none}.brand b{font-weight:400}.brand small{font:11px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-left:12px}
.live{display:flex;align-items:center;gap:8px;color:var(--muted)}.live i{width:8px;height:8px;border-radius:50%;background:var(--good);display:inline-block;animation:pulse 2s infinite}
@keyframes pulse{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.live i{animation:none}}
.eyebrow{font:11px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:0 0 14px}
.intro{display:grid;grid-template-columns:1.25fr 1fr;gap:60px;align-items:end;padding:56px 0 44px;border-bottom:1px solid var(--line)}
h1{font:400 clamp(46px,6.6vw,88px)/.98 var(--serif);letter-spacing:-.055em;margin:0 0 24px}
h1 em{font-style:italic;color:var(--accent)}.lede{font-size:18px;line-height:1.5;margin:0;max-width:560px}
.hero{text-align:right}.hero .n{font-size:clamp(56px,8vw,112px);font-weight:600;letter-spacing:-.05em;line-height:1}.hero p{margin:10px 0 0;color:var(--muted)}
.notice{margin:22px 0 0;padding:14px 18px;border:1px solid var(--accent);border-left-width:4px;background:var(--card);font-size:13px}
.notice b{font-family:var(--mono);font-size:11px;letter-spacing:.07em;margin-right:8px;color:var(--accent)}
.tiles{display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid var(--line)}
.tile{padding:24px 18px 26px 0}.tile+.tile{padding-left:18px;border-left:1px solid var(--line)}
.tile .l{font-size:12px;color:var(--muted);min-height:36px}.tile .v{font-size:32px;font-weight:600;letter-spacing:-.04em;margin-top:6px;line-height:1.1}
section{padding:52px 0 8px}h2{font:400 clamp(30px,3.6vw,46px)/1.05 var(--serif);letter-spacing:-.045em;margin:0 0 8px}
.sub{color:var(--muted);margin:0 0 22px;max-width:720px}
.thief{display:grid;grid-template-columns:1fr auto 1fr;gap:26px;align-items:center;background:var(--card);border:1px solid var(--line);border-top:4px solid var(--accent);padding:26px 30px;border-radius:3px}
.thief .who{font-size:22px;font-weight:600;letter-spacing:-.03em}.thief .when{color:var(--muted);font-size:13px}
.thief .arrow{text-align:center;font:600 34px var(--sans);letter-spacing:-.04em;color:var(--accent)}.thief .arrow small{display:block;font:11px var(--mono);color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.thief .what{grid-column:1/-1;border-top:1px dashed var(--line);padding-top:14px;font-size:13px;color:var(--muted)}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:3px}
table{width:100%;border-collapse:collapse;font-size:13px}th{font:10px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--muted);text-align:left;font-weight:500;padding:12px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.rank{font:11px var(--mono);color:var(--muted);width:34px}code,.mono{font-family:var(--mono);font-size:12px}td .dim{display:block;color:var(--muted);font-size:12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:28px}.pair h3{font:400 26px var(--serif);letter-spacing:-.035em;margin:0 0 6px}.pair .sub{font-size:13px;margin-bottom:14px}
.meter{display:flex;align-items:center;gap:10px;min-width:150px}.meter span{flex:1;height:8px;background:var(--soft);border-radius:4px;overflow:hidden}.meter span i{display:block;height:100%;background:var(--use);border-radius:0 4px 4px 0}
.tag{font:10px var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);padding:2px 6px;border-radius:2px;white-space:nowrap}
.charts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px}.chart{background:var(--card);border:1px solid var(--line);border-radius:3px;padding:18px 18px 12px;position:relative}
.chart h3{font-size:16px;letter-spacing:-.02em;margin:0}.chart p{font-size:12px;color:var(--muted);margin:2px 0 10px}.chart svg{display:block;width:100%;height:auto;overflow:visible}
.chart svg text{font:10px var(--mono);fill:var(--muted)}.chart svg .grid{stroke:var(--line);stroke-width:1}.chart svg .hit{fill:transparent;cursor:crosshair}
.chart details{font-size:12px;margin-top:8px;color:var(--muted)}.chart details table{font-size:12px;margin-top:6px}
.tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--paper);font-size:12px;padding:8px 10px;border-radius:3px;opacity:0;transition:opacity .1s;z-index:9;white-space:nowrap}
.feed li{list-style:none;display:grid;grid-template-columns:110px 1fr auto;gap:18px;padding:14px 0;border-bottom:1px solid var(--line);font-size:13px}.feed{padding:0;margin:0}
.feed time{font:11px var(--mono);color:var(--muted)}.feed .fast{font-weight:600;white-space:nowrap}
.empty{padding:28px;text-align:center;color:var(--muted);background:var(--card);border:1px dashed var(--line);border-radius:3px}
footer{margin-top:64px;padding:40px 0 60px;border-top:1px solid var(--line);display:grid;grid-template-columns:1.2fr 1fr;gap:50px;font-size:13px;color:var(--muted)}
footer h3{color:var(--ink);font:400 28px var(--serif);letter-spacing:-.035em;margin:0 0 10px}.button{display:inline-block;margin-top:14px;background:var(--ink);color:var(--paper);text-decoration:none;padding:13px 18px;border-radius:3px;font-weight:600;font-size:13px}
@media (max-width:980px){.intro,.pair,footer{grid-template-columns:1fr}.hero{text-align:left}.tiles{grid-template-columns:repeat(3,1fr)}.tile:nth-child(4){border-left:0;padding-left:0}.charts{grid-template-columns:1fr}.thief{grid-template-columns:1fr}.feed li{grid-template-columns:1fr}}
</style></head><body>
<div class="wrap">
<header class="top"><a class="brand" href="https://tryusual.com/bait/">usual<b>.</b><small>Bait</small></a><span class="live" id="live"><i></i><span>Loading</span></span></header>
<div class="intro"><div><p class="eyebrow">Live leaderboard · poisoned credentials</p>
<h1>We poison the <em>.env</em> scanners.</h1>
<p class="lede">Bots ask our sites for their secrets all day. Each one gets a fake <code>.env</code> in which every credential is unique, like a 409A with a different number for every reader. When a credential comes back, we know who scraped it, who used it, and how fast.</p></div>
<div class="hero"><div class="n" id="hero">–</div><p id="hero-sub">requests for our secrets</p></div></div>
<div id="notice"></div>
<div class="tiles" id="tiles"></div>
<section id="thief-section"><p class="eyebrow">The fastest thief</p><div id="thief"></div></section>
<section><h2>Most wanted credentials</h2><p class="sub">Each row is one unique fake credential, followed from the scan that took it to every attempt to use it.</p><div id="wanted"></div></section>
<section class="pair"><div><h3>Who scrapes</h3><p class="sub">Where the scanners' servers are rented, not who runs them. And how much of their haul came back.</p><div id="scrapers"></div></div>
<div><h3>Who comes back</h3><p class="sub">Networks that tried a poisoned credential. Often not the one that scraped it.</p><div id="users"></div></div></section>
<section><h2>What they try</h2><p class="sub">We see a credential used when it points back at our own sites. The OpenAI, Anthropic and AWS keys come with a base URL that sends SDKs to us. Stripe, GitHub and SendGrid keys get tested at those companies, out of our sight.</p><div id="credentials"></div></section>
<section><h2>Over time</h2><p class="sub">The last 30 days. Hover a column for its value.</p><div class="charts" id="charts"></div></section>
<section><h2>Latest uses</h2><p class="sub">The most recent times a poisoned credential came back.</p><div id="feed"></div></section>
<section class="pair"><div><h3>Members</h3><p class="sub">Everyone running Bait into this leaderboard. Sites stay private.</p><div id="members"></div></div><div><h3>Most requested files</h3><p class="sub" id="paths-sub">What the scanners asked for.</p><div id="paths"></div></div></section>
<footer><div><h3>Put Bait on your site.</h3>One file, no dependencies. Runs as a Cloudflare Worker or Node middleware, and gives you a leaderboard like this one.<br><a class="button" href="https://tryusual.com/bait/">Install Bait →</a></div>
<div><b>How to read this.</b> Every credential is fake and points back at one of our sites. We publish networks and countries, never IP addresses. A credential "came back" when it showed up in a later request to one of our sites. Open source under MIT at <a href="https://github.com/pauljump/usual">pauljump/usual</a>. <a href="stats.json" id="json">Raw stats JSON</a>.</div></footer>
</div><div class="tip" id="tip" role="tooltip"></div>
<script>
(function(){
var base=location.pathname.replace(/\\/?$/,"/"),tip=document.getElementById("tip");
function h(tag,attrs,kids){var e=document.createElement(tag);for(var k in attrs||{}){if(k==="text")e.textContent=attrs[k];else if(k==="cls")e.className=attrs[k];else e.setAttribute(k,attrs[k])}
(kids||[]).forEach(function(c){if(c!=null)e.appendChild(typeof c==="string"?document.createTextNode(c):c)});return e}
function fill(id,node){var el=document.getElementById(id);el.textContent="";if(node)el.appendChild(node)}
var nf=new Intl.NumberFormat("en-US");function n(v){return v==null?"–":nf.format(v)}
function compact(v){return v>=1e6?(v/1e6).toFixed(1).replace(/\\.0$/,"")+"M":v>=1e4?(v/1e3).toFixed(1).replace(/\\.0$/,"")+"K":nf.format(v)}
function dur(s){if(s==null)return"–";if(s<60)return s+"s";if(s<3600)return Math.round(s/60)+" min";if(s<86400){var hh=Math.floor(s/3600),m=Math.round(s%3600/60);return hh+"h"+(m?" "+m+"m":"")}
var d=Math.floor(s/86400),r=Math.round(s%86400/3600);return d+"d"+(r?" "+r+"h":"")}
function ago(iso){return dur(Math.max(0,Math.round((Date.now()-Date.parse(iso))/1000)))+" ago"}
function flag(cc){return cc&&/^[A-Z]{2}$/.test(cc)?String.fromCodePoint.apply(null,cc.split("").map(function(c){return 127397+c.charCodeAt(0)})):""}
function net(x){return x?(x.org||"Unknown network")+(x.country?" "+flag(x.country):""):"Unknown network"}
function pct(v){return v==null?"–":Math.round(v*100)+"%"}
function table(cols,rows,empty){if(!rows.length)return h("div",{cls:"empty",text:empty});
var head=h("tr",{},cols.map(function(c){return h("th",{cls:c.num?"num":"",text:c.t})}));
var body=rows.map(function(r,i){return h("tr",{},cols.map(function(c){var v=c.f(r,i);return h("td",{cls:c.num?"num":c.rank?"rank":""},[v])}))});
return h("div",{cls:"scroll"},[h("table",{},[h("thead",{},[head]),h("tbody",{},body)])])}
function two(a,b){return h("span",{},[a,h("span",{cls:"dim",text:b})])}
function showTip(ev,text){tip.textContent=text;tip.style.opacity=1;var x=Math.min(ev.clientX+14,innerWidth-tip.offsetWidth-8);tip.style.left=x+"px";tip.style.top=(ev.clientY-38)+"px"}
function hideTip(){tip.style.opacity=0}
function columns(title,note,rows,label,value,color,fmt){
var W=360,H=150,L=34,B=22,T=16,max=Math.max.apply(null,rows.map(value).concat([1])),step=Math.pow(10,Math.floor(Math.log10(max))),top=Math.max(2,Math.ceil(max/step)*step);
if(top%2)top+=1;var total=rows.reduce(function(a,r){return a+value(r)},0);
var ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.setAttribute("role","img");svg.setAttribute("aria-label",title);
function el(t,a){var e=document.createElementNS(ns,t);for(var k in a)e.setAttribute(k,a[k]);svg.appendChild(e);return e}
[0,top/2,top].forEach(function(v){var y=H-B-(H-B-T)*v/top;el("line",{x1:L,x2:W,y1:y,y2:y,"class":"grid"});var t=el("text",{x:L-6,y:y+3,"text-anchor":"end"});t.textContent=compact(v)});
var slot=(W-L)/rows.length,bw=Math.min(24,slot-2),peak=-1,pv=-1;rows.forEach(function(r,i){if(value(r)>pv){pv=value(r);peak=i}});
rows.forEach(function(r,i){var v=value(r),x=L+i*slot+(slot-bw)/2,hgt=(H-B-T)*v/top,y=H-B-hgt,rad=Math.min(4,hgt,bw/2);
if(v>0)el("path",{d:"M"+x+","+(H-B)+"V"+(y+rad)+"Q"+x+","+y+" "+(x+rad)+","+y+"H"+(x+bw-rad)+"Q"+(x+bw)+","+y+" "+(x+bw)+","+(y+rad)+"V"+(H-B)+"Z",fill:color});
var hit=el("rect",{x:L+i*slot,y:T,width:slot,height:H-B-T,"class":"hit"});var text=label(r)+": "+fmt(v);
hit.addEventListener("mousemove",function(ev){showTip(ev,text)});hit.addEventListener("mouseleave",hideTip);
if(i===peak&&v>0){var t=el("text",{x:x+bw/2,y:y-5,"text-anchor":"middle"});t.textContent=compact(v)}});
if(rows.length<=8)rows.forEach(function(r,i){var t=el("text",{x:L+i*slot+slot/2,y:H-6,"text-anchor":"middle"});t.textContent=label(r)});
else{var first=el("text",{x:L,y:H-6});first.textContent=label(rows[0]);var last=el("text",{x:W,y:H-6,"text-anchor":"end"});last.textContent=label(rows[rows.length-1])}
if(!total){var none=el("text",{x:L+(W-L)/2,y:T+(H-B-T)/2,"text-anchor":"middle"});none.textContent="Nothing yet"}
var details=h("details",{},[h("summary",{text:"Show as table"}),h("table",{},rows.map(function(r){return h("tr",{},[h("td",{text:label(r)}),h("td",{cls:"num",text:fmt(value(r))})])}))]);
return h("div",{cls:"chart"},[h("h3",{text:title}),h("p",{text:note}),svg,details])}
function render(s){
var t=s.totals,since=s.since?new Date(s.since).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";
fill("hero",document.createTextNode(n(t.scrapes)));
fill("hero-sub",document.createTextNode("requests for secrets across "+n(t.sites)+" sites"+(since?" since "+since:"")));
fill("notice",s.notice?h("div",{cls:"notice"},[h("b",{text:s.notice.indexOf("SIMULATED")===0?"SIMULATED":"NOTE"}),s.notice.replace(/^SIMULATED[:.]?\\s*/,"")]):null);
var tiles=[["Poisoned credentials handed out",n(t.credentialsHandedOut)],["Credentials that came back",n(t.credentialsCameBack)],["Times they were used",n(t.timesUsed)],
["Median time from scrape to first use",dur(s.speed.medianSecondsToFirstUse)],["First used by a different network",pct(s.speed.handoffShare)],["Scanner networks seen",n(t.networks)]];
fill("tiles",h("div",{style:"display:contents"},tiles.map(function(x){return h("div",{cls:"tile"},[h("div",{cls:"l",text:x[0]}),h("div",{cls:"v",text:x[1]})])})));
var f=s.speed.fastest;document.getElementById("thief-section").hidden=!f;
if(f)fill("thief",h("div",{cls:"thief"},[h("div",{},[h("p",{cls:"eyebrow",text:"Scraped by"}),h("div",{cls:"who",text:net(f.scrapedBy)}),h("div",{cls:"when",text:new Date(f.scrapedAt).toUTCString().replace(" GMT"," UTC")})]),
h("div",{cls:"arrow"},[document.createTextNode(dur(f.secondsToFirstUse)),h("small",{text:"then used"})]),
h("div",{},[h("p",{cls:"eyebrow",text:"Used by"}),h("div",{cls:"who",text:net(f.firstUsedBy)}),h("div",{cls:"when",text:"tried "+n(f.uses)+(f.uses===1?" time":" times")})]),
h("div",{cls:"what"},[document.createTextNode("Credential "),h("code",{text:"#"+f.id}),document.createTextNode(" · "+f.label+" from "),h("code",{text:f.file}),document.createTextNode(" on a site run by "+f.owner)])]));
fill("wanted",table([{t:"#",rank:1,f:function(r,i){return String(i+1)}},{t:"Credential",f:function(r){return two(h("code",{text:"#"+r.id}),r.label)}},
{t:"Scraped from",f:function(r){return two(r.owner,"asked for "+r.file+", "+ago(r.scrapedAt))}},{t:"Scraped by",f:function(r){return net(r.scrapedBy)}},
{t:"First used by",f:function(r){return net(r.firstUsedBy)}},{t:"Scrape → use",num:1,f:function(r){return dur(r.secondsToFirstUse)}},
{t:"Uses",num:1,f:function(r){return n(r.uses)}},{t:"Networks",num:1,f:function(r){return n(r.networks)}},{t:"Countries",f:function(r){return r.countries.map(flag).join(" ")||"–"}}],
s.mostWanted,"No poisoned credential has come back yet."+(t.credentialsHandedOut?" "+n(t.credentialsHandedOut)+" are out there.":"")+" The first one to return will lead this table."));
fill("scrapers",table([{t:"#",rank:1,f:function(r,i){return String(i+1)}},{t:"Network",f:function(r){return net(r)}},{t:"Scans",num:1,f:function(r){return n(r.scrapes)}},
{t:"Share",f:function(r){var v=t.scrapes?r.scrapes/t.scrapes:0;return h("span",{cls:"meter"},[h("span",{},[h("i",{style:"width:"+(v*100).toFixed(1)+"%;background:var(--scrape)"})]),document.createTextNode(v<.01?"<1%":pct(v))])}},
{t:"Came back",num:1,f:function(r){return n(r.credentialsLeaked)}}],s.scrapers,"No scans yet."));
fill("users",table([{t:"#",rank:1,f:function(r,i){return String(i+1)}},{t:"Network",f:function(r){return net(r)}},{t:"Uses",num:1,f:function(r){return n(r.uses)}},
{t:"Credentials",num:1,f:function(r){return n(r.credentials)}},{t:"Fastest",num:1,f:function(r){return dur(r.fastestSeconds)}}],s.users,"Nobody has used a poisoned credential yet."));
fill("credentials",table([{t:"Credential",f:function(r){return h("code",{text:r.label})}},{t:"Visible when used?",f:function(r){return h("span",{cls:"tag",text:r.watchable?"points at our site":"third-party key"})}},
{t:"Handed out",num:1,f:function(r){return n(r.handedOut)}},{t:"Came back",num:1,f:function(r){return n(r.cameBack)}},{t:"Uses",num:1,f:function(r){return n(r.timesUsed)}},
{t:"Came-back rate",f:function(r){var v=r.handedOut?r.cameBack/r.handedOut:0;return h("span",{cls:"meter"},[h("span",{},[h("i",{style:"width:"+Math.min(100,v*100).toFixed(1)+"%"})]),document.createTextNode(r.watchable?pct(v):"n/a")])}}],
s.credentials,"No credentials handed out yet."));
var css=getComputedStyle(document.documentElement),day=function(r){return new Date(r.day+"T00:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})};
fill("charts",h("div",{style:"display:contents"},[columns("Scans per day","Requests for secret files",s.daily,day,function(r){return r.scrapes},css.getPropertyValue("--scrape").trim(),n),
columns("Uses per day","Poisoned credentials coming back",s.daily,day,function(r){return r.uses},css.getPropertyValue("--use").trim(),n),
columns("Scrape to first use","How long a credential sat before its first use",s.speed.histogram,function(r){return r.label},function(r){return r.count},css.getPropertyValue("--use").trim(),function(v){return n(v)+" credentials"})]));
fill("feed",s.recent.length?h("ul",{cls:"feed"},s.recent.map(function(r){return h("li",{},[h("time",{datetime:r.at,text:ago(r.at)}),
h("span",{},[h("code",{text:"#"+r.id}),document.createTextNode(" "+r.label+" · scraped by "+net(r.scrapedBy)+", used by "+net(r.usedBy)+" via "+r.where+" on "+r.owner+"'s site "),h("code",{text:r.method+" "+r.path})]),
h("span",{cls:"fast",text:dur(r.secondsSinceScrape)+" later"})])})):h("div",{cls:"empty",text:"Waiting for the first poisoned credential to come back."}));
fill("members",table([{t:"Member",f:function(r){return r.owner}},{t:"Sites",num:1,f:function(r){return n(r.sites)}},{t:"Scans",num:1,f:function(r){return n(r.scans)}},{t:"Uses",num:1,f:function(r){return n(r.uses)}}],s.members,"No members yet."));
fill("paths-sub",document.createTextNode(t.distinctPaths>12?n(t.distinctPaths)+" different paths so far. The most requested:":"What the scanners asked for."));
fill("paths",table([{t:"Path",f:function(r){return h("code",{text:r.path})}},{t:"Requests",num:1,f:function(r){return n(r.hits)}}],s.paths,"No requests yet."));
var live=document.getElementById("live").lastChild;live.textContent="Live · updated "+new Date(s.generatedAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});}
function load(){fetch(base+"stats.json",{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()}).then(render).catch(function(){document.getElementById("live").lastChild.textContent="Stats unavailable. Retrying."})}
document.getElementById("json").href=base+"stats.json";load();setInterval(load,60000);
})();
</script></body></html>`;
}

let workerBait = null;

// Cloudflare Worker: route it at example.com/* and everything else passes to your origin.
export default {
  async fetch(request, env, ctx) {
    workerBait ||= createBait({
      secret: env.BAIT_SECRET, store: env.BAIT_DB ? d1Store(env.BAIT_DB) : undefined, owner: env.BAIT_OWNER || undefined,
      dashboard: env.BAIT_DASHBOARD || undefined, report: env.BAIT_REPORT || undefined, shareIps: env.BAIT_SHARE_IPS === "true",
      drip: Number(env.BAIT_DRIP || 0), wink: env.BAIT_WINK === "true",
      awsCanary: env.BAIT_AWS_KEY_ID && env.BAIT_AWS_SECRET
        ? { accessKeyId: env.BAIT_AWS_KEY_ID, secretAccessKey: env.BAIT_AWS_SECRET } : undefined,
    });
    try {
      const response = await workerBait.handle(request, { waitUntil: (p) => ctx.waitUntil(p) });
      if (response) return response;
    } catch (error) {
      console.error("[usual-bait]", error);
    }
    return fetch(request);
  },
};

export const _internal = { TOKEN_LENGTH, FILES, FILE_SLOTS, WATCHABLE, SLOTS, seal, open, keyFrom, base62, unbase62, ipBytes, ipText };
