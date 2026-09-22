import { randomUUID } from "node:crypto";
import {
  createAgentRecord,
  type WorkflowDefinition,
  type AgentRecord,
  toCanonicalStatus,
  canTransitionStatus,
  createSingleAgentWorkflow,
} from "@multi-agent/types";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
} from "../src/auth/internalPrincipal";
import type { StudioTask } from "../src/studio/contracts";
import type { AgentExecutionInput } from "../src/agents/runtime";

const TEST_SECRET = "phase2-taskboard-test-secret";

const alice: AuthenticatedPrincipal = { userId: "alice-user", tenantId: "tenant-alpha" };
const bob: AuthenticatedPrincipal = { userId: "bob-user", tenantId: "tenant-alpha" };
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

describe("Phase 2 Task Board — Comprehensive Production Specification", () => {
  let studioStore: InMemoryStudioStore;
  let runStore: InMemoryRunStore;
  let executor: RunExecutor;
  let app: ReturnType<typeof createStudioRouter>;
  let releaseAgentExecutions: Set<() => void>;
  let activeAgentExecutions: number;

  const sampleAgent: AgentRecord = {
    ...createAgentRecord({ name: "Alpha Dev Agent" }),
    id: "agent-alpha-1",
    description: "Specialized developer agent",
  };

  const sampleWorkflow: WorkflowDefinition = {
    ...createSingleAgentWorkflow(sampleAgent, "Alpha Deployment Workflow"),
    id: "wf-alpha-1",
  };

  beforeEach(async () => {
    studioStore = new InMemoryStudioStore();
    runStore = new InMemoryRunStore();
    releaseAgentExecutions = new Set();
    activeAgentExecutions = 0;
    executor = new RunExecutor(runStore, {
      async *execute(input: AgentExecutionInput) {
        activeAgentExecutions += 1;
        try {
          await new Promise<void>((resolve) => {
            let resolved = false;
            const finish = () => {
              if (resolved) return;
              resolved = true;
              releaseAgentExecutions.delete(finish);
              input.signal?.removeEventListener("abort", finish);
              resolve();
            };
            releaseAgentExecutions.add(finish);
            input.signal?.addEventListener("abort", finish, { once: true });
          });
          input.signal?.throwIfAborted();
          yield {
            type: "agent.completed" as const,
            timestamp: new Date().toISOString(),
            runId: input.runId,
            nodeId: input.nodeId,
            agentId: input.agent.id,
            payload: { content: "task-board-test-output" },
          };
        } finally {
          activeAgentExecutions -= 1;
        }
      },
    });

    // Seed agent and workflow for alice
    await studioStore.saveAgent(sampleAgent, alice);
    await studioStore.saveWorkflow(sampleWorkflow, alice);

    app = createStudioRouter(
      studioStore,
      (request) => {
        const token = request.headers.get("X-Multi-Agent-Principal");
        if (!token) return null;
        try {
          return verifyInternalPrincipalAssertion(token, TEST_SECRET);
        } catch {
          return null;
        }
      },
      executor
    );
  });

  afterEach(async () => {
    const deadline = Date.now() + 2_000;
    while (activeAgentExecutions > 0 && Date.now() < deadline) {
      for (const release of [...releaseAgentExecutions]) release();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(activeAgentExecutions).toBe(0);
  });

  describe("1. Domain Completeness & Persistence", () => {
    it("creates, retrieves, and persists all Phase 2 task fields", async () => {
      const createRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "Build Production Task Board",
            description: "Full Phase 2 task board requirements",
            status: "backlog",
            priority: "high",
            assignedAgents: ["agent-alpha-1"],
            workflowId: "wf-alpha-1",
            metadata: { sprint: 42, tags: ["frontend", "backend"] },
          },
          alice
        )
      );

      expect(createRes.status).toBe(201);
      const created = await json(createRes);
      expect(created.id).toBeDefined();
      expect(created.title).toBe("Build Production Task Board");
      expect(created.description).toBe("Full Phase 2 task board requirements");
      expect(created.status).toBe("backlog");
      expect(created.priority).toBe("high");
      expect(created.assignedAgents).toEqual(["agent-alpha-1"]);
      expect(created.workflowId).toBe("wf-alpha-1");
      expect(created.metadata).toEqual({ sprint: 42, tags: ["frontend", "backend"] });
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      // Retrieve via GET /tasks/:id
      const getRes = await app.fetch(req(`/tasks/${created.id}`, "GET", undefined, alice));
      expect(getRes.status).toBe(200);
      const retrieved = await json(getRes);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.priority).toBe("high");
      expect(retrieved.assignedAgents).toEqual(["agent-alpha-1"]);
      expect(retrieved.workflowId).toBe("wf-alpha-1");
    });

    it("preserves backward compatibility with legacy single agent and legacy statuses", async () => {
      const legacyTask: StudioTask = {
        id: "task-legacy-001",
        title: "Legacy Todo Task",
        description: "Old task record format",
        status: "todo",
        priority: "medium",
        assignedAgent: "agent-alpha-1",
        dependencies: [],
        output: null,
        retryCount: 0,
        paused: false,
        createdAt: "2026-09-01T00:00:00.000Z",
      };

      await studioStore.saveTask(legacyTask, alice);

      const res = await app.fetch(req("/tasks/task-legacy-001", "GET", undefined, alice));
      expect(res.status).toBe(200);
      const fetched = await json(res);
      expect(fetched.id).toBe("task-legacy-001");
      expect(fetched.assignedAgents).toEqual(["agent-alpha-1"]);
      expect(toCanonicalStatus(fetched.status)).toBe("backlog");
    });

    it("supports parentTaskId hierarchical relations", async () => {
      const parentRes = await app.fetch(
        req("/tasks", "POST", { title: "Parent Epic", status: "backlog" }, alice)
      );
      const parent = await json(parentRes);

      const childRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          { title: "Subtask 1", parentTaskId: parent.id, status: "backlog" },
          alice
        )
      );
      expect(childRes.status).toBe(201);
      const child = await json(childRes);
      expect(child.parentTaskId).toBe(parent.id);
    });
  });

  describe("2. Authoritative Validation & Cycle Detection", () => {
    it("rejects invalid runtime values instead of persisting them", async () => {
      const invalidPriority = await app.fetch(req("/tasks", "POST", { title: "Bad priority", priority: "urgent" }, alice));
      expect(invalidPriority.status).toBe(400);

      const invalidStatus = await app.fetch(req("/tasks", "POST", { title: "Bad status", status: "finished" }, alice));
      expect(invalidStatus.status).toBe(400);

      const invalidMetadata = await app.fetch(req("/tasks", "POST", { title: "Bad metadata", metadata: [] }, alice));
      expect(invalidMetadata.status).toBe(400);
    });

    it("rejects duplicate ids and unknown or circular parent relationships", async () => {
      const first = await app.fetch(req("/tasks", "POST", { id: "stable-task", title: "Stable task" }, alice));
      expect(first.status).toBe(201);
      const duplicate = await app.fetch(req("/tasks", "POST", { id: "stable-task", title: "Duplicate" }, alice));
      expect(duplicate.status).toBe(409);

      const unknownParent = await app.fetch(req("/tasks", "POST", { title: "Child", parentTaskId: "missing-parent" }, alice));
      expect(unknownParent.status).toBe(400);

      const child = await app.fetch(req("/tasks", "POST", { title: "Child", parentTaskId: "stable-task" }, alice));
      const childTask = await json(child);
      const cycle = await app.fetch(req(`/tasks/stable-task`, "PATCH", { parentTaskId: childTask.id }, alice));
      expect(cycle.status).toBe(400);
    });

    it("does not allow task edits to forge runtime-owned fields", async () => {
      const created = await app.fetch(req("/tasks", "POST", { title: "Runtime-owned fields" }, alice));
      const task = await json(created);
      const edited = await app.fetch(
        req(`/tasks/${task.id}`, "PATCH", {
          output: "forged output",
          lastError: "forged error",
          runId: "forged-run",
          completedAt: new Date().toISOString(),
          retryCount: 999,
        }, alice),
      );
      expect(edited.status).toBe(200);
      const body = await json(edited);
      expect(body.output).toBeNull();
      expect(body.lastError).toBeNull();
      expect(body.runId).toBeNull();
      expect(body.completedAt).toBeNull();
      expect(body.retryCount).toBe(0);
    });

    it("rejects task creation without a valid title", async () => {
      const res = await app.fetch(req("/tasks", "POST", { title: "   " }, alice));
      expect(res.status).toBe(400);
      const err = await json(res);
      expect(err.error).toMatch(/title is required/i);
    });

    it("rejects task assigned to a non-existent agent", async () => {
      const res = await app.fetch(
        req(
          "/tasks",
          "POST",
          { title: "Invalid Agent Task", assignedAgents: ["non-existent-agent-id"] },
          alice
        )
      );
      expect(res.status).toBe(400);
      const err = await json(res);
      expect(err.error).toMatch(/unknown agent/i);
    });

    it("rejects task referencing a non-existent workflow", async () => {
      const res = await app.fetch(
        req(
          "/tasks",
          "POST",
          { title: "Invalid Workflow Task", workflowId: "non-existent-wf" },
          alice
        )
      );
      expect(res.status).toBe(400);
      const err = await json(res);
      expect(err.error).toMatch(/unknown workflow/i);
    });

    it("rejects task referencing a non-existent dependency", async () => {
      const res = await app.fetch(
        req(
          "/tasks",
          "POST",
          { title: "Missing Dep Task", dependencies: ["non-existent-task-id"] },
          alice
        )
      );
      expect(res.status).toBe(400);
      const err = await json(res);
      expect(err.error).toMatch(/unknown dependency/i);
    });

    it("detects and rejects self-dependency", async () => {
      const createRes = await app.fetch(req("/tasks", "POST", { title: "Self Dep Task" }, alice));
      const task = await json(createRes);

      const updateRes = await app.fetch(
        req(`/tasks/${task.id}`, "PATCH", { dependencies: [task.id] }, alice)
      );
      expect(updateRes.status).toBe(400);
      const err = await json(updateRes);
      expect(err.error).toMatch(/cannot depend on itself/i);
    });

    it("detects and rejects direct two-task dependency cycle (A -> B -> A)", async () => {
      const taskARes = await app.fetch(req("/tasks", "POST", { title: "Task A" }, alice));
      const taskA = await json(taskARes);

      const taskBRes = await app.fetch(
        req("/tasks", "POST", { title: "Task B", dependencies: [taskA.id] }, alice)
      );
      const taskB = await json(taskBRes);

      // Now attempt to make Task A depend on Task B
      const updateRes = await app.fetch(
        req(`/tasks/${taskA.id}`, "PATCH", { dependencies: [taskB.id] }, alice)
      );
      expect(updateRes.status).toBe(400);
      const err = await json(updateRes);
      expect(err.error).toMatch(/circular chain/i);
    });

    it("detects and rejects transitive multi-hop dependency cycle (A -> B -> C -> A)", async () => {
      const taskARes = await app.fetch(req("/tasks", "POST", { title: "Task A" }, alice));
      const taskA = await json(taskARes);

      const taskBRes = await app.fetch(
        req("/tasks", "POST", { title: "Task B", dependencies: [taskA.id] }, alice)
      );
      const taskB = await json(taskBRes);

      const taskCRes = await app.fetch(
        req("/tasks", "POST", { title: "Task C", dependencies: [taskB.id] }, alice)
      );
      const taskC = await json(taskCRes);

      // Attempt to make Task A depend on Task C (A -> C -> B -> A)
      const updateRes = await app.fetch(
        req(`/tasks/${taskA.id}`, "PATCH", { dependencies: [taskC.id] }, alice)
      );
      expect(updateRes.status).toBe(400);
      const err = await json(updateRes);
      expect(err.error).toMatch(/circular chain/i);
    });
  });

  describe("3. Authoritative State Machine & Dependency Gating", () => {
    it("enforces canonical state transitions", () => {
      expect(canTransitionStatus("backlog", "ready")).toBe(true);
      expect(canTransitionStatus("ready", "running")).toBe(true);
      expect(canTransitionStatus("running", "completed")).toBe(true);
      expect(canTransitionStatus("running", "failed")).toBe(true);
      expect(canTransitionStatus("failed", "ready")).toBe(true);
      // Illegal jump: backlog directly to completed
      expect(canTransitionStatus("backlog", "completed")).toBe(false);
      // Illegal jump: completed to running
      expect(canTransitionStatus("completed", "running")).toBe(false);
    });

    it("rejects illegal status transition via API", async () => {
      const taskRes = await app.fetch(
        req("/tasks", "POST", { title: "Test Transition", status: "backlog" }, alice)
      );
      const task = await json(taskRes);

      const invalidMove = await app.fetch(
        req(`/tasks/${task.id}`, "PATCH", { status: "completed" }, alice)
      );
      expect(invalidMove.status).toBe(409);
      const err = await json(invalidMove);
      expect(err.error).toMatch(/invalid transition/i);
    });

    it("gates transitions to running when upstream dependencies are incomplete", async () => {
      const depTaskRes = await app.fetch(
        req("/tasks", "POST", { title: "Database Migration", status: "backlog" }, alice)
      );
      const depTask = await json(depTaskRes);

      const mainTaskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          { title: "Run Integration Tests", status: "ready", dependencies: [depTask.id] },
          alice
        )
      );
      const mainTask = await json(mainTaskRes);

      // Attempt to move mainTask to running while depTask is in backlog
      const moveRunningRes = await app.fetch(
        req(`/tasks/${mainTask.id}`, "PATCH", { status: "running" }, alice)
      );
      expect(moveRunningRes.status).toBe(409);
      const errRunning = await json(moveRunningRes);
      expect(errRunning.error).toMatch(/blocked by \d+ unfinished dependent task/i);

      // Attempt to start mainTask while depTask is in backlog
      const startRes = await app.fetch(
        req(`/tasks/${mainTask.id}/start`, "POST", undefined, alice)
      );
      expect(startRes.status).toBe(409);
      const errStart = await json(startRes);
      expect(errStart.error).toMatch(/blocked by \d+ unfinished dependent task/i);

      // Complete the dependency
      await studioStore.saveTask(
        {
          ...depTask,
          status: "completed",
          completedAt: new Date().toISOString(),
        },
        alice
      );

      // Now starting mainTask with completed dependencies succeeds
      // Seed an agent for mainTask so start can execute
      await app.fetch(
        req(`/tasks/${mainTask.id}`, "PATCH", { assignedAgents: ["agent-alpha-1"] }, alice)
      );
      const validStartRes = await app.fetch(
        req(`/tasks/${mainTask.id}/start`, "POST", undefined, alice)
      );
      expect(validStartRes.status).toBe(200);
      const startData = await json(validStartRes);
      expect(startData.success).toBe(true);
      expect(startData.runId).toBeDefined();
    });
  });

  describe("4. Runtime Execution Linkage with RunExecutor", () => {
    it("starts a single-agent task run through RunExecutor, linking runId and updating status", async () => {
      const taskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "Code Review Task",
            status: "ready",
            assignedAgents: ["agent-alpha-1"],
          },
          alice
        )
      );
      const task = await json(taskRes);

      const startRes = await app.fetch(
        req(`/tasks/${task.id}/start`, "POST", undefined, alice)
      );
      expect(startRes.status).toBe(200);
      const startBody = await json(startRes);
      expect(startBody.success).toBe(true);
      expect(startBody.runId).toBeDefined();

      // Verify task in store now has runId, startedAt, and running status
      const updatedTask = await studioStore.getTask(task.id, alice);
      expect(updatedTask).toBeDefined();
      expect(updatedTask?.runId).toBe(startBody.runId);
      expect(updatedTask?.status).toBe("running");
      expect(updatedTask?.startedAt).toBeDefined();

      // Verify Run exists in runStore with linked taskId
      const runEntry = runStore.get(startBody.runId);
      expect(runEntry).toBeDefined();
      expect(runEntry?.run.taskId).toBe(task.id);
    });

    it("starts a workflow-backed task run through RunExecutor", async () => {
      const taskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "CI/CD Pipeline Task",
            status: "ready",
            workflowId: "wf-alpha-1",
          },
          alice
        )
      );
      const task = await json(taskRes);

      const startRes = await app.fetch(
        req(`/tasks/${task.id}/start`, "POST", undefined, alice)
      );
      expect(startRes.status).toBe(200);
      const startBody = await json(startRes);
      expect(startBody.success).toBe(true);
      expect(startBody.runId).toBeDefined();

      const runEntry = runStore.get(startBody.runId);
      expect(runEntry?.run.workflowId).toBe("wf-alpha-1");
    });

    it("syncs task completion and output when run completes", async () => {
      const taskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "Fast Task",
            status: "ready",
            assignedAgents: ["agent-alpha-1"],
          },
          alice
        )
      );
      const task = await json(taskRes);

      const startRes = await app.fetch(
        req(`/tasks/${task.id}/start`, "POST", undefined, alice)
      );
      const { runId } = await json(startRes);

      // Simulate run completion event
      runStore.update(runId, { status: "completed", output: { result: "All tests green" } });
      runStore.append(runId, {
        id: randomUUID(),
        runId,
        type: "run.completed",
        timestamp: new Date().toISOString(),
        sequence: 1,
        payload: { output: { result: "All tests green" } },
      });

      // Give event loop microtask time to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      const finishedTask = await studioStore.getTask(task.id, alice);
      expect(finishedTask?.status).toBe("completed");
      const parsedOutput = typeof finishedTask?.output === "string" ? JSON.parse(finishedTask.output) : finishedTask?.output;
      expect(parsedOutput).toEqual({ result: "All tests green" });
      expect(finishedTask?.completedAt).toBeDefined();
    });

    it("syncs task failure and records lastError when run fails", async () => {
      const taskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "Failing Run Task",
            status: "ready",
            assignedAgents: ["agent-alpha-1"],
          },
          alice
        )
      );
      const task = await json(taskRes);

      const startRes = await app.fetch(
        req(`/tasks/${task.id}/start`, "POST", undefined, alice)
      );
      const { runId } = await json(startRes);

      // Simulate run failure
      runStore.update(runId, { status: "failed", error: "Connection to agent timed out" });
      runStore.append(runId, {
        id: randomUUID(),
        runId,
        type: "run.failed",
        timestamp: new Date().toISOString(),
        sequence: 1,
        payload: { error: "Connection to agent timed out" },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const failedTask = await studioStore.getTask(task.id, alice);
      expect(failedTask?.status).toBe("failed");
      expect(failedTask?.lastError).toMatch(/Connection to agent timed out/i);
    });

    it("truthfully handles pause on running task by reporting runtime constraint (409)", async () => {
      const taskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "In-Flight Running Task",
            status: "ready",
            assignedAgents: ["agent-alpha-1"],
          },
          alice
        )
      );
      const task = await json(taskRes);

      await app.fetch(req(`/tasks/${task.id}/start`, "POST", undefined, alice));

      // Attempt to pause running task
      const pauseRes = await app.fetch(
        req(`/tasks/${task.id}/pause`, "POST", undefined, alice)
      );
      expect(pauseRes.status).toBe(409);
      const err = await json(pauseRes);
      expect(err.error).toMatch(/mid-stream.*pausing/i);
    });

    it("cancels a running task and its associated run", async () => {
      const taskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "Task to Cancel",
            status: "ready",
            assignedAgents: ["agent-alpha-1"],
          },
          alice
        )
      );
      const task = await json(taskRes);

      const startRes = await app.fetch(
        req(`/tasks/${task.id}/start`, "POST", undefined, alice)
      );
      const { runId } = await json(startRes);

      const cancelRes = await app.fetch(
        req(`/tasks/${task.id}/cancel`, "POST", undefined, alice)
      );
      expect(cancelRes.status).toBe(200);
      const cancelBody = await json(cancelRes);
      expect(cancelBody.task.status).toBe("cancelled");

      const run = runStore.get(runId)?.run;
      expect(run?.status).toBe("cancelled");
    });

    it("retries a failed task, clearing lastError and initiating a new run", async () => {
      const taskRes = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "Retryable Task",
            status: "ready",
            assignedAgents: ["agent-alpha-1"],
          },
          alice
        )
      );
      const task = await json(taskRes);

      // Simulate task failed with previous error
      await studioStore.saveTask(
        {
          ...task,
          status: "failed",
          lastError: "Database connection failed",
          retryCount: 1,
        },
        alice
      );

      const retryRes = await app.fetch(
        req(`/tasks/${task.id}/retry`, "POST", undefined, alice)
      );
      expect(retryRes.status).toBe(200);
      const retryBody = await json(retryRes);
      expect(retryBody.success).toBe(true);
      expect(retryBody.runId).toBeDefined();

      const retriedTask = await studioStore.getTask(task.id, alice);
      expect(retriedTask?.status).toBe("running");
      expect(retriedTask?.lastError).toBeNull();
      expect(retriedTask?.retryCount).toBe(2);
      expect(retriedTask?.runId).toBe(retryBody.runId);
    });
  });

  describe("5. Task Deletion & Upstream Dependency Cleanup", () => {
    it("removes deleted task from other tasks' dependency lists", async () => {
      const task1Res = await app.fetch(
        req("/tasks", "POST", { title: "Prerequisite Task 1" }, alice)
      );
      const task1 = await json(task1Res);

      const task2Res = await app.fetch(
        req(
          "/tasks",
          "POST",
          { title: "Downstream Task 2", dependencies: [task1.id] },
          alice
        )
      );
      const task2 = await json(task2Res);
      expect(task2.dependencies).toEqual([task1.id]);

      // Delete Task 1
      const delRes = await app.fetch(req(`/tasks/${task1.id}`, "DELETE", undefined, alice));
      expect(delRes.status).toBe(200);

      // Check Task 2's dependencies are cleaned up
      const checkRes = await app.fetch(req(`/tasks/${task2.id}`, "GET", undefined, alice));
      const updatedTask2 = await json(checkRes);
      expect(updatedTask2.dependencies).toEqual([]);
    });
  });

  describe("6. Strict Multi-Tenant Isolation & Ownership Boundaries", () => {
    let aliceTaskId: string;

    beforeEach(async () => {
      const res = await app.fetch(
        req(
          "/tasks",
          "POST",
          {
            title: "Alice Confidential Task",
            status: "ready",
            assignedAgents: ["agent-alpha-1"],
          },
          alice
        )
      );
      const task = await json(res);
      aliceTaskId = task.id;
    });

    it("prevents cross-tenant GET /tasks/:id", async () => {
      const res = await app.fetch(req(`/tasks/${aliceTaskId}`, "GET", undefined, eve));
      expect(res.status).toBe(404);
    });

    it("prevents cross-tenant PATCH /tasks/:id", async () => {
      const res = await app.fetch(
        req(`/tasks/${aliceTaskId}`, "PATCH", { title: "Eve Hacked Title" }, eve)
      );
      expect(res.status).toBe(404);
    });

    it("prevents cross-tenant POST /tasks/:id/start", async () => {
      const res = await app.fetch(
        req(`/tasks/${aliceTaskId}/start`, "POST", undefined, eve)
      );
      expect(res.status).toBe(404);
    });

    it("prevents cross-tenant POST /tasks/:id/cancel", async () => {
      const res = await app.fetch(
        req(`/tasks/${aliceTaskId}/cancel`, "POST", undefined, eve)
      );
      expect(res.status).toBe(404);
    });

    it("prevents cross-tenant POST /tasks/:id/retry", async () => {
      const res = await app.fetch(
        req(`/tasks/${aliceTaskId}/retry`, "POST", undefined, eve)
      );
      expect(res.status).toBe(404);
    });

    it("prevents cross-tenant DELETE /tasks/:id", async () => {
      const res = await app.fetch(
        req(`/tasks/${aliceTaskId}`, "DELETE", undefined, eve)
      );
      expect(res.status).toBe(404);

      // Verify Alice's task is still intact
      const aliceCheck = await app.fetch(req(`/tasks/${aliceTaskId}`, "GET", undefined, alice));
      expect(aliceCheck.status).toBe(200);
    });

    it("permits same-tenant collaboration (Bob in Alice's tenant)", async () => {
      const res = await app.fetch(req(`/tasks/${aliceTaskId}`, "GET", undefined, bob));
      expect(res.status).toBe(200);
      const task = await json(res);
      expect(task.id).toBe(aliceTaskId);
    });
  });
});
