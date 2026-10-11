import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { nowIso } from "@multi-agent/types";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import type { OrganizationMembership, StudioStore } from "../src/studio/contracts";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

async function seedUser(store: StudioStore, pool: Pool | null, userId: string) {
  if (pool) {
    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, tenant_id, status)
       VALUES ($1, $2, 'hash', NULL, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@example.com`],
    );
  } else {
    await store.setUserLastOrganization(userId, null);
  }
}

function membership(
  organizationId: string,
  userId: string,
  overrides: Partial<OrganizationMembership> = {},
): OrganizationMembership {
  const stamp = nowIso();
  return {
    organizationId,
    userId,
    role: "member",
    status: "active",
    invitedBy: userId,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    removedAt: null,
    ...overrides,
  };
}

describe("organization membership store (in-memory)", () => {
  it("creates, gets, lists, and bumps version on update", async () => {
    const store = new InMemoryStudioStore();
    const orgId = "org-1";
    const userId = "user-1";
    const stamp = nowIso();
    await store.createOrganizationProfile(
      {
        id: orgId,
        name: "Acme",
        description: "",
        config: {},
        ownerId: userId,
        status: "active",
        slug: "acme",
        createdBy: userId,
        createdAt: stamp,
        updatedAt: stamp,
      },
      { userId, tenantId: orgId },
    );

    const owner = await store.getMembership(orgId, userId);
    expect(owner?.role).toBe("owner");
    expect(owner?.status).toBe("active");
    expect(owner?.version).toBe(1);

    await seedUser(store, null, "user-2");
    const saved = await store.saveMembership(
      membership(orgId, "user-2", { role: "admin", version: 1 }),
    );
    expect(saved.role).toBe("admin");

    const updated = await store.saveMembership({
      ...saved,
      role: "member",
      version: saved.version + 1,
      updatedAt: nowIso(),
    });
    expect(updated.version).toBe(2);
    expect(updated.role).toBe("member");

    const listed = await store.listMemberships(orgId);
    expect(listed.map((m) => m.userId).sort()).toEqual(["user-1", "user-2"]);
    expect(await store.listOrganizationsForUser(userId)).toHaveLength(1);
  });
});

(databaseUrl ? describe : describe.skip)("organization membership store (postgres)", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let store: PostgresStudioStore;

  beforeEach(async () => {
    schema = `org_mem_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
    store = new PostgresStudioStore(pool);
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("persists membership contract on postgres", async () => {
    const orgId = randomUUID();
    const userId = randomUUID();
    await seedUser(store, pool, userId);
    const stamp = nowIso();
    await store.createOrganizationProfile(
      {
        id: orgId,
        name: "Acme",
        description: "",
        config: {},
        ownerId: userId,
        status: "active",
        slug: `acme-${orgId.slice(0, 8)}`,
        createdBy: userId,
        createdAt: stamp,
        updatedAt: stamp,
      },
      { userId, tenantId: orgId },
    );

    const owner = await store.getMembership(orgId, userId);
    expect(owner?.role).toBe("owner");
    expect(await store.listOrganizationsForUser(userId)).toHaveLength(1);

    const user2 = randomUUID();
    await seedUser(store, pool, user2);
    await store.saveMembership(membership(orgId, user2, { role: "viewer", version: 1 }));
    const bumped = await store.saveMembership(
      membership(orgId, user2, { role: "member", version: 2 }),
    );
    expect(bumped.version).toBe(2);
    expect((await store.listMemberships(orgId)).length).toBe(2);
  });
});
