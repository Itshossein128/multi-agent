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
});
