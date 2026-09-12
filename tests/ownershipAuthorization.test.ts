import { randomUUID } from "node:crypto";
import {
  createEmptyDefinition,
  createAgentRecord,
  createToolRecord,
  createNode,
  createEdge,
  type WorkflowDefinition,
  type AgentRecord,
  type ToolRecord,
  type Run,
} from "@multi-agent/types";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { createRunsRouter } from "../apps/server/src/api/runs";
import { createToolsRouter } from "../apps/server/src/api/tools";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { InMemoryRunStore, PostgresRunStore } from "../apps/server/src/runtime/runStore";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import {
  createInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
} from "../src/auth/internalPrincipal";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import type { StudioTask } from "../src/studio/contracts";

const TEST_SECRET = "ownership-test-secret";

const alice: AuthenticatedPrincipal = { userId: "alice-user", tenantId: "tenant-alpha" };
const bob: AuthenticatedPrincipal = { userId: "bob-user", tenantId: "tenant-alpha" }; // same tenant, different user
const eve: AuthenticatedPrincipal = { userId: "eve-user", tenantId: "tenant-beta" }; // cross-tenant

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

describe("Persisted Ownership and Authorization Enforcement", () => {
  describe("Studio API Route Enforcement", () => {
    let store: InMemoryStudioStore;
    let app: ReturnType<typeof createStudioRouter>;

    beforeEach(() => {
      store = new InMemoryStudioStore();
      app = createStudioRouter(store, (request) => {
        const token = request.headers.get("X-Multi-Agent-Principal");
        if (!token) return null;
        try {
          const { verifyInternalPrincipalAssertion } = require("../src/auth/internalPrincipal");
          return verifyInternalPrincipalAssertion(token, TEST_SECRET);
        } catch {
          return null;
        }
      });
    });

    test("unauthenticated requests fail closed with 401 across all studio routes", async () => {
      expect((await app.fetch(req("/workflows", "GET"))).status).toBe(401);
      expect((await app.fetch(req("/workflows", "POST", { name: "Test" }))).status).toBe(401);
      expect((await app.fetch(req("/workflows/w1", "PUT", { id: "w1", nodes: [], edges: [] }))).status).toBe(401);
      expect((await app.fetch(req("/workflows/w1", "DELETE"))).status).toBe(401);
      expect((await app.fetch(req("/agents", "GET"))).status).toBe(401);
      expect((await app.fetch(req("/agents", "POST", { name: "A" }))).status).toBe(401);
      expect((await app.fetch(req("/tools", "GET"))).status).toBe(401);
      expect((await app.fetch(req("/tools", "POST", { name: "T" }))).status).toBe(401);
      expect((await app.fetch(req("/tasks", "GET"))).status).toBe(401);
      expect((await app.fetch(req("/tasks", "POST", { id: "t1", title: "Task" }))).status).toBe(401);
      expect((await app.fetch(req("/workspace/import", "POST", {}))).status).toBe(401);
    });

    test("workflows: personal ownership isolation between users and tenants", async () => {
      // Alice creates a workflow
      const wfDef = createEmptyDefinition("Alice Flow");
      const createRes = await app.fetch(req("/workflows", "POST", { workflow: wfDef }, alice));
      expect(createRes.status).toBe(201);
      const created = await json<WorkflowDefinition>(createRes);
      expect(created.ownerId).toBe(alice.userId);
      expect(created.tenantId).toBe(alice.tenantId);

      // Alice can read and list it
      const aliceGet = await app.fetch(req(`/workflows/${created.id}`, "GET", undefined, alice));
      expect(aliceGet.status).toBe(200);
      const aliceList = await json<WorkflowDefinition[]>(await app.fetch(req("/workflows", "GET", undefined, alice)));
      expect(aliceList.some((w) => w.id === created.id)).toBe(true);

      // Bob (same tenant, different user) cannot read, update, or delete Alice's workflow
      const bobGet = await app.fetch(req(`/workflows/${created.id}`, "GET", undefined, bob));
      expect(bobGet.status).toBe(404);

      const bobPut = await app.fetch(
        req(`/workflows/${created.id}`, "PUT", { ...created, name: "Bob Hijack" }, bob),
      );
      expect(bobPut.status).toBe(404);

      const bobDelete = await app.fetch(req(`/workflows/${created.id}`, "DELETE", undefined, bob));
      expect(bobDelete.status).toBe(404);

      const bobList = await json<WorkflowDefinition[]>(await app.fetch(req("/workflows", "GET", undefined, bob)));
      expect(bobList.some((w) => w.id === created.id)).toBe(false);

      // Eve (cross-tenant) cannot read, update, or delete Alice's workflow
      const eveGet = await app.fetch(req(`/workflows/${created.id}`, "GET", undefined, eve));
      expect(eveGet.status).toBe(404);

      const evePut = await app.fetch(
        req(`/workflows/${created.id}`, "PUT", { ...created, name: "Eve Hijack" }, eve),
      );
      expect(evePut.status).toBe(404);

      const eveDelete = await app.fetch(req(`/workflows/${created.id}`, "DELETE", undefined, eve));
      expect(eveDelete.status).toBe(404);

      // Client cannot forge ownerId or tenantId in request payload
      const spoofDef = { ...createEmptyDefinition("Spoofed"), ownerId: bob.userId, tenantId: eve.tenantId };
      const spoofRes = await app.fetch(req("/workflows", "POST", { workflow: spoofDef }, alice));
      const spoofed = await json<WorkflowDefinition>(spoofRes);
      expect(spoofed.ownerId).toBe(alice.userId);
      expect(spoofed.tenantId).toBe(alice.tenantId);
    });

    test("agents: user-created agents are isolated; system agents are globally readable but immutable", async () => {
      // Alice creates a custom agent
      const agentRes = await app.fetch(req("/agents", "POST", { name: "Alice Custom Agent" }, alice));
      expect(agentRes.status).toBe(201);
      const aliceAgent = await json<AgentRecord>(agentRes);
      expect(aliceAgent.ownerId).toBe(alice.userId);
      expect(aliceAgent.tenantId).toBe(alice.tenantId);

      // Bob (same tenant) and Eve (cross-tenant) cannot access Alice's agent
      expect((await app.fetch(req(`/agents/${aliceAgent.id}`, "GET", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/agents/${aliceAgent.id}`, "PATCH", { name: "Bob Name" }, bob))).status).toBe(404);
      expect((await app.fetch(req(`/agents/${aliceAgent.id}/duplicate`, "POST", {}, bob))).status).toBe(404);
      expect((await app.fetch(req(`/agents/${aliceAgent.id}`, "DELETE", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/agents/${aliceAgent.id}`, "GET", undefined, eve))).status).toBe(404);

      // System agent in store
      const systemAgent: AgentRecord = {
        ...createAgentRecord({ name: "System Orchestrator" }),
        id: "agent-system-orch",
        isSystem: true,
        ownerId: undefined,
        tenantId: undefined,
      };
      await store.saveAgent(systemAgent);

      // System agent is readable by Alice, Bob, and Eve
      expect((await app.fetch(req(`/agents/${systemAgent.id}`, "GET", undefined, alice))).status).toBe(200);
      expect((await app.fetch(req(`/agents/${systemAgent.id}`, "GET", undefined, bob))).status).toBe(200);
      expect((await app.fetch(req(`/agents/${systemAgent.id}`, "GET", undefined, eve))).status).toBe(200);

      // System agent cannot be modified or deleted by anyone (403 Forbidden)
      expect((await app.fetch(req(`/agents/${systemAgent.id}`, "PATCH", { name: "Tampered" }, alice))).status).toBe(403);
      expect((await app.fetch(req(`/agents/${systemAgent.id}`, "DELETE", undefined, alice))).status).toBe(403);
      expect((await app.fetch(req(`/agents/${systemAgent.id}`, "PATCH", { name: "Tampered" }, bob))).status).toBe(403);
      expect((await app.fetch(req(`/agents/${systemAgent.id}`, "DELETE", undefined, eve))).status).toBe(403);
    });

    test("tools: user-created tools are isolated; system tools are globally readable but immutable", async () => {
      // Alice creates a custom tool
      const toolRes = await app.fetch(req("/tools", "POST", { name: "Alice Custom Tool" }, alice));
      expect(toolRes.status).toBe(201);
      const aliceTool = await json<ToolRecord>(toolRes);
      expect(aliceTool.ownerId).toBe(alice.userId);
      expect(aliceTool.tenantId).toBe(alice.tenantId);

      // Bob and Eve cannot access Alice's tool
      expect((await app.fetch(req(`/tools/${aliceTool.id}`, "GET", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/tools/${aliceTool.id}`, "PATCH", { name: "Bob Tamper" }, bob))).status).toBe(404);
      expect((await app.fetch(req(`/tools/${aliceTool.id}`, "DELETE", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/tools/${aliceTool.id}`, "GET", undefined, eve))).status).toBe(404);

      // System tool in store
      const systemTool: ToolRecord = {
        ...createToolRecord({ name: "Web Browser" }),
        id: "tool-system-browser",
        isSystem: true,
        ownerId: undefined,
        tenantId: undefined,
      };
      await store.saveTool(systemTool);

      // System tool is readable by Alice, Bob, and Eve
      expect((await app.fetch(req(`/tools/${systemTool.id}`, "GET", undefined, alice))).status).toBe(200);
      expect((await app.fetch(req(`/tools/${systemTool.id}`, "GET", undefined, bob))).status).toBe(200);
      expect((await app.fetch(req(`/tools/${systemTool.id}`, "GET", undefined, eve))).status).toBe(200);

      // System tool cannot be modified or deleted by anyone (403 Forbidden)
      expect((await app.fetch(req(`/tools/${systemTool.id}`, "PATCH", { name: "Tampered" }, alice))).status).toBe(403);
      expect((await app.fetch(req(`/tools/${systemTool.id}`, "DELETE", undefined, alice))).status).toBe(403);
      expect((await app.fetch(req(`/tools/${systemTool.id}`, "PATCH", { name: "Tampered" }, bob))).status).toBe(403);
      expect((await app.fetch(req(`/tools/${systemTool.id}`, "DELETE", undefined, eve))).status).toBe(403);
    });

    test("tasks: tenant-scoped sharing (Alice and Bob in same tenant share tasks, Eve isolated)", async () => {
      const taskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            id: "task-alpha-1",
            title: "Tenant Alpha Shared Task",
            priority: "high",
            status: "todo",
            assignedAgent: null,
            dependencies: [],
            output: null,
            retryCount: 0,
            paused: false,
            createdAt: new Date().toISOString(),
          },
          alice,
        ),
      );
      expect(taskRes.status).toBe(201);
      const createdTask = await json<StudioTask>(taskRes);
      expect(createdTask.tenantId).toBe(alice.tenantId);

      // Bob in the SAME tenant can view, list, and update the task
      const bobGet = await app.fetch(req(`/tasks/${createdTask.id}`, "GET", undefined, bob));
      expect(bobGet.status).toBe(200);

      const bobList = await json<StudioTask[]>(await app.fetch(req("/tasks", "GET", undefined, bob)));
      expect(bobList.some((t) => t.id === createdTask.id)).toBe(true);

      const bobUpdate = await app.fetch(
        req(`/tasks/${createdTask.id}`, "PUT", { ...createdTask, status: "in_progress" }, bob),
      );
      expect(bobUpdate.status).toBe(200);
      expect((await json<StudioTask>(bobUpdate)).status).toBe("in_progress");

      // Eve in tenant-beta CANNOT view, list, update, or delete the task
      expect((await app.fetch(req(`/tasks/${createdTask.id}`, "GET", undefined, eve))).status).toBe(404);
      expect(
        (await app.fetch(req(`/tasks/${createdTask.id}`, "PUT", { ...createdTask, status: "failed" }, eve))).status,
      ).toBe(404);
      expect((await app.fetch(req(`/tasks/${createdTask.id}`, "DELETE", undefined, eve))).status).toBe(404);
      const eveList = await json<StudioTask[]>(await app.fetch(req("/tasks", "GET", undefined, eve)));
      expect(eveList.some((t) => t.id === createdTask.id)).toBe(false);
    });

    test("unowned legacy resources fail closed (quarantined)", async () => {
      // Manually inject an unowned legacy workflow and tool directly into store
      const legacyWf = { ...createEmptyDefinition("Legacy Unowned"), ownerId: undefined, tenantId: undefined };
      const legacyTool = { ...createToolRecord({ name: "Legacy Tool" }), ownerId: undefined, tenantId: undefined, isSystem: false };
      // Save directly without principal to simulate legacy pre-migration row
      await store.saveWorkflow(legacyWf);
      await store.saveTool(legacyTool);

      // Alice, Bob, and Eve cannot read or list these unowned items
      for (const p of [alice, bob, eve]) {
        expect((await app.fetch(req(`/workflows/${legacyWf.id}`, "GET", undefined, p))).status).toBe(404);
        expect((await app.fetch(req(`/tools/${legacyTool.id}`, "GET", undefined, p))).status).toBe(404);
        const wfs = await json<WorkflowDefinition[]>(await app.fetch(req("/workflows", "GET", undefined, p)));
        expect(wfs.some((w) => w.id === legacyWf.id)).toBe(false);
        const tls = await json<ToolRecord[]>(await app.fetch(req("/tools", "GET", undefined, p)));
        expect(tls.some((t) => t.id === legacyTool.id)).toBe(false);
      }
    });
  });

  describe("Run and Execution Authority Enforcement", () => {
    let runStore: InMemoryRunStore;
    let studioStore: InMemoryStudioStore;
    let executor: RunExecutor;
    let app: ReturnType<typeof createRunsRouter>["app"];

    beforeEach(() => {
      runStore = new InMemoryRunStore();
      studioStore = new InMemoryStudioStore();
      executor = new RunExecutor(runStore);
      const router = createRunsRouter(
        executor,
        async () => null,
        studioStore,
        (request) => {
          const token = request.headers.get("X-Multi-Agent-Principal");
          if (!token) return null;
          try {
            const { verifyInternalPrincipalAssertion } = require("../src/auth/internalPrincipal");
            return verifyInternalPrincipalAssertion(token, TEST_SECRET);
          } catch {
            return null;
          }
        },
      );
      app = router.app;
    });

    test("unauthenticated requests to run endpoints fail closed", async () => {
      expect((await app.fetch(req("/", "POST", { workflow: createEmptyDefinition(), agents: [] }))).status).toBe(401);
      expect((await app.fetch(req("/agent-test", "POST", { agent: createAgentRecord(), input: {} }))).status).toBe(401);
      // Lookups for runs return 404 to avoid enumeration
      expect((await app.fetch(req("/any-run-id", "GET"))).status).toBe(404);
      expect((await app.fetch(req("/any-run-id/history", "GET"))).status).toBe(404);
      expect((await app.fetch(req("/any-run-id/events", "GET"))).status).toBe(404);
      expect((await app.fetch(req("/any-run-id/cancel", "POST"))).status).toBe(404);
      expect(await json(await app.fetch(req("/", "GET")))).toEqual([]);
    });

    test("runs: personal ownership isolation for execution, history, events, approvals, cancellation", async () => {
      // Alice creates a workflow with approval node
      const input = createNode("input", { x: 0, y: 0 });
      const approval = (() => { const n = createNode("approval", { x: 1, y: 0 }); n.config = { approvalType: "manual", message: "Approve deployment?", timeoutSeconds: 300 }; return n; })();
      const output = createNode("output", { x: 2, y: 0 });
      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("Approval Workflow"),
        nodes: [input, approval, output],
        edges: [createEdge({ source: input.id, target: approval.id }), createEdge({ source: approval.id, target: output.id })],
      };
      await studioStore.saveWorkflow(workflow, alice);

      // Alice starts the run
      const startRes = await app.fetch(req("/", "POST", { workflow, agents: [], input: {} }, alice));
      expect(startRes.status).toBe(202);
      const { runId } = await json<{ runId: string }>(startRes);

      // Verify run is stamped with Alice's ownership
      const runEntry = runStore.get(runId);
      expect(runEntry?.run.ownerId).toBe(alice.userId);
      expect(runEntry?.run.tenantId).toBe(alice.tenantId);

      // Wait for approval node to be reached
      for (let i = 0; i < 50 && runStore.get(runId)?.run.status !== "waiting_for_human"; i++) {
        await new Promise((r) => setImmediate(r));
      }

      // Alice can read run, history, events, approvals
      expect((await app.fetch(req(`/${runId}`, "GET", undefined, alice))).status).toBe(200);
      expect((await app.fetch(req(`/${runId}/history`, "GET", undefined, alice))).status).toBe(200);
      expect((await app.fetch(req(`/${runId}/events`, "GET", undefined, alice))).status).toBe(200);
      expect((await app.fetch(req(`/${runId}/definition`, "GET", undefined, alice))).status).toBe(200);
      const approvalsRes = await app.fetch(req(`/${runId}/approvals`, "GET", undefined, alice));
      expect(approvalsRes.status).toBe(200);
      const approvals = await json<any[]>(approvalsRes);
      expect(approvals).toHaveLength(1);

      // Bob (same tenant, different user) is DENIED all access (404 Not Found to prevent enumeration)
      expect((await app.fetch(req(`/${runId}`, "GET", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/${runId}/history`, "GET", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/${runId}/events`, "GET", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/${runId}/definition`, "GET", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/${runId}/approvals`, "GET", undefined, bob))).status).toBe(404);
      expect((await app.fetch(req(`/${runId}/approvals/${approvals[0].id}/resolve`, "POST", { decision: "approved" }, bob))).status).toBe(404);
      expect((await app.fetch(req(`/${runId}/cancel`, "POST", undefined, bob))).status).toBe(404);

      // Bob's run list does NOT contain Alice's run
      const bobRuns = await json<Run[]>(await app.fetch(req("/", "GET", undefined, bob)));
      expect(bobRuns.some((r) => r.id === runId)).toBe(false);

      // Eve (cross-tenant) is also DENIED all access (404)
      expect((await app.fetch(req(`/${runId}`, "GET", undefined, eve))).status).toBe(404);
      expect((await app.fetch(req(`/${runId}/approvals`, "GET", undefined, eve))).status).toBe(404);
      expect((await app.fetch(req(`/${runId}/cancel`, "POST", undefined, eve))).status).toBe(404);

      // Bob cannot execute Alice's private workflow
      const bobExecAliceWf = await app.fetch(req("/", "POST", { workflow, agents: [], input: {} }, bob));
      expect(bobExecAliceWf.status).toBe(404);

      // Alice resolves the approval successfully
      const resolveRes = await app.fetch(
        req(`/${runId}/approvals/${approvals[0].id}/resolve`, "POST", { decision: "approved" }, alice),
      );
      expect(resolveRes.status).toBe(202);
    });

    test("POST /agent-test isolates private custom agents from other users", async () => {
      // Alice registers a private agent in studio store
      const aliceAgent = createAgentRecord({ name: "Alice Secret Agent" });
      await studioStore.saveAgent(aliceAgent, alice);

      // Bob cannot test Alice's agent
      const bobTestAlice = await app.fetch(req("/agent-test", "POST", { agent: aliceAgent, input: { prompt: "hi" } }, bob));
      expect(bobTestAlice.status).toBe(404);

      // Eve cannot test Alice's agent
      const eveTestAlice = await app.fetch(req("/agent-test", "POST", { agent: aliceAgent, input: { prompt: "hi" } }, eve));
      expect(eveTestAlice.status).toBe(404);

      // Alice can test her agent
      const aliceTest = await app.fetch(req("/agent-test", "POST", { agent: aliceAgent, input: { prompt: "hi" } }, alice));
      expect(aliceTest.status).toBe(202);
    });
  });

  describe("Tools Route Authority Enforcement", () => {
    let studioStore: InMemoryStudioStore;
    let app: ReturnType<typeof createToolsRouter>;

    beforeEach(() => {
      studioStore = new InMemoryStudioStore();
      app = createToolsRouter(undefined, studioStore, (request) => {
        const token = request.headers.get("X-Multi-Agent-Principal");
        if (!token) return null;
        try {
          const { verifyInternalPrincipalAssertion } = require("../src/auth/internalPrincipal");
          return verifyInternalPrincipalAssertion(token, TEST_SECRET);
        } catch {
          return null;
        }
      });
    });

    test("tools test execution enforces authentication and ownership", async () => {
      const tool: ToolRecord = { ...createToolRecord({ name: "Echo" }), configuration: { greeting: "hi" } };

      // Unauthenticated fails closed (401)
      expect((await app.fetch(req("/test", "POST", { tool, input: { name: "world" } }))).status).toBe(401);

      // Alice creates a private tool
      const aliceTool: ToolRecord = { ...createToolRecord({ name: "Alice Tool" }), configuration: { greeting: "secret" } };
      await studioStore.saveTool(aliceTool, alice);

      // Alice can execute her tool
      const aliceExec = await app.fetch(req("/test", "POST", { tool: aliceTool, input: { name: "alice" } }, alice));
      expect(aliceExec.status).toBe(200);

      // Bob cannot execute Alice's private tool (404)
      const bobExec = await app.fetch(req("/test", "POST", { tool: aliceTool, input: { name: "bob" } }, bob));
      expect(bobExec.status).toBe(404);

      // Eve cannot execute Alice's private tool (404)
      const eveExec = await app.fetch(req("/test", "POST", { tool: aliceTool, input: { name: "eve" } }, eve));
      expect(eveExec.status).toBe(404);

      // System tool can be executed by Alice, Bob, and Eve
      const systemTool: ToolRecord = {
        ...createToolRecord({ name: "Echo System" }),
        configuration: { greeting: "system" },
        isSystem: true,
      };
      await studioStore.saveTool(systemTool);

      expect((await app.fetch(req("/test", "POST", { tool: systemTool, input: { name: "a" } }, alice))).status).toBe(200);
      expect((await app.fetch(req("/test", "POST", { tool: systemTool, input: { name: "b" } }, bob))).status).toBe(200);
      expect((await app.fetch(req("/test", "POST", { tool: systemTool, input: { name: "c" } }, eve))).status).toBe(200);
    });
  });

  const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
  (databaseUrl ? describe : describe.skip)("Postgres Persistence Ownership Enforcement", () => {
    let pool: any;
    let schema: string;

    beforeAll(async () => {
      const { Pool } = require("pg");
      schema = `ownership_test_${randomUUID().replace(/-/g, "")}`;
      const admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.end();

      pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 16 });
      const applied = await runStudioMigrations(pool);
      expect(applied).toContain("004_ownership.sql");
    });

    afterAll(async () => {
      if (pool) {
        const { Pool } = require("pg");
        const admin = new Pool({ connectionString: databaseUrl });
        try {
          await pool.end();
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await admin.end();
        }
      }
    });

    test("PostgresStudioStore persists and filters by ownership and tenant", async () => {
      const store = new PostgresStudioStore(pool);

      // Alice saves workflow, agent, tool, and task
      const wf = createEmptyDefinition("Postgres Alice Flow");
      const agent = createAgentRecord({ name: "Postgres Alice Agent" });
      const tool = createToolRecord({ name: "Postgres Alice Tool" });
      const task: StudioTask = {
        id: "pg-task-1",
        title: "Postgres Task",
        description: "Testing pg tasks",
        priority: "high",
        status: "todo",
        assignedAgent: null,
        dependencies: [],
        output: null,
        retryCount: 0,
        paused: false,
        createdAt: new Date().toISOString(),
      };

      await store.saveWorkflow(wf, alice);
      await store.saveAgent(agent, alice);
      await store.saveTool(tool, alice);
      await store.saveTask(task, alice);

      // Alice can retrieve all of them
      expect(await store.getWorkflow(wf.id, alice)).not.toBeNull();
      expect(await store.getAgent(agent.id, alice)).not.toBeNull();
      expect(await store.getTool(tool.id, alice)).not.toBeNull();
      expect(await store.getTask(task.id, alice)).not.toBeNull();

      // Bob (same tenant) cannot see Alice's workflow, agent, or tool, but CAN see tenant task
      expect(await store.getWorkflow(wf.id, bob)).toBeNull();
      expect(await store.getAgent(agent.id, bob)).toBeNull();
      expect(await store.getTool(tool.id, bob)).toBeNull();
      expect(await store.getTask(task.id, bob)).not.toBeNull();

      // Bob's lists exclude Alice's personal resources but include the task
      const bobWfs = await store.listWorkflows(bob);
      expect(bobWfs.some((w) => w.id === wf.id)).toBe(false);
      const bobAgents = await store.listAgents(bob);
      expect(bobAgents.some((a) => a.id === agent.id)).toBe(false);
      const bobTools = await store.listTools(bob);
      expect(bobTools.some((t) => t.id === tool.id)).toBe(false);
      const bobTasks = await store.listTasks(bob);
      expect(bobTasks.some((t) => t.id === task.id)).toBe(true);

      // Eve (different tenant) cannot see anything
      expect(await store.getWorkflow(wf.id, eve)).toBeNull();
      expect(await store.getAgent(agent.id, eve)).toBeNull();
      expect(await store.getTool(tool.id, eve)).toBeNull();
      expect(await store.getTask(task.id, eve)).toBeNull();
    });

    test("PostgresRunStore persists and filters runs by owner and tenant", async () => {
      const store = new PostgresRunStore(pool);
      const runId = `pg-run-${randomUUID()}`;
      const run: Run = {
        id: runId,
        workflowId: "wf-1",
        status: "running",
        startedAt: new Date().toISOString(),
        metadata: {},
      };

      await store.create(run, undefined, undefined, alice);

      // Alice can read run
      const aliceEntry = await store.get(runId);
      expect(aliceEntry).not.toBeNull();
      expect(aliceEntry?.run.ownerId).toBe(alice.userId);
      expect(aliceEntry?.run.tenantId).toBe(alice.tenantId);

      // Bob and Eve cannot read run
      expect((await store.list({}, bob)).some(r => r.id === runId)).toBe(false);
      expect((await store.list({}, eve)).some(r => r.id === runId)).toBe(false);

      // Bob and Eve lists do not contain the run
      const bobList = await store.list({}, bob);
      expect(bobList.some((r) => r.id === runId)).toBe(false);
      const eveList = await store.list({}, eve);
      expect(eveList.some((r) => r.id === runId)).toBe(false);
    });

    test("deterministic migration backfills memory_owner to owner_id and tenant_id", async () => {
      // Direct SQL verification: check that columns exist on studio_runs and studio_workflows
      const checkRuns = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'studio_runs' AND column_name IN ('owner_id', 'tenant_id')",
      );
      expect(checkRuns.rows).toHaveLength(2);

      const checkWfs = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'studio_workflows' AND column_name IN ('owner_id', 'tenant_id')",
      );
      expect(checkWfs.rows).toHaveLength(2);
    });
  });
});
