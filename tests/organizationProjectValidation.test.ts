import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { requireActiveProject } from "../apps/server/src/organization/projectValidation";

const alice = { userId: "alice", tenantId: "tenant-a" };
const bob = { userId: "bob", tenantId: "tenant-b" };

describe("organization project validation", () => {
  const studio = new InMemoryStudioStore();
  beforeAll(async () => {
    const stamp = new Date().toISOString();
    for (const [id, principal, status] of [
      ["active", alice, "active"], ["retired", alice, "retired"], ["foreign", bob, "active"],
    ] as const) {
      await studio.saveProject({ id, tenantId: principal.tenantId, ownerId: principal.userId, name: id,
        nameSource: "manual", description: "", status, settings: {}, createdAt: stamp, updatedAt: stamp }, principal);
    }
  });
  it.each([undefined, "", "  "])("rejects missing/blank project %p", async projectId => {
    await expect(requireActiveProject(studio, projectId, alice)).rejects.toMatchObject({ status: 400, message: "projectId is required" });
  });
  it.each(["unknown", "foreign"])("hides unknown and foreign project %s", async projectId => {
    await expect(requireActiveProject(studio, projectId, alice)).rejects.toMatchObject({ status: 404, message: "Project not found" });
  });
  it("rejects a retired project", async () => {
    await expect(requireActiveProject(studio, "retired", alice)).rejects.toMatchObject({ status: 409, message: "Project is retired" });
  });
  it("returns an active project in the caller's tenant", async () => {
    expect(await requireActiveProject(studio, "active", alice)).toMatchObject({ id: "active", tenantId: alice.tenantId });
  });
});
