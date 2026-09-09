import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { PgPool } from "./postgres-memory-store";

/** Explicit operator action only. Never called from a store constructor or server startup. */
export async function runMemoryMigrations(pool: PgPool, options: { vectorEnabled?: boolean; directory?: string } = {}): Promise<string[]> {
  const directory = options.directory ?? resolve(process.cwd(), "infrastructure/memory/migrations");
  const names = ["001_memories.sql", ...(options.vectorEnabled ? ["002_pgvector.sql"] : [])];
  const migrations = await Promise.all(names.map(async name => { const sql = await readFile(resolve(directory, name), "utf8"); return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") }; }));
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('studio-memory-migrations', 0))");
    await client.query("CREATE TABLE IF NOT EXISTS studio_memory_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const migration of migrations) {
      const existing = await client.query("SELECT checksum FROM studio_memory_migrations WHERE name = $1", [migration.name]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== migration.checksum) throw new Error(`Memory migration checksum mismatch: ${migration.name}`);
        continue;
      }
      await client.query(migration.sql);
      await client.query("INSERT INTO studio_memory_migrations (name, checksum) VALUES ($1, $2)", [migration.name, migration.checksum]);
      applied.push(migration.name);
    }
    await client.query("COMMIT");
    return applied;
  } catch (error) { try { await client.query("ROLLBACK"); } catch { /* Preserve original failure. */ } throw error; }
  finally { client.release(); }
}
