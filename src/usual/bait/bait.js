// Usual Bait: answer secret scanners with a poisoned .env.
//
// Every fake credential is sealed with the scanner's IP, network, country, the
// file it asked for and the credential's slot. When one of them later comes back
// to your site, in a URL, header, basic-auth password or small body, Bait opens
// it and reports who scraped it, who used it, and how long that took.
// Tarpit mode instead keeps path-stable loot in an endless fake filesystem,
// remembers its first scrape in the store, and counts streamed time and bytes.
//
// One file, no dependencies. Works as a Cloudflare Worker (default export), in
// any runtime with web Request/Response (Next.js middleware, Hono, Bun, Deno),
// and as Node/Express middleware (baitMiddleware).
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Usual contributors. https://github.com/pauljump/usual

export const VERSION = "0.4.0";

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
async function render(kind, visit, key, options, hmac, stable = null) {
  const t = stable ? stable.token : (name) => seal(key, visit, kind, slot(name));
  const random = stable ? stable.random : randomText;
  const host = visit.host;
  const app = (host.split(".").slice(-2, -1)[0] || "app").replace(/[^a-z0-9]/gi, "").toLowerCase() || "app";
  const aws = stable ? stable.aws : options.awsCanary || { accessKeyId: await sealAccessKey(hmac, visit, kind), secretAccessKey: random(40) };
  const wink = options.wink ? `# hello, reader. every value below is a tripwire (${random(6)}).\n` : "";
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
    `APP_KEY=base64:${base64(random(32))}\n\n` +
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

// A fixed-length address keeps descending past browser/proxy URL length limits.
// Every room has several children and another directory listing. No stored tree.
const MAZE = /^\/_archive\/(\d{1,30})\/([a-f0-9]{32})\/(?:\.env|secrets\.json|\.git\/config|\.aws\/credentials|\.npmrc|\.docker\/config\.json|wp-config\.php\.bak)?$/;
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const tokenHash = async (token) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));

// The learner selects from code-reviewed recipes, never instructions from traffic.
// New probe paths are eligible only after this request gets a 404 from the origin.
const RECIPES = ["archive", "api", "git"];
const FAMILIES = ["secrets", "git", "debug", "wordpress", "php", "backup", "ai", "storage", "registry", "api"];
const LESSON = /^\/_archive\/h\/([a-f0-9]{32})\/(\d{1,24})\/([a-f0-9]{16})\/(.*)$/;
const COMPANY = /^\/_archive\/company\/([a-f0-9]{32})\/(.*)$/;
const COMPANY_MESSAGE = "If you think this is clever, get me some followers on X: @paulljump.";
const HOSTING_SESSION = /^\/(cpsess\d{10})\/(.*)$/;
const LOGIN_EXPERIMENT = "hosting-login-v1";
function hostingLogin(visit) {
  return visit.method === "POST" && (/:2083\/login\/?$/.test(visit.path)
    || (/^\/login\/?$/.test(visit.path) && new URLSearchParams((visit.url || "").split("?")[1]).get("login_only") === "1"));
}

