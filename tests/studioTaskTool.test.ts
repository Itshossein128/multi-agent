import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { StudioTaskToolExecutor } from "../src/tools/studioTaskToolExecutor";
import { ToolExecutorFactory } from "../src/tools/toolExecutorFactory";
import { ToolRuntime } from "../src/tools/toolRuntime";
import type { ToolRecord } from "@multi-agent/types";
import type { StudioTask } from "../src/studio/contracts";

describe("StudioTaskToolExecutor Comprehensive Unit & Integration Tests (T015 - T018)", () => {
  let store: InMemoryStudioStore;
  let executor: StudioTaskToolExecutor;

  const tenantA = "tenant-building-gap";
  const tenantB = "tenant-other-org";

  const principalA = { tenantId: tenantA, principalId: "agent-lead-orchestrator" };
  const principalB = { tenantId: tenantB, principalId: "agent-foreign" };

  const toolRecord: ToolRecord = {
    id: "tool-studio-task",
    name: "studio_task_tool",
    category: "function",
    description: "Studio Task Tool",
    inputSchema: {},
    outputSchema: {},
    configuration: {},
    enabled: true,
    impact: "read-only",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    store = new InMemoryStudioStore();
    executor = new StudioTaskToolExecutor(store);

    // Seed tasks for tenant A
    await store.saveTask({
      id: "task-01",
      title: "US-01: Weather Conditions",
      description: "Track weather conditions for daily logs",
      priority: "high",
      status: "queued",
      assignedAgent: null,
      projectId: "proj-gap-1",
      workspaceId: "ws-sandbox",
      dependencies: [],
      output: null,
      retryCount: 0,
      paused: false,
      tenantId: tenantA,
      createdAt: "2026-10-22T10:00:00.000Z",
    });

    await store.saveTask({
      id: "task-02",
      title: "US-02: Safety Check",
      description: "Daily safety inspection checklist",
      priority: "medium",
      status: "in_progress",
      assignedAgent: "agent-auditor",
      assignedAgents: ["agent-auditor"],
      projectId: "proj-gap-1",
      workspaceId: "ws-sandbox",
      dependencies: ["task-01"],
      output: null,
      retryCount: 0,
      paused: false,
      tenantId: tenantA,
      createdAt: "2026-10-22T10:05:00.000Z",
    });

    await store.saveTask({
      id: "task-03",
      title: "US-03: Material Delivery",
      description: "Log material delivery receipt",
      priority: "low",
      status: "done",
      assignedAgent: "agent-developer",
      projectId: "proj-gap-2",
      workspaceId: "ws-sandbox",
      dependencies: [],
      output: "Delivery verified",
      retryCount: 0,
      paused: false,
      tenantId: tenantA,
      createdAt: "2026-10-22T10:10:00.000Z",
    });

    // Seed task for tenant B (for tenant isolation tests)
    await store.saveTask({
      id: "task-alien-01",
      title: "Alien Task",
      description: "Private task belonging to tenant B",
      priority: "high",
      status: "queued",
      assignedAgent: "agent-alien",
      projectId: "proj-alien",
      workspaceId: "ws-alien",
      dependencies: [],
      output: null,
      retryCount: 0,
      paused: false,
      tenantId: tenantB,
      createdAt: "2026-10-22T10:00:00.000Z",
    });
  });

  describe("Action: query_tasks", () => {
    test("queries all tasks for the calling tenant", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "query_tasks",
          params: {},
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      expect(response.action).toBe("query_tasks");
      const data = response.data as { tasks: StudioTask[]; total: number };
      expect(data.total).toBe(3);
      expect(data.tasks.map((t) => t.id)).toEqual(
        expect.arrayContaining(["task-01", "task-02", "task-03"]),
      );
      // Strictly no tenant B tasks
      expect(data.tasks.some((t) => t.tenantId === tenantB)).toBe(false);
    });

    test("filters tasks by status (e.g. queued)", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "query_tasks",
          params: { status: "queued" },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { tasks: StudioTask[]; total: number };
      expect(data.total).toBe(1);
      expect(data.tasks[0].id).toBe("task-01");
      expect(data.tasks[0].status).toBe("queued");
    });

    test("filters tasks by projectId and assignedAgent", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "query_tasks",
          params: {
            projectId: "proj-gap-1",
            assignedAgent: "agent-auditor",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { tasks: StudioTask[]; total: number };
      expect(data.total).toBe(1);
      expect(data.tasks[0].id).toBe("task-02");
      expect(data.tasks[0].assignedAgent).toBe("agent-auditor");
    });

    test("honors pagination with limit and offset", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "query_tasks",
          params: { limit: 1, offset: 1 },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { tasks: StudioTask[]; total: number };
      expect(data.total).toBe(3); // total available
      expect(data.tasks.length).toBe(1); // paginated slice
    });
  });

  describe("Action: update_task_status (Lifecycle transitions)", () => {
    test("transitions queued -> in_progress and records startedAt timestamp", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-01",
            newStatus: "in_progress",
            reason: "Lead Orchestrator dispatched task to Gap Auditor",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { task: StudioTask };
      expect(data.task.status).toBe("in_progress");
      expect(data.task.startedAt).toBeDefined();
      expect(data.task.metadata?.statusChangeReason).toBe(
        "Lead Orchestrator dispatched task to Gap Auditor",
      );

      // Verify in store
      const persisted = await store.getTask("task-01");
      expect(persisted?.status).toBe("in_progress");
    });

    test("transitions in_progress -> in_review", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-02",
            newStatus: "in_review",
            reason: "Audit complete, awaiting Human Approval Gate",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { task: StudioTask };
      expect(data.task.status).toBe("in_review");
    });

    test("transitions in_review -> done and records completedAt timestamp", async () => {
      // First set to in_review
      await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: { taskId: "task-02", newStatus: "in_review" },
        },
        credentialPrincipal: principalA,
      });

      // Then transition in_review -> done
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: { taskId: "task-02", newStatus: "done", reason: "All QA verification passed" },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { task: StudioTask };
      expect(data.task.status).toBe("done");
      expect(data.task.completedAt).toBeDefined();
    });

    test("transitions in_progress -> paused and sets paused flag", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-02",
            newStatus: "paused",
            reason: "Remediation loop limit reached (max 3 cycles)",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { task: StudioTask };
      expect(data.task.status).toBe("paused");
      expect(data.task.paused).toBe(true);
    });

    test("transitions paused -> in_progress and clears paused flag", async () => {
      // Transition task-01 to in_progress
      await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: { taskId: "task-01", newStatus: "in_progress" },
        },
        credentialPrincipal: principalA,
      });

      // Pause task-01
      await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: { taskId: "task-01", newStatus: "paused" },
        },
        credentialPrincipal: principalA,
      });

      // Resume task-01 to in_progress
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: { taskId: "task-01", newStatus: "in_progress", reason: "User resolved pause" },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { task: StudioTask };
      expect(data.task.status).toBe("in_progress");
      expect(data.task.paused).toBe(false);
    });

    test("transitions in_progress -> failed", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-02",
            newStatus: "failed",
            reason: "Non-recoverable syntax error in sandbox code",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { task: StudioTask };
      expect(data.task.status).toBe("failed");
    });

    test("rejects invalid status transition (queued -> done) fail-closed", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-01",
            newStatus: "done",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("INVALID_STATUS_TRANSITION");
      expect((response as any).error.message).toContain('from "queued" to "done"');
    });

    test("rejects invalid status transition (done -> in_progress) fail-closed", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-03",
            newStatus: "in_progress",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("INVALID_STATUS_TRANSITION");
    });

    test("rejects transition to in_progress when upstream dependency is incomplete (DEPENDENCY_BLOCKED)", async () => {
      // task-02 depends on task-01. task-01 is currently 'queued' (not done).
      // Let's create task-04 that is 'queued' and depends on 'task-01'
      await store.saveTask({
        id: "task-04",
        title: "US-04: Dependent Task",
        description: "Depends on uncompleted task-01",
        priority: "high",
        status: "queued",
        assignedAgent: null,
        projectId: "proj-gap-1",
        dependencies: ["task-01"],
        output: null,
        retryCount: 0,
        paused: false,
        tenantId: tenantA,
        createdAt: "2026-10-22T10:00:00.000Z",
      });

      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-04",
            newStatus: "in_progress",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("DEPENDENCY_BLOCKED");
      expect((response as any).error.message).toContain("task-01");
    });

    test("returns TASK_NOT_FOUND when updating non-existent task", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-does-not-exist",
            newStatus: "in_progress",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("TASK_NOT_FOUND");
    });
  });

  describe("Action: assign_task", () => {
    test("assigns single specialist agent to task", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "assign_task",
          params: {
            taskId: "task-01",
            assignedAgent: "agent-spec-gap-auditor",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { task: StudioTask };
      expect(data.task.assignedAgent).toBe("agent-spec-gap-auditor");
      expect(data.task.assignedAgents).toContain("agent-spec-gap-auditor");

      // Verify in store
      const persisted = await store.getTask("task-01");
      expect(persisted?.assignedAgent).toBe("agent-spec-gap-auditor");
    });

    test("assigns multiple specialist agents to task", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "assign_task",
          params: {
            taskId: "task-01",
            assignedAgent: "agent-lead",
            assignedAgents: ["agent-lead", "agent-developer", "agent-qa"],
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { task: StudioTask };
      expect(data.task.assignedAgent).toBe("agent-lead");
      expect(data.task.assignedAgents).toEqual(
        expect.arrayContaining(["agent-lead", "agent-developer", "agent-qa"]),
      );
    });

    test("returns TASK_NOT_FOUND when assigning non-existent task", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "assign_task",
          params: {
            taskId: "ghost-task",
            assignedAgent: "agent-auditor",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("TASK_NOT_FOUND");
    });
  });

  describe("Action: add_task_comment (Structured Findings & Roles)", () => {
    test("adds structured audit finding comment with role=agent", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "add_task_comment",
          params: {
            taskId: "task-01",
            content: "Spec Audit: 12/14 checks passed. Completeness: 85.7%.",
            authorRole: "agent",
            authorAgentId: "agent-spec-auditor",
            metadata: {
              completenessScore: 85.7,
              gapsCount: 2,
              iteration: 1,
              reportRef: "SPEC-01-DAILY-WEATHER",
            },
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(true);
      const data = response.data as { comment: any };
      expect(data.comment.taskId).toBe("task-01");
      expect(data.comment.authorType).toBe("agent");
      expect(data.comment.authorId).toBe("agent-spec-auditor");
      expect(data.comment.metadata.completenessScore).toBe(85.7);

      // Verify persisted in store
      const comments = await store.listComments("task-01");
      expect(comments.length).toBe(1);
      expect(comments[0].content).toContain("Spec Audit: 12/14");
    });

    test("supports authorRole attribution for system and user", async () => {
      for (const authorRole of ["system", "user"] as const) {
        const response = await executor.execute({
          tool: toolRecord,
          input: {
            action: "add_task_comment",
            params: {
              taskId: "task-01",
              content: `Automated note from ${authorRole}`,
              authorRole,
            },
          },
          credentialPrincipal: principalA,
        });

        expect(response.success).toBe(true);
        const data = response.data as { comment: any };
        expect(data.comment.authorType).toBe(authorRole);
      }
    });

    test("returns TASK_NOT_FOUND when commenting on non-existent task", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "add_task_comment",
          params: {
            taskId: "missing-task",
            content: "Comment on missing task",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("TASK_NOT_FOUND");
    });
  });

  describe("Strict Tenant Isolation (T017)", () => {
    test("query_tasks never leaks cross-tenant records", async () => {
      // Tenant A query
      const resA = await executor.execute({
        tool: toolRecord,
        input: { action: "query_tasks", params: {} },
        credentialPrincipal: principalA,
      });
      const dataA = resA.data as { tasks: StudioTask[] };
      expect(dataA.tasks.every((t) => t.tenantId === tenantA)).toBe(true);
      expect(dataA.tasks.some((t) => t.id === "task-alien-01")).toBe(false);

      // Tenant B query
      const resB = await executor.execute({
        tool: toolRecord,
        input: { action: "query_tasks", params: {} },
        credentialPrincipal: principalB,
      });
      const dataB = resB.data as { tasks: StudioTask[] };
      expect(dataB.tasks.every((t) => t.tenantId === tenantB)).toBe(true);
      expect(dataB.tasks.some((t) => t.id === "task-01")).toBe(false);
    });

    test("query_tasks fails closed without authenticated credentialPrincipal.tenantId", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: { action: "query_tasks", params: {} },
        // No credentialPrincipal supplied
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("TENANT_ISOLATION_VIOLATION");
    });

    test("update_task_status fails closed with TENANT_ISOLATION_VIOLATION on cross-tenant task update", async () => {
      // Tenant A principal trying to modify Tenant B's task-alien-01
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-alien-01",
            newStatus: "in_progress",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("TENANT_ISOLATION_VIOLATION");
      expect((response as any).error.message).toContain("tenant");

      // Verify task-alien-01 in store was NOT modified
      const alienTask = await store.getTask("task-alien-01");
      expect(alienTask?.status).toBe("queued");
    });

    test("assign_task fails closed with TENANT_ISOLATION_VIOLATION on cross-tenant task assignment", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "assign_task",
          params: {
            taskId: "task-alien-01",
            assignedAgent: "agent-intruder",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("TENANT_ISOLATION_VIOLATION");

      const alienTask = await store.getTask("task-alien-01");
      expect(alienTask?.assignedAgent).toBe("agent-alien");
    });

    test("add_task_comment fails closed with TENANT_ISOLATION_VIOLATION on cross-tenant task comment", async () => {
      const response = await executor.execute({
        tool: toolRecord,
        input: {
          action: "add_task_comment",
          params: {
            taskId: "task-alien-01",
            content: "Intruder comment",
          },
        },
        credentialPrincipal: principalA,
      });

      expect(response.success).toBe(false);
      expect((response as any).error.code).toBe("TENANT_ISOLATION_VIOLATION");

      const comments = await store.listComments("task-alien-01");
      expect(comments.length).toBe(0);
    });
  });

  describe("Tool Factory & ToolRuntime Integration (T018)", () => {
    test("ToolExecutorFactory creates StudioTaskToolExecutor by category or tool name", () => {
      const factory = new ToolExecutorFactory(undefined, store);

      const byCategory = factory.create("studio_task_tool" as any);
      expect(byCategory).toBeInstanceOf(StudioTaskToolExecutor);

      const byName = factory.create("function", "studio_task_tool");
      expect(byName).toBeInstanceOf(StudioTaskToolExecutor);

      const byMethod = factory.createStudioTaskToolExecutor();
      expect(byMethod).toBeInstanceOf(StudioTaskToolExecutor);
    });

    test("ToolRuntime executes studio_task_tool seamlessly under policy", async () => {
      const factory = new ToolExecutorFactory(undefined, store);
      const runtime = new ToolRuntime(5_000, true, factory);

      const output = await runtime.execute(
        toolRecord,
        {
          action: "query_tasks",
          params: { status: "queued" },
        },
        undefined,
        {
          credentialPrincipal: principalA,
        },
      );

      expect(output).toBeDefined();
      expect(output.success).toBe(true);
      expect(output.action).toBe("query_tasks");
      expect((output.data as any).total).toBe(1);
    });
  });
});
