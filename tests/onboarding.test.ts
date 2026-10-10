import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runOnboarding } from "../src/cli/onboard";
import { AgentExecutorFactory } from "../src/agents/runtime/agentExecutorFactory";
import { NotImplementedAgentExecutor } from "../src/agents/runtime/notImplementedExecutor";

const testDatabaseUrl =
  process.env.MEMORY_TEST_DATABASE_URL ||
  process.env.STUDIO_DATABASE_URL ||
  "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory";

describe("Local First-Run Onboarding Assistant", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.STUDIO_DATABASE_URL;
    delete process.env.MEMORY_DATABASE_URL;
  });

  afterAll(() => {
    process.env = { ...origEnv };
  });

  it("runs environment prerequisite check and diagnostic provider inspection without paid calls", async () => {
    const report = await runOnboarding({
      runSelfTest: false,
      applyMigrations: false,
    });

    expect(report.environment).toBeDefined();
    expect(report.environment.nodeVersion).toBe(process.version);
    expect(report.environment.meetsPrerequisites).toBe(true);

    // Passive provider readiness diagnostic (no billable calls)
    expect(report.providers.length).toBeGreaterThanOrEqual(5);
    const names = report.providers.map((p) => p.name);
    expect(names).toContain("OpenAI");
    expect(names).toContain("Anthropic");
    expect(names).toContain("Gemini");
    expect(names).toContain("Process Adapter");
    expect(names).toContain("Webhook Adapter");

    // Check that providers report passive status without billing
    for (const provider of report.providers) {
      expect(typeof provider.configured).toBe("boolean");
      expect(typeof provider.details).toBe("string");
    }
  });

  it("handles unconfigured database gracefully and reports self-test unverified", async () => {
    const report = await runOnboarding({
      databaseUrl: undefined,
      studioDatabaseUrl: undefined,
      memoryDatabaseUrl: undefined,
      runSelfTest: true,
    });

    expect(report.database.configured).toBe(false);
    expect(report.database.connected).toBe(false);
    expect(report.selfTest.executed).toBe(false);
    expect(report.selfTest.success).toBe(false);
    expect(report.selfTest.type).toBe("offline_workflow_persistence");
    expect(report.selfTest.error).toContain("PostgreSQL database not configured or unreachable");
  });

  it("never implicitly targets MEMORY_TEST_DATABASE_URL when standard URLs are unset", async () => {
    process.env.MEMORY_TEST_DATABASE_URL = testDatabaseUrl;

    const report = await runOnboarding({
      databaseUrl: undefined,
      studioDatabaseUrl: undefined,
      memoryDatabaseUrl: undefined,
      runSelfTest: true,
    });

    // Must NOT use MEMORY_TEST_DATABASE_URL
    expect(report.database.configured).toBe(false);
    expect(report.database.connected).toBe(false);
    expect(report.selfTest.executed).toBe(false);
    expect(report.selfTest.success).toBe(false);
  });

  it("guards offline test provider against invocation by ordinary stored agents", () => {
    // Default factory without explicit onboarding opt-in
    const standardFactory = new AgentExecutorFactory();
    const executor = standardFactory.create({
      type: "local",
      provider: "offline-test",
      model: "self-test",
    });

    // Must fail closed with NotImplementedAgentExecutor
    expect(executor).toBeInstanceOf(NotImplementedAgentExecutor);

    // Explicit onboarding factory allows it
    const onboardingFactory = new AgentExecutorFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    const allowed = onboardingFactory.create({
      type: "local",
      provider: "offline-test",
      model: "self-test",
    });
    expect(allowed).not.toBeInstanceOf(NotImplementedAgentExecutor);
  });
});

const describeDb = process.env.MEMORY_TEST_DATABASE_URL || process.env.STUDIO_DATABASE_URL ? describe : describe.skip;

