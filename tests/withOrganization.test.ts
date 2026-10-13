import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { readOrganizationGucs, withOrganization } from "../src/studio/infrastructure/withOrganization";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)("withOrganization", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `with_org_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("sets app.tenant_id and app.principal_kind for the duration of the callback", async () => {
    const seen = await withOrganization(pool, "org-a", "user", async (client) => {
      return readOrganizationGucs(client);
    });
    expect(seen).toEqual({ tenantId: "org-a", principalKind: "user" });
  });

  it("restores GUCs after error (transaction rolled back)", async () => {
    await expect(
      withOrganization(pool, "org-b", "service", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const outside = await pool.query(
      `SELECT current_setting('app.tenant_id', true) AS tenant_id,
              current_setting('app.principal_kind', true) AS principal_kind`,
    );
    expect(outside.rows[0].tenant_id ?? "").toBe("");
    expect(outside.rows[0].principal_kind ?? "").toBe("");
  });

  it("rejects blank organizationId", async () => {
    await expect(withOrganization(pool, "  ", "user", async () => null)).rejects.toThrow(/organizationId/i);
  });

  it("exposes ambient scoped client via scopedDbClient during withOrganization execution", async () => {
    const { scopedDbClient } = await import("../src/studio/infrastructure/withOrganization");
    expect(scopedDbClient(pool)).toBeUndefined();
    await withOrganization(pool, "org-c", "user", async (client) => {
      const scoped = scopedDbClient(pool);
      expect(scoped).toBeDefined();
      const res = await scoped!.query("SELECT 1 AS num");
      expect(res.rows[0].num).toBe(1);
    });
    expect(scopedDbClient(pool)).toBeUndefined();
  });

  it("supports nested withOrganization for the same organization via savepoint", async () => {
    await withOrganization(pool, "org-d", "user", async (client) => {
      await client.query(
        `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id, name_source)
         VALUES ('p-outer', 'org-d', 'Outer', '', 'active', '{}'::jsonb, now(), now(), 'u1', 'manual')`,
      );

      // Inner call succeeds
      await withOrganization(pool, "org-d", "user", async (innerClient) => {
        await innerClient.query(
          `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id, name_source)
           VALUES ('p-inner', 'org-d', 'Inner', '', 'active', '{}'::jsonb, now(), now(), 'u1', 'manual')`,
        );
      });

      // Inner call fails: savepoint rollback should preserve outer row
      await expect(
        withOrganization(pool, "org-d", "user", async (innerClient) => {
          await innerClient.query(
            `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id, name_source)
             VALUES ('p-fail', 'org-d', 'Fail', '', 'active', '{}'::jsonb, now(), now(), 'u1', 'manual')`,
          );
          throw new Error("inner error");
        }),
      ).rejects.toThrow("inner error");

      // Verify outer transaction is intact and p-fail was rolled back
      const res = await client.query("SELECT id FROM studio_projects ORDER BY id");
      expect(res.rows.map((r) => r.id)).toEqual(["p-inner", "p-outer"]);
    });

    const finalRes = await pool.query("SELECT id FROM studio_projects ORDER BY id");
    expect(finalRes.rows.map((r) => r.id)).toEqual(["p-inner", "p-outer"]);
  });

  it("rejects cross-organization nested withOrganization calls", async () => {
    const { OrganizationScopeError } = await import("../src/studio/infrastructure/withOrganization");
    await withOrganization(pool, "org-d1", "user", async () => {
      await expect(
        withOrganization(pool, "org-d2", "user", async () => {
          return null;
        }),
      ).rejects.toThrow(OrganizationScopeError ?? /Cross-organization/);
    });
  });
});
