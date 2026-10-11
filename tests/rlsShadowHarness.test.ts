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
      await admin.query(`DROP ROLE IF EXISTS ${appRole}`);
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

  it("documents that organization-scoped store queries should use withOrganization", async () => {
    const policies = await pool.query(
      `SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = current_schema()
          AND tablename IN ('studio_projects', 'studio_agents')
        ORDER BY tablename, policyname`,
    );
    expect(policies.rows.length).toBeGreaterThan(0);
  });
});
