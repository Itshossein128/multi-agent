import {
  createAgentRecord,
  createSingleAgentWorkflow,
  type AgentRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
} from "../src/auth/internalPrincipal";

const TEST_SECRET = "projects-workspaces-test-secret";
const alice: AuthenticatedPrincipal = { userId: "alice-user", tenantId: "tenant-alpha" };
const eve: AuthenticatedPrincipal = { userId: "eve-user", tenantId: "tenant-beta" };

function authHeaders(principal?: AuthenticatedPrincipal): HeadersInit {
  if (!principal) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    "X-Multi-Agent-Principal": createInternalPrincipalAssertion(principal, TEST_SECRET),
  };
}

function req(path: string, method = "GET", body?: unknown, principal?: AuthenticatedPrincipal) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: authHeaders(principal),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createProjectWithRepo(
  app: ReturnType<typeof createStudioRouter>,
  principal: AuthenticatedPrincipal,
  name: string,
) {
  const project = await json(await app.fetch(req("/projects", "POST", { name }, principal)));
  const repo = await json(
    await app.fetch(
      req(
        `/projects/${project.id}/repositories`,
        "POST",
        { name: "app", source: "https://example.com/app.git", defaultBranch: "main" },
        principal,
      ),
    ),
  );
  return { project, repo };
}

