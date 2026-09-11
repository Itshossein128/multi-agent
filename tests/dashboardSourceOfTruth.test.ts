import { randomUUID } from "node:crypto";
import {
  createAgentRecord,
  createEmptyDefinition,
  nowIso,
  type Run,
} from "@multi-agent/types";
import { createDashboardRouter } from "../apps/server/src/api/dashboard";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { InMemoryRunStore, PostgresRunStore } from "../apps/server/src/runtime/runStore";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
} from "../src/auth/internalPrincipal";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import type { StudioTask } from "../src/studio/contracts";

const TEST_SECRET = "dashboard-test-secret";

const alice: AuthenticatedPrincipal = { userId: "alice-user", tenantId: "tenant-alpha" };
const bob: AuthenticatedPrincipal = { userId: "bob-user", tenantId: "tenant-beta" }; // different tenant
const eve: AuthenticatedPrincipal = { userId: "eve-user", tenantId: "tenant-alpha" }; // same tenant, different user

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

const resolvePrincipal = (request: Request) => {
  const token = request.headers.get("X-Multi-Agent-Principal");
  if (!token) return null;
  try {
    return verifyInternalPrincipalAssertion(token, TEST_SECRET);
  } catch {
    return null;
  }
};

describe("Authoritative Dashboard Source of Truth", () => {
  let runStore: InMemoryRunStore;
  let studioStore: InMemoryStudioStore;
  let executor: RunExecutor;
  let app: ReturnType<typeof createDashboardRouter>;

  beforeEach(() => {
    runStore = new InMemoryRunStore();
    studioStore = new InMemoryStudioStore();
    executor = new RunExecutor(runStore);
    app = createDashboardRouter(runStore, studioStore, executor, resolvePrincipal);
  });

  describe("1. Authoritative Aggregation from RunStore & StudioStore", () => {
    test("aggregates queue, active agents, completed runs, and failed tasks authoritatively", async () => {
      // 1. Create a custom agent in StudioStore
      const agent = {
        ...createAgentRecord({ name: "Research Agent" }),
        id: "agent-researcher",
        description: "Deep Research Specialist",
      };
      await studioStore.saveAgent(agent, alice);

      // 2. Create tasks in StudioStore
      const todoTask: StudioTask = {
        id: "task-todo-1",
        title: "Analyze competitor pricing",
        description: "",
        priority: "high",
        status: "todo",
        assignedAgent: "Research Agent",
        dependencies: [],
        output: null,
        retryCount: 0,
        paused: false,
        createdAt: "2026-09-11T10:00:00.000Z",
      };
      const activeTask: StudioTask = {
        id: "task-active-1",
        title: "Synthesizing market reports",
        description: "",
        priority: "medium",
        status: "in_progress",
        assignedAgent: "Research Agent",
        dependencies: [],
        output: null,
        retryCount: 0,
        paused: false,
        createdAt: "2026-09-11T10:10:00.000Z",
      };
      await studioStore.saveTask(todoTask, alice);
      await studioStore.saveTask(activeTask, alice);

      // 3. Create runs in RunStore
      const completedRun: Run = {
        id: "run-comp-1",
        workflowId: "wf-1",
        status: "completed",
        startedAt: "2026-09-11T10:00:00.000Z",
        completedAt: "2026-09-11T10:00:05.000Z",
        metadata: {
          name: "Extract PDF Table",
          agentId: "agent-researcher",
          agentName: "Research Agent",
          totalTokens: 4500,
          cost: 0.0125, // Explicit provider-reported cost
        },
      };
      const failedRun: Run = {
        id: "run-fail-1",
        workflowId: "wf-1",
        status: "failed",
        startedAt: "2026-09-11T10:15:00.000Z",
        completedAt: "2026-09-11T10:15:02.000Z",
        error: "Rate limit exceeded for provider",
        metadata: {
          name: "Scrape Financial Portal",
          agentId: "agent-researcher",
          agentName: "Research Agent",
          retryCount: 2,
        },
      };
      runStore.create(completedRun, undefined, undefined, alice);
      runStore.create(failedRun, undefined, undefined, alice);

      // Query dashboard
      const res = await app.fetch(req("/", "GET", undefined, alice));
      expect(res.status).toBe(200);
      const data = await res.json();

      // Verify Queue: includes todoTask
      expect(data.queue).toHaveLength(1);
      expect(data.queue[0].id).toBe("task-todo-1");
      expect(data.queue[0].title).toBe("Analyze competitor pricing");
      expect(data.queue[0].priority).toBe("high");

      // Verify Active Agents: Research Agent is running due to active task
      const researchAgent = data.agents.find((a: any) => a.id === "agent-researcher");
      expect(researchAgent).toBeDefined();
      expect(researchAgent.status).toBe("running");
      expect(researchAgent.currentTask).toBe("Synthesizing market reports");
      expect(researchAgent.tokensUsed).toBe(4500);
      expect(researchAgent.cost).toBe(0.0125);

      // Verify Completed: contains completedRun
      expect(data.completedTasks).toHaveLength(1);
      expect(data.completedTasks[0].id).toBe("run-comp-1");
      expect(data.completedTasks[0].title).toBe("Extract PDF Table");
      expect(data.completedTasks[0].tokens).toBe(4500);
      expect(data.completedTasks[0].cost).toBe(0.0125);
      expect(data.completedTasks[0].duration).toBe("5.0s");

      // Verify Failed: contains failedRun
      expect(data.failedTasks).toHaveLength(1);
      expect(data.failedTasks[0].id).toBe("run-fail-1");
      expect(data.failedTasks[0].error).toBe("Rate limit exceeded for provider");
      expect(data.failedTasks[0].retryCount).toBe(2);

      // Verify Token Metrics
      expect(data.tokenMetrics.totalTokens).toBe(4500);
      expect(data.tokenMetrics.totalCostUsd).toBe(0.0125);
    });
  });

  describe("2. No Fabricated Synthetic Fallback Cost", () => {
    test("explicitly preserves null for unknown cost without multiplying by 0.000002", async () => {
      const runWithoutCost: Run = {
        id: "run-no-cost",
        workflowId: "wf-1",
        status: "completed",
        startedAt: "2026-09-11T10:00:00.000Z",
        completedAt: "2026-09-11T10:00:03.000Z",
        metadata: {
          name: "Unmetered Local Run",
          totalTokens: 12500, // Notice: 12500 tokens * 0.000002 would be 0.025 if fabricated!
        },
      };
      runStore.create(runWithoutCost, undefined, undefined, alice);

      const res = await app.fetch(req("/", "GET", undefined, alice));
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.completedTasks).toHaveLength(1);
      expect(data.completedTasks[0].tokens).toBe(12500);
      // Must be explicit null, NEVER 0.025!
      expect(data.completedTasks[0].cost).toBeNull();
      // Total cost metric remains 0
      expect(data.tokenMetrics.totalCostUsd).toBe(0);
    });
  });

  describe("3. Contradictory State Resolution (Persisted Store Always Wins)", () => {
    test("authoritative RunStore overrides transient/conflicting state", async () => {
      const run: Run = {
        id: "run-state-conflict",
        workflowId: "wf-1",
        status: "completed",
        startedAt: "2026-09-11T10:00:00.000Z",
        completedAt: "2026-09-11T10:00:02.000Z",
        metadata: {
          name: "Reconciliation Test Run",
          agentId: "agent-orchestrator",
          agentName: "Orchestrator Agent",
        },
      };
      runStore.create(run, undefined, undefined, alice);

      // The dashboard queries RunStore directly — even if external cache claimed running, RunStore reports completed
      const res = await app.fetch(req("/", "GET", undefined, alice));
      const data = await res.json();

      expect(data.completedTasks.some((t: any) => t.id === "run-state-conflict")).toBe(true);
      expect(data.queue.some((q: any) => q.id === "run-state-conflict")).toBe(false);
    });
  });

  describe("4. Authorization & Multi-Tenant Scoping", () => {
    test("unauthenticated requests fail closed with 401", async () => {
      const res = await app.fetch(req("/", "GET"));
      expect(res.status).toBe(401);
    });

    test("tenant isolation: Bob cannot view Alice's runs, tasks, or token metrics", async () => {
      // Alice creates a run and task
      const aliceRun: Run = {
        id: "run-alice-private",
        workflowId: "wf-alice",
        status: "completed",
        startedAt: "2026-09-11T10:00:00.000Z",
        completedAt: "2026-09-11T10:00:04.000Z",
        metadata: {
          name: "Alice Secret Pipeline",
          totalTokens: 8000,
          cost: 0.05,
        },
      };
      runStore.create(aliceRun, undefined, undefined, alice);

      const aliceTask: StudioTask = {
        id: "task-alice-private",
        title: "Alice Secret Mission",
        description: "",
        priority: "high",
        status: "todo",
        assignedAgent: null,
        dependencies: [],
        output: null,
        retryCount: 0,
        paused: false,
        createdAt: nowIso(),
      };
      await studioStore.saveTask(aliceTask, alice);

      // Bob queries dashboard
      const bobRes = await app.fetch(req("/", "GET", undefined, bob));
      expect(bobRes.status).toBe(200);
      const bobData = await bobRes.json();

      expect(bobData.queue).toHaveLength(0);
      expect(bobData.completedTasks).toHaveLength(0);
      expect(bobData.failedTasks).toHaveLength(0);
      expect(bobData.tokenMetrics.totalTokens).toBe(0);
      expect(bobData.tokenMetrics.totalCostUsd).toBe(0);

      // Alice queries dashboard and sees her data
      const aliceRes = await app.fetch(req("/", "GET", undefined, alice));
      const aliceData = await aliceRes.json();
      expect(aliceData.queue).toHaveLength(1);
      expect(aliceData.completedTasks).toHaveLength(1);
      expect(aliceData.tokenMetrics.totalTokens).toBe(8000);
      expect(aliceData.tokenMetrics.totalCostUsd).toBe(0.05);
    });

    test("user isolation: Eve (same tenant, different user) does not see Alice's private runs", async () => {
      const aliceRun: Run = {
        id: "run-alice-scoped",
        workflowId: "wf-alice",
        status: "completed",
        startedAt: "2026-09-11T10:00:00.000Z",
        completedAt: "2026-09-11T10:00:01.000Z",
        metadata: {
          name: "Alice Confidential Run",
          totalTokens: 3000,
        },
      };
      runStore.create(aliceRun, undefined, undefined, alice);

      const eveRes = await app.fetch(req("/", "GET", undefined, eve));
      const eveData = await eveRes.json();

      // RunStore enforces fail-closed quarantine: Alice's run is not returned to Eve
      expect(eveData.completedTasks.some((t: any) => t.id === "run-alice-scoped")).toBe(false);
    });
  });

  describe("5. Dashboard Action Mutations (Enqueue, Retry, Cancel)", () => {
    test("action 'enqueue' creates a task in StudioStore with tenant ownership", async () => {
      const res = await app.fetch(
        req("/", "POST", { action: "enqueue", title: "New Feature Task", role: "Developer Agent", priority: "high" }, alice)
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.id).toBeDefined();

      // Verify the task was persisted in StudioStore
      const task = await studioStore.getTask(body.id, alice);
      expect(task).not.toBeNull();
      expect(task?.title).toBe("New Feature Task");
      expect(task?.status).toBe("todo");
      expect(task?.ownerId).toBe(alice.userId);
      expect(task?.tenantId).toBe(alice.tenantId);
    });

    test("action 'cancel' cancels an active run in RunStore or deletes task in StudioStore", async () => {
      const activeRun: Run = {
        id: "run-to-cancel",
        workflowId: "wf-1",
        status: "running",
        startedAt: nowIso(),
        metadata: {},
      };
      runStore.create(activeRun, undefined, undefined, alice);

      const cancelRes = await app.fetch(req("/", "POST", { action: "cancel", taskId: "run-to-cancel" }, alice));
      expect(cancelRes.status).toBe(200);

      // Verify cancellation signal in RunStore
      expect(runStore.signal("run-to-cancel")?.aborted).toBe(true);
    });

    test("action 'retry' resets failed task status to todo and increments retryCount", async () => {
      const failedTask: StudioTask = {
        id: "task-failed-retry",
        title: "Failed Sync Job",
        description: "",
        priority: "medium",
        status: "failed",
        assignedAgent: null,
        dependencies: [],
        output: "Network timeout",
        retryCount: 1,
        paused: false,
        createdAt: nowIso(),
      };
      await studioStore.saveTask(failedTask, alice);

      const retryRes = await app.fetch(req("/", "POST", { action: "retry", taskId: "task-failed-retry" }, alice));
      expect(retryRes.status).toBe(200);

      const updated = await studioStore.getTask("task-failed-retry", alice);
      expect(updated?.status).toBe("todo");
      expect(updated?.retryCount).toBe(2);
      expect(updated?.output).toBeNull();
    });
  });

  const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
  (databaseUrl ? describe : describe.skip)("6. Server Restart & Durability Resilience (PostgreSQL)", () => {
    let pool: any;
    let schema: string;

    beforeAll(async () => {
      const { Pool } = require("pg");
      schema = `dash_test_${randomUUID().replace(/-/g, "")}`;
      const admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.end();

      pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 16 });
      await runStudioMigrations(pool);
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

    test("reconstructed server loads persisted runs and tasks without any in-memory state", async () => {
      // 1. First server lifecycle: insert run and task into durable stores
      const pgRunStore1 = new PostgresRunStore(pool);
      const pgStudioStore1 = new PostgresStudioStore(pool);

      const durableRun: Run = {
        id: "pg-durable-run-1",
        workflowId: "wf-pg",
        status: "completed",
        startedAt: "2026-09-11T10:00:00.000Z",
        completedAt: "2026-09-11T10:00:04.000Z",
        metadata: {
          name: "Postgres Durable Pipeline",
          totalTokens: 15000,
          cost: 0.08,
        },
      };
      pgRunStore1.create(durableRun, undefined, undefined, alice);
      await pgRunStore1.flush();

      const durableTask: StudioTask = {
        id: "pg-durable-task-1",
        title: "Durable Postgres Task",
        description: "",
        priority: "high",
        status: "todo",
        assignedAgent: null,
        dependencies: [],
        output: null,
        retryCount: 0,
        paused: false,
        createdAt: nowIso(),
      };
      await pgStudioStore1.saveTask(durableTask, alice);

      // 2. Simulate server restart: create completely fresh instances and hydrate
      const pgRunStore2 = new PostgresRunStore(pool);
      await pgRunStore2.hydrate();
      const pgStudioStore2 = new PostgresStudioStore(pool);
      const freshApp = createDashboardRouter(pgRunStore2, pgStudioStore2, undefined, resolvePrincipal);

      // Query dashboard from newly booted server
      const res = await freshApp.fetch(req("/", "GET", undefined, alice));
      expect(res.status).toBe(200);
      const data = await res.json();

      // Persisted task exists in queue
      expect(data.queue.some((q: any) => q.id === "pg-durable-task-1")).toBe(true);

      // Persisted completed run exists in completedTasks with token metrics
      const comp = data.completedTasks.find((c: any) => c.id === "pg-durable-run-1");
      expect(comp).toBeDefined();
      expect(comp.tokens).toBe(15000);
      expect(comp.cost).toBe(0.08);
      expect(data.tokenMetrics.totalCostUsd).toBe(0.08);
    });
  });
});
