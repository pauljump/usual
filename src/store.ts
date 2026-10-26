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
  url: string;
  domain: string;
  reads: number;
  agents: number;
  tokens_saved: number;
}

// A page only shows up on public surfaces once this many different agents
// have read it, so one person's browsing never appears in the feed.
export const PUBLIC_MIN_AGENTS = 3;

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
       FROM reads WHERE url = ?`,
      [url],
    );
    return row ?? { reads: 0, agents: 0, tokens_saved: 0, first_read_at: null };
  }

  async totals(since = 0): Promise<{ reads: number; hits: number; agents: number; tokens_saved: number; pages: number }> {
    const row = await this.db.first<{ reads: number; hits: number; agents: number; tokens_saved: number; pages: number }>(
      `SELECT COUNT(*) AS reads, COALESCE(SUM(hit), 0) AS hits, COUNT(DISTINCT agent) AS agents,
              COALESCE(SUM(tokens_saved), 0) AS tokens_saved, COUNT(DISTINCT url) AS pages
       FROM reads WHERE at >= ?`,
      [since],
    );
    return row ?? { reads: 0, hits: 0, agents: 0, tokens_saved: 0, pages: 0 };
  }

  topPages(since: number, limit = 20, domain?: string): Promise<PublicPage[]> {
    return this.db.all<PublicPage>(
      `SELECT url, domain, COUNT(*) AS reads, COUNT(DISTINCT agent) AS agents, COALESCE(SUM(tokens_saved), 0) AS tokens_saved
       FROM reads WHERE at >= ? ${domain ? "AND domain = ?" : ""}
         AND url IN (SELECT url FROM reads GROUP BY url HAVING COUNT(DISTINCT agent) >= ${PUBLIC_MIN_AGENTS})
       GROUP BY url ORDER BY reads DESC, tokens_saved DESC LIMIT ?`,
      domain ? [since, domain, limit] : [since, limit],
    );
  }

  recentPublicReads(limit = 25): Promise<{ url: string; domain: string; hit: number; tokens_saved: number; at: number }[]> {
    return this.db.all(
      `SELECT url, domain, hit, tokens_saved, at FROM reads
       WHERE url IN (SELECT url FROM reads GROUP BY url HAVING COUNT(DISTINCT agent) >= ${PUBLIC_MIN_AGENTS})
       ORDER BY at DESC LIMIT ?`,
      [limit],
    );
  }

  async domainTotals(domain: string): Promise<{ reads: number; agents: number; tokens_saved: number }> {
    const row = await this.db.first<{ reads: number; agents: number; tokens_saved: number }>(
      `SELECT COUNT(*) AS reads, COUNT(DISTINCT agent) AS agents, COALESCE(SUM(tokens_saved), 0) AS tokens_saved
       FROM reads WHERE domain = ?`,
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
