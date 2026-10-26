import type { SqlDb } from "./store.js";

// node:sqlite adapter (Node 22.13+). Used by the local server and tests.
export async function sqliteDb(path = ":memory:"): Promise<SqlDb> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  const norm = (params: unknown[]) => params.map((p) => (typeof p === "boolean" ? Number(p) : p)) as never[];
  return {
    async run(sql, params = []) {
      db.prepare(sql).run(...norm(params));
    },
    async first(sql, params = []) {
      return (db.prepare(sql).get(...norm(params)) as never) ?? null;
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...norm(params)) as never[];
    },
  };
}
