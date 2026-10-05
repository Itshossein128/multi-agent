import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { runStudioMigrations } from "../studio/infrastructure/migrate";
import { runMemoryMigrations } from "../memory/infrastructure/migrate";
import { executeOfflineWorkflowRun } from "../runtime/workflowRunScheduler";

export interface OnboardingOptions {
  databaseUrl?: string;
  studioDatabaseUrl?: string;
  memoryDatabaseUrl?: string;
  vectorEnabled?: boolean;
  applyMigrations?: boolean;
  runSelfTest?: boolean;
  json?: boolean;
}

export interface OnboardingReport {
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
    meetsPrerequisites: boolean;
  };
  database: {
    configured: boolean;
    connected: boolean;
    studioDatabaseUrlConfigured: boolean;
    memoryDatabaseUrlConfigured: boolean;
    studioPendingMigrations: string[];
    memoryPendingMigrations: string[];
    studioMigrationsApplied: string[];
    memoryMigrationsApplied: string[];
    checksumErrors: string[];
    error?: string;
  };
  selfTest: {
    executed: boolean;
    success: boolean;
    type: "offline_workflow_persistence";
    runId?: string;
    durationMs?: number;
    eventsEmitted: number;
    output?: string;
    error?: string;
  };
  providers: Array<{
    name: string;
    type: "api" | "cli" | "local" | "process" | "webhook";
    configured: boolean;
    details: string;
  }>;
}

const KNOWN_STUDIO_MIGRATIONS = [
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
];

const KNOWN_MEMORY_MIGRATIONS = [
  "001_memories.sql",
  "002_pgvector.sql",
  "003_temporal_validity.sql",
  "004_memory_jobs.sql",
  "005_memory_jobs_tenant_identity.sql",
];

