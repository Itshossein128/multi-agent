"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMemoryMigrations = runMemoryMigrations;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
/** Explicit operator action only. Never called from a store constructor or server startup. */
async function runMemoryMigrations(pool, options = {}) {
    const directory = options.directory ?? (0, node_path_1.resolve)(process.cwd(), "infrastructure/memory/migrations");
    const names = ["001_memories.sql", ...(options.vectorEnabled ? ["002_pgvector.sql"] : [])];
    const migrations = await Promise.all(names.map(async (name) => { const sql = await (0, promises_1.readFile)((0, node_path_1.resolve)(directory, name), "utf8"); return { name, sql, checksum: (0, node_crypto_1.createHash)("sha256").update(sql).digest("hex") }; }));
    const client = await pool.connect();
    const applied = [];
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('studio-memory-migrations', 0))");
        await client.query("CREATE TABLE IF NOT EXISTS studio_memory_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
        for (const migration of migrations) {
            const existing = await client.query("SELECT checksum FROM studio_memory_migrations WHERE name = $1", [migration.name]);
            if (existing.rows.length) {
                if (existing.rows[0].checksum !== migration.checksum)
                    throw new Error(`Memory migration checksum mismatch: ${migration.name}`);
                continue;
            }
            await client.query(migration.sql);
            await client.query("INSERT INTO studio_memory_migrations (name, checksum) VALUES ($1, $2)", [migration.name, migration.checksum]);
            applied.push(migration.name);
        }
        await client.query("COMMIT");
        return applied;
    }
    catch (error) {
        try {
            await client.query("ROLLBACK");
        }
        catch { /* Preserve original failure. */ }
        throw error;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=migrate.js.map