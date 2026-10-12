import { nowIso } from "@multi-agent/types";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import {
  OrganizationContextResolver,
  OrganizationContextDeniedError,
} from "../apps/server/src/auth/organizationContext";

async function seedOrg(
  store: InMemoryStudioStore,
  orgId: string,
  slug: string,
  ownerId: string,
  status: "active" | "suspended" | "deleting" = "active",
) {
  const stamp = nowIso();
  await store.createOrganizationProfile(
    {
      id: orgId,
      name: slug,
      description: "",
      config: {},
      ownerId,
      status,
      slug,
      createdBy: ownerId,
      createdAt: stamp,
      updatedAt: stamp,
    },
    { userId: ownerId, tenantId: orgId },
  );
}

describe("OrganizationContextResolver", () => {
  it("resolves active member with role and permissions", async () => {
    const store = new InMemoryStudioStore();
    await seedOrg(store, "org-a", "acme", "user-1");
    const resolver = new OrganizationContextResolver(store, { ttlMs: 60_000 });
    const ctx = await resolver.resolve("org-a", "user-1");
    expect(ctx.organizationId).toBe("org-a");
    expect(ctx.userId).toBe("user-1");
    expect(ctx.role).toBe("owner");
    expect(ctx.principalKind).toBe("user");
    expect(ctx.permissions).toContain("org.read");
    expect(ctx.membershipVersion).toBe(1);
  });

  it("denies non-member, suspended org, and removed member", async () => {
    const store = new InMemoryStudioStore();
    await seedOrg(store, "org-a", "acme", "user-1");
    const resolver = new OrganizationContextResolver(store, { ttlMs: 60_000 });

    await expect(resolver.resolve("org-a", "stranger")).rejects.toBeInstanceOf(OrganizationContextDeniedError);

    await seedOrg(store, "org-b", "paused", "user-2", "suspended");
    await expect(resolver.resolve("org-b", "user-2")).rejects.toBeInstanceOf(OrganizationContextDeniedError);

    const stamp = nowIso();
    await store.saveMembership({
      organizationId: "org-a",
      userId: "user-1",
      role: "owner",
      status: "removed",
      version: 2,
      invitedBy: "user-1",
      createdAt: stamp,
      updatedAt: stamp,
      removedAt: stamp,
    });
    await expect(resolver.resolve("org-a", "user-1")).rejects.toBeInstanceOf(OrganizationContextDeniedError);
  });

  it("caches by membership version and invalidates on bump", async () => {
    const store = new InMemoryStudioStore();
    await seedOrg(store, "org-a", "acme", "user-1");
    const resolver = new OrganizationContextResolver(store, { ttlMs: 60_000 });

    const first = await resolver.resolve("org-a", "user-1");
    expect(first.membershipVersion).toBe(1);

    const spy = jest.spyOn(store, "getMembership");
    const cached = await resolver.resolve("org-a", "user-1");
    expect(cached.membershipVersion).toBe(1);
    expect(spy).toHaveBeenCalledWith("org-a", "user-1");

    const stamp = nowIso();
    await store.saveMembership({
      organizationId: "org-a",
      userId: "user-1",
      role: "admin",
      status: "active",
      version: 3,
      invitedBy: "user-1",
      createdAt: stamp,
      updatedAt: stamp,
      removedAt: null,
    });
    resolver.invalidate("org-a", "user-1");
    const bumped = await resolver.resolve("org-a", "user-1");
    expect(bumped.role).toBe("admin");
    expect(bumped.membershipVersion).toBe(3);
    spy.mockRestore();
  });
  it("rechecks membership version without an explicit local invalidation", async () => {
    const store = new InMemoryStudioStore();
    await seedOrg(store, "org-a", "acme", "user-1");
    const resolver = new OrganizationContextResolver(store);
    await resolver.resolve("org-a", "user-1");
    const membership = (await store.getMembership("org-a", "user-1"))!;
    await store.saveMembership({ ...membership, role: "viewer", version: 2 });
    expect(await resolver.resolve("org-a", "user-1")).toMatchObject({ role: "viewer", membershipVersion: 2 });
    await store.saveMembership({ ...membership, status: "removed", version: 3 });
    await expect(resolver.resolve("org-a", "user-1")).rejects.toBeInstanceOf(OrganizationContextDeniedError);
  });

  it("denies a suspended organization even when context was cached", async () => {
    const store = new InMemoryStudioStore();
    await seedOrg(store, "org-a", "acme", "user-1");
    const resolver = new OrganizationContextResolver(store);
    await resolver.resolve("org-a", "user-1");
    const profile = (await store.getOrganizationProfile({ userId: "user-1", tenantId: "org-a" }))!;
    jest.spyOn(store, "getOrganizationProfile").mockResolvedValue({ ...profile, status: "suspended" });
    await expect(resolver.resolve("org-a", "user-1")).rejects.toBeInstanceOf(OrganizationContextDeniedError);
  });

});