export async function runOnboarding(options: OnboardingOptions = {}): Promise<OnboardingReport> {
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  const meetsPrerequisites = nodeMajor >= 20;

  const report: OnboardingReport = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      meetsPrerequisites,
    },
    database: {
      configured: false,
      connected: false,
      studioDatabaseUrlConfigured: false,
      memoryDatabaseUrlConfigured: false,
      studioPendingMigrations: [],
      memoryPendingMigrations: [],
      studioMigrationsApplied: [],
      memoryMigrationsApplied: [],
      checksumErrors: [],
    },
    selfTest: {
      executed: false,
      success: false,
      type: "offline_workflow_persistence",
      eventsEmitted: 0,
    },
    providers: [],
  };

  // 1. Database URL resolution (aligning with infrastructure/memory/migrate.cjs and infrastructure/studio/migrate.cjs)
  // Preserves the canonical shared isolated Studio database architecture.
  const canonicalDbUrl =
    options.databaseUrl ||
    process.env.MEMORY_DATABASE_URL ||
    process.env.STUDIO_DATABASE_URL ||
    process.env.DATABASE_URL;

  const studioUrl = options.studioDatabaseUrl || canonicalDbUrl;
  const memoryUrl = options.memoryDatabaseUrl || canonicalDbUrl;

  report.database.studioDatabaseUrlConfigured = Boolean(studioUrl);
  report.database.memoryDatabaseUrlConfigured = Boolean(memoryUrl);
  report.database.configured = Boolean(studioUrl || memoryUrl);

  const vectorEnabled = Boolean(options.vectorEnabled || process.env.MEMORY_VECTOR_ENABLED === "true");

  let studioPool: Pool | undefined;
  let memoryPool: Pool | undefined;

  try {
    const studioDir = resolve(process.cwd(), "infrastructure/studio/migrations");
    const memoryDir = resolve(process.cwd(), "infrastructure/memory/migrations");

    // 2. Studio Database Inspection
    if (studioUrl) {
      studioPool = new Pool({ connectionString: studioUrl, connectionTimeoutMillis: 3000 });
      const client = await studioPool.connect();
      try {
        await client.query("SELECT 1");
        report.database.connected = true;

        // Inspect Studio migration ledger
        const studioLedgerExists = await client.query(
          "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'studio_migrations'"
        );

        let appliedStudio: Array<{ name: string; checksum: string }> = [];

        if (studioLedgerExists.rows.length > 0) {
          const res = await client.query("SELECT name, checksum FROM studio_migrations");
          appliedStudio = res.rows;
        }

        const appliedNames = appliedStudio.map((r) => r.name);
        report.database.studioPendingMigrations = KNOWN_STUDIO_MIGRATIONS.filter((name) => !appliedNames.includes(name));

        // Checksum verification for applied migrations
        for (const applied of appliedStudio) {
          try {
            const sql = await readFile(resolve(studioDir, applied.name), "utf8");
            const expectedHash = createHash("sha256").update(sql).digest("hex");
            if (applied.checksum !== expectedHash) {
              report.database.checksumErrors.push(
                `Studio migration checksum mismatch for ${applied.name} (DB: ${applied.checksum.slice(0, 8)}, disk: ${expectedHash.slice(0, 8)})`
              );
            }
          } catch {
            report.database.checksumErrors.push(`Studio migration file ${applied.name} is missing from ${studioDir}`);
          }
        }
      } finally {
        client.release();
      }
    }

    // 3. Memory Database Inspection
    if (memoryUrl) {
      // If memoryUrl is same as studioUrl, reuse pool connection
      memoryPool = studioUrl === memoryUrl && studioPool ? studioPool : new Pool({ connectionString: memoryUrl, connectionTimeoutMillis: 3000 });
      const client = await memoryPool.connect();
      try {
        await client.query("SELECT 1");

        const memoryLedgerExists = await client.query(
          "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'studio_memory_migrations'"
        );

        let appliedMemory: Array<{ name: string; checksum: string }> = [];

        if (memoryLedgerExists.rows.length > 0) {
          const res = await client.query("SELECT name, checksum FROM studio_memory_migrations");
          appliedMemory = res.rows;
        }

        const appliedMemNames = appliedMemory.map((r) => r.name);
        const requiredMemoryMigrations = [
          "001_memories.sql",
          ...(vectorEnabled || appliedMemNames.includes("002_pgvector.sql") ? ["002_pgvector.sql"] : []),
          "003_temporal_validity.sql",
          "004_memory_jobs.sql",
          "005_memory_jobs_tenant_identity.sql",
        ];

        report.database.memoryPendingMigrations = requiredMemoryMigrations.filter((name) => !appliedMemNames.includes(name));

        // Checksum verification for applied memory migrations
        for (const applied of appliedMemory) {
          try {
            const sql = await readFile(resolve(memoryDir, applied.name), "utf8");
            const expectedHash = createHash("sha256").update(sql).digest("hex");
            if (applied.checksum !== expectedHash) {
              report.database.checksumErrors.push(
                `Memory migration checksum mismatch for ${applied.name} (DB: ${applied.checksum.slice(0, 8)}, disk: ${expectedHash.slice(0, 8)})`
              );
            }
          } catch {
            report.database.checksumErrors.push(`Memory migration file ${applied.name} is missing from ${memoryDir}`);
          }
        }
      } finally {
        client.release();
      }
    }

    // Block migrations if checksum errors exist
    if (options.applyMigrations) {
      if (report.database.checksumErrors.length > 0) {
        throw new Error(
          `Cannot apply migrations: checksum mismatch or missing migration files detected (${report.database.checksumErrors.join("; ")}). Manual operator inspection required.`
        );
      }
      if (studioPool) {
        const applied = await runStudioMigrations(studioPool as any, { directory: studioDir });
        report.database.studioMigrationsApplied = applied;
        report.database.studioPendingMigrations = [];
      }
      if (memoryPool) {
        const applied = await runMemoryMigrations(memoryPool as any, { vectorEnabled, directory: memoryDir });
        report.database.memoryMigrationsApplied = applied;
        report.database.memoryPendingMigrations = [];
      }
    }
  } catch (err) {
    report.database.error = err instanceof Error ? err.message : String(err);
  }

  // 4. Real Offline E2E Self-Test (Workflow scheduling + state persistence)
  if (options.runSelfTest !== false) {
    if (!report.database.configured || !report.database.connected || !studioPool) {
      report.selfTest.executed = false;
      report.selfTest.success = false;
      report.selfTest.error = "PostgreSQL database not configured or unreachable; offline self-test requires a configured and migrated PostgreSQL database.";
    } else if (report.database.studioPendingMigrations.length > 0) {
      report.selfTest.executed = false;
      report.selfTest.success = false;
      report.selfTest.error = `Pending studio database migrations detected (${report.database.studioPendingMigrations.length}); run migrations (--migrate) before executing self-test.`;
    } else {
      const startMs = Date.now();
      try {
        const testResult = await executeOfflineWorkflowRun(studioPool);
        report.selfTest.executed = true;
        report.selfTest.success = true;
        report.selfTest.runId = testResult.runId;
        report.selfTest.durationMs = Date.now() - startMs;
        report.selfTest.eventsEmitted = testResult.eventsEmitted;
        report.selfTest.output = `Offline workflow run scheduled and persisted in PostgreSQL (Run ID: ${testResult.runId}, ${testResult.eventsEmitted} events).`;
      } catch (err) {
        report.selfTest.executed = true;
        report.selfTest.success = false;
        report.selfTest.durationMs = Date.now() - startMs;
        report.selfTest.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Clean up pools
  if (studioPool) {
    await studioPool.end().catch(() => {});
  }
  if (memoryPool && memoryPool !== studioPool) {
    await memoryPool.end().catch(() => {});
  }

  // 5. Passive Diagnostic Provider Inspection (Zero billable API calls)
  const env = process.env;
  report.providers.push({
    name: "OpenAI",
    type: "api",
    configured: Boolean(env.OPENAI_API_KEY?.trim()),
    details: env.OPENAI_API_KEY ? "API key present in environment (passive check)" : "Not configured",
  });
  report.providers.push({
    name: "Anthropic",
    type: "api",
    configured: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    details: env.ANTHROPIC_API_KEY ? "API key present in environment (passive check)" : "Not configured",
  });
  report.providers.push({
    name: "Gemini",
    type: "api",
    configured: Boolean(env.GEMINI_API_KEY?.trim()),
    details: env.GEMINI_API_KEY ? "API key present in environment (passive check)" : "Not configured",
  });
  report.providers.push({
    name: "Process Adapter",
    type: "process",
    configured: env.PROCESS_AGENT_ENABLED === "true",
    details: env.PROCESS_AGENT_ENABLED === "true"
      ? `Enabled (trustedHostAllowed: ${env.PROCESS_AGENT_TRUSTED_HOST_ALLOWED === "true"}, allowed commands: ${env.PROCESS_AGENT_ALLOWED_COMMANDS || "none"})`
      : "Disabled (set PROCESS_AGENT_ENABLED=true)",
  });
  report.providers.push({
    name: "Webhook Adapter",
    type: "webhook",
    configured: env.WEBHOOK_AGENT_ENABLED === "true",
    details: env.WEBHOOK_AGENT_ENABLED === "true"
      ? `Enabled (allowed hosts: ${env.WEBHOOK_AGENT_ALLOWED_HOSTS || "none - fails closed"})`
      : "Disabled (set WEBHOOK_AGENT_ENABLED=true)",
  });

  return report;
}

export function printOnboardingReport(report: OnboardingReport): void {
  console.log("\n=======================================================");
  console.log("   Multi-Agent Platform: Local Onboarding Diagnostic   ");
  console.log("=======================================================\n");

  console.log("1. Environment Prerequisites:");
  console.log(`   Node.js: ${report.environment.nodeVersion} ${report.environment.meetsPrerequisites ? "✓ (>= 20)" : "✗ (requires Node 20+)"}`);
  console.log(`   Platform: ${report.environment.platform}\n`);

  console.log("2. Database Connectivity & Migrations:");
  if (!report.database.configured) {
    console.log("   Status: ⚠️  No PostgreSQL database URL configured.");
    console.log("   Guidance: Set STUDIO_DATABASE_URL or MEMORY_DATABASE_URL (or DATABASE_URL)\n");
  } else if (!report.database.connected) {
    console.log(`   Status: ✗ Failed to connect to PostgreSQL: ${report.database.error}\n`);
  } else {
    console.log("   Status: ✓ PostgreSQL connected successfully.");
    if (report.database.checksumErrors.length > 0) {
      console.log(`   ⚠️  Checksum Mismatches Detected (${report.database.checksumErrors.length}):`);
      for (const err of report.database.checksumErrors) {
        console.log(`      - ${err}`);
      }
    }

    const totalPending = report.database.studioPendingMigrations.length + report.database.memoryPendingMigrations.length;
    if (totalPending > 0) {
      console.log(`   ⚠️  Pending Migrations Detected (${totalPending}):`);
      if (report.database.studioPendingMigrations.length > 0) {
        console.log(`      Studio: ${report.database.studioPendingMigrations.join(", ")}`);
      }
      if (report.database.memoryPendingMigrations.length > 0) {
        console.log(`      Memory: ${report.database.memoryPendingMigrations.join(", ")}`);
      }
      console.log("   Action: Run with --migrate to apply pending migrations.\n");
    } else {
      console.log("   Status: ✓ All database migrations up to date.\n");
    }

    if (report.database.studioMigrationsApplied.length > 0) {
      console.log(`   Studio Migrations Applied: ${report.database.studioMigrationsApplied.join(", ")}`);
    }
    if (report.database.memoryMigrationsApplied.length > 0) {
      console.log(`   Memory Migrations Applied: ${report.database.memoryMigrationsApplied.join(", ")}`);
    }
  }

  console.log("3. Offline Workflow Scheduling & State Persistence:");
  if (report.selfTest.success) {
    console.log(`   Status: ✓ ${report.selfTest.output} (${report.selfTest.durationMs}ms)`);
    console.log(`   Notice: Executed 100% offline with zero external network or billing calls.\n`);
  } else if (report.selfTest.executed) {
    console.log(`   Status: ✗ Self-test failed: ${report.selfTest.error}\n`);
  } else {
    console.log(`   Status: ⚠️  Self-test unverified: ${report.selfTest.error}\n`);
  }

  console.log("4. External Provider Readiness (Passive Diagnostics):");
  for (const provider of report.providers) {
    const symbol = provider.configured ? "✓" : "○";
    console.log(`   [${symbol}] ${provider.name.padEnd(16)}: ${provider.details}`);
  }

  console.log("\n=======================================================");
  console.log("   Next Steps:                                         ");
  console.log("   - Start server: pnpm --filter server dev            ");
  console.log("   - Start web UI: pnpm --filter web dev               ");
  console.log("=======================================================\n");
}