// A small allowlist of inert hosting API operations. Never store arbitrary API
// names, arguments, filenames, mail recipients, commands, or submitted content.
function hostingOperation(visit, suffix) {
  const url = new URL(visit.url, "https://example.invalid");
  const params = new URLSearchParams(url.search);
  if (visit.contentType?.startsWith("application/x-www-form-urlencoded") && visit.bodyText) {
    for (const [k, v] of new URLSearchParams(visit.bodyText)) if (!params.has(k)) params.set(k, v);
  }
  const match = suffix.match(/^execute\/([A-Za-z]+)\/([a-z_0-9]+)$/);
  const legacy = suffix === "json-api/cpanel";
  const module = match?.[1] || (legacy ? params.get("cpanel_jsonapi_module") : "");
  const fn = match?.[2] || (legacy ? params.get("cpanel_jsonapi_func") : "");
  const operations = {
    "Fileman/list_files": "hosting-file-list", "Fileman/upload_files": "hosting-upload-attempt",
    "Fileman/save_file_content": "hosting-write-attempt", "Fileman/get_file_content": "hosting-file-read",
    "Fileman/uploadfiles": "hosting-upload-attempt", "Fileman/savefile": "hosting-write-attempt",
    "Email/list_pops": "hosting-mail-list", "Email/listpops": "hosting-mail-list",
    "Email/add_pop": "hosting-mail-account-attempt", "Email/addpop": "hosting-mail-account-attempt",
    "Mysql/list_databases": "hosting-database-list", "Backup/fullbackup_to_homedir": "hosting-backup-attempt",
    "Cron/add_line": "hosting-schedule-attempt", "Cron/add_line_v2": "hosting-schedule-attempt",
  };
  const operation = module + "/" + fn;
  if (operations[operation]) return { step: operations[operation], operation, legacy };
  if (/^frontend\/(jupiter|paper_lantern)\/index\.html$/.test(suffix)) return { step: "hosting-home", operation: "home", legacy: false };
  return { step: "hosting-unknown", operation: "unknown", legacy };
}
const REPLAY_STEPS = {
  "company-login": "Used an issued credential to log in", "company-home": "Opened the company dashboard",
  "company-employees": "Requested the employee directory", "company-projects": "Opened internal projects",
  "company-notes": "Requested migration notes", "company-message": "Opened the note from Paul",
  "company-exports": "Opened the exports page",
  "export-start": "Requested a production export", "export-poll": "Checked export progress",
  "export-chunk": "Requested an export batch",
  "hosting-login": "Used an issued credential at a hosting login",
  "hosting-home": "Opened the fake hosting account", "hosting-file-list": "Listed fake files",
  "hosting-file-read": "Requested a fake file", "hosting-mail-list": "Listed fake mail accounts",
  "hosting-database-list": "Listed fake databases", "hosting-upload-attempt": "Attempted a file upload",
  "hosting-write-attempt": "Attempted a file change", "hosting-mail-account-attempt": "Attempted to create a mail account",
  "hosting-backup-attempt": "Requested a fake backup", "hosting-schedule-attempt": "Attempted to schedule a job",
  "hosting-unknown": "Requested another hosting operation",
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const GIT_PART = /^(?:HEAD|info\/refs|refs\/heads\/main|objects\/[a-f0-9]{2}\/[a-f0-9]{38}|objects\/info\/packs)$/;
const GIT_PATH = /^(.*(?:\/\.git|\/_git\/[a-zA-Z0-9_-]+\.git))\/(.+)$/;
const LEARNING_LIMITS = { plans: 10000, hooks: 1000, clientsPerHook: 32, traceRows: 20000, bodyBytes: 65536 };

function probeFamily(path) {
  if (path.length > 180 || !/^\/[a-zA-Z0-9_./-]+$/.test(path)) return null;
  const git = path.match(GIT_PATH);
  if (git && GIT_PART.test(git[2])) return "git";
  if (/\/(?:\.gitconfig|\.git-credentials|\.gitlab-ci\.yml|\.dockerenv|env\.(?:bak|old))$/.test(path)) return "secrets";
  if (/^\/(?:actuator\/(?:env|configprops|mappings)|debug\/(?:vars|pprof\/cmdline)|(?:phpinfo|info)\.php)$/.test(path)) return "debug";
  if (/^\/(?:wp-login\.php|xmlrpc\.php|wp-content\/[a-zA-Z0-9_./-]+\.php)$/.test(path)) return "wordpress";
  if (/^\/[a-zA-Z0-9_-]{1,48}\.php$/.test(path)) return "php";
  if (/^\/(?:backup|database|dump|config|configuration)(?:\.[a-z0-9_-]{1,20})?\.(?:bak|old|sql|zip|tar|gz)$/.test(path)) return "backup";
  return null;
}

// Interesting 404s outside the supported recipes remain review candidates. They
// never become responses or links just because a caller supplied a new string.
function reviewCandidate(path) {
  return path.length <= 180 && /^\/[a-zA-Z0-9_./-]+$/.test(path)
    && /^\/(?:admin(?:\/|$)|graphql$|api\/v[0-9]+(?:\/|$)|v2\/_catalog$|\.well-known\/|cgi-bin\/|vendor\/|owa\/|autodiscover\/)/i.test(path);
}

function credentialFamily(visit, credential) {
  if (/openai|anthropic/.test(credential)) return "ai";
  if (/^aws-/.test(credential)) return "storage";
  if (/git-remote/.test(credential)) return "git";
  if (/npm-token|docker-auth/.test(credential)) return "registry";
  return "api";
}

function chooseRecipe(rows, seed) {
  const explore = RECIPES[seed % RECIPES.length];
  // A fifth of fresh paths explore. Require five observations per recipe before
  // exploiting; a single long request cannot become a claimed winner.
  if (seed % 5 === 0 || RECIPES.some((v) => (rows.find((r) => r.recipe === v)?.requests || 0) < 5)) return explore;
  const score = (r) => r.held_ms / Math.max(1, r.requests) / 1000 + 30 * r.followups / Math.max(1, r.requests);
  return [...rows].filter((r) => RECIPES.includes(r.recipe)).sort((a, b) => score(b) - score(a) || a.recipe.localeCompare(b.recipe))[0]?.recipe || explore;
}

const asBytes = (body) => body instanceof Uint8Array ? body : encoder.encode(body);
function joinBytes(...parts) {
  const arrays = parts.map(asBytes), out = new Uint8Array(arrays.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of arrays) { out.set(part, offset); offset += part.length; }
  return out;
}

// A valid three-commit dumb-HTTP repository. The removed configuration remains
// in history; its old deployment URL leads back into our own maze.
async function gitRepository(envBody, next) {
  const objects = new Map();
  async function object(kind, body) {
    const data = asBytes(body), raw = joinBytes(`${kind} ${data.length}\0`, data);
    const sha = hex(new Uint8Array(await crypto.subtle.digest("SHA-1", raw)));
    objects.set(sha, raw);
    return sha;
  }
  const env = await object("blob", envBody);
  const readme = await object("blob", `# Deployment archive\n\nConfiguration index: ${next}\n`);
  const hashBytes = (sha) => Uint8Array.from(sha.match(/../g), (b) => parseInt(b, 16));
  const tree = await object("tree", joinBytes("100644 .env\0", hashBytes(env), "100644 README.md\0", hashBytes(readme)));
  const makeCommit = (root, parent, time, message) => object("commit", `tree ${root}\n${parent ? `parent ${parent}\n` : ""}author deploy <deploy@example.invalid> ${time} +0000\ncommitter deploy <deploy@example.invalid> ${time} +0000\n\n${message}\n`);
  const first = await makeCommit(tree, null, 1704067200, "Production configuration");
  const cleanTree = await object("tree", joinBytes("100644 README.md\0", hashBytes(readme)));
  const removed = await makeCommit(cleanTree, first, 1704153600, "remove production credentials");
  const currentEnv = await object("blob", `APP_ENV=production\nNEXT_CONFIG_URL=${next}\n# Legacy deployment configuration lives in Git history.\n`);
  const notes = await object("blob", `# Migration notes\n\nPrevious deployment: ${next}\nThe original configuration was removed in commit ${removed}.\nInspect its parent before decommissioning the old deployment.\n`);
  const currentTree = await object("tree", joinBytes("100644 .env\0", hashBytes(currentEnv), "100644 MIGRATION.md\0", hashBytes(notes), "100644 README.md\0", hashBytes(readme)));
  const commit = await makeCommit(currentTree, removed, 1704240000, "document legacy deployment before migration");
  return { objects, commit, env };
}

async function gitReply(part, envBody, next) {
  if (!GIT_PART.test(part)) return null;
  if (part === "HEAD") return { body: "ref: refs/heads/main\n", contentType: "text/plain", step: "git-head" };
  if (part === "objects/info/packs") return { body: "\n", contentType: "text/plain", step: "git-packs" };
  const repo = await gitRepository(envBody, next);
  if (part === "info/refs") return { body: `${repo.commit}\trefs/heads/main\n`, contentType: "text/plain", step: "git-refs" };
  if (part === "refs/heads/main") return { body: repo.commit + "\n", contentType: "text/plain", step: "git-refs" };
  const hash = part.slice("objects/".length).replace("/", ""), raw = repo.objects.get(hash);
  if (!raw) return { body: "Not found\n", status: 404, contentType: "text/plain", step: "git-miss" };
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
  return { body: new Uint8Array(await new Response(stream).arrayBuffer()), contentType: "application/octet-stream",
    step: hash === repo.env ? "git-config-read" : "git-object" };
}

function attachHook(body, kind, url) {
  if (kind === "json" || kind === "docker") return JSON.stringify({ NextConfig: url, ...JSON.parse(body) }, null, 2) + "\n";
  if (kind === "directory") return body.replace("<pre>", `<pre><a href="${url}">current/</a>\n`);
  if (kind === "env") return `NEXT_CONFIG_URL=${url}\n` + body;
  if (kind === "wordpress") return body.replace("<?php\n", `<?php\n// include: ${url}\n`);
  return `# include: ${url}\n` + body;
}

// Protocol-shaped loot. Values come from our own deterministic seed, never from
// prompts, uploaded files, requested callback URLs, or a real provider.
function apiReply(visit, family, next, seed) {
  const url = new URL(visit.url || visit.path, "https://example.invalid");
  const page = (url.searchParams.get("cursor") || url.searchParams.get("continuation-token") || "").slice(0, 64);
  const json = (value, step) => ({ body: JSON.stringify(value, null, 2) + "\n", contentType: "application/json", step });
  if (family === "ai") {
    if (/\/models\/?$/.test(url.pathname)) return json({ object: "list", data: [{ id: "production-chat", object: "model", owned_by: "internal" }], next }, "model-list");
    if (/anthropic|\/messages$/.test(url.pathname)) return json({ id: "msg_" + seed, type: "message", role: "assistant", model: "production-chat",
      content: [{ type: "text", text: `Additional context is available at ${next}` }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } }, "message-request");
    return json({ id: "chatcmpl-" + seed, object: "chat.completion", created: 1704067200, model: "production-chat",
      choices: [{ index: 0, message: { role: "assistant", content: `Dataset available at ${next}` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }, "completion-request");
  }
  if (family === "storage") {
    return { body: `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>production-exports</Name><IsTruncated>true</IsTruncated>` +
      `<NextContinuationToken>${seed}</NextContinuationToken>` + ["config.env", "customers.csv", "archive.json"].map((name) =>
        `<Contents><Key>exports/${seed}/${name}</Key><Size>4096</Size></Contents>`).join("") +
      `<NextIndex>${next}</NextIndex></ListBucketResult>`, contentType: "application/xml", step: page ? "storage-pagination" : "storage-list" };
  }
  if (family === "registry") return json({ name: "production", tags: ["latest", "release-" + seed], next }, "registry-read");
  const data = Array.from({ length: 12 }, (_, i) => ({ id: seed + "-" + i, name: "export-" + i, region: "us-east-1", config_url: next }));
  return json({ data, has_more: true, next, next_cursor: seed }, page ? "api-pagination" : "api-read");
}

async function mazeBody(visit, kind, key, options, hmac) {
  const match = visit.path.match(MAZE);
  const depth = match ? BigInt(match[1]) : 0n;
  const digest = async (label) => new Uint8Array(await crypto.subtle.sign("HMAC", hmac,
    encoder.encode(`usual-bait/maze/v1\0${visit.host}\0${visit.path}\0${label}`)));
  const root = (index, name) => digest("child/" + index).then((d) =>
    `/_archive/${depth + 1n}/${hex(d.slice(0, 16))}/${name}`);
  const names = ["", ".env", "secrets.json", ".git/config", ".aws/credentials", ".npmrc", ".docker/config.json", "wp-config.php.bak", ""];
  const paths = await Promise.all(names.map((name, i) => root(i, name)));
  const links = paths.map((path) => `https://${visit.host}${path}`);
  const tokens = [];
  const token = async (name) => {
    const parts = await Promise.all([digest("credential/" + name), digest("credential-tail/" + name)]);
    let number = BigInt("0x" + parts.map(hex).join("")), value = "";
    for (let i = 0; i < TOKEN_LENGTH; i++, number /= 62n) value += ALPHABET[Number(number % 62n)];
    tokens.push({ hash: await tokenHash(value), slot: name });
    return value;
  };
  const seed = await digest("decoration");
  // Seeded decoration, not a cryptographic credential; avoid visibly repeating
  // the 32-byte seed in longer strings. Actual tripwire tokens use HMAC above.
  let state = new DataView(seed.buffer).getUint32(0) || 1;
  const random = (length, alphabet = ALPHABET) => Array.from({ length }, () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return alphabet[(state >>> 0) % alphabet.length];
  }).join("");
  const awsId = "AKIA" + random(16, BASE32);
  if (kind === "env" || kind === "aws") tokens.push({ hash: await tokenHash(awsId), slot: "aws-access-key" });
  let body;
  if (kind === "directory") {
    body = `<!doctype html><title>Index of /releases/${depth}/</title><h1>Index of /releases/${depth}/</h1><pre>\n` +
      paths.map((path, i) => `<a href="${path}">${names[i] || (i ? "previous/" : "production/")}</a>\n`).join("") + "</pre>\n";
  } else {
    body = await render(kind, visit, key, { ...options, awsCanary: null }, hmac,
      { token, random, aws: { accessKeyId: awsId, secretAccessKey: random(40) } });
    if (kind === "json" || kind === "docker") {
      body = JSON.stringify({ ReleaseIndex: links[0], ...JSON.parse(body), Includes: links }, null, 2) + "\n";
    } else if (kind === "env") {
      // Offer the next door before a scanner's short timeout can cut it off.
      body = `RELEASE_INDEX=${links[0]}\n` + body + "\n" +
        links.slice(1).map((link, i) => `CONFIG_INCLUDE_${i + 1}=${link}\n`).join("");
    } else {
      // All remaining formats accept comments, including PHP's // form.
      const comment = kind === "wordpress" ? "//" : "#";
      const first = `${comment} include: ${links[0]}\n`;
      body = kind === "wordpress" ? body.replace("<?php\n", "<?php\n" + first) : first + body;
      body += "\n" + links.slice(1).map((link) => `${comment} include: ${link}\n`).join("");
    }
  }
  return { body, tokens, depth: Number(depth > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : depth) };
}

// Count stream lifetime, never the configured delay. Checkpoints are cumulative
// and idempotent; termination may lose the final interval, never invent one.
function tarpitStream(text, seconds, signal, report, { admit, release } = {}) {
  const bytes = asBytes(text);
  const duration = seconds * 1000;
  const chunks = Math.max(2, Math.min(bytes.length, Math.ceil(duration / 1000) + 1));
  const size = Math.ceil(bytes.length / chunks);
  const steps = Math.ceil(bytes.length / size);
  const interval = duration / (steps - 1);
  let offset = 0, started = null, stopped = false, admitted = false, timer, wake, checkpoint, deadline, controllerRef;
  const snapshot = (ended) => {
    if (offset) report({ heldMs: Math.max(0, Math.floor(performance.now() - started)), bytes: offset, ended });
  };
  const finish = (ended, close = false) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer); clearTimeout(deadline); clearInterval(checkpoint);
    signal?.removeEventListener("abort", abort);
    wake?.();
    snapshot(ended);
    if (admitted) release?.();
    if (close) controllerRef.close();
  };
  const abort = () => finish("disconnected", true);
  return new ReadableStream({
    start(controller) { controllerRef = controller; },
    async pull(controller) {
      if (stopped) return;
      if (signal?.aborted) { finish("disconnected", true); return; }
      if (started === null) {
        started = performance.now();
        if (admit && !(admitted = admit())) {
          controller.enqueue(bytes); offset = bytes.length; finish("busy", true); return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        checkpoint = setInterval(() => snapshot(null), 10000);
        deadline = setTimeout(() => finish("capped", true), duration + 1000);
      }
      if (offset) await new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, interval); });
      if (stopped) return;
      const chunk = bytes.slice(offset, offset + size);
      controller.enqueue(chunk);
      offset += chunk.length;
      if (offset === bytes.length) finish("completed", true);
    },
    cancel() { finish("disconnected"); },
  }, { highWaterMark: 0 });
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
 * tarpit     Endless, path-stable fake filesystem. Off by default.
 * tarpitSeconds  Per-response drip budget, default 120 seconds, maximum 300.
 * learning   Learn reviewed origin-404 probes and recipe outcomes. Requires a store.
 * maxActiveTarpits  Slow streams per instance, default 16, maximum 64.
 * loginExperimentUntil  Opt-in ISO end time (at most seven days ahead). Disabled otherwise.
 * loginExperimentHosts  Explicit host allowlist for that experiment. Empty by default.
 * experimentSource  "runtime" (default) or "synthetic" for isolated local fixtures.
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
  const tarpitSeconds = Math.max(0.01, Math.min(Number(options.tarpitSeconds) || 120, 300));
  const learning = Boolean(options.tarpit && options.learning && options.store?.assignPlan);
  const experimentEnd = Date.parse(options.loginExperimentUntil || "");
  const experimentHosts = new Set((options.loginExperimentHosts || []).map(h => String(h).toLowerCase()));
  const loginExperiment = learning && Boolean(options.store?.enrollHosting) && Number.isFinite(experimentEnd)
    && experimentEnd <= Date.now() + 7 * 86400000 && experimentEnd > Date.now();
  const experimentActive = host => loginExperiment && Date.now() < experimentEnd && experimentHosts.has(host.toLowerCase());
  const maxActive = Math.max(1, Math.min(Number(options.maxActiveTarpits) || 16, 64));
  let active = 0;
  const admission = { admit: () => active < maxActive ? (++active, true) : false, release: () => { active--; } };
  const emit = options.onEvent || ((event) => console.log(JSON.stringify({ usual_bait: event })));

  async function digest(label) {
    return hex(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacPromise, encoder.encode("usual-bait/learn/v1\0" + label))));
  }

  async function identities(visit) {
    const tool = (await digest("tool\0" + (visit.userAgent || "").slice(0, 300) + "\0" + (visit.fingerprint || "").slice(0, 1000))).slice(0, 24);
    const actor = (await digest("actor\0" + new Date(visit.at).toISOString().slice(0, 10) + "\0" + (visit.ip || "unknown") + "\0" + tool)).slice(0, 24);
    return { tool, actor };
  }

  async function observationEvidence(visit) {
    const observedDay = new Date(visit.at).toISOString().slice(0, 10);
    // A daily egress group is separate from the tool group: a client may change
    // tools without changing its visible network. Neither identifies an operator.
    return { version: 1, source: options.experimentSource === "synthetic" ? "synthetic" : "runtime",
      day: observedDay,
      network: visit.ip ? (await digest("egress\0" + observedDay + "\0" + visit.ip)).slice(0, 24) : null,
      asn: Number.isInteger(Number(visit.asn)) && Number(visit.asn) > 0 ? Number(visit.asn) : null,
      country: /^[A-Z]{2}$/.test(visit.country || "") ? visit.country : null,
      transport: visit.transport ? (await digest("transport\0" + visit.transport)).slice(0, 24) : null };
  }

  async function planFor(visit, family, path = visit.path) {
    // Path is private and query-free. Cap keys before storing them.
    if (path.length > 200 || visit.host.length > 120) return null;
    const hash = await digest("plan\0" + visit.host + "\0" + path + "\0" + family);
    return options.store.assignPlan({ id: hash.slice(0, 32), site: visit.host, path, family, seed: parseInt(hash.slice(0, 8), 16) });
  }

  async function nextDoors(visit, plan, depth) {
    const node = (await digest("door\0" + visit.host + "\0" + visit.path)).slice(0, 16);
    const root = `https://${visit.host}/_archive/h/${plan.id}/${BigInt(depth) + 1n}/${node}/`;
    const doors = { archive: root + ".env", api: root + "index.json", git: root + "repo.git/HEAD" };
    return { root, primary: doors[plan.recipe], doors };
  }

  const companyRoot = (plan) => `/_archive/company/${plan.id}/`;
  const companyLink = (visit, plan) => `https://${visit.host}${companyRoot(plan)}login`;
  function companyEnv(body, visit, plan) {
    return `ADMIN_LOGIN_URL=${companyLink(visit, plan)}\nADMIN_USERNAME=deploy\n` + body;
  }

  async function newSession(visit, plan) {
    const expiry = Math.floor(Date.now() / 1000) + 86400;
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const value = `${expiry}.${nonce}`;
    return { value: value + "." + await digest(`session\0${visit.host}\0${plan.id}\0${value}`),
      journey: (await digest("replay\0" + nonce)).slice(0, 24) };
  }

  async function readSession(visit, plan, cookieName = "bait_company") {
    const value = (visit.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
    if (!value || !/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) return null;
    const [expiry, nonce, signature] = value.split(".");
    if (Number(expiry) <= Date.now() / 1000 || Number(expiry) > Date.now() / 1000 + 86401) return null;
    const expected = await digest(`session\0${visit.host}\0${plan.id}\0${expiry}.${nonce}`);
    let different = 0;
    for (let i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return different ? null : { value, journey: (await digest("replay\0" + nonce)).slice(0, 24) };
  }

  async function hostingEnrollment(visit, plan) {
    if (!experimentActive(visit.host) || !hostingLogin(visit)) return null;
    const { tool } = await identities(visit);
    // Stable within this experiment; a network/tool cohort is not a unique bot.
    const cohort = (await digest(`hosting-cohort\0${visit.host}\0${visit.ip || "unknown"}\0${tool}`)).slice(0, 24);
    const arm = parseInt(cohort.slice(0, 2), 16) % 2 ? "protocol-fast" : "company-slow";
    const session = await newSession(visit, plan);
    const number = BigInt(crypto.getRandomValues(new Uint32Array(1))[0]) * 10000000000n / 4294967296n;
    const id = "cpsess" + String(number).padStart(10, "0");
    const record = { id, version: LOGIN_EXPERIMENT, site: visit.host, planId: plan.id,
      sourcePlanId: visit.sourcePlanId, credentialId: visit.credentialId, cohort, arm, journey: session.journey,
      created: Date.now(), expires: Math.min(Date.now() + 86400000, experimentEnd),
      source: options.experimentSource === "synthetic" ? "synthetic" : "runtime" };
    return await options.store.enrollHosting(record) ? { ...record, session } : null;
  }

  async function hostingReply(visit, plan, record, suffix, waitUntil, login = false) {
    const root = "/" + record.id;
    const op = login ? { step: "hosting-login", operation: "login" } : hostingOperation(visit, suffix);
    let body, contentType = "application/json", status = 200;
    if (login) body = JSON.stringify({ status: 1, notices: [], security_token: root,
      redirect: root + "/frontend/jupiter/index.html" });
    else if (op.operation === "home") {
      contentType = "text/html; charset=utf-8";
      body = `<!doctype html><title>cPanel - Main</title><h1>Account: deploy</h1><ul>` +
        ["Fileman/list_files", "Email/list_pops", "Mysql/list_databases"].map(p => `<li><a href="${root}/execute/${p}">${p}</a></li>`).join("") + "</ul>";
    } else {
      const data = op.step === "hosting-file-list" ? [{ file: "public_html", type: "dir" }, { file: "backups", type: "dir" }]
        : op.step === "hosting-mail-list" ? [{ email: "deploy@example.invalid", diskused: 0 }]
        : op.step === "hosting-database-list" ? [{ database: "deploy_production", disk_usage: 4096 }]
        : op.step === "hosting-file-read" ? { content: "APP_ENV=production\n" } : null;
      const ok = op.operation !== "unknown";
      status = ok ? 200 : 404;
      body = JSON.stringify(op.legacy ? { cpanelresult: { apiversion: 2,
        module: ok ? op.operation.split("/")[0] : "Unknown", func: ok ? op.operation.split("/")[1] : "unknown",
        event: { result: ok ? 1 : 0 }, data: data || (ok ? [{ result: 1, reason: "" }] : []) } }
        : { apiversion: 3, module: ok ? op.operation.split("/")[0] : "Unknown",
          func: ok ? op.operation.split("/")[1] : "unknown",
          result: { status: ok ? 1 : 0, errors: ok ? null : ["Function not found"], messages: null, metadata: {}, data } });
    }
    // Normalized trace paths prevent query/body or bearer-session leakage.
    const clean = { ...visit, path: login ? "/[hosting-login]" : "/[hosting-session]/" + op.operation,
      journey: record.journey, sourcePlanId: record.sourcePlanId || record.source_plan_id,
      credentialId: record.credentialId || record.credential_id };
    const headers = login ? { "set-cookie": `cpsession=${record.session.value}; Path=${root}/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((record.expires - Date.now()) / 1000))}` } : {};
    return slowResponse(clean, { body, contentType, status, step: op.step, headers,
      html: contentType.startsWith("text/html") }, waitUntil,
      { plan, followup: !login, credentialUse: login, seconds: login ? 0 : tarpitSeconds });
  }

  async function companyReply(visit, plan, page, session, waitUntil, signedIn = false) {
    const root = companyRoot(plan), seed = await digest("company\0" + visit.host);
    const name = ["Alder", "Northline", "Cedar", "Meridian"][parseInt(seed[0], 16) % 4] + " Operations";
    const project = "Atlas-" + seed.slice(0, 4).toUpperCase();
    const link = (path, label) => `<a href="${root}${path}">${escapeHtml(label)}</a>`;
    const frame = (title, content) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ${name}</title><style>body{margin:0;background:#f4f5f2;color:#25302b;font:16px/1.6 system-ui,sans-serif}main{max-width:900px;margin:8vh auto;padding:24px}header{border-bottom:1px solid #cdd4cd;padding-bottom:24px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}nav{display:flex;gap:18px;flex-wrap:wrap}a{color:#246447}h1{font-size:clamp(32px,6vw,56px);line-height:1.1;letter-spacing:-.04em}section{background:white;border:1px solid #dce1d9;padding:28px;border-radius:8px;margin:24px 0}label{display:block;margin:18px 0}input,button{box-sizing:border-box;font:inherit;padding:12px;border:1px solid #aebbb0;border-radius:4px;max-width:100%}input{display:block;width:100%;margin-top:6px}button{background:#254f3a;color:white;cursor:pointer}li{margin:12px 0}code{overflow-wrap:anywhere}small{color:#59675d}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #729b38;outline-offset:3px}</style><main><header><strong>${name}</strong>${session ? `<nav>${link("home", "Overview")}${link("employees", "People")}${link("projects", "Projects")}${link("notes", "Notes")}${link("exports", "Exports")}</nav>` : "<small>Staff access</small>"}</header><h1>${escapeHtml(title)}</h1>${content}<small>${project} · Operations workspace</small></main></html>`;
    let reply, step = "company-" + page;
    if (page === "login") {
      reply = { body: frame("Sign in", `<section><p>Use your deployment credentials.</p><form method="post" action="${root}login"><label>Username<input name="username" value="deploy" autocomplete="off"></label><label>Password<input name="password" type="password" required autocomplete="off"></label><button>Sign in</button></form></section>`), contentType: "text/html; charset=utf-8" };
      step = "company-login-form";
    } else if (page === "home") {
      reply = { body: frame("Operations overview", `<section><p>${signedIn ? "Signed in. " : ""}${project} is migrating its production archives.</p><ul><li>${link("exports", "Prepare a production backup")}</li><li>${link("projects", "Review legacy deployments")}</li><li>${link("notes", "Read the migration handover")}</li></ul></section>`), contentType: "text/html; charset=utf-8" };
    } else if (page === "employees") {
      reply = { body: frame("People", `<section><ul>${["Morgan Vale", "Robin Field", "Alex Linden", "Casey Reed"].map((n, i) => `<li><strong>${n}</strong> — ${["Infrastructure", "Data operations", "Deployment", "Archives"][i]}<br><small>${n.toLowerCase().replace(" ", ".")}@${seed.slice(0, 8)}.invalid · ${project}</small></li>`).join("")}</ul>${link("notes", "Handover notes")}</section>`), contentType: "text/html; charset=utf-8" };
    } else if (page === "projects" || page === "notes") {
      const next = await nextDoors(visit, plan, 0);
      reply = { body: frame(page === "projects" ? "Projects" : "Migration handover", `<section><h2>${project}</h2><p>Keep the legacy deployment available until the archive migration is complete. Configuration removed from the repository is still in its earlier commits.</p><ul><li><a href="${next.root}repo.git/HEAD">Deployment repository</a></li><li><a href="${next.doors.archive}">Legacy deployment configuration</a></li><li>${link("exports", "Production exports")}</li><li>${link("notes/message", "A note from Paul")}</li></ul></section>`), contentType: "text/html; charset=utf-8" };
    } else if (page === "notes/message") {
      step = "company-message";
      reply = { body: frame("A note from Paul", `<section><p>${escapeHtml(COMPANY_MESSAGE).replace("@paulljump", '<a href="https://x.com/paulljump" rel="noopener noreferrer">@paulljump</a>')}</p></section>`), contentType: "text/html; charset=utf-8" };
    } else if (page === "exports") {
      const job = (await digest("export\0" + plan.id)).slice(0, 16);
      step = visit.method === "POST" ? "export-start" : "company-exports";
      reply = { body: frame("Production exports", `<section><p>${project} · Export ${job}</p>${visit.method === "POST" ? `<p>Preparing production backup. Batches become available separately.</p>${link(`exports/${job}/status/0.html`, "Check export progress")}` : `<form method="post" action="${root}exports"><button>Prepare production backup</button></form>`}</section>`), contentType: "text/html; charset=utf-8" };
    } else {
      const match = page.match(/^exports\/([a-f0-9]{16})\/(status|chunks)\/(\d{1,24})\.(json|csv|html)$/);
      if (!match || match[1] !== (await digest("export\0" + plan.id)).slice(0, 16) || !(match[2] === "status" ? ["json", "html"] : ["csv"]).includes(match[4])) return new Response("Not found", { status: 404 });
      const cursor = BigInt(match[3]), next = cursor + 1n;
      // The cursor is the state. Polls never enqueue background work or grow a job table.
      const status = `${root}exports/${match[1]}/status/${next}.json`;
      step = match[2] === "status" ? "export-poll" : "export-chunk";
      reply = match[4] === "html" ? { body: frame("Export in progress", `<section><p>${project} · Batch ${cursor}</p><p>This batch is ready. The remaining archive is still being assembled.</p><ul><li>${link(`exports/${match[1]}/chunks/${cursor}.csv`, "Download this batch")}</li><li>${link(`exports/${match[1]}/status/${next}.html`, "Check the next batch")}</li><li>${link(`exports/${match[1]}/status/${cursor}.json`, "Export status API")}</li></ul></section>`), contentType: "text/html; charset=utf-8", next: status, headers: { "retry-after": "15" } }
        : match[2] === "status" ? { body: JSON.stringify({ job_id: match[1], project, state: "assembling", batch: String(cursor),
        download_url: `${root}exports/${match[1]}/chunks/${cursor}.csv`, next_status_url: status, retry_after_seconds: 15 }),
        contentType: "application/json", headers: { "retry-after": "15" }, next: status }
        : { body: "record_id,project,account,status\n" + Array.from({ length: 48 }, (_, i) => `${seed.slice(0, 8)}-${cursor}-${i},${project},Account ${cursor}-${i},archived`).join("\n") + "\n",
          contentType: "text/csv; charset=utf-8", headers: { "content-disposition": 'attachment; filename="production-batch.csv"' }, next: status };
    }
    const extra = signedIn ? { "set-cookie": `bait_company=${session.value}; Path=${root}; HttpOnly; Secure; SameSite=Strict; Max-Age=86400` } : {};
    return slowResponse({ ...visit, journey: session?.journey || null }, { ...reply, step: signedIn ? "company-login" : step,
      headers: { ...reply.headers, ...extra }, html: reply.contentType.startsWith("text/html") }, waitUntil,
      { plan, followup: !signedIn && Boolean(session), credentialUse: signedIn });
  }

  async function slowResponse(visit, reply, waitUntil, { plan = null, depth = 0, followup = false, credentialUse = false, seconds = tarpitSeconds } = {}) {
    const headers = { "content-type": reply.contentType || "text/plain; charset=utf-8",
      "cache-control": "no-store, no-transform", "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" };
    if (reply.html) headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
    Object.assign(headers, reply.headers || {});
    headers["referrer-policy"] = "no-referrer";
    if (reply.next) headers.link = `<${reply.next}>; rel="next"`;
    if (visit.method === "HEAD") return new Response(null, { status: reply.status || 200, headers });
    const bytes = asBytes(reply.body);
    if (bytes.length > LEARNING_LIMITS.bodyBytes) throw new Error("Bait response exceeds byte budget");
    const connectionId = crypto.randomUUID();
    const meta = plan ? { site: visit.host, path: visit.path, ...(await identities(visit)), family: plan.family,
      recipe: plan.recipe, planId: plan.id, sourcePlanId: visit.sourcePlanId || null,
      credentialId: visit.credentialId || null, journey: visit.journey || null, observedMs: visit.at,
      step: reply.step || "config-read", method: visit.method || "GET", followup, credentialUse,
      evidence: await observationEvidence(visit) } : null;
    return new Response(tarpitStream(bytes, seconds, visit.signal, (sample) => publish({
      type: "tarpit", at: new Date().toISOString(), connectionId, depth, learning: meta, ...sample,
    }, waitUntil), admission), { status: reply.status || 200, headers });
  }

  function servedEvent(visit, kind, tokens, waitUntil, plan) {
    publish({ type: "served", at: new Date(visit.at).toISOString(), site: visit.host, owner: options.owner || null,
      file: kind, path: visit.path, credentials: tokens.length, mazeTokens: tokens, planId: plan?.id || null,
      ip: visit.ip, asn: visit.asn || null, asOrg: visit.asOrg || null, country: visit.country || null,
      userAgent: visit.userAgent || null, fingerprint: visit.fingerprint || null }, waitUntil);
  }

  async function lessonReply(visit, plan, depth, suffix, waitUntil, credentialUse = false) {
    const git = suffix.match(/^repo\.git\/(.+)$/);
    if (![".env", "index.json", ""].includes(suffix) && !(git && GIT_PART.test(git[1]))) return null;
    // Every object in one Git repository must use the same seed and next link.
    const seedVisit = git ? { ...visit, path: visit.path.slice(0, -git[1].length) + ".env" } : visit;
    const next = await nextDoors(seedVisit, plan, depth);
    const maze = await mazeBody(seedVisit, "env", await keyPromise, options, await hmacPromise);
    const envBody = companyEnv(attachHook(maze.body, "env", next.primary), visit, plan);
    let reply;
    if (git) reply = await gitReply(git[1], envBody, next.primary);
    else if (suffix === "index.json") reply = apiReply(visit, "api", next.doors.api, (await digest(visit.host + visit.url)).slice(0, 16));
    else reply = { body: envBody, contentType: "text/plain", step: "config-read" };
    if (visit.method !== "HEAD" && (!git || reply.step === "git-config-read")) servedEvent(visit, "env", maze.tokens, waitUntil, plan);
    return slowResponse(visit, { ...reply, next: next.primary }, waitUntil,
      { plan, depth: Number(BigInt(depth) > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : BigInt(depth)), followup: true, credentialUse });
  }

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
    const hosting = experimentActive(visit.host) ? visit.path.match(HOSTING_SESSION) : null;
    if (hosting) {
      const record = await options.store.findHosting(hosting[1], visit.host);
      if (record && record.expires > Date.now() && record.arm === "protocol-fast") {
        const plan = await options.store.findPlan(record.plan_id);
        const session = plan && await readSession(visit, plan, "cpsession");
        if (!session || session.journey !== record.journey) return new Response("Access denied", { status: 401, headers: { "cache-control": "no-store" } });
        if (!["GET", "HEAD", "POST"].includes(visit.method || "GET")) return new Response("Method not allowed", { status: 405 });
        return hostingReply(visit, plan, record, hosting[2], waitUntil);
      }
      // Unissued session paths belong to the real site and pass through.
    }
    const company = learning ? visit.path.match(COMPANY) : null;
    let companyPlan = null;
    if (company) {
      companyPlan = await options.store.findPlan(company[1]);
      if (!companyPlan || companyPlan.site !== visit.host) return new Response("Not found", { status: 404 });
      const page = company[2];
      if (!["GET", "HEAD"].includes(visit.method || "GET") && !(visit.method === "POST" && ["login", "exports"].includes(page))) return new Response("Method not allowed", { status: 405 });
      const session = await readSession(visit, companyPlan);
      if (session) return companyReply(visit, companyPlan, page === "login" ? "home" : page, session, waitUntil);
      if (page === "login" && visit.method !== "POST") return companyReply(visit, companyPlan, "login", null, waitUntil);
      if (page !== "login") return new Response(null, { status: 303, headers: { location: companyRoot(companyPlan) + "login", "cache-control": "no-store" } });
      // POST /login continues through the existing issued-credential verifier.
    }
    if (learning && ["GET", "HEAD"].includes(visit.method || "GET")) {
      const match = visit.path.match(LESSON);
      if (match) {
        const plan = await options.store.findPlan(match[1]);
        if (plan?.site === visit.host) return lessonReply(visit, plan, match[2], match[4], waitUntil);
        return null;
      }
    }
    const file = FILES.find((f) => f.pattern.test(visit.path));
    const maze = options.tarpit && MAZE.test(visit.path);
    if (options.tarpit && (file || maze) && ["GET", "HEAD"].includes(visit.method || "GET")) {
      const kind = file?.kind || "directory";
      const headers = { "content-type": kind === "directory" ? "text/html; charset=utf-8"
        : kind === "json" || kind === "docker" ? "application/json" : "text/plain; charset=utf-8",
        "cache-control": "no-store, no-transform", "x-robots-tag": "noindex, nofollow",
        "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" };
      if (visit.method === "HEAD") return new Response(null, { headers });
      let { body, tokens, depth } = await mazeBody(visit, kind, key, options, hmac);
      const plan = learning ? await planFor(visit, kind === "git" ? "git" : "secrets") : null;
      if (plan) {
        const next = await nextDoors(visit, plan, depth);
        body = attachHook(body, kind, next.primary);
        if (kind === "env") body = companyEnv(body, visit, plan);
        for (const path of JSON.parse(plan.links || "[]")) body = attachHook(body, kind, `https://${visit.host}${path}`);
      }
      publish({ type: "served", at: new Date(visit.at).toISOString(), site: visit.host, owner: options.owner || null,
        file: kind, path: visit.path, credentials: tokens.length, mazeTokens: tokens, planId: plan?.id || null,
        ip: visit.ip, asn: visit.asn || null, asOrg: visit.asOrg || null, country: visit.country || null,
        userAgent: visit.userAgent || null, fingerprint: visit.fingerprint || null }, waitUntil);
      return slowResponse(visit, { body, contentType: headers["content-type"] }, waitUntil, { plan, depth, followup: Boolean(maze) });
    }
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
      .map((token) => ({ token, opener: async () => await open(key, token)
        || (options.store?.lookupMazeToken ? options.store.lookupMazeToken(await tokenHash(token)) : null) }))
      .concat([...new Set(haystack.match(ACCESS_KEY_PATTERN) || [])].slice(0, 2).map((token) => ({ token,
        opener: async () => {
          const served = await openAccessKey(hmac, token)
            || (options.store?.lookupMazeToken ? await options.store.lookupMazeToken(await tokenHash(token)) : null);
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
      if (learning && typeof options.respond !== "function" && ["GET", "HEAD", "POST"].includes(visit.method || "GET")) {
        const family = credentialFamily(visit, scraped.slot);
        const cleanVisit = { ...visit, path: redact(visit.path, [token]), sourcePlanId: scraped.planId || null,
          credentialId: await credentialId(token) };
        const git = visit.path.match(GIT_PATH);
        const plan = companyPlan || await planFor(cleanVisit, family, git?.[1] || cleanVisit.path);
        const portalPlan = companyPlan || plan;
        if (portalPlan && hostingLogin(visit)) {
          const enrollment = await hostingEnrollment(cleanVisit, portalPlan);
          if (enrollment?.arm === "protocol-fast") return hostingReply(cleanVisit, portalPlan, enrollment, "", waitUntil, true);
          if (enrollment) return companyReply(cleanVisit, portalPlan, "home", enrollment.session, waitUntil, true);
        }
        if (portalPlan && (company || (family === "api" && /login|admin/i.test(visit.path)) || scraped.slot === "admin-url")) {
          const session = await newSession(visit, portalPlan);
          return companyReply(cleanVisit, portalPlan, "home", session, waitUntil, true);
        }
        if (plan) {
          if (family === "git" && git && GIT_PART.test(git[2])) {
            return learnedProbe(cleanVisit, plan, waitUntil, true);
          }
          const next = await nextDoors(cleanVisit, plan, 0);
          const reply = apiReply(visit, family, next.doors.api, (await digest(visit.host + visit.url)).slice(0, 16));
          if (family === "api") reply.body = JSON.stringify({ ...JSON.parse(reply.body), admin_login_url: companyLink(visit, plan) });
          return slowResponse(cleanVisit, { ...reply, next: next.primary }, waitUntil, { plan, credentialUse: true });
        }
      }
      return typeof options.respond === "function" ? options.respond(scraped)
        : new Response(JSON.stringify({ error: "invalid_token" }), { status: 401,
          headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (company) return new Response("Credentials not recognized", { status: 401, headers: { "cache-control": "no-store" } });
    return null;
  }

  async function learnedProbe(visit, plan, waitUntil, credentialUse = false) {
    const git = visit.path.match(GIT_PATH);
    const seedVisit = git ? { ...visit, path: git[1] + "/.env" } : visit;
    const next = await nextDoors(seedVisit, plan, 0);
    const maze = await mazeBody(seedVisit, "env", await keyPromise, options, await hmacPromise);
    let reply = { body: companyEnv(attachHook(maze.body, "env", next.primary), visit, plan), contentType: "text/plain", step: "probe" };
    if (git) reply = await gitReply(git[2], reply.body, next.primary);
    else if (plan.family === "debug") reply = { body: JSON.stringify({ status: "UP", activeProfiles: ["production"],
      propertySources: [{ name: "config", properties: { configUrl: { value: next.primary } } }] }, null, 2), contentType: "application/json", step: "debug-read" };
    else if (plan.family === "wordpress" || plan.family === "php") reply = { body: `<!doctype html><title>Maintenance</title><p>Configuration moved.</p><a href="${next.primary}">Deployment configuration</a>`, contentType: "text/html", step: "php-probe" };
    else if (plan.family === "backup") reply = { body: `-- Production export manifest\n-- Config: ${next.primary}\nCREATE TABLE export_manifest (next_url TEXT);\nINSERT INTO export_manifest VALUES ('${next.primary}');\n`, contentType: "text/plain", step: "backup-read" };
    const emittedTokens = !git && ["debug", "wordpress", "php", "backup"].includes(plan.family) ? [] : maze.tokens;
    if (visit.method !== "HEAD" && (!git || reply.step === "git-config-read")) servedEvent(visit, emittedTokens.length ? "env" : plan.family, emittedTokens, waitUntil, plan);
    return slowResponse(visit, { ...reply, next: next.primary }, waitUntil, { plan, credentialUse });
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
      try {
        return new Response(JSON.stringify(await options.store.stats({ awsCanary: Boolean(options.awsCanary), owner: options.owner })), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=30",
            "access-control-allow-origin": "*" } });
      } catch (error) {
        if (!options.store.snapshotOnly) throw error;
        return new Response(JSON.stringify({ error: "The next score is still on its way. No numbers filled in." }), {
          status: 503, headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": "900" } });
      }
    }
    return null;
  }

  async function handle(request, context = {}) {
    const url = new URL(request.url);
    const page = await dashboard(url.host, url.pathname, request.method);
    if (page) return page;
    let bodyText = null;
    const length = Number(request.headers.get("content-length") || 0);
    if (!context.originStatus && request.body && (length > 0 || COMPANY.test(url.pathname)
      || (experimentActive(url.host) && (HOSTING_SESSION.test(url.pathname) || hostingLogin({ path: url.pathname, url: url.pathname + url.search, method: request.method })))) && length <= MAX_BODY_BYTES) {
      const reader = request.clone().body.getReader();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 2000);
      try {
        const chunks = []; let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { if (!timedOut) bodyText = new TextDecoder().decode(joinBytes(...chunks)); break; }
          size += value.length;
          if (size > MAX_BODY_BYTES) break;
          chunks.push(value);
        }
      } catch { bodyText = null; }
      finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
    }
    const cf = request.cf || {};
    const visit = {
      at: Date.now(),
      host: url.host, path: url.pathname, url: url.pathname + url.search, method: request.method,
      signal: request.signal,
      headerText: headerText(request.headers), bodyText,
      contentType: request.headers.get("content-type"),
      cookie: request.headers.get("cookie"),
      ip: context.ip ?? request.headers.get("cf-connecting-ip") ?? null,
      asn: context.asn ?? cf.asn ?? null, asOrg: context.asOrg ?? cf.asOrganization ?? null,
      country: context.country ?? cf.country ?? null, userAgent: request.headers.get("user-agent"),
      fingerprint: fingerprintOf(request.headers, cf),
      transport: transportOf(cf),
    };
    if (context.originStatus !== undefined) {
      if (!learning || context.originStatus !== 404 || !["GET", "HEAD", "POST"].includes(request.method)) return null;
      const family = probeFamily(visit.path);
      if (request.method === "HEAD") return null;
      if (!family) {
        if (reviewCandidate(visit.path)) await options.store.observeProbe({
          id: (await digest("hook\0" + visit.host + "\0" + visit.path)).slice(0, 32), site: visit.host,
          path: visit.path, family: "unclassified", actor: (await identities(visit)).actor });
        return null;
      }
      const git = visit.path.match(GIT_PATH);
      const plan = await planFor(visit, family, git?.[1] || visit.path);
      if (!plan) return null;
      const { actor } = await identities(visit);
      await options.store.observeProbe({ id: (await digest("hook\0" + visit.host + "\0" + visit.path)).slice(0, 32),
        site: visit.host, path: visit.path, family, actor });
      return learnedProbe(visit, plan, context.waitUntil);
    }
    return inspect(visit, context.waitUntil);
  }

  async function handleWithOrigin(request, origin, context = {}) {
    try {
      const direct = await handle(request, context);
      if (direct) return direct;
    } catch (error) { console.error("[usual-bait]", error); }
    const response = await origin(request);
    const path = new URL(request.url).pathname;
    if (!learning || response.status !== 404 || !(probeFamily(path) || reviewCandidate(path))) return response;
    try {
      const bait = await handle(request, { ...context, originStatus: response.status });
      if (bait) { void response.body?.cancel().catch(() => {}); return bait; }
    } catch (error) { console.error("[usual-bait] learning", error); }
    return response;
  }

  return { handle, handleWithOrigin, inspect, dashboard, version: VERSION };
}

// Tool characteristics suggest cohorts across IPs. They are spoofable and do not
// identify people or prove that two requests share an operator.
function fingerprintOf(headers, cf = {}) {
  const names = [...headers.keys()].filter((n) => !n.startsWith("cf-") && !["x-forwarded-for", "x-forwarded-proto", "x-real-ip", "cdn-loop"].includes(n));
  return JSON.stringify({ tls: cf.tlsVersion || null, cipher: cf.tlsCipher || null, http: cf.httpProtocol || null,
    headers: names.sort().join(","), accept: headers.get("accept") || null, lang: headers.get("accept-language") || null,
    encoding: headers.get("accept-encoding") || null });
}

// Optional edge-supplied fields, never client-supplied forwarding headers.
// No paid Bot Management/JA4 dependency and no per-connection TLS random.
// A terminating proxy can supply this handshake; a match is not an identity.
function transportOf(cf = {}) {
  const fields = ["tlsVersion", "tlsCipher", "httpProtocol", "tlsClientCiphersSha1",
    "tlsClientExtensionsSha1", "tlsClientHelloLength"];
  const values = fields.map(key => [key, typeof cf[key] === "string" ? cf[key].slice(0, 96) : null]);
  return values.some(([, value]) => value) ? JSON.stringify(Object.fromEntries(values)) : null;
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
    const abort = new AbortController();
    const disconnected = () => abort.abort();
    res.once("close", disconnected);
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
        signal: abort.signal,
        headerText: headerText(headers), bodyText: body && body.length <= MAX_BODY_BYTES ? body : null,
        ip: forwarded || req.socket?.remoteAddress || null, asn: null,
        country: trustProxy ? req.headers["cf-ipcountry"] || null : null, userAgent: req.headers["user-agent"] || null,
        fingerprint: fingerprintOf(headers, { httpProtocol: "HTTP/" + req.httpVersion }),
      });
      if (!response) return next();
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      if (req.method === "HEAD") {
        await response.body?.cancel();
      } else if (response.body) for await (const chunk of response.body) {
        if (res.destroyed) break;
        if (!res.write(chunk)) await new Promise((resolve) => {
          const done = () => { res.off("drain", done); res.off("close", done); resolve(); };
          res.once("drain", done); res.once("close", done);
        });
      }
      res.end();
    } catch (error) {
      abort.abort();
      if (!res.destroyed) next(error);
    } finally {
      res.off("close", disconnected);
    }
  };
}

// ---------------------------------------------------------------------------
// Leaderboard store (Cloudflare D1, or anything with the same prepare/batch API)
//
// Events update aggregate counters. Scheduled public snapshots read bounded
// summaries; legacy detailed reports also inspect history and must be used sparingly.

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
  `CREATE TABLE IF NOT EXISTS bait_hosting_experiment (id TEXT PRIMARY KEY, version TEXT NOT NULL,
    site TEXT NOT NULL, plan_id TEXT NOT NULL, source_plan_id TEXT, credential_id TEXT,
    cohort TEXT NOT NULL, arm TEXT NOT NULL, journey TEXT NOT NULL UNIQUE,
    created INTEGER NOT NULL, expires INTEGER NOT NULL, source TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bait_learning_plan (id TEXT PRIMARY KEY, site TEXT NOT NULL, path TEXT NOT NULL,
    family TEXT NOT NULL, recipe TEXT NOT NULL, links TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bait_learning_hook (id TEXT PRIMARY KEY, site TEXT NOT NULL, path TEXT NOT NULL,
    family TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, clients INTEGER NOT NULL DEFAULT 0,
    promoted INTEGER NOT NULL DEFAULT 0, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bait_learning_client (hook_id TEXT NOT NULL, actor TEXT NOT NULL, PRIMARY KEY(hook_id, actor))`,
  `CREATE TABLE IF NOT EXISTS bait_learning_arm (family TEXT NOT NULL, recipe TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0, followups INTEGER NOT NULL DEFAULT 0, credential_uses INTEGER NOT NULL DEFAULT 0,
    held_ms INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(family, recipe))`,
  `CREATE TABLE IF NOT EXISTS bait_learning_visit (id TEXT PRIMARY KEY, at INTEGER NOT NULL, site TEXT NOT NULL,
    path TEXT NOT NULL, actor TEXT NOT NULL, tool TEXT NOT NULL, family TEXT NOT NULL, recipe TEXT NOT NULL,
    plan_id TEXT NOT NULL, source_plan_id TEXT, credential_id TEXT, step TEXT NOT NULL, followup INTEGER NOT NULL, credential_use INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS bait_learning_visit_at ON bait_learning_visit(at)`,
  `CREATE INDEX IF NOT EXISTS bait_learning_visit_actor ON bait_learning_visit(actor, at)`,
  `CREATE TABLE IF NOT EXISTS bait_tarpit (id INTEGER PRIMARY KEY CHECK (id = 1),
    held_ms INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0, deep_requests INTEGER NOT NULL DEFAULT 0, max_depth INTEGER NOT NULL DEFAULT 0)`,
  `INSERT OR IGNORE INTO bait_tarpit (id) VALUES (1)`,
  `CREATE TABLE IF NOT EXISTS bait_tarpit_connection (id TEXT PRIMARY KEY, held_ms INTEGER NOT NULL,
    bytes INTEGER NOT NULL, depth INTEGER NOT NULL, ended TEXT)`,
  `CREATE TABLE IF NOT EXISTS bait_maze_token (id TEXT PRIMARY KEY, at INTEGER, slot TEXT, file TEXT,
    ip TEXT, asn INTEGER, country TEXT)`,
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
  `ALTER TABLE bait_maze_token ADD COLUMN plan_id TEXT`,
  `ALTER TABLE bait_learning_visit ADD COLUMN journey TEXT`,
  `ALTER TABLE bait_learning_visit ADD COLUMN observed_ms INTEGER`,
  `ALTER TABLE bait_learning_visit ADD COLUMN method TEXT`,
  `ALTER TABLE bait_learning_visit ADD COLUMN evidence TEXT`,
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

export function d1Store(db, { cacheSeconds = 60, snapshotOnly = false, nowMs = Date.now } = {}) {
  let ready = null;
  const ensure = () => (ready ||= db.batch(SCHEMA.map((sql) => db.prepare(sql)))
    .then(() => Promise.all(MIGRATIONS.map((sql) => db.prepare(sql).run().catch(() => null))))
    .then(() => db.prepare(`CREATE INDEX IF NOT EXISTS bait_learning_visit_journey ON bait_learning_visit(journey, at)`).run())
    .catch((error) => {
      ready = null;
      throw error;
    }));
  const run = (sql, ...args) => db.prepare(sql).bind(...args);

  async function findPlan(id) {
    await ensure();
    return run(`SELECT * FROM bait_learning_plan WHERE id = ?`, id).first();
  }

  async function findHosting(id, site) {
    await ensure();
    return run(`SELECT * FROM bait_hosting_experiment WHERE id = ? AND site = ? AND version = ?`, id, site, LOGIN_EXPERIMENT).first();
  }

  async function enrollHosting(r) {
    await ensure();
    // The limit is enforced atomically in SQLite, across Worker isolates. There is
    // no per-request background job or unbounded session table. Failed enrollment
    // leaves the existing company behavior intact.
    await run(`INSERT OR IGNORE INTO bait_hosting_experiment
      (id, version, site, plan_id, source_plan_id, credential_id, cohort, arm, journey, created, expires, source)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT count(*) FROM bait_hosting_experiment WHERE version = ?) < 100`,
      r.id, r.version, r.site, r.planId, r.sourcePlanId || null, r.credentialId || null,
      r.cohort, r.arm, r.journey, r.created, r.expires, r.source, LOGIN_EXPERIMENT).run();
    const saved = await findHosting(r.id, r.site);
    return Boolean(saved && saved.journey === r.journey);
  }

  async function assignPlan({ id, site, path, family, seed }) {
    const existing = await findPlan(id);
    if (existing) return existing;
    const rows = await run(`SELECT * FROM bait_learning_arm WHERE family = ?`, family).all();
    const recipe = chooseRecipe(rows.results, seed);
    const links = JSON.stringify(await learnedLinks(site));
    await run(`INSERT OR IGNORE INTO bait_learning_plan (id, site, path, family, recipe, links, created)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM bait_learning_plan) < ?`,
      id, site, path, family, recipe, links, Math.floor(Date.now() / 1000), LEARNING_LIMITS.plans).run();
    return findPlan(id);
  }

  async function observeProbe({ id, site, path, family, actor }) {
    await ensure();
    const now = Math.floor(Date.now() / 1000);
    await db.batch([
      run(`INSERT INTO bait_learning_hook (id, site, path, family, hits, first_at, last_at)
        SELECT ?, ?, ?, ?, 1, ?, ? WHERE (SELECT count(*) FROM bait_learning_hook) < ?
          OR EXISTS(SELECT 1 FROM bait_learning_hook WHERE id = ?)
        ON CONFLICT(id) DO UPDATE SET hits = hits + 1, last_at = excluded.last_at`,
        id, site, path, family, now, now, LEARNING_LIMITS.hooks, id),
      run(`INSERT OR IGNORE INTO bait_learning_client (hook_id, actor)
        SELECT ?, ? WHERE EXISTS(SELECT 1 FROM bait_learning_hook WHERE id = ?)
        AND (SELECT count(*) FROM bait_learning_client WHERE hook_id = ?) < ?`,
        id, actor, id, id, LEARNING_LIMITS.clientsPerHook),
      run(`UPDATE bait_learning_hook SET clients = (SELECT count(*) FROM bait_learning_client WHERE hook_id = ?)
        WHERE id = ?`, id, id),
      run(`UPDATE bait_learning_hook SET promoted = 1 WHERE id = ? AND hits >= 3 AND clients >= 2 AND family != 'unclassified'`, id),
    ]);
  }

  async function learnedLinks(site) {
    await ensure();
    return (await run(`SELECT path FROM bait_learning_hook WHERE site = ? AND promoted = 1
      ORDER BY hits DESC, path LIMIT 3`, site).all()).results.map((r) => r.path);
  }

  async function learningStats() {
    await ensure();
    const [hooks, plans, arms] = await Promise.all([
      run(`SELECT count(*) AS observed, coalesce(sum(promoted),0) AS promoted,
        coalesce(sum(family = 'unclassified'),0) AS review FROM bait_learning_hook`).first(),
      run(`SELECT count(*) AS n FROM bait_learning_plan`).first(),
      run(`SELECT * FROM bait_learning_arm ORDER BY held_ms DESC, family, recipe`).all(),
    ]);
    return { observedPaths: hooks.observed, promotedPaths: hooks.promoted, reviewCandidates: hooks.review, stablePlans: plans.n,
      recipes: arms.results.map((r) => ({ family: r.family, recipe: r.recipe, requests: r.requests,
        followups: r.followups, credentialUses: r.credential_uses, timeWastedMs: r.held_ms, bytesGenerated: r.bytes })),
      measurement: "Observed requests only. Follow-ups are visits to linked maze URLs, not proof of a unique bot or causation. Recipe selection is an online heuristic, not a controlled experiment." };
  }

  async function replays() {
    await ensure();
    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    const groups = (await run(`SELECT v.journey, count(*) AS requests, sum(c.held_ms) AS held_ms,
      sum(c.bytes) AS bytes FROM bait_learning_visit v JOIN bait_tarpit_connection c ON c.id = v.id
      WHERE v.journey IS NOT NULL AND v.at >= ? GROUP BY v.journey HAVING count(*) >= 2
      ORDER BY held_ms DESC, v.journey LIMIT 6`, since).all()).results;
    const items = await Promise.all(groups.filter(g => /^[a-f0-9]{24}$/.test(g.journey)).map(async g => {
      const rows = (await run(`SELECT v.step, coalesce(v.observed_ms,v.at*1000) AS observed_ms,
        c.held_ms, c.bytes FROM bait_learning_visit v JOIN bait_tarpit_connection c ON c.id = v.id
        WHERE v.journey = ? AND v.at >= ? ORDER BY observed_ms, v.rowid LIMIT 12`, g.journey, since).all()).results;
      return { id: g.journey, requests: g.requests, timeWastedMs: g.held_ms, bytesGenerated: g.bytes,
        steps: rows.map(r => ({ at: new Date(r.observed_ms).toISOString(),
          action: REPLAY_STEPS[r.step] || "Opened another company page", timeWastedMs: r.held_ms, bytesGenerated: r.bytes })) };
    }));
    return { items, retentionDays: 7, maxStepsShown: 12,
      measurement: "Observed requests sharing a signed company session, not verified people or proof that content was read. Time is summed response-stream lifetime. No hostnames, credentials, IPs or submitted content are published." };
  }

  async function record(event) {
    await ensure();
    if (event.type === "tarpit") {
      // Historical imports and simulations cannot create tarpit credit.
      if (event.backfilled || event.simulated || !event.connectionId) return;
      const held = Math.max(0, Math.floor(Number(event.heldMs) || 0));
      const bytes = Math.max(0, Math.floor(Number(event.bytes) || 0));
      const depth = Math.max(0, Math.floor(Number(event.depth) || 0));
      if (!bytes) return;
      // One transaction: duplicate or out-of-order checkpoints add only new work.
      await db.batch([
        ...(event.learning && FAMILIES.includes(event.learning.family) && RECIPES.includes(event.learning.recipe) ? [
          run(`INSERT OR IGNORE INTO bait_learning_arm (family, recipe) VALUES (?, ?)`, event.learning.family, event.learning.recipe),
          run(`UPDATE bait_learning_arm SET
            held_ms = held_ms + max(0, ? - coalesce((SELECT held_ms FROM bait_tarpit_connection WHERE id = ?), 0)),
            bytes = bytes + max(0, ? - coalesce((SELECT bytes FROM bait_tarpit_connection WHERE id = ?), 0)),
            requests = requests + (NOT EXISTS(SELECT 1 FROM bait_tarpit_connection WHERE id = ?)),
            followups = followups + (? AND NOT EXISTS(SELECT 1 FROM bait_tarpit_connection WHERE id = ?)),
            credential_uses = credential_uses + (? AND NOT EXISTS(SELECT 1 FROM bait_tarpit_connection WHERE id = ?))
            WHERE family = ? AND recipe = ?`, held, event.connectionId, bytes, event.connectionId,
            event.connectionId, event.learning.followup ? 1 : 0, event.connectionId,
            event.learning.credentialUse ? 1 : 0, event.connectionId, event.learning.family, event.learning.recipe),
          run(`INSERT OR IGNORE INTO bait_learning_visit
            (id, at, site, path, actor, tool, family, recipe, plan_id, source_plan_id, credential_id, step, followup, credential_use, journey, observed_ms, method, evidence)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS(SELECT 1 FROM bait_tarpit_connection WHERE id = ?)`,
            event.connectionId, Math.floor(Date.parse(event.at) / 1000), clip(event.learning.site, 120),
            clip(event.learning.path, 200), event.learning.actor, event.learning.tool, event.learning.family,
            event.learning.recipe, event.learning.planId, event.learning.sourcePlanId || null,
            event.learning.credentialId || null, event.learning.step,
            event.learning.followup ? 1 : 0, event.learning.credentialUse ? 1 : 0,
            /^[a-f0-9]{24}$/.test(event.learning.journey || "") ? event.learning.journey : null,
            Number(event.learning.observedMs) || Date.parse(event.at), clip(event.learning.method, 10),
            event.learning.evidence ? clip(JSON.stringify(event.learning.evidence), 512) : null, event.connectionId),
          // Separate indexed range deletes. The previous OR + sorted OFFSET
          // scanned the retained history on every ten-second checkpoint.
          run(`DELETE FROM bait_learning_visit WHERE at < ?`, Math.floor(Date.now() / 1000) - 7 * 86400),
          // rowid is insertion order, not event time. Gaps can retain fewer than
          // the cap, never more. MAX(rowid) uses SQLite's integer primary key;
          // do not use last_insert_rowid(), which can belong to another table.
          run(`DELETE FROM bait_learning_visit WHERE rowid <=
            (SELECT max(rowid) FROM bait_learning_visit) - ?`, LEARNING_LIMITS.traceRows),
        ] : []),
        run(`UPDATE bait_tarpit SET
          held_ms = held_ms + max(0, ? - coalesce((SELECT held_ms FROM bait_tarpit_connection WHERE id = ?), 0)),
          bytes = bytes + max(0, ? - coalesce((SELECT bytes FROM bait_tarpit_connection WHERE id = ?), 0)),
          requests = requests + (NOT EXISTS(SELECT 1 FROM bait_tarpit_connection WHERE id = ?)),
          deep_requests = deep_requests + (? >= 2 AND NOT EXISTS(SELECT 1 FROM bait_tarpit_connection WHERE id = ?)),
          max_depth = max(max_depth, ?) WHERE id = 1`, held, event.connectionId, bytes, event.connectionId,
          event.connectionId, depth, event.connectionId, depth),
        run(`INSERT INTO bait_tarpit_connection (id, held_ms, bytes, depth, ended) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET held_ms = max(held_ms, excluded.held_ms), bytes = max(bytes, excluded.bytes),
          ended = coalesce(ended, excluded.ended)`, event.connectionId, held, bytes, depth, event.ended || null),
      ]);
      return;
    }
    const at = Math.floor(Date.parse(event.at) / 1000);
    const asn = Number(event.asn) || 0;
    if (event.type === "served") {
      await db.batch([
        ...(event.mazeTokens || []).map((token) => run(`INSERT INTO bait_maze_token
          (id, at, slot, file, ip, asn, country, plan_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET plan_id = coalesce(plan_id, excluded.plan_id)`, token.hash, at,
          token.slot, event.file, event.ip || null, asn, event.country || null, event.planId || null)),
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
    const [totals, files, slots, tokens, scrapers, users, networkCount, paths, sites, days, recent, notice, tarpit] = await Promise.all([
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
      run(`SELECT * FROM bait_tarpit WHERE id = 1`).first(),
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
      learning: await learningStats(),
      replays: await replays(),
      timeWasted: { milliseconds: tarpit?.held_ms || 0, seconds: (tarpit?.held_ms || 0) / 1000,
        measurement: "Observed response-stream lifetime; summed across connections. Checkpointed every 10 seconds. Abrupt termination can undercount." },
      computeBurned: { bytesGenerated: tarpit?.bytes || 0, requestsServed: tarpit?.requests || 0,
        deepRequests: tarpit?.deep_requests || 0, deepestLevel: tarpit?.max_depth || 0, deepStartsAt: 2,
        measurement: "Proxy: generated bytes handed to the response stream and maze requests at depth 2+. Not measured client CPU or confirmed downloads." },
      totals: {
        timeWastedMs: tarpit?.held_ms || 0, computeBurnedBytes: tarpit?.bytes || 0,
        tarpitRequests: tarpit?.requests || 0, deepMazeRequests: tarpit?.deep_requests || 0,
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
    if (snapshotOnly) {
      // This point lookup never initializes schema or rebuilds a report.
      const cached = await run(`SELECT body FROM bait_cache WHERE key = 'public-snapshot'`).first();
      if (!cached) throw new Error("No scheduled snapshot yet");
      const parsed = JSON.parse(cached.body);
      if (parsed.schema !== "bait-public-snapshot-v1" || !parsed.totals || !Number.isFinite(Date.parse(parsed.generatedAt)))
        throw new Error("Invalid saved snapshot");
      return parsed;
    }
    await ensure();
    const now = Math.floor(Date.now() / 1000);
    const cached = await run(`SELECT at, body FROM bait_cache WHERE key = 'stats'`).first();
    if (cached && now - cached.at < cacheSeconds) {
      const parsed = JSON.parse(cached.body);
      if (parsed.version === VERSION && parsed.learning && parsed.timeWasted && parsed.computeBurned) return parsed;
    }
    const fresh = await compute(options);
    await run(`INSERT INTO bait_cache (key, at, body) VALUES ('stats', ?, ?)
      ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body`, now, JSON.stringify(fresh)).run();
    return fresh;
  }

  async function refreshSnapshot({ owner = "anonymous" } = {}) {
    const now = Math.floor(nowMs() / 1000);
    // The existing cache table is initialized by normal installation/traffic.
    // A shared lease survives cold starts and coalesces duplicate cron deliveries.
    // Failed attempts wait a full interval too; no retry storm against exhausted D1.
    const lease = crypto.randomUUID();
    const acquired = await run(`INSERT INTO bait_cache (key, at, body) VALUES ('snapshot-refresh-lease', ?, ?)
      ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body
      WHERE bait_cache.at <= ? RETURNING body`, now, lease, now - 900).first();
    if (acquired?.body !== lease) return { refreshed: false, reason: "interval-not-elapsed" };
    // Fixed-size indexed reads, independent of the length of the visit history.
    // Detailed rankings/medians stay in the separate offline reports.
    const totals = await run(`SELECT * FROM bait_totals WHERE id = 1`).first();
    const tarpit = await run(`SELECT * FROM bait_tarpit WHERE id = 1`).first();
    const notice = await run(`SELECT value FROM bait_meta WHERE key = 'notice'`).first();
    if (!totals || !tarpit) throw new Error("Snapshot counters unavailable; keep the previous score");
    const recent = (await run(`SELECT r.*, n.org AS served_org, s.owner AS site_owner FROM bait_trip r
      LEFT JOIN bait_network n ON n.asn = r.served_asn LEFT JOIN bait_site s ON s.site = r.site
      ORDER BY r.id DESC LIMIT 20`).all()).results;
    const days = (await run(`SELECT day, served, trips FROM bait_day WHERE day >= ? ORDER BY day DESC LIMIT 30`, day(now - 29 * 86400)).all()).results;
    const network = (asn, org, country) => ({ asn: asn || null,
      org: CLOUDS[asn] || org || (asn ? `AS${asn}` : "Unknown network"), country: country || null });
    const snapshot = {
      schema: "bait-public-snapshot-v1", version: VERSION,
      notice: notice?.value || null,
      generatedAt: new Date(now * 1000).toISOString(), since: totals.since ? new Date(totals.since * 1000).toISOString() : null,
      snapshot: { intervalSeconds: 900, mode: "scheduled-summary", recentLimit: 20,
        detail: "Fresh stored counters and the latest 20 credential-use records. Historical rankings, medians, learning breakdowns and session replays are not recomputed by this endpoint." },
      timeWasted: { milliseconds: tarpit.held_ms, seconds: tarpit.held_ms / 1000,
        measurement: "Observed response-stream lifetime, summed across connections. Not client CPU or money." },
      computeBurned: { bytesGenerated: tarpit.bytes, requestsServed: tarpit.requests,
        deepRequests: tarpit.deep_requests, deepestLevel: tarpit.max_depth, deepStartsAt: 2,
        measurement: "Generated bytes handed to response streams and maze requests. Not verified downloads or measured client compute." },
      totals: { timeWastedMs: tarpit.held_ms, computeBurnedBytes: tarpit.bytes, tarpitRequests: tarpit.requests,
        deepMazeRequests: tarpit.deep_requests, scrapes: totals.served, backfilledScrapes: totals.backfilled,
        credentialsHandedOut: totals.minted, credentialsCameBack: totals.came_back, timesUsed: totals.trips,
        networks: null, sites: null, members: null, distinctPaths: null },
      recent: recent.map(r => ({ at: new Date(r.at * 1000).toISOString(), credential: r.slot, label: LABELS[r.slot] || r.slot,
        id: r.token_id, owner: r.site_owner || owner, where: r.where_found, method: r.method,
        path: r.path, usedBy: network(r.asn, r.org, r.country), scrapedBy: network(r.served_asn, r.served_org, r.served_country),
        secondsSinceScrape: r.seconds, userAgent: clip(r.user_agent, 80) })),
      daily: days.map(r => ({ day: r.day, scrapes: r.served, uses: r.trips })),
      learning: null, replays: null, speed: null,
    };
    await run(`INSERT INTO bait_cache (key, at, body) VALUES ('public-snapshot', ?, ?)
      ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body`, now, JSON.stringify(snapshot)).run();
    return { refreshed: true, generatedAt: snapshot.generatedAt };
  }

  async function lookupAccessKey(id) {
    await ensure();
    const row = await run(`SELECT ip, asn, country, site FROM bait_access_key WHERE id = ?`, id).first();
    return row ? { ip: row.ip, asn: row.asn || null, country: row.country } : null;
  }

  async function lookupMazeToken(id) {
    await ensure();
    const row = await run(`SELECT * FROM bait_maze_token WHERE id = ?`, id).first();
    return row ? { servedAt: new Date(row.at * 1000).toISOString(), servedAtMs: row.at * 1000,
      ip: row.ip, asn: row.asn || null, country: row.country, file: row.file, slot: row.slot, planId: row.plan_id || null } : null;
  }

  return { record, stats, compute, lookupAccessKey, lookupMazeToken, findPlan, assignPlan, observeProbe, learningStats,
    findHosting, enrollHosting, snapshotOnly, refreshSnapshot };
}

// ---------------------------------------------------------------------------
// The public leaderboard. Everything scanner-controlled (paths, user agents,
// network names) is inserted with textContent, never as markup.

export function dashboardPage() {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bait — Help yourself to nothing.</title>
<meta name="description" content="An endless fake filesystem for bots looking for your secrets. More fake loot. Slower responses. Their time, wasted.">
<meta property="og:title" content="Bait — Help yourself to nothing.">
<meta property="og:description" content="Fake secrets. Endless wrong turns. A very real score in wasted time.">
<meta name="theme-color" content="#f3f2ec">
<style>
:root{--paper:#f3f2ec;--ink:#23251f;--muted:#64675c;--line:#d3d5c9;--acid:#d7ef74;--white:#fcfcf7;--dark:#272b23;--mono:ui-monospace,SFMono-Regular,Consolas,monospace;--sans:"Helvetica Neue",Helvetica,Arial,sans-serif;color-scheme:light}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 var(--sans);-webkit-font-smoothing:antialiased}button,a,summary{-webkit-tap-highlight-color:transparent}button,input,textarea{font:inherit}button,a{touch-action:manipulation}button{cursor:pointer}a{color:inherit;text-underline-offset:4px}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #718a27;outline-offset:5px}button:disabled{opacity:.5;cursor:default}[hidden]{display:none!important}.wrap{width:min(1240px,calc(100% - 64px));margin:auto}.mono,.eyebrow{font:11px/1.5 var(--mono);letter-spacing:.08em;text-transform:uppercase}.muted{color:var(--muted)}
.top{display:flex;align-items:center;justify-content:space-between;padding:25px 0;border-bottom:1px solid var(--line);gap:24px}.brand{display:inline-flex;align-items:center;gap:12px;text-decoration:none}.mark{width:32px;height:32px}.wordmark{font-size:30px;font-weight:800;letter-spacing:-1.8px}.byline{border-left:1px solid var(--line);margin-left:5px;padding-left:14px;font:12px var(--mono);color:var(--muted)}nav{display:flex;gap:27px;align-items:center;font-size:13px}nav a{text-decoration:none}nav a:hover{text-decoration:underline}.nav-cta{border:1px solid var(--ink);padding:9px 14px;border-radius:3px}
.hero{display:grid;grid-template-columns:1.15fr 1fr;gap:80px;align-items:center;padding:76px 0 70px}.eyebrow{margin:0 0 24px;color:var(--muted)}.eyebrow .dot{display:inline-block;width:6px;height:6px;background:currentColor;border-radius:50%;margin:0 9px 2px 0}h1{font-size:clamp(60px,6.8vw,96px);line-height:.96;font-weight:650;letter-spacing:-.068em;margin:0 0 28px;max-width:650px}h1 span{display:block}h1 .nothing{display:inline;background:linear-gradient(transparent 64%,var(--acid) 64%);padding-right:.07em}.lede{font-size:18px;line-height:1.65;max-width:465px;color:var(--muted);margin:0 0 26px}.lede b{font-weight:500;color:var(--ink)}.actions{display:flex;align-items:center;gap:23px;flex-wrap:wrap}.button{border:1px solid var(--ink);border-radius:3px;background:var(--ink);color:var(--white);padding:13px 19px;font-size:14px;font-weight:500;display:inline-flex;align-items:center;justify-content:space-between;gap:25px;text-decoration:none}.button:hover{background:#414637}.button.light{background:var(--acid);color:var(--ink);border-color:transparent}.button.light:hover{background:#e3fa93}.text-link{font-size:13px}.small{font-size:12px;color:var(--muted)}
.receipt{position:relative;background:var(--acid);padding:30px 34px 27px;border-radius:4px;transform:rotate(1deg);box-shadow:8px 10px 0 #22251c0b;isolation:isolate}.receipt:before{content:"";position:absolute;top:-9px;left:41%;width:88px;height:25px;background:#eceddbb5;transform:rotate(-3deg)}.receipt-head{display:flex;justify-content:space-between;gap:12px;padding-bottom:22px;border-bottom:1px dashed #778442}.receipt .eyebrow{color:#3b4a22;margin:0}.receipt-status{display:flex;gap:6px;align-items:center;font:10px var(--mono);text-align:right}.receipt-status:before{content:"";width:5px;height:5px;border-radius:50%;background:#465d21;flex-shrink:0}.score-label{font:12px var(--mono);margin:25px 0 5px}.score{font-size:clamp(48px,5.8vw,81px);line-height:1.1;font-weight:550;letter-spacing:-.055em;font-variant-numeric:tabular-nums}.score small{font-size:22px;font-weight:400;letter-spacing:-.03em;margin-left:7px}.score-note{font-size:12px;color:#465433;margin:8px 0 0}.score-secondary{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-top:24px;padding:20px 0;border-top:1px dashed #778442;border-bottom:1px dashed #778442}.score-secondary .score-label{margin:0 0 4px}.score-secondary .score{font-size:39px;white-space:nowrap}.receipt-foot{display:flex;align-items:end;justify-content:space-between;gap:20px;padding-top:19px}.receipt-foot p{margin:0;max-width:200px;font-size:11px;color:#465433}.copy-score{border:0;background:none;padding:4px 0;text-align:right;text-decoration:underline;text-underline-offset:4px;font-size:12px;color:var(--ink)}
.evidence{display:grid;grid-template-columns:1.3fr repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:24px 0;align-items:center;gap:30px}.evidence-title{font-size:15px;max-width:185px}.evidence .value{font-size:32px;font-weight:500;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.evidence p{font-size:12px;color:var(--muted);margin:2px 0 0}.source-note{font:10px/1.5 var(--mono);color:var(--muted);margin:11px 0 0}.notice{margin:0 0 22px;padding:14px 18px;border:1px solid #9d6d38;background:#faf0dc;font-size:13px}.notice strong{margin-right:9px}.section{padding:85px 0;border-bottom:1px solid var(--line)}.section-head{display:flex;justify-content:space-between;align-items:end;gap:35px;margin-bottom:35px}.section-head .eyebrow{margin-bottom:15px}h2{font-size:clamp(34px,4vw,52px);font-weight:500;line-height:1.06;letter-spacing:-.05em;margin:0}h3{font-size:20px;line-height:1.2;font-weight:500;letter-spacing:-.035em;margin:0 0 12px}.section-head>p{max-width:375px;margin:0;font-size:14px;color:var(--muted)}
.trap{display:grid;grid-template-columns:1.5fr 1fr;gap:50px;align-items:start}.terminal{background:var(--dark);color:#e7ebde;border-radius:5px;overflow:hidden;box-shadow:0 12px 32px #22251c0a}.terminal-bar{display:flex;justify-content:space-between;align-items:center;padding:15px 21px;border-bottom:1px solid #494e40;color:#bdc4af;font:10px var(--mono);letter-spacing:.03em;gap:12px}.terminal-bar span:first-child{display:flex;align-items:center;gap:6px}.lamp{display:block;background:#626955;width:6px;height:6px;border-radius:50%}.terminal-bar .sample{color:var(--acid);text-align:right}.tabs{display:flex;gap:0;border-bottom:1px solid #494e40;padding:0 18px}.tabs button{border:0;border-bottom:2px solid transparent;background:none;color:#b9c1ab;padding:14px 12px;font:12px var(--mono)}.tabs button[aria-pressed=true]{color:var(--acid);border-bottom-color:var(--acid)}.file-view{min-height:226px;padding:23px 24px}.file-path{font:11px var(--mono);color:#a8b299;margin-bottom:16px;overflow-wrap:anywhere}.file-view pre{font:12px/1.95 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;margin:0;color:#e1e8d5}.file-view pre::first-line{color:var(--acid)}.terminal-action{padding:19px 24px;border-top:1px solid #494e40;display:flex;align-items:center;justify-content:space-between;gap:20px}.terminal-action p{margin:0;color:#a8b299;font:11px var(--mono)}.terminal-action .button{font-size:12px;padding:10px 13px;gap:16px}.reset{background:none;border:0;color:var(--muted);padding:0;text-decoration:underline;font-size:12px}.demo-caption{display:flex;justify-content:space-between;gap:14px;font-size:11px;color:var(--muted);margin-top:14px}.steps{margin:0;padding:0;list-style:none;counter-reset:steps}.steps li{position:relative;padding:0 0 29px 42px;counter-increment:steps}.steps li:last-child{padding-bottom:0}.steps li:before{content:"0" counter(steps);position:absolute;left:0;top:1px;color:var(--muted);font:11px var(--mono)}.steps li:not(:last-child):after{content:"";position:absolute;left:8px;top:26px;bottom:12px;width:1px;background:var(--line)}.steps p{font-size:14px;color:var(--muted);margin:0;max-width:330px}.proof{margin-top:29px;background:#e6e8dd;border-left:2px solid #88916f;padding:15px 18px;font-size:12px;line-height:1.7;color:#515a42}.proof p{margin:0}.proof strong{font-weight:500;color:var(--ink)}
.direction-grid{display:grid;grid-template-columns:.9fr 1.5fr;gap:90px}.direction-intro>p{font-size:16px;color:var(--muted);margin:22px 0 0;max-width:360px}.roadmap{list-style:none;padding:0;margin:0}.roadmap li{display:grid;grid-template-columns:100px 1fr;gap:20px;border-bottom:1px solid var(--line);padding:24px 0}.roadmap li:first-child{padding-top:0}.roadmap li:last-child{border-bottom:0;padding-bottom:0}.status{font:10px var(--mono);letter-spacing:.04em;text-transform:uppercase;display:inline-block;border:1px solid #b9c0aa;padding:5px 7px;height:fit-content;width:fit-content}.status.next{border-style:dashed;color:var(--muted)}.roadmap h3{font-size:19px;margin-bottom:8px}.roadmap p{font-size:14px;color:var(--muted);margin:0}.learning-note{margin-top:13px!important;font:11px/1.6 var(--mono)!important;color:#526232!important}.loot{display:flex;flex-wrap:wrap;gap:6px;margin-top:15px}.loot span{font:10px var(--mono);border:1px solid var(--line);padding:5px 8px;border-radius:2px;color:var(--muted)}
.install{margin:70px 0 45px;background:var(--dark);color:var(--white);padding:42px 45px;border-radius:5px;display:grid;grid-template-columns:1fr 1fr;gap:70px;align-items:center}.install .eyebrow{color:#b9c3a9;margin-bottom:16px}.install h2{font-size:42px}.install p{color:#b9c3a9;font-size:14px;max-width:380px;margin:18px 0 0}.install-box{border:1px solid #515a46;border-radius:3px;padding:19px}.install-box label{font:10px var(--mono);text-transform:uppercase;letter-spacing:.04em;color:#b9c3a9;display:block;margin-bottom:13px}.install-box textarea{width:100%;resize:none;border:0;background:none;color:#e8ecdf;font:12px/1.7 var(--mono);height:105px;padding:0;outline-offset:5px}.install-box .button{width:100%;margin-top:12px}.install-links{display:flex;gap:22px;font-size:12px;margin-top:16px;color:#b9c3a9}
.details{border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:32px}.details summary{cursor:pointer;list-style:none;padding:19px 0;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:20px}.details summary::-webkit-details-marker{display:none}.details summary:after{content:"+";font:20px var(--mono)}.details[open] summary:after{content:"−"}.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:35px;padding-bottom:25px;font-size:12px;color:var(--muted)}.details-grid h3{font-size:16px;color:var(--ink)}.details-grid p{margin:0 0 12px}.details-grid dl{display:grid;grid-template-columns:1fr auto;gap:9px;margin:0}.details-grid dd{margin:0;color:var(--ink);font-variant-numeric:tabular-nums}footer{display:flex;justify-content:space-between;gap:24px;padding-bottom:36px;font:11px var(--mono);color:var(--muted)}footer a{margin-left:20px}.no-js{padding:14px;background:var(--acid)}
@media(max-width:1050px){.hero{gap:40px}h1{font-size:74px}.score{font-size:65px}.trap{gap:30px}.direction-grid{gap:45px}.install{gap:35px}.byline{display:none}}
@media(max-width:760px){.wrap{width:calc(100% - 38px)}.top{padding:19px 0}nav{gap:16px}nav a:not(.nav-cta){display:none}.hero{grid-template-columns:1fr;padding:44px 0 40px;gap:38px}h1{font-size:clamp(57px,12vw,86px);max-width:600px}.lede{font-size:16px;max-width:500px}.receipt{transform:none;padding:25px 25px 22px;max-width:540px}.score{font-size:67px}.score-label{margin-top:20px}.score-secondary{margin-top:19px}.evidence{grid-template-columns:repeat(3,1fr);gap:18px;padding:21px 0}.evidence-title{grid-column:1/-1;max-width:none;font-size:13px}.evidence .value{font-size:27px}.evidence p{font-size:11px}.section{padding:54px 0}.section-head{display:block;margin-bottom:27px}.section-head>p{margin-top:19px;max-width:450px}.trap,.direction-grid{grid-template-columns:1fr;gap:35px}.steps{display:grid;grid-template-columns:1fr;gap:0}.steps p{max-width:none}.file-view{padding:20px;min-height:217px}.terminal-action{padding:17px 20px}.direction-intro>p{max-width:none}.roadmap li{grid-template-columns:86px 1fr;gap:14px}.install{grid-template-columns:1fr;margin-top:48px;padding:29px 24px;gap:28px}.install h2{font-size:38px}.install-box{padding:15px}.details-grid{grid-template-columns:1fr;gap:20px}footer{display:block;line-height:2}footer div{margin-top:9px}footer a{margin-left:0;margin-right:18px}}
.replays{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:22px}.replay{border:1px solid var(--line);padding:25px;border-radius:4px;min-width:0}.replay h3{font-size:25px}.replay ol{padding-left:20px;font-size:13px;color:var(--muted)}.replay li{padding:5px 0}.replay time{display:block;font:10px var(--mono)}.replay button{border:0;background:none;color:var(--ink);padding:8px 0;text-decoration:underline}.replay button:disabled{color:var(--muted);cursor:default}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
<a class="brand" href="https://tryusual.com/bait/" aria-label="Bait by Usual"><svg class="mark" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 28V4h24v24H11V12h8v8" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg><span class="wordmark">Bait</span><span class="byline">a little spite, by usual.</span></a>
<nav aria-label="Main"><a href="#trap">The trap</a><a href="#direction">What's next</a><a class="nav-cta" href="#install">Put it on my site ↗</a></nav>
</header>
<main>
<div class="hero">
<div><p class="eyebrow"><span class="dot"></span>For bots with bad intentions</p>
<h1><span>Help yourself</span><span>to <span class="nothing">nothing.</span></span></h1>
<p class="lede">They came looking for your secrets. <b>Give them an endless supply of fake ones.</b> More files. More wrong turns. All served very, very slowly.</p>
<div class="actions"><a class="button" href="#trap">Take a wrong turn <span aria-hidden="true">↓</span></a><a class="text-link" href="#install">Get Bait for your site</a></div></div>
<aside class="receipt" id="score" aria-label="The real tarpit score">
<div class="receipt-head"><p class="eyebrow">Their time. Our receipt.</p><span class="receipt-status" id="live" role="status">Loading stats</span></div>
<p class="score-label">Time wasted</p><div class="score"><span id="wasted">—</span><small id="wasted-unit">hours</small></div>
<p class="score-note" id="wasted-detail">Connection time we actually held.</p>
<div class="score-secondary"><div><p class="score-label">Compute burned</p><div class="score"><span id="burned">—</span><small id="burned-unit">bytes</small></div></div><p class="score-note">Fake loot streamed.<br>Busywork, by the byte.</p></div>
<div class="receipt-foot"><p>Measured time and bytes.<br>No pretend dollar bill.</p><button class="copy-score" id="copy-score" disabled>Copy the score ↗</button></div>
</aside>
</div>
<div class="notice" id="notice" hidden></div>
<div class="evidence" aria-label="What has actually happened">
<div class="evidence-title" id="evidence-title">The evidence<br>so far.</div>
<div><div class="value" id="probes">—</div><p>requests for secrets</p></div>
<div><div class="value" id="returned">—</div><p>fake credentials came back</p></div>
<div><div class="value" id="uses">—</div><p>attempts to use them</p></div>
</div>
<p class="source-note" id="asof">Fetching the recorded score. Nothing here counts up on its own.</p>
<noscript><p class="no-js">JavaScript loads the recorded score and the interactive example. The <a href="stats.json">raw stats JSON</a> is available directly.</p></noscript>
<section class="section" id="trap">
<div class="section-head"><div><p class="eyebrow">01 / A room with no far wall</p><h2>One more file.<br>One more jackpot.</h2></div><p>A config points to a repo. The repo points to an export. The export has another page. It's all ours. It's all nonsense.</p></div>
<div class="trap">
<div><div class="terminal">
<div class="terminal-bar"><span><i class="lamp"></i><i class="lamp"></i><i class="lamp"></i> /production</span><span class="sample">INTERACTIVE EXAMPLE · NOT LIVE TRAFFIC</span></div>
<div class="tabs" role="group" aria-label="Choose the kind of fake loot"><button type="button" aria-pressed="true" data-room="env">.env</button><button type="button" aria-pressed="false" data-room="git">repo.git</button><button type="button" aria-pressed="false" data-room="api">exports.json</button></div>
<div class="file-view" aria-live="polite"><div class="file-path" id="demo-path">/production/.env</div><pre id="demo-code"># the next config is one level deeper
APP_ENV=production
CONFIG_INCLUDE=/archive/1/.env
API_KEY=example-not-a-real-credential</pre></div>
<div class="terminal-action"><p id="demo-depth">You're at the entrance.</p><button class="button light" id="next-door">Open the next file <span aria-hidden="true">↗</span></button></div>
</div><div class="demo-caption"><span>This example stays in your browser. It never touches the score.</span><button class="reset" id="reset-demo">Start over</button></div></div>
<div><ol class="steps"><li><h3>Leave something worth stealing.</h3><p>Fake keys, convincing configs, a Git repo that really clones. The jackpot just happens to be worthless.</p></li><li><h3>Always leave another door.</h3><p>Every piece of loot points deeper into our fake filesystem. There's no final folder to reach.</p></li><li><h3>Make them wait for it.</h3><p>The live trap trickles out the bytes. When they leave, the clock stops. We keep the time we actually observed.</p></li></ol>
<div class="proof"><p id="depth-proof">The real depth count will appear here. Opening this example won't change it.</p></div></div>
</div>
</section>
<section class="section" id="replays">
<div class="section-head"><div><p class="eyebrow">02 / They kept going</p><h2>Their visit.<br>Our souvenir.</h2></div><p>A fake login. A fake company. Another export to wait for. These are recorded requests from the same signed session.</p></div>
<div class="replays" id="replay-list"><p class="small">Loading recorded visits. No stories have been filled in.</p></div>
<p class="source-note">Up to six visits from the last seven days; first twelve steps shown. Times add across connections. A request isn't proof that someone read the page, and a session isn't a unique person or bot.</p>
</section>
<section class="section" id="direction">
<div class="direction-grid">
<div class="direction-intro"><p class="eyebrow">03 / Where the spite goes next</p><h2>Every wrong turn<br>makes better bait.</h2><p>The product we're building: a growing network of traps that learns what bots want, hands them garbage, and gets better at keeping them busy.</p><div class="loot"><span>Fake secrets</span><span>Git history</span><span>Fake companies</span><span>Slow exports</span></div></div>
<ol class="roadmap"><li><span class="status">Built</span><div><h3>An endless fake filesystem.</h3><p>Stable fake loot, more doors at every level, and a score built from actual response time and bytes.</p></div></li><li><span class="status">Built</span><div><h3>Traps that learn from the last visitor.</h3><p>Measure what gets opened and which fake keys come back. Favor the bait that earns more time; keep trying the others.</p><p class="learning-note" id="learning-note">Waiting for the recorded learning results.</p></div></li><li><span class="status next">Next</span><div><h3>Make it easy to join the mischief.</h3><p>Bring your site into a shared network. See what your traps contributed. Turn what worked on one site into better bait for the next.</p></div></li><li><span class="status next">Next</span><div><h3>More kinds of bot. More kinds of bait.</h3><p>Use the unfamiliar probes we're seeing to build more convincing fake places for them to get lost.</p></div></li></ol>
</div>
</section>
<section class="install" id="install">
<div><p class="eyebrow">Start with your own site</p><h2>They waste your time.<br>Return the favor.</h2><p>Bait is open source. Put it on a site you control, give the secret scanners somewhere to go, and start counting.</p><div class="install-links"><a href="https://tryusual.com/bait/install">Read the install guide ↗</a><a href="https://github.com/pauljump/usual/blob/main/src/usual/bait/bait.js">View source ↗</a></div></div>
<div class="install-box"><label for="install-prompt">Give this to your coding agent</label><textarea id="install-prompt" readonly spellcheck="false">Read https://tryusual.com/bait/install and add Bait to my website. Enable the tarpit and learning loop where supported. Check my hosting and show me the deployment plan and costs before publishing.</textarea><button class="button light" id="copy-install">Copy install prompt <span aria-hidden="true">↗</span></button><span id="copy-status" class="small" role="status"></span></div>
</section>
<details class="details"><summary>The receipts, without the theater <span class="mono">How we count</span></summary><div class="details-grid"><div><h3>Real observations. Specific limits.</h3><p>Time wasted is observed response-stream lifetime, added across connections. Bytes are handed to the stream, not confirmed downloads or measured bot CPU. Abrupt disconnects can leave time uncounted. Human requests to the traps count too.</p><p>Fake-key reuse is a request containing a credential we issued. It isn't proof of a unique bot, a real person, or money lost. Network names tell us where a request came from, not who sent it.</p><p>The maze above is a browser example. It creates no requests to the trap and earns no points.</p><a id="json" href="stats.json">Open the recorded score JSON ↗</a></div><div><h3>The rest of the score</h3><dl><dt>Tarpit requests</dt><dd id="detail-requests">—</dd><dt>Requests two or more levels deep</dt><dd id="detail-deep">—</dd><dt>Deepest level requested</dt><dd id="detail-depth">—</dd><dt>Networks observed</dt><dd id="detail-networks">—</dd><dt>Probe paths added to the bait menu</dt><dd id="detail-promoted">—</dd><dt>Unfamiliar paths queued for review</dt><dd id="detail-review">—</dd></dl></div></div></details>
</main>
<footer><span>Built out of spite. All on our own turf.</span><div><a href="https://tryusual.com/">usual.</a><a href="https://github.com/pauljump/usual">MIT / Open source</a></div></footer>
</div>
<script>
(function(){
'use strict';
var base=location.pathname.replace(/\/?$/,'/'),last=null,room='env',depth=0;
var $=function(id){return document.getElementById(id)};
var text=function(id,value){$(id).textContent=value};
var num=function(value,digits){return new Intl.NumberFormat('en-US',{maximumFractionDigits:digits===undefined?0:digits}).format(value)};
var valid=function(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0};
function value(id,v){text(id,valid(v)?num(v):'—')}
function bytes(v){var units=['B','KB','MB','GB','TB'],i=0;while(v>=1000&&i<units.length-1){v/=1000;i++}return [num(v,2),units[i]]}
function renderReplays(s){
 var list=$('replay-list');list.replaceChildren();
 var items=s.replays&&Array.isArray(s.replays.items)?s.replays.items:[];
 if(!items.length){var empty=document.createElement('p');empty.className='small';empty.textContent=s.snapshot?'The score is saved here. Detailed visit stories live in the separate report.':'No recorded company visits yet. The first story still has to happen.';list.append(empty);return;}
 items.forEach(function(item){
  var card=document.createElement('article');card.className='replay';card.id='visit-'+item.id;
  var title=document.createElement('h3');title.textContent=num(item.timeWastedMs/1000,1)+' seconds wasted';
  var caption=document.createElement('p');caption.className='small';caption.textContent=(s.notice?'LOCAL TEST · ':s.preview?'SAVED SNAPSHOT · ':'')+num(item.requests)+' requests · '+bytes(item.bytesGenerated).join(' ')+' of fake loot';
  var steps=document.createElement('ol');
  item.steps.forEach(function(step){var li=document.createElement('li'),at=document.createElement('time');at.dateTime=step.at;at.textContent=new Date(step.at).toLocaleString();li.textContent=step.action;li.append(at);steps.append(li)});
  var button=document.createElement('button');button.textContent='Copy this visit ↗';button.disabled=Boolean(s.notice)||Boolean(s.preview);
  button.addEventListener('click',function(){if(this.disabled)return;copy('One Bait session: '+num(item.requests)+' requests, '+num(item.timeWastedMs/1000,1)+' seconds of connection time wasted.\\n\\n'+item.steps.map(function(step){return step.action}).join(' → ')+'\\n\\nFake company. Real busywork.\\nhttps://tryusual.com/bait/live/#visit-'+item.id,this,'Copied ↗')});
  card.append(title,caption,steps,button);list.append(card);
 });
}
function render(s){
 if(!s||!s.totals)throw new Error('Stats are incomplete');
 var t=s.totals,w=s.timeWasted,b=s.computeBurned,l=s.learning,simulated=/^SIMULATED/i.test(s.notice||'');
 $('score').setAttribute('aria-label',simulated?'Local test score':'The real tarpit score');
 value('probes',t.scrapes);value('returned',t.credentialsCameBack);value('uses',t.timesUsed);
 text('evidence-title',simulated?'Local test data.':t.scrapes>0?'They actually took the bait.':'Waiting for the first visitor.');
 text('wasted',w&&valid(w.seconds)?num(w.seconds/3600,2):'—');
 text('wasted-detail',w&&valid(w.seconds)?num(w.seconds,3)+' seconds of observed connection time.':'No measured time available.');
 var size=b&&valid(b.bytesGenerated)?bytes(b.bytesGenerated):['—','bytes'];text('burned',size[0]);text('burned-unit',size[1]);
 value('detail-requests',b&&b.requestsServed);value('detail-deep',b&&b.deepRequests);value('detail-depth',b&&b.deepestLevel);value('detail-networks',t.networks);value('detail-promoted',l&&l.promotedPaths);value('detail-review',l&&l.reviewCandidates);
 text('depth-proof',b&&valid(b.deepRequests)?(b.deepRequests===0?'Real traffic: no recorded requests two levels deep yet. The next wrong turn still has to be earned.':num(b.deepRequests)+' real requests reached two or more levels deep. Deepest level requested: '+num(b.deepestLevel)+'.'):'Maze depth data is not available yet.');
 var lessons=l&&Array.isArray(l.recipes)?l.recipes.reduce(function(n,r){return n+(valid(r.requests)?r.requests:0)},0):null;
 text('learning-note',lessons===null?(s.snapshot?'The score updates here. The longer story stays in the separate report.':'Learning results are not available yet.'):lessons===0?'No measured lessons yet. The first result still has to be earned.':num(lessons)+' measured fetches · '+num(l.promotedPaths||0)+' paths added to the bait menu.');
 $('notice').hidden=!s.notice;text('notice',s.notice||'');
 if(simulated){text('depth-proof','Simulated local data. No public traffic is represented here.');text('learning-note','Simulated local data. No public learning results are represented here.');}
 var at=new Date(s.generatedAt),hasDate=!Number.isNaN(at.valueOf()),preview=Boolean(s.preview),stale=!hasDate||Date.now()-at.valueOf()>(s.snapshot?1200000:180000);
 text('live',simulated?'Local test data':preview?'Recorded snapshot':stale?'Last recorded score':s.snapshot?'Saved score · every 15 min':'Live score');
 text('asof',(simulated?'Simulated local test data. ':preview?'Local preview · real recorded snapshot. ':stale?'Last available snapshot. ':'Real counts. ')+(hasDate?'Recorded '+at.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})+'.':'Timestamp unavailable.'));
 renderReplays(s);
 last=s;$('copy-score').disabled=Boolean(s.notice)||Boolean(s.preview)||!(w&&valid(w.seconds)&&b&&valid(b.requestsServed));
}
function load(){fetch(base+'stats.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('Stats unavailable');return r.json()}).then(render).catch(function(){text('live','Stats unavailable');text('asof',last?'Could not refresh. Score recorded '+new Date(last.generatedAt).toLocaleString()+'. Retrying in a minute.':'Could not load the score. Retrying in a minute. No numbers have been filled in.');if(!last)$('copy-score').disabled=true})}
function demo(){
 var next=depth+1,root='/archive/'+depth+'/',code,path;
 if(room==='git'){path=root+'repo.git/config';code='# another release, one level deeper\n[remote "origin"]\n  url = /archive/'+next+'/repo.git\n[deployment]\n  config = /archive/'+next+'/.env';}
 else if(room==='api'){path=root+'exports.json';code=JSON.stringify({data:[{file:'production-config',status:'archived'}],next:'/archive/'+next+'/exports.json',has_more:true},null,2);}
 else{path=root+'.env';code='# the next config is one level deeper\nAPP_ENV=production\nCONFIG_INCLUDE=/archive/'+next+'/.env\nAPI_KEY=example-not-a-real-credential\nEXPORT_INDEX=/archive/'+next+'/exports.json';}
 text('demo-path',path);text('demo-code',code);text('demo-depth',depth===0?"You're at the entrance.":'Level '+num(depth)+'. Still no bottom.');
 document.querySelectorAll('[data-room]').forEach(function(button){button.setAttribute('aria-pressed',String(button.dataset.room===room))});
}
async function copy(content,button,done){var original=button.textContent;try{if(!navigator.clipboard)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(content);button.textContent=done;setTimeout(function(){button.textContent=original},2500)}catch(e){if(button.id==='copy-install'){text('copy-status','Select and copy the install prompt above.');$('install-prompt').select()}else button.textContent='Copy unavailable';}}
$('next-door').addEventListener('click',function(){depth=depth<Number.MAX_SAFE_INTEGER?depth+1:0;demo()});
$('reset-demo').addEventListener('click',function(){depth=0;room='env';demo()});
 document.querySelectorAll('[data-room]').forEach(function(button){button.addEventListener('click',function(){room=button.dataset.room;demo()})});
$('copy-install').addEventListener('click',function(){copy($('install-prompt').value,this,'Copied. Go lay some bait. ↗')});
$('copy-score').addEventListener('click',function(){if(!last||this.disabled)return;copy('Bait: '+num(last.timeWasted.seconds/3600,2)+' hours of connection time wasted across '+num(last.computeBurned.requestsServed)+' tarpit requests. Fake loot. Real busywork.\n\nhttps://tryusual.com/bait/live/',this,'Copied ↗')});
$('json').href=base+'stats.json';demo();load();setInterval(load,60000);
})();
</script>
</body></html>
`;
}

let workerBait = null;

// Cache one canonical saved score, regardless of query strings or HEAD requests.
// A miss reads one stored row. It never starts a report build. Cache retention is
// best-effort; keep the original generatedAt even when serving an older score.
export function snapshotResponder({ cache, read, nowMs = Date.now }) {
  let pending, lastResponse, retryAt = 0;
  return async function respond(request) {
    const url = new URL(request.url); url.search = "";
    const key = new Request(url.toString());
    const bodyOnly = r => {
      const result = new Response(request.method === "HEAD" ? null : r.body, r);
      result.headers.set("cache-control", "no-store");
      return result;
    };
    if (lastResponse && nowMs() < retryAt) return bodyOnly(lastResponse.clone());
    const previous = cache ? await cache.match(key).catch(() => undefined) : undefined;
    const checked = Number(previous?.headers.get("x-bait-checked-at") || 0);
    if (previous && nowMs() - checked < 300000) return bodyOnly(previous);
    if (!pending) pending = (async () => {
      let response;
      try {
        const score = await read();
        response = new Response(JSON.stringify(score), { headers: {
          "content-type": "application/json", "access-control-allow-origin": "*",
          "cache-control": "public, max-age=86400", "x-bait-checked-at": String(nowMs()),
        } });
      } catch {
        if (previous) {
          response = new Response(previous.body, previous);
          response.headers.set("x-bait-checked-at", String(nowMs()));
          response.headers.set("x-bait-refresh", "unavailable");
        } else response = new Response(JSON.stringify({ error: "The score is taking its time. No numbers filled in." }), {
          status: 503, headers: { "content-type": "application/json", "retry-after": "300", "cache-control": "no-store" } });
      }
      // Do not extend stale retention indefinitely on failures.
      if (cache && response.ok && !response.headers.has("x-bait-refresh"))
        await cache.put(key, response.clone()).catch(() => {});
      lastResponse = response.clone();
      retryAt = nowMs() + 300000;
      return response;
    })().finally(() => { pending = undefined; });
    const result = (await pending).clone();
    result.headers.set("cache-control", "no-store");
    return bodyOnly(result);
  };
}

let workerSnapshot;

// Cloudflare Worker: route it at example.com/* and everything else passes to your origin.
export default {
  async scheduled(event, env) {
    if (env.BAIT_SNAPSHOTS !== "true" || event.cron !== "*/15 * * * *" || !env.BAIT_DB) return;
    await d1Store(env.BAIT_DB).refreshSnapshot({ owner: env.BAIT_OWNER || "anonymous" });
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (env.BAIT_SNAPSHOTS === "true" && env.BAIT_DB && ["GET", "HEAD"].includes(request.method)
        && dashboardMatch(env.BAIT_DASHBOARD, url.host, url.pathname) === "stats") {
      workerSnapshot ||= snapshotResponder({ cache: globalThis.caches?.default,
        read: () => d1Store(env.BAIT_DB, { snapshotOnly: true }).stats() });
      return workerSnapshot(request);
    }
    workerBait ||= createBait({
      secret: env.BAIT_SECRET, store: env.BAIT_DB ? d1Store(env.BAIT_DB, { snapshotOnly: env.BAIT_SNAPSHOTS === "true" }) : undefined, owner: env.BAIT_OWNER || undefined,
      dashboard: env.BAIT_DASHBOARD || undefined, report: env.BAIT_REPORT || undefined, shareIps: env.BAIT_SHARE_IPS === "true",
      drip: Number(env.BAIT_DRIP || 0), wink: env.BAIT_WINK === "true",
      tarpit: env.BAIT_TARPIT === "true", tarpitSeconds: Number(env.BAIT_TARPIT_SECONDS || 120),
      learning: env.BAIT_LEARNING === "true", maxActiveTarpits: Number(env.BAIT_MAX_ACTIVE_TARPITS || 16),
      loginExperimentUntil: env.BAIT_LOGIN_EXPERIMENT_UNTIL,
      loginExperimentHosts: (env.BAIT_LOGIN_EXPERIMENT_HOSTS || "").split(",").map(h => h.trim()).filter(Boolean),
      awsCanary: env.BAIT_AWS_KEY_ID && env.BAIT_AWS_SECRET
        ? { accessKeyId: env.BAIT_AWS_KEY_ID, secretAccessKey: env.BAIT_AWS_SECRET } : undefined,
    });
    return workerBait.handleWithOrigin(request, (req) => fetch(req), { waitUntil: (p) => ctx.waitUntil(p) });
  },
};

export const _internal = { TOKEN_LENGTH, FILES, FILE_SLOTS, WATCHABLE, SLOTS, seal, open, keyFrom, base62, unbase62, ipBytes, ipText,
  probeFamily, chooseRecipe, gitRepository, gitReply, apiReply, hostingLogin, hostingOperation };
