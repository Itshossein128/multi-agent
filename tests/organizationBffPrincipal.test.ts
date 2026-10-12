jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next-auth", () => jest.fn(() => ({ auth: jest.fn() })), { virtual: true });
jest.mock("next-auth/providers/credentials", () => jest.fn((config) => config), { virtual: true });
jest.mock("@/lib/db", () => ({ getDbPool: jest.fn() }));
import { auth, getAuthenticatedPrincipal } from "../apps/web/src/auth";
import { getDbPool } from "../apps/web/src/lib/db";
import { GET as projects } from "../apps/web/src/app/api/projects/route";
import { POST as createOrganization } from "../apps/web/src/app/api/organizations/route";
jest.mock("@/lib/projectsWorkspaces", () => ({ listProjects: jest.fn(async () => []), createOrganization: jest.fn(async (_input, principal) => principal) }));
import { listProjects, createOrganization as saveOrganization } from "../apps/web/src/lib/projectsWorkspaces";
const query = jest.fn();
beforeEach(() => { jest.clearAllMocks(); (auth as jest.Mock).mockResolvedValue({ user: { id: "alice", tenantId: "org-a" } }); (getDbPool as jest.Mock).mockReturnValue({ query }); });
test("project BFF derives organization from URL despite stale session", async () => {
  query.mockResolvedValue({ rows: [{ id: "org-b" }] });
  const response = await projects(new Request("http://web/api/o/beta/projects"));
  expect(response.status).toBe(200);
  expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ userId: "alice", tenantId: "org-b" }), "active");
  expect(query.mock.calls[0][1]).toEqual(["beta", "alice"]);
});
test("unknown and non-member slug return the same 404 without upstream access", async () => {
  query.mockResolvedValue({ rows: [] });
  for (const slug of ["foreign", "missing"]) {
    const response = await projects(new Request(`http://web/api/o/${slug}/projects`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  }
  expect(listProjects).not.toHaveBeenCalled();
});
test("a member can create a second organization with a fresh identity", async () => {
  query.mockResolvedValue({ rows: [{ id: "org-a", tenant_id: "org-a" }] });
  const response = await createOrganization(new Request("http://web/api/organizations", { method: "POST", body: JSON.stringify({ name: "Beta" }) }));
  expect(response.status).toBe(201);
  expect(saveOrganization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "alice" }));
  expect((saveOrganization as jest.Mock).mock.calls[0][1].tenantId).not.toBe("org-a");
});

test("legacy BFF cannot trust an arbitrary tenant supplied through a session update", async () => {
  query.mockResolvedValue({ rows: [] });
  await expect(getAuthenticatedPrincipal()).resolves.toBeNull();
  expect(query).toHaveBeenCalled();
});
