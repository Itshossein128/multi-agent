import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { PgPool } from "../../memory/infrastructure";

type LegacySchemaRequirements = Record<string, readonly string[]>;

// Older local databases were created before the migration ledger existed.
// Reconcile only a complete, recognizable schema; never treat a partial schema
// as migrated because that could hide a destructive or incomplete upgrade.
const LEGACY_SCHEMA_REQUIREMENTS: Record<string, LegacySchemaRequirements> = {
  "001_studio_entities.sql": {
    studio_workflows: ["id", "name", "definition", "created_at", "updated_at"],
    studio_agents: ["id", "name", "record", "created_at", "updated_at"],
    studio_tools: ["id", "name", "record", "created_at", "updated_at"],
  },
  "002_runs.sql": {
    studio_runs: ["id", "workflow_id", "status", "started_at", "metadata"],
    studio_run_events: ["run_id", "sequence", "event", "created_at"],
    studio_approvals: ["id", "run_id", "node_id", "status", "message", "requested_at"],
  },
  "003_tasks.sql": {
    studio_tasks: ["id", "title", "description", "priority", "status", "dependencies", "retry_count", "paused", "created_at", "updated_at"],
  },
  "004_ownership.sql": {
    studio_workflows: ["owner_id", "tenant_id"],
    studio_agents: ["owner_id", "tenant_id", "is_system"],
    studio_tools: ["owner_id", "tenant_id", "is_system"],
    studio_tasks: ["owner_id", "tenant_id"],
    studio_runs: ["owner_id", "tenant_id"],
  },
  "005_users.sql": {
    studio_users: ["id", "email", "password_hash", "tenant_id", "status", "created_at", "updated_at"],
  },
  "006_task_domain.sql": {
    studio_tasks: ["workflow_id", "assigned_agents", "started_at", "completed_at", "parent_task_id", "run_id", "last_error", "metadata"],
  },
  "007_run_tool_snapshot.sql": {
    studio_runs: ["tools_snapshot"],
  },
};

async function reconcileLegacySchema(client: { query(text: string, values?: any[]): Promise<{ rows: any[] }> }, migrationName: string): Promise<boolean> {
  const requirements = LEGACY_SCHEMA_REQUIREMENTS[migrationName];
  if (!requirements) return false;

  const tableNames = Object.keys(requirements);
  const result = await client.query(
    `SELECT table_name, json_agg(column_name) AS columns
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
      GROUP BY table_name`,
    [tableNames],
  );
  const columnsByTable = new Map<string, Set<string>>(
    result.rows.map((row) => [row.table_name, new Set<string>(row.columns)]),
  );
  const existingTables = tableNames.filter((tableName) => columnsByTable.has(tableName));
  const complete = Object.entries(requirements).every(([tableName, columns]) => {
    const actual = columnsByTable.get(tableName);
    return actual && columns.every((column) => actual.has(column));
  });

  if (!existingTables.length) return false;
  if (!complete) {
    // Later migrations are intentionally idempotent and can finish a schema
    // that is still being created in this same transaction.
    if (["004_ownership.sql", "005_users.sql", "006_task_domain.sql", "007_run_tool_snapshot.sql"].includes(migrationName)) return false;
    throw new Error(`Studio migration ${migrationName} found an existing but incomplete schema; inspect it and create a reviewed migration before retrying`);
  }
  return true;
}

/** Explicit operator action only. Never called from a store constructor or server startup. */
export async function runStudioMigrations(pool: PgPool, options: { directory?: string } = {}): Promise<string[]> {
  const directory = options.directory ?? resolve(process.cwd(), "infrastructure/studio/migrations");
  const names = ["001_studio_entities.sql", "002_runs.sql", "003_tasks.sql", "004_ownership.sql", "005_users.sql", "006_task_domain.sql", "007_run_tool_snapshot.sql", "008_run_result.sql", "009_run_memory_access.sql", "010_procedural_memory_status.sql"];
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(resolve(directory, name), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('studio-entity-migrations', 0))");
    await client.query("CREATE TABLE IF NOT EXISTS studio_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const migration of migrations) {
      const existing = await client.query("SELECT checksum FROM studio_migrations WHERE name = $1", [migration.name]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== migration.checksum) throw new Error(`Studio migration checksum mismatch: ${migration.name}`);
        continue;
      }
      if (await reconcileLegacySchema(client, migration.name)) {
        await client.query("INSERT INTO studio_migrations (name, checksum) VALUES ($1, $2)", [migration.name, migration.checksum]);
        applied.push(migration.name);
        continue;
      }
      await client.query(migration.sql);
      await client.query("INSERT INTO studio_migrations (name, checksum) VALUES ($1, $2)", [migration.name, migration.checksum]);
      applied.push(migration.name);
    }
    await client.query("COMMIT");
    return applied;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}