describeDb("Onboarding Database & Persistence Integration", () => {
  let adminPool: Pool;

  beforeAll(async () => {
    // Fails fast and visibly if PostgreSQL is unreachable; no silent skips
    adminPool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 3000 });
    await adminPool.query("SELECT 1");
  });

  afterAll(async () => {
    if (adminPool) {
      await adminPool.end().catch(() => {});
    }
  });

  it("detects checksum mismatches and blocks --migrate when ledger hash diverges", async () => {
    const schema = `onboard_chk_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const scopedUrl = `${testDatabaseUrl}${testDatabaseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}%2Cpublic`;

    const schemaPool = new Pool({ connectionString: scopedUrl });
    try {
      // Create ledger with tampered checksum
      await schemaPool.query(
        "CREATE TABLE studio_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
      );
      await schemaPool.query(
        "INSERT INTO studio_migrations (name, checksum) VALUES ('001_studio_entities.sql', 'corrupted_hash_value_1234567890')"
      );

      // Attempting to apply migrations on corrupt ledger must be blocked and recorded
      const report = await runOnboarding({
        databaseUrl: scopedUrl,
        applyMigrations: true,
        runSelfTest: false,
      });

      expect(report.database.connected).toBe(true);
      expect(report.database.checksumErrors.length).toBeGreaterThan(0);
      expect(report.database.checksumErrors[0]).toContain("Studio migration checksum mismatch for 001_studio_entities.sql");
      expect(report.database.error).toContain("Cannot apply migrations: checksum mismatch or missing migration files detected");
    } finally {
      await schemaPool.end().catch(() => {});
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    }
  });

  it("detects missing migration files on disk and records checksum error", async () => {
    const schema = `onboard_missing_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const scopedUrl = `${testDatabaseUrl}${testDatabaseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}%2Cpublic`;

    const schemaPool = new Pool({ connectionString: scopedUrl });
    try {
      await schemaPool.query(
        "CREATE TABLE studio_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
      );
      await schemaPool.query(
        "INSERT INTO studio_migrations (name, checksum) VALUES ('999_nonexistent_migration.sql', 'dummyhash')"
      );

      const report = await runOnboarding({
        databaseUrl: scopedUrl,
        applyMigrations: false,
        runSelfTest: false,
      });

      expect(report.database.connected).toBe(true);
      expect(report.database.checksumErrors.length).toBeGreaterThan(0);
      expect(report.database.checksumErrors[0]).toContain("Studio migration file 999_nonexistent_migration.sql is missing");
    } finally {
      await schemaPool.end().catch(() => {});
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    }
  });

  it("handles vectorEnabled toggle properly for memory migrations", async () => {
    const schema = `onboard_vec_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const scopedUrl = `${testDatabaseUrl}${testDatabaseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}%2Cpublic`;

    try {
      // 1. With vectorEnabled: false
      const reportNoVector = await runOnboarding({
        memoryDatabaseUrl: scopedUrl,
        vectorEnabled: false,
        runSelfTest: false,
      });
      expect(reportNoVector.database.memoryPendingMigrations).not.toContain("002_pgvector.sql");

      // 2. With vectorEnabled: true
      const reportWithVector = await runOnboarding({
        memoryDatabaseUrl: scopedUrl,
        vectorEnabled: true,
        runSelfTest: false,
      });
      expect(reportWithVector.database.memoryPendingMigrations).toContain("002_pgvector.sql");
    } finally {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    }
  });

  it("executes real offline workflow scheduling through RunExecutor and verifies PostgreSQL persistence e2e", async () => {
    const schema = `onboard_e2e_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const scopedUrl = `${testDatabaseUrl}${testDatabaseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}%2Cpublic`;

    try {
      // 1. Run onboarding with applyMigrations: true and runSelfTest: true
      const report = await runOnboarding({
        databaseUrl: scopedUrl,
        applyMigrations: true,
        runSelfTest: true,
        vectorEnabled: false,
      });

      expect(report.database.connected).toBe(true);
      expect(report.database.studioPendingMigrations.length).toBe(0);
      expect(report.selfTest.executed).toBe(true);
      expect(report.selfTest.success).toBe(true);
      expect(report.selfTest.type).toBe("offline_workflow_persistence");
      expect(report.selfTest.runId).toBeDefined();
      expect(report.selfTest.eventsEmitted).toBeGreaterThanOrEqual(10);
      expect(report.selfTest.output).toContain("Offline workflow run scheduled and persisted in PostgreSQL");

      // 2. Query PostgreSQL directly to verify state persistence in studio_runs
      const schemaPool = new Pool({ connectionString: scopedUrl });
      try {
        const runRes = await schemaPool.query(
          "SELECT id, workflow_id, status, started_at, completed_at, output, workflow_snapshot, agents_snapshot FROM studio_runs WHERE id = $1",
          [report.selfTest.runId]
        );
        expect(runRes.rows.length).toBe(1);
        const run = runRes.rows[0];
        expect(run.status).toBe("completed");
        expect(run.started_at).not.toBeNull();
        expect(run.completed_at).not.toBeNull();
        expect(run.output).toBeDefined();

        // Verify snapshot shows offline-test agent
        const agents = typeof run.agents_snapshot === "string" ? JSON.parse(run.agents_snapshot) : run.agents_snapshot;
        expect(agents[0].backend.provider).toBe("offline-test");

        // 3. Query PostgreSQL studio_run_events to assert full compiler/node event stream
        const eventsRes = await schemaPool.query(
          "SELECT sequence, event FROM studio_run_events WHERE run_id = $1 ORDER BY sequence ASC",
          [report.selfTest.runId]
        );
        expect(eventsRes.rows.length).toBeGreaterThanOrEqual(10);

        const eventTypes = eventsRes.rows.map((r: { event: any }) => {
          const ev = typeof r.event === "string" ? JSON.parse(r.event) : r.event;
          return ev.type;
        });

        // Life-cycle events
        expect(eventTypes).toContain("run.created");
        expect(eventTypes).toContain("run.started");
        expect(eventTypes).toContain("run.completed");

        // Input, agent, and output node events produced by the workflow compiler & GraphRunner
        expect(eventTypes).toContain("node.started");
        expect(eventTypes).toContain("node.completed");
        expect(eventTypes).toContain("agent.started");
        expect(eventTypes).toContain("agent.completed");
      } finally {
        await schemaPool.end().catch(() => {});
      }
    } finally {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    }
  });
});
