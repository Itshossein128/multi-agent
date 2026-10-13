import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { OrganizationProfileService } from "../apps/server/src/api/studio/organizationProfileService";
import { registerOrganizationProfileRoutes } from "../apps/server/src/api/studio/organizationProfileRoutes";
import { requireOrganizationContext, respondWithApiError, type PrincipalVariables } from "../apps/server/src/api/shared/http";
import type { RequestPrincipal } from "../apps/server/src/auth/principal";
import type { StudioPrincipal } from "../src/studio/contracts";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

describe("Organization Profile & Slug Editing (T099 / F10)", () => {
  const oldEnforcement = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  beforeAll(() => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = "enforce";
  });
  afterAll(() => {
    if (oldEnforcement === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT;
    else process.env.ORG_MEMBERSHIP_ENFORCEMENT = oldEnforcement;
  });
  describe("InMemoryStudioStore", () => {
    it("updates name, description, config, and slug while preserving id and memberships", async () => {
      const store = new InMemoryStudioStore();
      const principal: StudioPrincipal = { userId: "user-1", tenantId: "org-1" };

      await store.createOrganizationProfile(
        {
          id: "org-1",
          name: "Original Name",
          description: "Original Desc",
          config: { theme: "dark" },
          ownerId: "user-1",
          status: "active",
          slug: "original-slug",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        principal,
      );

      const updated = await (store as any).updateOrganizationProfile(
        {
          name: "Updated Name",
          description: "Updated Desc",
          config: { theme: "light" },
          slug: "new-slug",
        },
        principal,
      );

      expect(updated.id).toBe("org-1");
      expect(updated.name).toBe("Updated Name");
      expect(updated.description).toBe("Updated Desc");
      expect(updated.config).toEqual({ theme: "light" });
      expect(updated.slug).toBe("new-slug");

      // Old slug lookup returns null
      expect(await store.getOrganizationBySlug("original-slug")).toBeNull();
      // New slug lookup returns profile
      const found = await store.getOrganizationBySlug("new-slug");
      expect(found).not.toBeNull();
      expect(found?.id).toBe("org-1");

      // Memberships preserved
      const members = await store.listMemberships("org-1");
      expect(members.length).toBeGreaterThan(0);
      expect(members.some((m) => m.userId === "user-1" && m.role === "owner")).toBe(true);
    });

    it("rejects duplicate slug", async () => {
      const store = new InMemoryStudioStore();
      const p1: StudioPrincipal = { userId: "user-1", tenantId: "org-1" };
      const p2: StudioPrincipal = { userId: "user-2", tenantId: "org-2" };

      await store.createOrganizationProfile(
        {
          id: "org-1",
          name: "Org One",
          description: "",
          config: {},
          ownerId: "user-1",
          status: "active",
          slug: "slug-one",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        p1,
      );

      await store.createOrganizationProfile(
        {
          id: "org-2",
          name: "Org Two",
          description: "",
          config: {},
          ownerId: "user-2",
          status: "active",
          slug: "slug-two",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        p2,
      );

      await expect(
        (store as any).updateOrganizationProfile({ slug: "slug-two" }, p1),
      ).rejects.toThrow(/slug/i);
    });
  });

  describe("HTTP Routes & Permissions (PATCH /organizations/current)", () => {
    function createTestApp(store: InMemoryStudioStore) {
      const app = new Hono<{ Variables: PrincipalVariables }>();
      const service = new OrganizationProfileService(store);

      app.use("*", async (c, next) => {
        const userId = c.req.header("x-user-id") ?? "user-owner";
        const tenantId = c.req.header("x-tenant-id") ?? "org-1";

        const p: RequestPrincipal = {
          userId,
          tenantId,
          principalKind: "user",
        };
        c.set("principal", p);
        await next();
      });

      app.use("*", requireOrganizationContext(store));
      app.onError(respondWithApiError);
      registerOrganizationProfileRoutes(app, service);
      return app;
    }

    it("allows owner to update profile and slug", async () => {
      const store = new InMemoryStudioStore();
      const p: StudioPrincipal = { userId: "user-owner", tenantId: "org-1" };
      await store.createOrganizationProfile(
        {
          id: "org-1",
          name: "Acme",
          description: "Acme Desc",
          config: {},
          ownerId: "user-owner",
          status: "active",
          slug: "acme-slug",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        p,
      );

      const app = createTestApp(store);
      const res = await app.request("/organizations/current", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "user-owner",
          "x-tenant-id": "org-1",
        },
        body: JSON.stringify({ name: "Acme Corp", slug: "acme-corp" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("Acme Corp");
      expect(body.slug).toBe("acme-corp");
      expect(body.id).toBe("org-1");
    });

    it("allows admin to update profile and slug", async () => {
      const store = new InMemoryStudioStore();
      const p: StudioPrincipal = { userId: "user-owner", tenantId: "org-1" };
      await store.createOrganizationProfile(
        {
          id: "org-1",
          name: "Acme",
          description: "Acme Desc",
          config: {},
          ownerId: "user-owner",
          status: "active",
          slug: "acme-slug",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        p,
      );

      await store.saveMembership({
        organizationId: "org-1",
        userId: "user-admin",
        role: "admin",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const app = createTestApp(store);
      const res = await app.request("/organizations/current", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "user-admin",
          "x-tenant-id": "org-1",
        },
        body: JSON.stringify({ name: "Acme Renovated", slug: "acme-renovated" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("Acme Renovated");
      expect(body.slug).toBe("acme-renovated");
    });

    it("denies member with 403 Forbidden", async () => {
      const store = new InMemoryStudioStore();
      const p: StudioPrincipal = { userId: "user-owner", tenantId: "org-1" };
      await store.createOrganizationProfile(
        {
          id: "org-1",
          name: "Acme",
          description: "Acme Desc",
          config: {},
          ownerId: "user-owner",
          status: "active",
          slug: "acme-slug",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        p,
      );

      await store.saveMembership({
        organizationId: "org-1",
        userId: "user-member",
        role: "member",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const app = createTestApp(store);
      const res = await app.request("/organizations/current", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "user-member",
          "x-tenant-id": "org-1",
        },
        body: JSON.stringify({ name: "Hacked Name" }),
      });

      expect(res.status).toBe(403);
    });

    it("denies viewer with 403 Forbidden", async () => {
      const store = new InMemoryStudioStore();
      const p: StudioPrincipal = { userId: "user-owner", tenantId: "org-1" };
      await store.createOrganizationProfile(
        {
          id: "org-1",
          name: "Acme",
          description: "Acme Desc",
          config: {},
          ownerId: "user-owner",
          status: "active",
          slug: "acme-slug",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        p,
      );

      await store.saveMembership({
        organizationId: "org-1",
        userId: "user-viewer",
        role: "viewer",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const app = createTestApp(store);
      const res = await app.request("/organizations/current", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "user-viewer",
          "x-tenant-id": "org-1",
        },
        body: JSON.stringify({ name: "Hacked Name" }),
      });

      expect(res.status).toBe(403);
    });

    it("rejects invalid slug with 400", async () => {
      const store = new InMemoryStudioStore();
      const p: StudioPrincipal = { userId: "user-owner", tenantId: "org-1" };
      await store.createOrganizationProfile(
        {
          id: "org-1",
          name: "Acme",
          description: "Acme Desc",
          config: {},
          ownerId: "user-owner",
          status: "active",
          slug: "acme-slug",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        p,
      );

      const app = createTestApp(store);
      const res = await app.request("/organizations/current", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "user-owner",
          "x-tenant-id": "org-1",
        },
        body: JSON.stringify({ slug: "INVALID SLUG WITH SPACES & UPPERCASE" }),
      });

      expect(res.status).toBe(400);
    });
  });

  (databaseUrl ? describe : describe.skip)("PostgresStudioStore", () => {
    let admin: Pool;
    let pool: Pool;
    let schema: string;
    let store: PostgresStudioStore;

    beforeEach(async () => {
      schema = `org_prof_${randomUUID().replace(/-/g, "")}`;
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

    it("updates profile and slug in Postgres, rejecting duplicates", async () => {
      const orgId = randomUUID();
      const userId = randomUUID();
      await pool.query(
        `INSERT INTO studio_users (id, email, password_hash, tenant_id, status)
         VALUES ($1, $2, 'hash', NULL, 'active')`,
        [userId, `${userId}@example.com`],
      );

      const principal: StudioPrincipal = { userId, tenantId: orgId };
      await store.createOrganizationProfile(
        {
          id: orgId,
          name: "Original PG Org",
          description: "Original Description",
          config: { tier: "enterprise" },
          ownerId: userId,
          status: "active",
          slug: "pg-orig-slug",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        principal,
      );

      const updated = await store.updateOrganizationProfile(
        {
          name: "Renamed PG Org",
          description: "New Description",
          config: { tier: "growth" },
          slug: "pg-new-slug",
        },
        principal,
      );

      expect(updated.id).toBe(orgId);
      expect(updated.name).toBe("Renamed PG Org");
      expect(updated.description).toBe("New Description");
      expect(updated.config).toEqual({ tier: "growth" });
      expect(updated.slug).toBe("pg-new-slug");

      // Old slug lookup returns null
      expect(await store.getOrganizationBySlug("pg-orig-slug")).toBeNull();
      // New slug lookup returns profile
      const found = await store.getOrganizationBySlug("pg-new-slug");
      expect(found).not.toBeNull();
      expect(found?.id).toBe(orgId);

      // Create another org and try to update to same slug
      const orgId2 = randomUUID();
      const userId2 = randomUUID();
      await pool.query(
        `INSERT INTO studio_users (id, email, password_hash, tenant_id, status)
         VALUES ($1, $2, 'hash', NULL, 'active')`,
        [userId2, `${userId2}@example.com`],
      );
      const principal2: StudioPrincipal = { userId: userId2, tenantId: orgId2 };
      await store.createOrganizationProfile(
        {
          id: orgId2,
          name: "Second PG Org",
          description: "",
          config: {},
          ownerId: userId2,
          status: "active",
          slug: "pg-second-slug",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        principal2,
      );

      await expect(
        store.updateOrganizationProfile({ slug: "pg-new-slug" }, principal2),
      ).rejects.toThrow(/slug.*already in use/i);
    });
  });
});
