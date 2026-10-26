import { outline } from "./sections.js";
// Storage over a tiny SQL interface, so the same queries run on Cloudflare D1
// in production and on node:sqlite locally and in tests.

export interface SqlDb {
  run(sql: string, params?: unknown[]): Promise<void>;
  first<T>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS digests (
  key           TEXT PRIMARY KEY,
  url           TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  recipe        TEXT NOT NULL,
  title         TEXT NOT NULL,
  digest_json   TEXT NOT NULL,
  page_tokens   INTEGER NOT NULL,
  digest_tokens INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL,
  domain        TEXT NOT NULL,
  digest_key    TEXT NOT NULL,
  agent         TEXT NOT NULL,
  hit           INTEGER NOT NULL,
  tokens_saved  INTEGER NOT NULL,
  at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reads_url ON reads (url, at);
CREATE INDEX IF NOT EXISTS reads_domain ON reads (domain, at);
CREATE INDEX IF NOT EXISTS reads_at ON reads (at);
CREATE INDEX IF NOT EXISTS digests_url_created ON digests (url, created_at);
CREATE TABLE IF NOT EXISTS source_chunks (
  digest_key TEXT NOT NULL, part INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (digest_key, part)
);
CREATE TABLE IF NOT EXISTS source_snapshots (digest_key TEXT PRIMARY KEY, outline TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_aliases (url TEXT PRIMARY KEY, canonical_url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS internal_agents (
  agent TEXT PRIMARY KEY, label TEXT NOT NULL, marked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS library (
  url TEXT PRIMARY KEY, collection TEXT NOT NULL, status TEXT NOT NULL,
  detail TEXT NOT NULL, checked_at INTEGER NOT NULL
);
`;

export interface DigestRow {
  key: string;
  url: string;
  content_hash: string;
  recipe: string;
  title: string;
  digest_json: string;
  page_tokens: number;
  digest_tokens: number;
  created_at: number;
}

export interface ReadRow {
  url: string;
  domain: string;
  digest_key: string;
  agent: string; // salted hash, never a raw id or IP
  hit: boolean;
  tokens_saved: number;
  at: number;
}

export interface PageStats {
  reads: number;
  agents: number;
  tokens_saved: number;
  first_read_at: number | null;
}

export interface PublicPage {
  title: string | null;
  url: string;
  domain: string;
  reads: number;
  agents: number;
  tokens_saved: number;
}

// A page only shows up on public surfaces once this many different agents
// have read it, so one person's browsing never appears in the feed.
export const PUBLIC_MIN_AGENTS = 3;

// Reads by agents an admin marked as internal (tests, verification, seeding)
// stay in the reads table but never count on public surfaces or receipts.
const COUNTED = "agent NOT IN (SELECT agent FROM internal_agents)";

export interface AgentSummary {
  agent: string; reads: number; pages: number; first_at: number; last_at: number;
  sample_urls: string; internal: number; label: string | null;
}

export interface LibraryEntry {
  url: string; collection: string; status: string; detail: string;
  checked_at: number; title: string | null; source: string;
}
export interface LibraryPage {
  entries: LibraryEntry[]; total: number; page: number; page_size: number;
  q: string; source: string; status: string; collection: string;
  sources: {source: string; count: number}[];
  ready: number;
}
export interface LibraryCollection { collection: string; ready: number; total: number }

export class SwarmStore {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
      await this.db.run(stmt);
    }
  }

  getDigest(key: string): Promise<DigestRow | null> {
    return this.db.first<DigestRow>("SELECT * FROM digests WHERE key = ?", [key]);
  }

  digestPrefix(prefix: string): Promise<DigestRow[]> {
    // Range lookup uses the digest primary-key index. Ambiguous prefixes are
    // never resolved to an arbitrary document.
    return this.db.all("SELECT * FROM digests WHERE key >= ? AND key < ? LIMIT 2", [prefix, prefix + "g"]);
  }

  latestDigest(url: string): Promise<DigestRow | null> {
    return this.db.first<DigestRow>("SELECT * FROM digests WHERE url = COALESCE((SELECT canonical_url FROM page_aliases WHERE url = ?), ?) ORDER BY created_at DESC LIMIT 1", [url, url]);
  }

  async alias(url: string, canonical: string): Promise<void> {
    if (url !== canonical) await this.db.run("INSERT OR REPLACE INTO page_aliases (url, canonical_url) VALUES (?, ?)", [url, canonical]);
  }

  async saveSource(key: string, text: string): Promise<void> {
    for (let start = 0, part = 0; start < text.length; start += 100_000, part++) {
      await this.db.run("INSERT OR REPLACE INTO source_chunks (digest_key, part, text) VALUES (?, ?, ?)", [key, part, text.slice(start, start + 100_000)]);
    }
    await this.db.run("INSERT OR REPLACE INTO source_snapshots (digest_key, outline) VALUES (?, ?)", [key, outline(text)]);
  }

  sourceOutline(key: string): Promise<{outline: string} | null> {
    return this.db.first("SELECT outline FROM source_snapshots WHERE digest_key = ?", [key]);
  }

  async source(key: string): Promise<string | undefined> {
    if (!await this.sourceOutline(key)) return undefined;
    const rows = await this.db.all<{text: string}>("SELECT text FROM source_chunks WHERE digest_key = ? ORDER BY part", [key]);
    return rows.length ? rows.map(r => r.text).join("") : undefined;
  }

  async library(options: {q?: string; source?: string; status?: string; collection?: string; page?: number} = {}): Promise<LibraryPage> {
    const q=(options.q ?? '').trim().slice(0,160);
    const source=(options.source ?? '').trim().slice(0,253);
    const collection=(options.collection ?? '').trim().slice(0,160);
    const status=['all','unavailable'].includes(options.status ?? '') ? options.status! : 'ready';
    const host = "substr(substr(l.url,instr(l.url,'://')+3),1,instr(substr(l.url,instr(l.url,'://')+3)||'/','/')-1)";
    const from = `FROM library l LEFT JOIN digests d ON d.key =
      (SELECT key FROM digests WHERE url = COALESCE((SELECT canonical_url FROM page_aliases WHERE url=l.url),l.url) ORDER BY created_at DESC LIMIT 1)`;
    const terms: string[]=[];const params: unknown[]=[];
    if(status==='ready') terms.push("l.status='ready'");
    if(status==='unavailable') terms.push("l.status<>'ready'");
    if(source) {terms.push(`${host} = ?`);params.push(source);}
    if(collection) {terms.push('l.collection = ?');params.push(collection);}
    if(q) {
      terms.push("(COALESCE(d.title,'') LIKE ? ESCAPE '~' OR l.url LIKE ? ESCAPE '~' OR l.collection LIKE ? ESCAPE '~')");
      const pattern='%'+q.replace(/[~%_]/g,c=>'~'+c)+'%';params.push(pattern,pattern,pattern);
    }
    const where=terms.length?'WHERE '+terms.join(' AND '):'';
    const [count,sources,ready]=await Promise.all([
      this.db.first<{n:number}>(`SELECT COUNT(*) AS n ${from} ${where}`,params),
      this.db.all<{source:string;count:number}>(`SELECT ${host} AS source,COUNT(*) AS count FROM library l GROUP BY source ORDER BY count DESC,source`),
      this.db.first<{n:number}>("SELECT COUNT(*) AS n FROM library WHERE status='ready'")
    ]);
    const total=count?.n ?? 0,page_size=24;
    const requested=Number.isFinite(options.page)?Math.max(1,Math.floor(options.page!)):1;
    const page=Math.min(requested,Math.max(1,Math.ceil(total/page_size)));
    const entries=await this.db.all<LibraryEntry>(`SELECT l.*,d.title,${host} AS source ${from} ${where} ORDER BY COALESCE(d.title,l.url) COLLATE NOCASE,l.url LIMIT ? OFFSET ?`,[...params,page_size,(page-1)*page_size]);
    return {entries,total,page,page_size,q,source,status,collection,sources,ready:ready?.n ?? 0};
  }

  async markInternal(agents: string[], label: string, internal = true): Promise<void> {
    for (const agent of agents) {
      if (internal) await this.db.run("INSERT OR REPLACE INTO internal_agents (agent, label, marked_at) VALUES (?, ?, ?)", [agent, label, Date.now()]);
      else await this.db.run("DELETE FROM internal_agents WHERE agent = ?", [agent]);
    }
  }

  // Every agent hash that has read anything, for deciding which are internal.
  agents(limit = 200): Promise<AgentSummary[]> {
    return this.db.all<AgentSummary>(
      `SELECT r.agent, COUNT(*) AS reads, COUNT(DISTINCT r.url) AS pages, MIN(r.at) AS first_at, MAX(r.at) AS last_at,
              substr(GROUP_CONCAT(DISTINCT r.url), 1, 600) AS sample_urls,
              (i.agent IS NOT NULL) AS internal, i.label
       FROM reads r LEFT JOIN internal_agents i ON i.agent = r.agent
       GROUP BY r.agent ORDER BY last_at DESC LIMIT ?`,
      [limit],
    );
  }

  // Curated collections with how many of their documents are ready to read.
  collections(): Promise<LibraryCollection[]> {
    return this.db.all<LibraryCollection>(
      "SELECT collection, COALESCE(SUM(status = 'ready'), 0) AS ready, COUNT(*) AS total FROM library GROUP BY collection ORDER BY ready DESC, collection",
    );
  }

  async putDigest(row: DigestRow): Promise<void> {
    await this.db.run(
      `INSERT OR IGNORE INTO digests (key, url, content_hash, recipe, title, digest_json, page_tokens, digest_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.key, row.url, row.content_hash, row.recipe, row.title, row.digest_json, row.page_tokens, row.digest_tokens, row.created_at],
    );
  }

  async recordRead(r: ReadRow): Promise<void> {
    await this.db.run(
      "INSERT INTO reads (url, domain, digest_key, agent, hit, tokens_saved, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [r.url, r.domain, r.digest_key, r.agent, r.hit ? 1 : 0, r.tokens_saved, r.at],
    );
  }

  async pageStats(url: string): Promise<PageStats> {
    const row = await this.db.first<PageStats>(
      `SELECT COUNT(*) AS reads, COUNT(DISTINCT agent) AS agents,
              COALESCE(SUM(tokens_saved), 0) AS tokens_saved, MIN(at) AS first_read_at
       FROM reads WHERE url = ? AND ${COUNTED}`,
      [url],
    );
    return row ?? { reads: 0, agents: 0, tokens_saved: 0, first_read_at: null };
  }

  async totals(since = 0): Promise<{ reads: number; hits: number; agents: number; tokens_saved: number; pages: number }> {
    const row = await this.db.first<{ reads: number; hits: number; agents: number; tokens_saved: number; pages: number }>(
      `SELECT COUNT(*) AS reads, COALESCE(SUM(hit), 0) AS hits, COUNT(DISTINCT agent) AS agents,
              COALESCE(SUM(tokens_saved), 0) AS tokens_saved, COUNT(DISTINCT url) AS pages
       FROM reads WHERE at >= ? AND ${COUNTED}`,
      [since],
    );
    return row ?? { reads: 0, hits: 0, agents: 0, tokens_saved: 0, pages: 0 };
  }

  topPages(since: number, limit = 20, domain?: string): Promise<PublicPage[]> {
    return this.db.all<PublicPage>(
      `SELECT url, domain, (SELECT title FROM digests d WHERE d.url = reads.url ORDER BY created_at DESC LIMIT 1) AS title, COUNT(*) AS reads, COUNT(DISTINCT agent) AS agents, COALESCE(SUM(tokens_saved), 0) AS tokens_saved
       FROM reads WHERE at >= ? AND ${COUNTED} ${domain ? "AND domain = ?" : ""}
         AND url IN (SELECT url FROM reads WHERE ${COUNTED} GROUP BY url HAVING COUNT(DISTINCT agent) >= ${PUBLIC_MIN_AGENTS})
       GROUP BY url ORDER BY reads DESC, tokens_saved DESC LIMIT ?`,
      domain ? [since, domain, limit] : [since, limit],
    );
  }

  recentPublicReads(limit = 25): Promise<{ title: string | null; url: string; domain: string; hit: number; tokens_saved: number; at: number }[]> {
    return this.db.all(
      `SELECT url, domain, (SELECT title FROM digests d WHERE d.key = reads.digest_key) AS title, hit, tokens_saved, at FROM reads
       WHERE ${COUNTED} AND url IN (SELECT url FROM reads WHERE ${COUNTED} GROUP BY url HAVING COUNT(DISTINCT agent) >= ${PUBLIC_MIN_AGENTS})
       ORDER BY at DESC LIMIT ?`,
      [limit],
    );
  }

  async domainTotals(domain: string): Promise<{ reads: number; agents: number; tokens_saved: number }> {
    const row = await this.db.first<{ reads: number; agents: number; tokens_saved: number }>(
      `SELECT COUNT(*) AS reads, COUNT(DISTINCT agent) AS agents, COALESCE(SUM(tokens_saved), 0) AS tokens_saved
       FROM reads WHERE domain = ? AND ${COUNTED}`,
      [domain],
    );
    return row ?? { reads: 0, agents: 0, tokens_saved: 0 };
  }
}

// Cloudflare D1 adapter.
export function d1Db(d1: D1Database): SqlDb {
  return {
    async run(sql, params = []) {
      await d1.prepare(sql).bind(...params).run();
    },
    first: (sql, params = []) => d1.prepare(sql).bind(...params).first(),
    all: async (sql, params = []) => (await d1.prepare(sql).bind(...params).all()).results as never[],
  };
}
