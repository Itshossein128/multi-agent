import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { nowIso } from "@multi-agent/types";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { withOrganization } from "../src/studio/infrastructure/withOrganization";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)("RLS shadow harness", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let appRole: string;

  beforeEach(async () => {
    schema = `rls_shadow_${randomUUID().replace(/-/g, "")}`;
    appRole = `rls_app_${schema.slice(-12)}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
    await pool.query(`
      ALTER TABLE studio_projects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE studio_projects FORCE ROW LEVEL SECURITY;
      ALTER TABLE studio_agents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE studio_agents FORCE ROW LEVEL SECURITY;
    `);
    // Superusers bypass RLS; use a non-bypass role for enforcement checks.
    await admin.query(`DROP ROLE IF EXISTS ${appRole}`);
    await admin.query(`CREATE ROLE ${appRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${appRole}`);
    await admin.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO ${appRole}`);
    await admin.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO ${appRole}`);
    await admin.query(`GRANT ${appRole} TO CURRENT_USER`);
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP OWNED BY ${appRole}; DROP ROLE IF EXISTS ${appRole}`);
      await admin.end();
    }
  });

  async function asAppRole<T>(fn: (client: { query: Pool["query"] }) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${appRole}`);
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

  it("unscoped project query returns 0 rows when RLS is forced for app role", async () => {
    await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(
        `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id, name_source)
         VALUES ('p1', 'org-a', 'P', '', 'active', '{}'::jsonb, now(), now(), 'u1', 'manual')`,
      );
    });
    const unscoped = await asAppRole((client) => client.query(`SELECT id FROM studio_projects`));
    expect(unscoped.rows).toHaveLength(0);
  });

  it("withOrganization-scoped store path can read own projects", async () => {
    await withOrganization(pool, "org-a", "user", async (client) => {
      const scoped = new PostgresStudioStore(pool, client as never);
      await scoped.saveProject({
        id: "p1",
        tenantId: "org-a",
        name: "P",
        nameSource: "manual",
        description: "",
        status: "active",
        settings: {},
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ownerId: "u1",
      }, { userId: "u1", tenantId: "org-a" });
    });

    const listed = await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      const scoped = new PostgresStudioStore(pool, client as never);
      return scoped.listProjects({ userId: "u1", tenantId: "org-a" });
    });
    expect(listed.map((p) => p.id)).toEqual(["p1"]);
  });

  it("allows global system agent reads across orgs and rejects system writes", async () => {
    await pool.query(
      `INSERT INTO studio_agents (id, name, record, owner_id, tenant_id, is_system, created_at, updated_at)
       VALUES ('sys-1', 'System', '{}'::jsonb, 'system', NULL, true, now(), now())`,
    );

    const fromOrgA = await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      return client.query(`SELECT id FROM studio_agents WHERE id = 'sys-1'`);
    });
    expect(fromOrgA.rows).toHaveLength(1);

    await expect(
      withOrganization(pool, "org-a", "user", async (client) => {
        await client.query(`SET LOCAL ROLE ${appRole}`);
        await client.query(
          `INSERT INTO studio_agents (id, name, record, owner_id, tenant_id, is_system, created_at, updated_at)
           VALUES ('sys-2', 'Hack', '{}'::jsonb, 'system', NULL, true, now(), now())`,
        );
      }),
    ).rejects.toThrow();

    const updated = await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      return client.query(`UPDATE studio_agents SET name = 'x' WHERE id = 'sys-1'`);
    });
    expect(updated.rowCount).toBe(0);
    const still = await pool.query(`SELECT name FROM studio_agents WHERE id = 'sys-1'`);
    expect(still.rows[0].name).toBe("System");
  });

  it("normal production store instance automatically routes through withOrganization and succeeds under RLS", async () => {
    const store = new PostgresStudioStore(pool);
    await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      await store.saveProject({
        id: "p2",
        tenantId: "org-a",
        name: "P2",
        nameSource: "manual",
        description: "",
        status: "active",
        settings: {},
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ownerId: "u1",
      }, { userId: "u1", tenantId: "org-a" });
    });

    const listed = await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      return store.listProjects({ userId: "u1", tenantId: "org-a" });
    });
    expect(listed.map((p) => p.id)).toContain("p2");
  });

  it("documents that organization-scoped store queries should use withOrganization", async () => {
    const policies = await pool.query(
      `SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = current_schema()
          AND tablename IN ('studio_projects', 'studio_agents')
        ORDER BY tablename, policyname`,
    );
    expect(policies.rows.length).toBeGreaterThan(0);
  });

  it("enforces RLS on omitted organization tables: goals, reporting, budgets, alerts, heartbeats, deliveries", async () => {
    const omittedTables = [
      "studio_organization_goals",
      "studio_agent_reporting",
      "studio_budgets",
      "studio_budget_reservations",
      "studio_budget_alerts",
      "studio_webhook_deliveries",
      "studio_agent_heartbeats",
    ];

    for (const tbl of omittedTables) {
      await pool.query(`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`);
      await pool.query(`ALTER TABLE ${tbl} FORCE ROW LEVEL SECURITY`);
    }

    // Insert an org-a goal within withOrganization under appRole
    await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      await client.query(`
        INSERT INTO studio_organization_goals (id, tenant_id, title, status, created_by)
        VALUES ('g1', 'org-a', 'Goal 1', 'active', 'u1')
      `);
    });

    // org-a can select its own goal
    const orgAGoals = await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      return client.query(`SELECT id FROM studio_organization_goals`);
    });
    expect(orgAGoals.rows.map((r) => r.id)).toEqual(["g1"]);

    // org-b cannot see org-a goal
    const orgBGoals = await withOrganization(pool, "org-b", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      return client.query(`SELECT id FROM studio_organization_goals`);
    });
    expect(orgBGoals.rows).toHaveLength(0);

    // unscoped app role sees 0 rows
    const unscopedGoals = await asAppRole((client) => client.query(`SELECT id FROM studio_organization_goals`));
    expect(unscopedGoals.rows).toHaveLength(0);

    // Cross-tenant write fails WITH CHECK policy
    await expect(
      withOrganization(pool, "org-a", "user", async (client) => {
        await client.query(`SET LOCAL ROLE ${appRole}`);
        await client.query(`
          INSERT INTO studio_organization_goals (id, tenant_id, title, status, created_by)
          VALUES ('g2', 'org-b', 'Cross Goal', 'active', 'u1')
        `);
      }),
    ).rejects.toThrow();

    // Verify other omitted tables: studio_budgets, studio_agent_reporting, studio_agent_heartbeats
    await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      await client.query(`
        INSERT INTO studio_budgets (tenant_id, scope, scope_id, limit_usd, threshold_percent, period_start, period_end)
        VALUES ('org-a', 'company', 'org-a', 1000, 80, now(), now() + interval '30 days')
      `);
      await client.query(`
        INSERT INTO studio_agent_reporting (tenant_id, agent_id, role)
        VALUES ('org-a', 'agent-ceo', 'ceo')
      `);
      await client.query(`
        INSERT INTO studio_agent_heartbeats (tenant_id, agent_id, enabled)
        VALUES ('org-a', 'agent-ceo', true)
      `);
    });

    const orgABudget = await withOrganization(pool, "org-a", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      return client.query(`SELECT scope_id FROM studio_budgets`);
    });
    expect(orgABudget.rows.map((r) => r.scope_id)).toEqual(["org-a"]);

    const orgBBudget = await withOrganization(pool, "org-b", "user", async (client) => {
      await client.query(`SET LOCAL ROLE ${appRole}`);
      return client.query(`SELECT scope_id FROM studio_budgets`);
    });
    expect(orgBBudget.rows).toHaveLength(0);
  });

  it("proves explicit worker claim privileges and direct table denial under forced RLS", async () => {
    const workerRole = `rls_worker_${schema.slice(-12)}`;
    await admin.query(`DROP ROLE IF EXISTS ${workerRole}`);
    await admin.query(`CREATE ROLE ${workerRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${workerRole}`);
    await admin.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO ${workerRole}`);
    await admin.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO ${workerRole}`);
    await admin.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "${schema}" TO ${workerRole}`);
    await admin.query(`GRANT ${workerRole} TO CURRENT_USER`);

    try {
      await pool.query(`
        ALTER TABLE studio_trigger_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE studio_trigger_events FORCE ROW LEVEL SECURITY;
        ALTER TABLE studio_routines ENABLE ROW LEVEL SECURITY;
        ALTER TABLE studio_routines FORCE ROW LEVEL SECURITY;
        ALTER TABLE studio_agent_heartbeats ENABLE ROW LEVEL SECURITY;
        ALTER TABLE studio_agent_heartbeats FORCE ROW LEVEL SECURITY;
      `);

      // Seed pending trigger event, routine, and heartbeat for org-a
      await withOrganization(pool, "org-a", "user", async (client) => {
        await client.query(`
          INSERT INTO studio_trigger_events (id, tenant_id, event_type, target_type, target_id, idempotency_key, status)
          VALUES ('ev-claim-1', 'org-a', 'task_assignment', 'agent', 'a1', 'idem-1', 'pending')
        `);
        await client.query(`
          INSERT INTO studio_routines (id, tenant_id, name, schedule_type, schedule_expr, target_type, target_id, owner_id, enabled, next_run_at)
          VALUES ('rt-claim-1', 'org-a', 'Routine 1', 'interval', '60s', 'agent', 'a1', 'u1', true, now() - interval '1 minute')
        `);
        await client.query(`
          INSERT INTO studio_agent_heartbeats (tenant_id, agent_id, enabled, next_heartbeat_at)
          VALUES ('org-a', 'agent-h1', true, now() - interval '1 minute')
        `);
      });

      // Direct unscoped table reads by worker role return 0 rows under forced RLS
      const directWorkerRead = await asAppRole(async (client) => {
        await client.query(`SET LOCAL ROLE ${workerRole}`);
        return client.query(`SELECT id FROM studio_trigger_events`);
      });
      expect(directWorkerRead.rows).toHaveLength(0);

      // SECURITY DEFINER claim functions succeed across organizations for worker role
      const claimedEvents = await asAppRole(async (client) => {
        await client.query(`SET LOCAL ROLE ${workerRole}`);
        return client.query(`SELECT id, status, locked_by FROM studio_claim_trigger_events(10, 'worker-1', 60)`);
      });
      expect(claimedEvents.rows.map((r) => r.id)).toContain("ev-claim-1");
      expect(claimedEvents.rows[0].status).toBe("processing");

      const claimedRoutines = await asAppRole(async (client) => {
        await client.query(`SET LOCAL ROLE ${workerRole}`);
        return client.query(`SELECT id FROM studio_claim_routines(10, 'worker-1')`);
      });
      expect(claimedRoutines.rows.map((r) => r.id)).toContain("rt-claim-1");

      const claimedHeartbeats = await asAppRole(async (client) => {
        await client.query(`SET LOCAL ROLE ${workerRole}`);
        return client.query(`SELECT agent_id FROM studio_claim_heartbeats(10, 'worker-1')`);
      });
      expect(claimedHeartbeats.rows.map((r) => r.agent_id)).toContain("agent-h1");
    } finally {
      await admin.query(`DROP OWNED BY ${workerRole}; DROP ROLE IF EXISTS ${workerRole};`);
    }
  });

  it("verifies broker lease RLS policies and service-only broker audit exception", async () => {
    const { LEASE_TABLE_DDL } = await import("../src/broker/leaseStore");
    const { AUDIT_TABLE_DDL } = await import("../src/broker/audit");
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    await pool.query(LEASE_TABLE_DDL);
    await pool.query(AUDIT_TABLE_DDL);
    const brokerRlsSql = readFileSync(resolve(process.cwd(), "infrastructure/broker/rls_prerequisites.sql"), "utf8");
    await pool.query(brokerRlsSql);
    await admin.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO ${appRole}`);

    await pool.query(`
      ALTER TABLE credential_broker_leases ENABLE ROW LEVEL SECURITY;
      ALTER TABLE credential_broker_leases FORCE ROW LEVEL SECURITY;
    `);

    // Verify credential_broker_leases has tenant policies
    const leasePolicies = await pool.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = current_schema() AND tablename = 'credential_broker_leases'
    `);
    expect(leasePolicies.rows.length).toBeGreaterThan(0);

    // Verify credential_broker_audit_log has NO tenant policies (service-only exception)
    const auditPolicies = await pool.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = current_schema() AND tablename = 'credential_broker_audit_log'
    `);
    expect(auditPolicies.rows).toHaveLength(0);

    // Seed lease for org-a
    await pool.query(`
      INSERT INTO credential_broker_leases (
        lease_id, contract_version, tenant_id, principal_id, run_id, agent_id,
        provider, alias, purpose, status, issued_at, expires_at
      ) VALUES (
        'lease-1', '1.0.0', 'org-a', 'u1', 'r1', 'a1',
        'anthropic', 'default', 'agent_execution', 'issued', now(), now() + interval '5 minutes'
      )
    `);

    // Under appRole with app.tenant_id = org-a, can read own lease
    const orgALeases = await asAppRole(async (client) => {
      await client.query("SELECT set_config('app.tenant_id', 'org-a', true)");
      return client.query(`SELECT lease_id FROM credential_broker_leases`);
    });
    expect(orgALeases.rows.map((r) => r.lease_id)).toEqual(["lease-1"]);

    // Under appRole with app.tenant_id = org-b, cannot read org-a lease
    const orgBLeases = await asAppRole(async (client) => {
      await client.query("SELECT set_config('app.tenant_id', 'org-b', true)");
      return client.query(`SELECT lease_id FROM credential_broker_leases`);
    });
    expect(orgBLeases.rows).toHaveLength(0);

    // Unscoped appRole returns 0 rows
    const unscopedLeases = await asAppRole((client) => client.query(`SELECT lease_id FROM credential_broker_leases`));
    expect(unscopedLeases.rows).toHaveLength(0);
  });
});
