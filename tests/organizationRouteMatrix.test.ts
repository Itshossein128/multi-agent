import { nowIso } from "@multi-agent/types";
import { createStudioRouter } from "../apps/server/src/api/studio";
import {
  OrganizationContextDeniedError,
  OrganizationContextResolver,
} from "../apps/server/src/auth/organizationContext";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";

type Principal = { userId: string; tenantId: string; organizationId: string };

async function seedOrg(store: InMemoryStudioStore, orgId: string, slug: string, ownerId: string) {
  const stamp = nowIso();
  await store.createOrganizationProfile(
    {
      id: orgId,
      name: slug,
      description: "",
      config: {},
      ownerId,
      status: "active",
      slug,
      createdBy: ownerId,
      createdAt: stamp,
      updatedAt: stamp,
    },
    { userId: ownerId, tenantId: orgId },
  );
}

function principalFor(orgId: string, userId: string): Principal {
  return { userId, tenantId: orgId, organizationId: orgId };
}

/**
 * US1 T034 smoke: representative studio routes × same-org / foreign-org / non-member.
 */
describe("organization route matrix smoke", () => {
  const originalEnforcement = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  beforeAll(() => { process.env.ORG_MEMBERSHIP_ENFORCEMENT = "enforce"; });
  afterAll(() => {
    if (originalEnforcement === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT;
    else process.env.ORG_MEMBERSHIP_ENFORCEMENT = originalEnforcement;
  });
  it("same-org succeeds, foreign-org and non-member cannot read cross-org project data", async () => {
    const store = new InMemoryStudioStore();
    await seedOrg(store, "org-a", "acme", "alice");
    await seedOrg(store, "org-b", "beta", "bob");
    const stamp = nowIso();
    await store.saveProject(
      {
        id: "proj-a",
        tenantId: "org-a",
        ownerId: "alice",
        name: "Acme Project",
        nameSource: "manual",
        description: "",
        status: "active",
        settings: {},
        createdAt: stamp,
        updatedAt: stamp,
      },
      principalFor("org-a", "alice"),
    );
    await store.saveProject(
      {
        id: "proj-b",
        tenantId: "org-b",
        ownerId: "bob",
        name: "Beta Project",
        nameSource: "manual",
        description: "",
        status: "active",
        settings: {},
        createdAt: stamp,
        updatedAt: stamp,
      },
      principalFor("org-b", "bob"),
    );

    const aliceA = principalFor("org-a", "alice");
    const bobB = principalFor("org-b", "bob");

    const appFor = (principal: Principal) => createStudioRouter(store, async () => principal);

    // same-org
    const sameProject = await appFor(aliceA).request("/projects/proj-a");
    expect(sameProject.status).toBe(200);
    expect(await sameProject.json()).toMatchObject({ id: "proj-a", tenantId: "org-a" });

    // foreign-org (member of A reading B resource by id)
    const foreignProject = await appFor(aliceA).request("/projects/proj-b");
    expect(foreignProject.status).toBe(404);

    for (const path of ["/projects", "/budgets", "/organization"] as const) {
      const aliceRes = await appFor(aliceA).request(path);
      expect(aliceRes.status).toBe(200);
      const bobRes = await appFor(bobB).request(path);
      expect(bobRes.status).toBe(200);
      if (path === "/projects") {
        const aliceProjects = (await aliceRes.json()) as Array<{ id: string }>;
        const bobProjects = (await bobRes.json()) as Array<{ id: string }>;
        expect(aliceProjects.map((p) => p.id)).toEqual(["proj-a"]);
        expect(bobProjects.map((p) => p.id)).toEqual(["proj-b"]);
      }
    }

    for (const path of ["/projects", "/projects/proj-b", "/budgets", "/organization"]) {
      const denied = await appFor(principalFor("org-b", "alice")).request(path);
      expect(denied.status).toBe(404);
      expect(await denied.json()).toEqual({ error: "Not found" });
    }

    // non-member: BFF/layout must refuse before signing an assertion (resolver gate)
    const resolver = new OrganizationContextResolver(store);
    await expect(resolver.resolve("org-a", "alice")).resolves.toMatchObject({ organizationId: "org-a" });
    await expect(resolver.resolve("org-b", "alice")).rejects.toBeInstanceOf(OrganizationContextDeniedError);
    await expect(resolver.resolveBySlug("acme", "bob")).rejects.toBeInstanceOf(OrganizationContextDeniedError);
    await expect(resolver.resolveBySlug("beta", "bob")).resolves.toMatchObject({ organizationId: "org-b", slug: "beta" });
  });
});
