import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { nowIso } from "@multi-agent/types";
import { OrganizationProfileService } from "../apps/server/src/api/studio/organizationProfileService";
import { ApiError } from "../apps/server/src/api/shared/http";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { resetApplicationData } from "../scripts/db-reset";

describe("organization onboarding after reset (in-memory)", () => {
  it("creates org + exactly one owner membership + audit atomically", async () => {
    const store = new InMemoryStudioStore();
    const service = new OrganizationProfileService(store);
    const userId = "user-1";
    const orgId = randomUUID();
    const profile = await service.create(
      { name: "Acme Studio", description: "demo", slug: "acme-studio" },
      { userId, tenantId: orgId },
    );
    expect(profile.id).toBe(orgId);
    expect(profile.slug).toBe("acme-studio");
    expect(profile.status).toBe("active");

    const members = await store.listMemberships(orgId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId, role: "owner", status: "active", version: 1 });
    expect(await store.listOrganizationsForUser(userId)).toHaveLength(1);
  });

  it("rolls back org create when membership write fails", async () => {
    const store = new InMemoryStudioStore();
    const service = new OrganizationProfileService(store);
    const orgId = randomUUID();
    const spy = jest
      .spyOn(InMemoryStudioStore.prototype, "saveMembership")
      .mockRejectedValue(new Error("injected"));
    await expect(
      service.create({ name: "Broken" }, { userId: "u1", tenantId: orgId }),
    ).rejects.toThrow("injected");
    spy.mockRestore();
    expect(await store.getOrganizationProfile({ userId: "u1", tenantId: orgId })).toBeNull();
    expect(await store.listMemberships(orgId)).toHaveLength(0);
  });
});

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)("organization onboarding after reset (postgres)", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `org_onboard_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("registration-shaped user (null tenant) can create organization as owner; reset clears data", async () => {
    const userId = randomUUID();
    const orgId = randomUUID();
    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status)
       VALUES ($1, $2, 'hash', 'Ada', NULL, 'active')`,
      [userId, `${userId}@example.com`],
    );

    const store = new PostgresStudioStore(pool);
    const service = new OrganizationProfileService(store);
    const profile = await service.create(
      { name: "Fresh Org", slug: `fresh-${orgId.slice(0, 8)}` },
      { userId, tenantId: orgId },
    );
    expect(profile.ownerId).toBe(userId);

    const members = await store.listMemberships(orgId);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");

    const user = await pool.query(`SELECT tenant_id FROM studio_users WHERE id = $1`, [userId]);
    expect(user.rows[0].tenant_id).toBe(orgId);

    await expect(
      service.create({ name: "Again" }, { userId, tenantId: orgId }),
    ).rejects.toBeInstanceOf(ApiError);

    await resetApplicationData(pool, { confirm: true, skipRunningCheck: true });
    expect((await pool.query(`SELECT COUNT(*)::int AS c FROM studio_users`)).rows[0].c).toBe(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS c FROM studio_organizations`)).rows[0].c).toBe(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS c FROM studio_organization_memberships`)).rows[0].c).toBe(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS c FROM studio_migrations`)).rows[0].c).toBeGreaterThan(0);
  });

  it("injected failure after org insert rolls back membership and org", async () => {
    const userId = randomUUID();
    const orgId = randomUUID();
    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, tenant_id, status)
       VALUES ($1, $2, 'hash', NULL, 'active')`,
      [userId, `${userId}@example.com`],
    );
    const store = new PostgresStudioStore(pool);
    const stamp = nowIso();
    const spy = jest
      .spyOn(PostgresStudioStore.prototype, "appendOrganizationAudit")
      .mockRejectedValue(new Error("injected after goal"));
    await expect(
      store.createOrganizationProfile(
        {
          id: orgId,
          name: "X",
          description: "",
          config: {},
          ownerId: userId,
          status: "active",
          slug: `x-${orgId.slice(0, 8)}`,
          createdBy: userId,
          createdAt: stamp,
          updatedAt: stamp,
        },
        { userId, tenantId: orgId },
      ),
    ).rejects.toThrow("injected");
    spy.mockRestore();
    expect((await pool.query(`SELECT COUNT(*)::int AS c FROM studio_organizations`)).rows[0].c).toBe(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS c FROM studio_organization_memberships`)).rows[0].c).toBe(0);
  });
});