describe("Studio projects & workspaces", () => {
  let store: InMemoryStudioStore;
  let app: ReturnType<typeof createStudioRouter>;
  let agent: AgentRecord;
  let workflow: WorkflowDefinition;

  beforeEach(async () => {
    store = new InMemoryStudioStore();
    agent = { ...createAgentRecord({ name: "Alpha" }), id: "agent-alpha" };
    workflow = { ...createSingleAgentWorkflow(agent, "WF"), id: "wf-alpha" };
    await store.saveAgent(agent, alice);
    await store.saveWorkflow(workflow, alice);
    app = createStudioRouter(store, (request) => {
      const token = request.headers.get("X-Multi-Agent-Principal");
      if (!token) return null;
      try {
        return verifyInternalPrincipalAssertion(token, TEST_SECRET);
      } catch {
        return null;
      }
    });
  });

  it("starts empty and supports create, rename, retire", async () => {
    const listProjects = await app.fetch(req("/projects", "GET", undefined, alice));
    expect(listProjects.status).toBe(200);
    expect(await json(listProjects)).toEqual([]);

    const listWorkspaces = await app.fetch(req("/workspaces", "GET", undefined, alice));
    expect(listWorkspaces.status).toBe(200);
    expect(await json(listWorkspaces)).toEqual([]);

    const createdProject = await json(await app.fetch(req("/projects", "POST", { name: "Alpha" }, alice)));
    expect(createdProject.name).toBe("Alpha");
    expect(createdProject.nameSource).toBe("manual");
    expect(createdProject.usesDefaultWorkspace).toBe(true);

    const renamed = await json(
      await app.fetch(req(`/projects/${createdProject.id}`, "PATCH", { name: "Alpha Renamed" }, alice)),
    );
    expect(renamed.name).toBe("Alpha Renamed");

    const repo = await json(
      await app.fetch(
        req(
          `/projects/${createdProject.id}/repositories`,
          "POST",
          { name: "app", source: "https://example.com/app.git", defaultBranch: "main" },
          alice,
        ),
      ),
    );
    const createdWorkspace = await json(
      await app.fetch(
        req("/workspaces", "POST", { name: "Lab", projectId: createdProject.id }, alice),
      ),
    );
    expect(createdWorkspace.name).toBe("Lab");
    expect(createdWorkspace.projectId).toBe(createdProject.id);
    expect(repo.id).toBeDefined();

    const renamedWs = await json(
      await app.fetch(req(`/workspaces/${createdWorkspace.id}`, "PATCH", { name: "Lab 2" }, alice)),
    );
    expect(renamedWs.name).toBe("Lab 2");

    await app.fetch(req(`/projects/${createdProject.id}/retire`, "POST", undefined, alice));
    const activeProjects = await json(await app.fetch(req("/projects", "GET", undefined, alice)));
    expect(activeProjects.some((p: { id: string }) => p.id === createdProject.id)).toBe(false);

    await app.fetch(req(`/workspaces/${createdWorkspace.id}/retire`, "POST", undefined, alice));
    const activeWorkspaces = await json(await app.fetch(req("/workspaces", "GET", undefined, alice)));
    expect(activeWorkspaces.some((w: { id: string }) => w.id === createdWorkspace.id)).toBe(false);
  });

  it("rejects task create without projectId and blocks retired associations", async () => {
    const missing = await app.fetch(req("/tasks", "POST", { title: "No links" }, alice));
    expect(missing.status).toBe(400);
    const missingBody = await json(missing);
    expect(missingBody.error).toMatch(/projectId is required/i);

    const project = await json(await app.fetch(req("/projects", "POST", { name: "P1" }, alice)));

    const created = await app.fetch(
      req("/tasks", "POST", {
        title: "Linked",
        projectId: project.id,
        workspaceId: null,
      }, alice),
    );
    expect(created.status).toBe(201);
    const createdBody = await json(created);
    expect(createdBody.projectId).toBe(project.id);
    expect(createdBody.workspaceId).toBeNull();

    await app.fetch(req(`/projects/${project.id}/retire`, "POST", undefined, alice));
    const blockedProject = await app.fetch(
      req("/tasks", "POST", {
        title: "Onto retired project",
        projectId: project.id,
      }, alice),
    );
    expect(blockedProject.status).toBe(400);
    expect((await json(blockedProject)).error).toMatch(/retired/i);

    const { project: activeProject } = await createProjectWithRepo(app, alice, "Active");
    const workspace = await json(
      await app.fetch(
        req("/workspaces", "POST", { name: "W1", projectId: activeProject.id }, alice),
      ),
    );
    await app.fetch(req(`/workspaces/${workspace.id}/retire`, "POST", undefined, alice));
    const blockedWorkspace = await app.fetch(
      req("/tasks", "POST", {
        title: "Onto retired workspace",
        projectId: activeProject.id,
        workspaceId: workspace.id,
      }, alice),
    );
    expect(blockedWorkspace.status).toBe(400);
    expect((await json(blockedWorkspace)).error).toMatch(/retired/i);
  });

  it("allows task update to replace a retired project association with an active project", async () => {
    const retired = await json(await app.fetch(req("/projects", "POST", { name: "Soon Retired" }, alice)));
    const active = await json(await app.fetch(req("/projects", "POST", { name: "Still Active" }, alice)));

    const created = await json(
      await app.fetch(
        req("/tasks", "POST", {
          title: "Needs reassignment",
          projectId: retired.id,
          workspaceId: null,
        }, alice),
      ),
    );
    expect(created.projectId).toBe(retired.id);
    expect(created.workspaceId).toBeNull();

    await app.fetch(req(`/projects/${retired.id}/retire`, "POST", undefined, alice));

    const blocked = await app.fetch(
      req(`/tasks/${created.id}`, "PATCH", {
        title: "Still on retired only",
        projectId: retired.id,
      }, alice),
    );
    expect(blocked.status).toBe(400);
    expect((await json(blocked)).error).toMatch(/retired/i);

    const replaced = await app.fetch(
      req(`/tasks/${created.id}`, "PATCH", {
        title: "Reassigned",
        projectId: active.id,
        workspaceId: null,
      }, alice),
    );
    expect(replaced.status).toBe(200);
    const body = await json(replaced);
    expect(body.title).toBe("Reassigned");
    expect(body.projectId).toBe(active.id);
    expect(body.workspaceId).toBeNull();
  });

  it("returns project and workspace dashboards with related entities", async () => {
    const { project } = await createProjectWithRepo(app, alice, "Dash Project");
    const workspace = await json(
      await app.fetch(
        req("/workspaces", "POST", { name: "Dash Workspace", projectId: project.id }, alice),
      ),
    );
    await app.fetch(
      req("/tasks", "POST", {
        title: "Dash Task",
        projectId: project.id,
        workspaceId: workspace.id,
      }, alice),
    );

    const projectDash = await json(await app.fetch(req(`/projects/${project.id}/dashboard`, "GET", undefined, alice)));
    expect(projectDash.project.id).toBe(project.id);
    expect(projectDash.tasks.some((t: { title: string }) => t.title === "Dash Task")).toBe(true);
    expect(projectDash.relatedWorkspaces.some((w: { id: string }) => w.id === workspace.id)).toBe(true);

    const workspaceDash = await json(
      await app.fetch(req(`/workspaces/${workspace.id}/dashboard`, "GET", undefined, alice)),
    );
    expect(workspaceDash.workspace.id).toBe(workspace.id);
    expect(workspaceDash.tasks.some((t: { title: string }) => t.title === "Dash Task")).toBe(true);
    expect(workspaceDash.relatedProjects.some((p: { id: string }) => p.id === project.id)).toBe(true);
  });

  it("enforces tenant isolation for projects and workspaces", async () => {
    const { project } = await createProjectWithRepo(app, alice, "Secret");
    const workspace = await json(
      await app.fetch(
        req("/workspaces", "POST", { name: "Secret WS", projectId: project.id }, alice),
      ),
    );

    const eveProjects = await json(await app.fetch(req("/projects", "GET", undefined, eve)));
    expect(eveProjects.some((p: { id: string }) => p.id === project.id)).toBe(false);

    const eveGet = await app.fetch(req(`/projects/${project.id}`, "GET", undefined, eve));
    expect(eveGet.status).toBe(404);

    const eveWs = await app.fetch(req(`/workspaces/${workspace.id}`, "GET", undefined, eve));
    expect(eveWs.status).toBe(404);
  });
});
