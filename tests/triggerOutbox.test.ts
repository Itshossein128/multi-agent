import { extractMentions, registerTaskCommentRoutes } from "../apps/server/src/api/studio/taskCommentRoutes";
import { TriggerOutboxProcessor } from "../apps/server/src/triggers/triggerOutboxProcessor";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { Hono } from "hono";
import type { AgentRecord } from "@multi-agent/types";
import type { StudioTask } from "../src/studio/contracts";

describe("Trigger Outbox & Event-Driven Wakeups", () => {
  describe("Mentions Extraction", () => {
    it("extracts mentions with case-insensitivity and deduplication", () => {
      const text = "Hello @code-reviewer and @tester! Please check this, @Code-Reviewer";
      const mentions = extractMentions(text);
      expect(mentions).toEqual(["code-reviewer", "tester"]);
    });

    it("returns empty array when no mentions present", () => {
      expect(extractMentions("Plain comment without mentions")).toEqual([]);
    });
  });

  describe("Task Comments & Self-Comment Loop Suppression", () => {
    let store: InMemoryStudioStore;
    let app: Hono<any>;
    const principal = { tenantId: "tenant-outbox", userId: "user-alice" };

    const reviewerAgent: AgentRecord = {
      id: "agent-reviewer",
      name: "Code Reviewer",
      description: "",
      systemPrompt: "",
      tools: [],
      backend: { type: "local", provider: "mock" } as any,
      executionPolicy: { filesystem: "read", network: true },
      enabled: true,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const workerAgent: AgentRecord = {
      id: "agent-worker",
      name: "Task Worker",
      description: "",
      systemPrompt: "",
      tools: [],
      backend: { type: "local", provider: "mock" } as any,
      executionPolicy: { filesystem: "read", network: true },
      enabled: true,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const task: StudioTask = {
      id: "task-100",
      workspaceId: "ws-1",
      projectIds: ["proj-1"],
      title: "Write documentation",
      description: "Document feature 005",
      priority: "medium",
      status: "running",
      assignedAgent: "agent-worker",
      assignedAgents: ["agent-worker"],
      retryCount: 0,
      paused: false,
      dependencies: [],
      output: null,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tenantId: "tenant-outbox",
    };

    beforeEach(async () => {
      store = new InMemoryStudioStore();
      await store.saveAgent(reviewerAgent, principal);
      await store.saveAgent(workerAgent, principal);
      await store.saveTask(task, principal);

      app = new Hono();
      app.use("/*", async (c, next) => {
        c.set("principal", principal);
        await next();
      });
      registerTaskCommentRoutes(app as any, store);
    });

    it("enqueues trigger intent when user mentions an agent", async () => {
      const res = await app.request("/tasks/task-100/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Please review this PR @agent-reviewer",
          authorType: "user",
        }),
      });

      expect(res.status).toBe(201);
      const events = await store.listTriggerEvents({ tenantId: "tenant-outbox" });
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("task_mention");
      expect(events[0].payload.targetAgentId).toBe("agent-reviewer");
      expect(events[0].idempotencyKey).toMatch(/^comment:comment-[a-z0-9-]+:agent-reviewer$/);
    });

    it("suppresses loop when agent comments on its own task without mentions", async () => {
      process.env.INTERNAL_PRINCIPAL_SECRET = "worker-secret-xyz";
      // Agent-worker posts progress update on task-100 (which is assigned to agent-worker)
      const res = await app.request("/tasks/task-100/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-worker-secret": "worker-secret-xyz",
        },
        body: JSON.stringify({
          content: "I have finished step 1, working on step 2 now.",
          authorType: "agent",
          authorId: "agent-worker",
        }),
      });

      expect(res.status).toBe(201);
      // Self-comment loop suppression must prevent waking agent-worker again!
      const events = await store.listTriggerEvents({ tenantId: "tenant-outbox" });
      expect(events).toHaveLength(0);
    });

    it("allows agent to wake another agent via @mention", async () => {
      process.env.INTERNAL_PRINCIPAL_SECRET = "worker-secret-xyz";
      // Agent-worker posts comment mentioning Code Reviewer
      const res = await app.request("/tasks/task-100/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-worker-secret": "worker-secret-xyz",
        },
        body: JSON.stringify({
          content: "Step 1 complete, please verify @agent-reviewer",
          authorType: "agent",
          authorId: "agent-worker",
        }),
      });

      expect(res.status).toBe(201);
      const events = await store.listTriggerEvents({ tenantId: "tenant-outbox" });
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("task_mention");
      expect(events[0].payload.targetAgentId).toBe("agent-reviewer");
    });
  });

  describe("Outbox Worker Lifecycle & Retry State", () => {
    let store: InMemoryStudioStore;

    beforeEach(() => {
      store = new InMemoryStudioStore();
    });

    it("processes pending outbox event and updates status to processed", async () => {
      await store.saveTask(
        {
          id: "task-test",
          workspaceId: "ws-1",
          projectIds: ["p-1"],
          title: "Test Task",
          description: "",
          priority: "medium",
          status: "running",
          assignedAgent: "agent-1",
          assignedAgents: ["agent-1"],
          retryCount: 0,
          paused: false,
          dependencies: [],
          output: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tenantId: "tenant-1",
        },
        { tenantId: "tenant-1", userId: "user-1" },
      );

      const event = await store.enqueueTriggerEvent({
        tenantId: "tenant-1",
        eventType: "task_assignment",
        targetType: "task",
        targetId: "task-test",
        idempotencyKey: "assign:task-test:1",
        payload: { taskId: "task-test" },
      });

      expect(event.status).toBe("pending");

      // Mock executor
      const fakeExecutor: any = {
        start: jest.fn().mockReturnValue("run-fake-123"),
      };

      const processor = new TriggerOutboxProcessor(store, fakeExecutor);
      const result = await processor.tick();

      expect(result).not.toBeNull();
      const updated = (await store.listTriggerEvents({ tenantId: "tenant-1" }))[0];
      expect(updated.status).toBe("processed");
      expect(updated.retryCount).toBe(0);
    });

    it("transitions event to dead_letter after exceeding maxRetries", async () => {
      await store.enqueueTriggerEvent({
        tenantId: "tenant-1",
        eventType: "routine_tick",
        targetType: "workflow",
        targetId: "wf-nonexistent",
        idempotencyKey: "tick:wf-nonexistent:1",
        payload: {},
        maxRetries: 2,
      });

      // Processor with no workflow in store -> will fail
      const processor = new TriggerOutboxProcessor(store, undefined);

      // Attempt 1: fails, status remains pending or failed, retryCount becomes 1
      await processor.tick();
      let event = (await store.listTriggerEvents({ tenantId: "tenant-1" }))[0];
      expect(event.retryCount).toBe(1);
      expect(event.status).not.toBe("dead_letter");

      // Attempt 2: fails, reaches maxRetries (2) -> dead_letter
      // Reset nextRetryAt to past so it can be claimed immediately
      await store.updateTriggerEvent(event.id, { nextRetryAt: new Date(Date.now() - 1000).toISOString() });
      await processor.tick();

      event = (await store.listTriggerEvents({ tenantId: "tenant-1" }))[0];
      expect(event.status).toBe("dead_letter");
      expect(event.lastError).toMatch(/RunExecutor not configured|not found/);
    });

    it("wakes specifically mentioned agent B on task assigned to agent A", async () => {
      const principal = { tenantId: "tenant-dispatch", userId: "u-1" };
      await store.saveAgent(
        {
          id: "agent-a",
          name: "Agent Alpha",
          description: "",
          systemPrompt: "",
          tools: [],
          backend: { type: "local", provider: "mock" } as any,
          executionPolicy: { filesystem: "read", network: true },
          enabled: true,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        principal,
      );

      await store.saveAgent(
        {
          id: "agent-b",
          name: "Agent Beta",
          description: "",
          systemPrompt: "",
          tools: [],
          backend: { type: "local", provider: "mock" } as any,
          executionPolicy: { filesystem: "read", network: true },
          enabled: true,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        principal,
      );

      await store.saveTask(
        {
          id: "task-assigned-to-a",
          workspaceId: "ws-1",
          projectIds: ["p-1"],
          title: "Assigned Task",
          description: "",
          priority: "medium",
          status: "running",
          assignedAgent: "agent-a",
          assignedAgents: ["agent-a"],
          retryCount: 0,
          paused: false,
          dependencies: [],
          output: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tenantId: "tenant-dispatch",
        },
        principal,
      );

      // Enqueue mention event targeting agent-b specifically
      await store.enqueueTriggerEvent({
        tenantId: "tenant-dispatch",
        eventType: "task_mention",
        targetType: "task",
        targetId: "task-assigned-to-a",
        idempotencyKey: "mention:task-assigned-to-a:agent-b",
        payload: {
          taskId: "task-assigned-to-a",
          targetAgentId: "agent-b",
          content: "Can you help here @Agent Beta",
        },
      });

      const mockExecutor: any = {
        start: jest.fn().mockReturnValue("run-dispatched-for-b"),
      };

      const processor = new TriggerOutboxProcessor(store, mockExecutor);
      const res = await processor.tick();
      expect(res).not.toBeNull();

      expect(mockExecutor.start).toHaveBeenCalledTimes(1);
      const startArg = mockExecutor.start.mock.calls[0][0];
      // Target agent should be agent-b, NOT agent-a!
      expect(startArg.agents[0].id).toBe("agent-b");
      expect(startArg.metadata.targetAgentId).toBe("agent-b");
    });

    it("resolves approval faithfully preserving decision without creating duplicate run", async () => {
      const principal = { tenantId: "tenant-appr", userId: "u-1" };
      await store.saveTask(
        {
          id: "task-appr",
          workspaceId: "ws-1",
          projectIds: ["p-1"],
          title: "Approval Task",
          description: "",
          priority: "high",
          status: "running",
          runId: "run-existing-123",
          assignedAgent: "agent-1",
          assignedAgents: ["agent-1"],
          retryCount: 0,
          paused: true,
          dependencies: [],
          output: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tenantId: "tenant-appr",
        },
        principal,
      );

      await store.enqueueTriggerEvent({
        tenantId: "tenant-appr",
        eventType: "approval_resolved",
        targetType: "task",
        targetId: "task-appr",
        idempotencyKey: "approval:appr-456",
        payload: {
          taskId: "task-appr",
          approvalId: "appr-456",
          decision: "rejected",
          response: "Operator denied permission for security boundary",
          clarificationAnswers: [{ questionId: "scope", value: "limited" }],
        },
      });

      const mockExecutor: any = {
        isRunResumable: jest.fn().mockReturnValue(true),
        resolveApproval: jest.fn().mockReturnValue({ runId: "run-existing-123", status: "running" }),
        start: jest.fn(),
      };
      const mockTaskService: any = {
        start: jest.fn(),
      };

      const processor = new TriggerOutboxProcessor(store, mockExecutor, mockTaskService);
      const processed = await processor.tick();

      expect(processed).not.toBeNull();
      // Should have called resolveApproval with actual rejected decision and clarification answers
      expect(mockExecutor.resolveApproval).toHaveBeenCalledWith("run-existing-123", "appr-456", {
        decision: "rejected",
        response: "Operator denied permission for security boundary",
        clarificationAnswers: [{ questionId: "scope", value: "limited" }],
      });
      // Should NEVER have spawned a new run or called taskService.start!
      expect(mockExecutor.start).not.toHaveBeenCalled();
      expect(mockTaskService.start).not.toHaveBeenCalled();
    });

    it("enforces CAS lease check so stolen or expired leases do not clobber state", async () => {
      const event = await store.enqueueTriggerEvent({
        tenantId: "tenant-cas",
        eventType: "routine_tick",
        targetType: "agent",
        targetId: "agent-1",
        idempotencyKey: "cas-test-key-1",
        payload: {},
      });

      // Claimed by worker-alpha
      const claimed = await store.claimNextTriggerEvent("worker-alpha", 60);
      expect(claimed?.lockedBy).toBe("worker-alpha");

      // While worker-alpha is working, lease expires and worker-beta steals the lock
      await store.updateTriggerEvent(event.id, {
        lockedBy: "worker-beta",
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      });

      // worker-alpha attempts to ack with CAS expectedLockedBy = worker-alpha
      const ackResult = await store.updateTriggerEvent(
        event.id,
        { status: "processed", lockedBy: null, lockedUntil: null },
        "worker-alpha", // expectedLockedBy
      );

      // CAS failure! Must return null and preserve worker-beta's ownership!
      expect(ackResult).toBeNull();
      const current = (await store.listTriggerEvents({ tenantId: "tenant-cas" }))[0];
      expect(current.lockedBy).toBe("worker-beta");
      expect(current.status).not.toBe("processed");
    });
  });
});
