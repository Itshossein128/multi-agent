import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { withOrganization } from "../src/studio/infrastructure/withOrganization";
import { createPostgresPool } from "../apps/server/src/infrastructure/postgresPool";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)("T066 / T096: Raw-SQL negative tests under RLS enforcement", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `rls_raw_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    // Migration 024 activates ENABLE + FORCE RLS across all organization tables
    await runStudioMigrations(pool);

    // Grant schema usage and permissions in this isolated schema
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO studio_app, studio_worker`);
    await admin.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO studio_app, studio_worker`);
    await admin.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO studio_app, studio_worker`);
    await admin.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "${schema}" TO studio_app, studio_worker`);
    await admin.query(`GRANT studio_app, studio_worker TO CURRENT_USER`);
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  async function asRole<T>(role: "studio_app" | "studio_worker", fn: (client: any) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  it("query without app.tenant_id returns 0 organization-owned rows for studio_app", async () => {
    // Seed records for org-a and org-b using superuser/bootstrap connection
    await pool.query(`
      INSERT INTO studio_projects (id, tenant_id, name, status, settings, created_at, updated_at, owner_id)
      VALUES ('proj-a', 'org-a', 'Project A', 'active', '{}', now(), now(), 'u1'),
             ('proj-b', 'org-b', 'Project B', 'active', '{}', now(), now(), 'u2');

      INSERT INTO studio_workflows (id, tenant_id, name, definition, created_at, updated_at, owner_id)
      VALUES ('wf-a', 'org-a', 'Workflow A', '{}', now(), now(), 'u1'),
             ('wf-b', 'org-b', 'Workflow B', '{}', now(), now(), 'u2');

      INSERT INTO studio_organizations (id, name, slug, status, owner_id, created_at, updated_at)
      VALUES ('org-a', 'Org A', 'org-a', 'active', 'u1', now(), now()),
             ('org-b', 'Org B', 'org-b', 'active', 'u2', now(), now());
    `);

    // As studio_app WITHOUT setting app.tenant_id:
    const unscopedProjects = await asRole("studio_app", async (c) => c.query("SELECT * FROM studio_projects"));
    expect(unscopedProjects.rows).toHaveLength(0);

    const unscopedWorkflows = await asRole("studio_app", async (c) => c.query("SELECT * FROM studio_workflows"));
    expect(unscopedWorkflows.rows).toHaveLength(0);

    const unscopedOrgs = await asRole("studio_app", async (c) => c.query("SELECT * FROM studio_organizations"));
    expect(unscopedOrgs.rows).toHaveLength(0);
  });

  it("query with app.tenant_id set returns only that organization's rows", async () => {
    await pool.query(`
      INSERT INTO studio_projects (id, tenant_id, name, status, settings, created_at, updated_at, owner_id)
      VALUES ('proj-a', 'org-a', 'Project A', 'active', '{}', now(), now(), 'u1'),
             ('proj-b', 'org-b', 'Project B', 'active', '{}', now(), now(), 'u2');
    `);

    const orgAProjects = await asRole("studio_app", async (c) => {
      await c.query("SELECT set_config('app.tenant_id', 'org-a', true)");
      return c.query("SELECT id FROM studio_projects");
    });
    expect(orgAProjects.rows.map((r: any) => r.id)).toEqual(["proj-a"]);

    const orgBProjects = await asRole("studio_app", async (c) => {
      await c.query("SELECT set_config('app.tenant_id', 'org-b', true)");
      return c.query("SELECT id FROM studio_projects");
    });
    expect(orgBProjects.rows.map((r: any) => r.id)).toEqual(["proj-b"]);
  });

  it("cross-org insert is rejected by WITH CHECK constraint under studio_app", async () => {
    await expect(
      asRole("studio_app", async (c) => {
        // Active context is org-a
        await c.query("SELECT set_config('app.tenant_id', 'org-a', true)");
        // Attempting to insert row for org-b
        await c.query(`
          INSERT INTO studio_projects (id, tenant_id, name, status, settings, created_at, updated_at, owner_id)
          VALUES ('proj-foreign', 'org-b', 'Foreign Project', 'active', '{}', now(), now(), 'u1')
        `);
      }),
    ).rejects.toThrow(/violates row-level security policy/);
  });

  it("global system records remain read/execute-only across organizations and reject foreign modification", async () => {
    await pool.query(`
      INSERT INTO studio_agents (id, name, record, owner_id, tenant_id, is_system, created_at, updated_at)
      VALUES ('sys-agent-1', 'Global Helper', '{}', 'system', NULL, true, now(), now());

      INSERT INTO studio_tools (id, name, record, owner_id, tenant_id, is_system, created_at, updated_at)
      VALUES ('sys-tool-1', 'Global Bash', '{}', 'system', NULL, true, now(), now());
    `);

    // org-a can read global system records
    const readFromOrgA = await asRole("studio_app", async (c) => {
      await c.query("SELECT set_config('app.tenant_id', 'org-a', true)");
      const agents = await c.query("SELECT id FROM studio_agents WHERE id = 'sys-agent-1'");
      const tools = await c.query("SELECT id FROM studio_tools WHERE id = 'sys-tool-1'");
      return { agents: agents.rows, tools: tools.rows };
    });
    expect(readFromOrgA.agents).toHaveLength(1);
    expect(readFromOrgA.tools).toHaveLength(1);

    // org-a cannot create a fake system record
    await expect(
      asRole("studio_app", async (c) => {
        await c.query("SELECT set_config('app.tenant_id', 'org-a', true)");
        await c.query(`
          INSERT INTO studio_agents (id, name, record, owner_id, tenant_id, is_system, created_at, updated_at)
          VALUES ('sys-fake', 'Fake System', '{}', 'u1', NULL, true, now(), now())
        `);
      }),
    ).rejects.toThrow(/violates row-level security policy/);

    // org-a cannot modify global system records (0 rows updated)
    const updateResult = await asRole("studio_app", async (c) => {
      await c.query("SELECT set_config('app.tenant_id', 'org-a', true)");
      return c.query("UPDATE studio_agents SET name = 'Mutated' WHERE id = 'sys-agent-1'");
    });
    expect(updateResult.rowCount).toBe(0);

    const actual = await pool.query("SELECT name FROM studio_agents WHERE id = 'sys-agent-1'");
    expect(actual.rows[0].name).toBe("Global Helper");
  });

  it("worker can claim across orgs via SECURITY DEFINER functions but direct table read returns 0 rows", async () => {
    // Seed pending items for two different organizations
    await pool.query(`
      INSERT INTO studio_trigger_events (id, tenant_id, event_type, target_type, target_id, idempotency_key, status)
      VALUES ('ev-org-a', 'org-a', 'task_assignment', 'agent', 'a1', 'k1', 'pending'),
             ('ev-org-b', 'org-b', 'task_assignment', 'agent', 'a2', 'k2', 'pending');

      INSERT INTO studio_routines (id, tenant_id, name, schedule_type, schedule_expr, target_type, target_id, owner_id, enabled, next_run_at)
      VALUES ('rt-org-a', 'org-a', 'Routine A', 'interval', '60s', 'agent', 'a1', 'u1', true, now() - interval '1 minute'),
             ('rt-org-b', 'org-b', 'Routine B', 'interval', '60s', 'agent', 'a2', 'u2', true, now() - interval '1 minute');
    `);

    // Direct unscoped table query by studio_worker returns 0 rows
    const directEvents = await asRole("studio_worker", async (c) => c.query("SELECT * FROM studio_trigger_events"));
    expect(directEvents.rows).toHaveLength(0);

    const directRoutines = await asRole("studio_worker", async (c) => c.query("SELECT * FROM studio_routines"));
    expect(directRoutines.rows).toHaveLength(0);

    // Worker claim function claims pending items across both organizations
    const claimed = await asRole("studio_worker", async (c) => {
      const res = await c.query("SELECT id, tenant_id FROM studio_claim_trigger_events(10, 'worker-1', 60)");
      return res.rows;
    });
    expect(claimed.map((r: any) => r.id)).toEqual(expect.arrayContaining(["ev-org-a", "ev-org-b"]));

    // Handlers execute strictly inside item organization via withOrganization under worker role
    const workerPool = createPostgresPool(databaseUrl!, {
      role: "studio_worker",
      options: `-c search_path=${schema},public`,
    });
    try {
      await withOrganization(workerPool, "org-a", "service", async (client) => {
        const evA = await client.query("SELECT id, tenant_id FROM studio_trigger_events WHERE id = 'ev-org-a'");
        expect(evA.rows).toHaveLength(1);
        const evB = await client.query("SELECT id, tenant_id FROM studio_trigger_events WHERE id = 'ev-org-b'");
        expect(evB.rows).toHaveLength(0);
      });
    } finally {
      await workerPool.end();
    }
  });

  it("wiring via createPostgresPool applies studio_app and studio_worker when ORG_RLS=enforce", async () => {
    const oldRls = process.env.ORG_RLS;
    try {
      process.env.ORG_RLS = "enforce";

      // App pool automatically assumes role studio_app
      const appPool = createPostgresPool(databaseUrl!, { options: `-c search_path=${schema},public` });
      const appRoleCheck = await appPool.query("SELECT current_user");
      expect(appRoleCheck.rows[0].current_user).toBe("studio_app");
      await appPool.end();

      // Worker pool automatically assumes role studio_worker
      const workerPool = createPostgresPool(databaseUrl!, {
        isWorker: true,
        options: `-c search_path=${schema},public`,
      });
      const workerRoleCheck = await workerPool.query("SELECT current_user");
      expect(workerRoleCheck.rows[0].current_user).toBe("studio_worker");
      await workerPool.end();

      // Bootstrap pool with skipRole: true maintains administrative user
      const bootstrapPool = createPostgresPool(databaseUrl!, {
        skipRole: true,
        options: `-c search_path=${schema},public`,
      });
      const bootstrapRoleCheck = await bootstrapPool.query("SELECT current_user");
      expect(bootstrapRoleCheck.rows[0].current_user).not.toBe("studio_app");
      expect(bootstrapRoleCheck.rows[0].current_user).not.toBe("studio_worker");
      await bootstrapPool.end();
    } finally {
      if (oldRls === undefined) delete process.env.ORG_RLS; else process.env.ORG_RLS = oldRls;
    }
  });
});
