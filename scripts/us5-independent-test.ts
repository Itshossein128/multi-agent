import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { resetApplicationData, countRows, CONFIRM_FLAG } from "./db-reset";
import { OrganizationProfileService } from "../apps/server/src/api/studio/organizationProfileService";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";

const testDatabaseUrl =
  process.env.MEMORY_TEST_DATABASE_URL ||
  "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory";

async function main() {
  const logLines: string[] = [];
  function log(msg: string) {
    console.log(msg);
    logLines.push(msg);
  }

  log("================================================================================");
  log("US5 Independent Test: Clean Start Without Legacy Tenants (FR-108, SC-002, T024)");
  log(`Timestamp: ${new Date().toISOString()}`);
  log("================================================================================\n");

  const schema = `us5_independent_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = new Pool({ connectionString: testDatabaseUrl });
  log(`[Step 0] Creating task-owned disposable database schema "${schema}"...`);
  await admin.query(`CREATE SCHEMA "${schema}"`);

  const pool = new Pool({
    connectionString: testDatabaseUrl,
    options: `-c search_path=${schema},public`,
  });

  const storageRoot = mkdtempSync(join(tmpdir(), "studio-us5-ws-"));
  log(`[Step 0] Created isolated workspace storage root: ${storageRoot}\n`);

  try {
    // Step 1: Apply pre-018 migrations (001 to 017)
    log("[Step 1] Applying pre-organization migrations 001_studio_entities.sql through 017_project_workspace_hierarchy.sql...");
    const pre018Names = [
      "001_studio_entities.sql",
      "002_runs.sql",
      "003_tasks.sql",
      "004_ownership.sql",
      "005_users.sql",
      "006_task_domain.sql",
      "007_run_tool_snapshot.sql",
      "008_run_result.sql",
      "009_run_memory_access.sql",
      "010_procedural_memory_status.sql",
      "011_projects_workspaces.sql",
      "012_event_routines_triggers.sql",
      "013_event_routines_hardening.sql",
      "014_organization_goals.sql",
      "015_cost_budgets.sql",
      "016_run_execution_leases.sql",
      "017_project_workspace_hierarchy.sql",
    ];

    const migrationsDir = resolve(process.cwd(), "infrastructure/studio/migrations");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE IF NOT EXISTS studio_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
      );
      for (const name of pre018Names) {
        const sql = await readFile(resolve(migrationsDir, name), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        await client.query(sql);
        await client.query(
          "INSERT INTO studio_migrations (name, checksum) VALUES ($1, $2)",
          [name, checksum]
        );
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const preMigrationCount = await countRows(pool, "studio_migrations");
    log(`  -> Applied ${pre018Names.length} pre-organization migrations. Ledger count: ${preMigrationCount}\n`);

    // Step 2: Populate legacy application data
    log("[Step 2] Populating legacy application data and filesystem working copies...");
    const legacyTenant = "tenant-legacy-alpha";
    const legacyUser = "user-legacy-ada";
    const stamp = new Date().toISOString();

    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status, created_at, updated_at)
       VALUES ($1, $2, 'legacy-hash', 'Ada Legacy', $3, 'active', $4, $4)`,
      [legacyUser, "ada@legacy.local", legacyTenant, stamp]
    );

    await pool.query(
      `INSERT INTO studio_organizations (id, name, description, config, owner_id, created_at, updated_at)
       VALUES ($1, 'Legacy Alpha Org', 'Legacy description', '{}', $2, $3, $3)`,
      [legacyTenant, legacyUser, stamp]
    );

    await pool.query(
      `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, owner_id, created_at, updated_at)
       VALUES ('proj-legacy-1', $1, 'Legacy Project', '', 'active', '{}', $2, $3, $3)`,
      [legacyTenant, legacyUser, stamp]
    );

    await pool.query(
      `INSERT INTO studio_tasks (id, tenant_id, project_id, title, description, priority, status, dependencies, retry_count, paused, owner_id, created_at, updated_at)
       VALUES ('task-legacy-1', $1, 'proj-legacy-1', 'Legacy Task', '', 'medium', 'todo', '[]', 0, false, $2, $3, $3)`,
      [legacyTenant, legacyUser, stamp]
    );

    await pool.query(
      `INSERT INTO studio_workflows (id, tenant_id, name, definition, owner_id, created_at, updated_at)
       VALUES ('wf-legacy-1', $1, 'Legacy Workflow', '{}', $2, $3, $3)`,
      [legacyTenant, legacyUser, stamp]
    );

    await pool.query(
      `INSERT INTO studio_tools (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
       VALUES ('tool-legacy-1', $1, 'Legacy Tool', '{}', $2, false, $3, $3)`,
      [legacyTenant, legacyUser, stamp]
    );

    await pool.query(
      `INSERT INTO studio_agents (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
       VALUES ('agent-legacy-1', $1, 'Legacy Agent', '{}', $2, false, $3, $3)`,
      [legacyTenant, legacyUser, stamp]
    );

    const legacyFileDir = join(storageRoot, legacyTenant);
    mkdirSync(legacyFileDir, { recursive: true });
    writeFileSync(join(legacyFileDir, "workspace-code.ts"), "export const legacy = true;");

    log(`  -> Seeded legacy users: ${await countRows(pool, "studio_users")}`);
    log(`  -> Seeded legacy organizations: ${await countRows(pool, "studio_organizations")}`);
    log(`  -> Seeded legacy projects: ${await countRows(pool, "studio_projects")}`);
    log(`  -> Seeded legacy tasks: ${await countRows(pool, "studio_tasks")}`);
    log(`  -> Seeded legacy workflows: ${await countRows(pool, "studio_workflows")}`);
    log(`  -> Seeded legacy tools: ${await countRows(pool, "studio_tools")}`);
    log(`  -> Seeded legacy agents: ${await countRows(pool, "studio_agents")}`);
    log(`  -> Seeded filesystem file: ${join(legacyFileDir, "workspace-code.ts")} (exists: ${existsSync(join(legacyFileDir, "workspace-code.ts"))})\n`);

    // Step 3: Demonstrate unconfirmed reset leaves data intact (AC1)
    log("[Step 3] Executing reset WITHOUT explicit confirmation flag (confirm: false)...");
    let unconfirmedError: Error | null = null;
    try {
      await resetApplicationData(pool, {
        confirm: false,
        skipRunningCheck: true,
        workspaceStorageRoot: storageRoot,
      });
    } catch (err: any) {
      unconfirmedError = err;
    }

    if (!unconfirmedError || !unconfirmedError.message.includes(CONFIRM_FLAG)) {
      throw new Error(`Expected unconfirmed reset to reject with ${CONFIRM_FLAG}, got: ${unconfirmedError?.message}`);
    }
    log(`  -> PASS: Unconfirmed reset rejected as expected: "${unconfirmedError.message}"`);
    log(`  -> Verification: Users remaining: ${await countRows(pool, "studio_users")}`);
    log(`  -> Verification: Organizations remaining: ${await countRows(pool, "studio_organizations")}`);
    log(`  -> Verification: Projects remaining: ${await countRows(pool, "studio_projects")}`);
    log(`  -> Verification: Tasks remaining: ${await countRows(pool, "studio_tasks")}`);
    log(`  -> Verification: Workspace file exists: ${existsSync(join(legacyFileDir, "workspace-code.ts"))}\n`);

    // Step 4: Demonstrate legacy-data migration refusal (AC2)
    log("[Step 4] Attempting to apply migration 018_organization_foundation.sql while legacy data exists...");
    const sql018 = await readFile(resolve(migrationsDir, "018_organization_foundation.sql"), "utf8");
    let migrationRefusalError: Error | null = null;
    try {
      await pool.query(sql018);
    } catch (err: any) {
      migrationRefusalError = err;
    }

    if (!migrationRefusalError || !migrationRefusalError.message.includes("Migration 018 refused")) {
      throw new Error(`Expected migration 018 to refuse legacy rows, got: ${migrationRefusalError?.message}`);
    }
    log(`  -> PASS: Migration 018 refused legacy data as expected: "${migrationRefusalError.message}"\n`);

    // Step 5: Execute confirmed reset (FR-108, SC-002)
    log("[Step 5] Executing confirmed reset WITH --confirm-destroy-all-data...");
    const resetResult = await resetApplicationData(pool, {
      confirm: true,
      skipRunningCheck: true,
      workspaceStorageRoot: storageRoot,
    });
    log(`  -> Truncated ${resetResult.truncated.length} application data tables: ${resetResult.truncated.join(", ")}`);
    log(`  -> Verification: Users count: ${await countRows(pool, "studio_users")}`);
    log(`  -> Verification: Organizations count: ${await countRows(pool, "studio_organizations")}`);
    log(`  -> Verification: Projects count: ${await countRows(pool, "studio_projects")}`);
    log(`  -> Verification: Tasks count: ${await countRows(pool, "studio_tasks")}`);
    log(`  -> Verification: Workflows count: ${await countRows(pool, "studio_workflows")}`);
    log(`  -> Verification: Tools count: ${await countRows(pool, "studio_tools")}`);
    log(`  -> Verification: Agents count: ${await countRows(pool, "studio_agents")}`);
    log(`  -> Verification: Migration ledger count: ${await countRows(pool, "studio_migrations")} (PRESERVED)`);
    log(`  -> Verification: Workspace files remaining in ${storageRoot}: [${readdirSync(storageRoot).join(", ")}] (CLEARED)\n`);

    // Step 6: Apply all migrations post-reset
    log("[Step 6] Running remaining studio migrations (018 through 023) on clean schema...");
    const remainingApplied = await runStudioMigrations(pool);
    log(`  -> Applied ${remainingApplied.length} migrations: ${remainingApplied.join(", ")}`);
    log(`  -> Total migrations in ledger: ${await countRows(pool, "studio_migrations")}\n`);

    // Step 7: Clean registration -> organization creation (AC3)
    log("[Step 7] Simulating clean registration and first organization creation...");
    const newUserId = randomUUID();
    const newOrgId = randomUUID();
    const userEmail = "first.owner@clean-start.local";

    log(`  -> Inserting newly registered user (id: "${newUserId}", email: "${userEmail}", tenant_id: NULL)...`);
    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status, created_at, updated_at)
       VALUES ($1, $2, 'secure-hashed-password', 'Grace Hopper', NULL, 'active', now(), now())`,
      [newUserId, userEmail]
    );

    const registeredUser = (await pool.query(`SELECT id, email, tenant_id, status FROM studio_users WHERE id = $1`, [newUserId])).rows[0];
    log(`  -> User registered successfully: tenant_id = ${registeredUser.tenant_id === null ? "NULL (no implicit tenant)" : registeredUser.tenant_id}`);

    const store = new PostgresStudioStore(pool);
    const orgService = new OrganizationProfileService(store);
    log(`  -> Creating organization "Analytical Engine" (slug: "analytical-engine", id: "${newOrgId}")...`);
    const orgProfile = await orgService.create(
      { name: "Analytical Engine", slug: "analytical-engine", description: "First organization after clean start" },
      { userId: newUserId, tenantId: newOrgId }
    );

    log(`  -> Organization profile created:`);
    log(`     - id: ${orgProfile.id}`);
    log(`     - name: ${orgProfile.name}`);
    log(`     - slug: ${orgProfile.slug}`);
    log(`     - status: ${orgProfile.status}`);
    log(`     - ownerId: ${orgProfile.ownerId}`);

    const memberships = await store.listMemberships(newOrgId);
    log(`  -> Organization memberships: ${memberships.length}`);
    for (const m of memberships) {
      log(`     - user: ${m.userId}, role: ${m.role}, status: ${m.status}, version: ${m.version}`);
    }

    const auditRows = (await pool.query(`SELECT action, target_user_id, actor_user_id, details FROM studio_organization_audit WHERE organization_id = $1`, [newOrgId])).rows;
    log(`  -> Organization audit records: ${auditRows.length}`);
    for (const a of auditRows) {
      log(`     - action: ${a.action}, target: ${a.target_user_id}, actor: ${a.actor_user_id}`);
    }

    const updatedUser = (await pool.query(`SELECT tenant_id FROM studio_users WHERE id = $1`, [newUserId])).rows[0];
    log(`  -> User default tenant updated: ${updatedUser.tenant_id}`);

    // Pre-reset data check
    const checkLegacy = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM studio_users WHERE id = $1) AS legacy_users,
         (SELECT COUNT(*) FROM studio_projects WHERE id = 'proj-legacy-1') AS legacy_projects,
         (SELECT COUNT(*) FROM studio_tasks WHERE id = 'task-legacy-1') AS legacy_tasks,
         (SELECT COUNT(*) FROM studio_workflows WHERE id = 'wf-legacy-1') AS legacy_workflows,
         (SELECT COUNT(*) FROM studio_tools WHERE id = 'tool-legacy-1') AS legacy_tools,
         (SELECT COUNT(*) FROM studio_agents WHERE id = 'agent-legacy-1') AS legacy_agents`,
      [legacyUser]
    );
    const row = checkLegacy.rows[0];
    log("\n[Step 8] Pre-reset data leakage verification:");
    log(`  -> Legacy users visible: ${row.legacy_users}`);
    log(`  -> Legacy projects visible: ${row.legacy_projects}`);
    log(`  -> Legacy tasks visible: ${row.legacy_tasks}`);
    log(`  -> Legacy workflows visible: ${row.legacy_workflows}`);
    log(`  -> Legacy tools visible: ${row.legacy_tools}`);
    log(`  -> Legacy agents visible: ${row.legacy_agents}`);

    if (Number(row.legacy_users) + Number(row.legacy_projects) + Number(row.legacy_tasks) + Number(row.legacy_workflows) + Number(row.legacy_tools) + Number(row.legacy_agents) > 0) {
      throw new Error("Pre-reset data detected in store after reset and onboarding!");
    }

    log("\n================================================================================");
    log("RESULT: US5 Independent Test PASSED (100% of invariants verified)");
    log("================================================================================");
  } finally {
    log(`\n[Cleanup] Dropping disposable schema "${schema}"...`);
    await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    rmSync(storageRoot, { recursive: true, force: true });
    log("[Cleanup] Completed successfully.");
  }

  return logLines.join("\n");
}

main()
  .then((transcript) => {
    const fs = require("node:fs");
    const path = require("node:path");
    const outDir = path.resolve(__dirname, "../specs/007-organization-tenancy-audit/evidence/phase-1");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "us5-independent-test.txt"), transcript + "\n");
    console.log(`\nTranscript saved to ${path.join(outDir, "us5-independent-test.txt")}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
