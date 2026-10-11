#!/usr/bin/env node
/**
 * Operator database reset for organization-centric clean start (D-7).
 * Usage: pnpm db:reset -- --confirm-destroy-all-data [--backup file.dump]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

export const CONFIRM_FLAG = "--confirm-destroy-all-data";

const STUDIO_DATA_TABLES = [
  "studio_organization_audit",
  "studio_organization_memberships",
  "studio_workspace_repo_states",
  "studio_workspace_repositories",
  "studio_project_repositories",
  "studio_task_comments",
  "studio_trigger_events",
  "studio_routine_history",
  "studio_routines",
  "studio_webhook_deliveries",
  "studio_webhook_triggers",
  "studio_agent_heartbeats",
  "studio_approvals",
  "studio_run_events",
  "studio_run_execution_leases",
  "studio_runs",
  "studio_tasks",
  "studio_workspaces",
  "studio_projects",
  "studio_organization_goals",
  "studio_agent_reporting",
  "studio_budgets",
  "studio_budget_reservations",
  "studio_budget_alerts",
  "studio_organizations",
  "studio_workflows",
  "studio_agents",
  "studio_tools",
  "studio_users",
];

const MEMORY_DATA_TABLES = ["studio_memory_jobs", "studio_memories"];
const BROKER_DATA_TABLES = ["credential_broker_leases", "credential_broker_audit"];
export const LEDGER_TABLES = ["studio_migrations", "studio_memory_migrations"];

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

async function tableExists(db: Queryable, name: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = $1`,
    [name],
  );
  return result.rows.length > 0;
}

export async function countRows(db: Queryable, name: string): Promise<number | null> {
  if (!(await tableExists(db, name))) return null;
  const result = await db.query(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(name)}`);
  return Number(result.rows[0]?.c ?? 0);
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid table name ${name}`);
  return `"${name}"`;
}

export async function assertNoRunningRuns(executionUrl: string): Promise<void> {
  try {
    const response = await fetch(new URL("/health", executionUrl), { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return;
  } catch {
    return;
  }
  try {
    const response = await fetch(new URL("/runs?status=running&limit=1", executionUrl), {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return;
    const body = (await response.json()) as unknown;
    const runs = Array.isArray(body) ? body : (body as { runs?: unknown[] })?.runs;
    if (Array.isArray(runs) && runs.length > 0) {
      throw new Error("Refusing reset: execution server reports running runs. Drain or cancel them first.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Refusing reset")) throw error;
  }
}

export function clearWorkspaceStorage(rootEnv: string | undefined): string | null {
  if (!rootEnv) return null;
  const root = resolve(rootEnv);
  if (!existsSync(root)) return root;
  for (const name of readdirSync(root)) {
    const full = resolve(root, name);
    const st = statSync(full);
    if (st.isDirectory()) rmSync(full, { recursive: true, force: true });
    else rmSync(full, { force: true });
  }
  return root;
}

export async function resetApplicationData(
  db: Queryable,
  options: {
    confirm: boolean;
    executionUrl?: string;
    backupFile?: string;
    databaseUrl?: string;
    workspaceStorageRoot?: string;
    skipRunningCheck?: boolean;
  },
): Promise<{ truncated: string[]; ledgerCounts: Record<string, number | null> }> {
  const allTables = [...STUDIO_DATA_TABLES, ...MEMORY_DATA_TABLES, ...BROKER_DATA_TABLES];
  const counts: Record<string, number | null> = {};
  for (const table of allTables) counts[table] = await countRows(db, table);
  const ledgerCounts: Record<string, number | null> = {};
  for (const ledger of LEDGER_TABLES) ledgerCounts[ledger] = await countRows(db, ledger);

  if (!options.confirm) {
    const error = new Error(`Refusing to destroy data without ${CONFIRM_FLAG}`);
    (error as Error & { counts?: typeof counts }).counts = counts;
    throw error;
  }

  if (!options.skipRunningCheck) {
    await assertNoRunningRuns(options.executionUrl ?? process.env.EXECUTION_SERVER_URL ?? "http://127.0.0.1:4000");
  }

  if (options.backupFile) {
    if (!options.databaseUrl) throw new Error("--backup requires a database URL");
    execFileSync("pg_dump", [options.databaseUrl, "-f", options.backupFile], { stdio: "inherit" });
  }

  const existing: string[] = [];
  for (const table of allTables) {
    if (await tableExists(db, table)) existing.push(table);
  }
  if (existing.length) {
    await db.query(`TRUNCATE ${existing.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`);
  }

  clearWorkspaceStorage(options.workspaceStorageRoot ?? process.env.STUDIO_WORKSPACE_STORAGE_ROOT);

  return { truncated: existing, ledgerCounts };
}

async function main() {
  const argv = process.argv.slice(2);
  const confirm = argv.includes(CONFIRM_FLAG);
  const backupIdx = argv.indexOf("--backup");
  const backupFile = backupIdx >= 0 ? argv[backupIdx + 1] : undefined;
  const url = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  if (!url) throw new Error("MEMORY_DATABASE_URL (or STUDIO_DATABASE_URL) is required");

  const pool = new Pool({ connectionString: url });
  try {
    const allTables = [...STUDIO_DATA_TABLES, ...MEMORY_DATA_TABLES, ...BROKER_DATA_TABLES];
    console.log("Row counts before reset:");
    for (const table of allTables) {
      const count = await countRows(pool, table);
      if (count !== null) console.log(`  ${table}: ${count}`);
    }
    for (const ledger of LEDGER_TABLES) {
      const count = await countRows(pool, ledger);
      if (count !== null) console.log(`  ${ledger} (kept): ${count}`);
    }

    const result = await resetApplicationData(pool, {
      confirm,
      backupFile,
      databaseUrl: url,
      workspaceStorageRoot: process.env.STUDIO_WORKSPACE_STORAGE_ROOT,
    });
    console.log(`Truncated ${result.truncated.length} data tables; migration ledgers preserved`);
    console.log(
      JSON.stringify({
        event: "db.reset",
        at: new Date().toISOString(),
        tables: result.truncated.length,
        backup: backupFile ?? null,
      }),
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
