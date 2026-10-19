import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  nowIso,
  type RoutineRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { Hono } from "hono";
import { registerRoutineRoutes } from "../apps/server/src/api/studio/routineRoutes";
import { respondWithApiError } from "../apps/server/src/api/shared/http";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { RunOrganizationAccess } from "../apps/server/src/runtime/runOrganizationAccess";
import { RoutineScheduler } from "../apps/server/src/triggers/routineScheduler";
import { TriggerOutboxProcessor } from "../apps/server/src/triggers/triggerOutboxProcessor";
import type { StudioTask } from "../src/studio/contracts";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { seedUs2 } from "./organizationUs2Fixtures";

const owner = { userId: "owner", tenantId: "org-a" };
const member = { userId: "member", tenantId: "org-a" };

function workflow(id: string): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const output = createNode("output", { x: 1, y: 0 });
  return {
    ...createEmptyDefinition(),
    id,
    name: id,
    nodes: [input, output],
    edges: [createEdge({ source: input.id, target: output.id })],
    updatedAt: nowIso(),
  };
}

function routine(input: {
  id: string;
  ownerId: string;
  targetType: RoutineRecord["targetType"];
  targetId: string;
  inputPayload?: Record<string, unknown>;
}): RoutineRecord {
  const stamp = nowIso();
  return {
    id: input.id,
    tenantId: "org-a",
    name: input.id,
    description: "",
    scheduleType: "interval",
    scheduleExpr: "every:60s",
    timezone: "UTC",
    targetType: input.targetType,
    targetId: input.targetId,
    inputPayload: input.inputPayload ?? {},
    misfirePolicy: "coalesce",
    enabled: true,
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: stamp,
    updatedAt: stamp,
    ownerId: input.ownerId,
  };
}

function task(id: string, workflowId: string): StudioTask {
  const stamp = nowIso();
  return {
    id,
    title: id,
    description: "",
    priority: "medium",
    status: "todo",
    assignedAgent: null,
    assignedAgents: [],
    workflowId,
    dependencies: [],
    output: null,
    retryCount: 0,
    paused: false,
    projectId: "project-1",
    workspaceId: null,
    tenantId: "org-a",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function routineBody(targetType: string, targetId: string) {
  return {
    name: "Scheduled",
    scheduleType: "interval",
    scheduleExpr: "every:60s",
    targetType,
    targetId,
    inputPayload: { hello: "world" },
  };
}

describe("routine target authorization", () => {
  let store: InMemoryStudioStore;

  beforeEach(async () => {
    store = new InMemoryStudioStore();
    await seedUs2(store);
    await store.saveWorkflow(workflow("wf-owner"), owner);
    await store.saveWorkflow(workflow("wf-member"), member);
    await store.saveAgent({ ...createAgentRecord({ name: "Owner agent" }), id: "agent-owner" }, owner);
    await store.saveAgent({ ...createAgentRecord({ name: "Member agent" }), id: "agent-member" }, member);
    const system = createAgentRecord({ name: "System agent" });
    system.id = "agent-system";
    system.isSystem = true;
    await store.saveAgent(system);
    await store.saveWorkflow({ ...workflow("wf-shared"), tenantId: "org-a" });
  });

  function routes() {
    let current = member;
    const app = new Hono<{ Variables: { principal: typeof member } }>();
    app.onError(respondWithApiError);
    app.use("/*", async (c, next) => {
      c.set("principal", current);
      await next();
    });
    registerRoutineRoutes(app as never, store);
    return {
      app,
      asUser(user: typeof member) {
        current = user;
      },
    };
  }

  it("rejects a routine that targets another user's private workflow or agent", async () => {
    const api = routes();
    const workflowResponse = await api.app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routineBody("workflow", "wf-owner")),
    });
    expect(workflowResponse.status).toBe(400);
    expect(await workflowResponse.json()).toEqual({
      error: 'Target workflow "wf-owner" not found in current tenant',
    });

    const agentResponse = await api.app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routineBody("agent", "agent-owner")),
    });
    expect(agentResponse.status).toBe(400);
    expect(await store.listRoutines(member)).toHaveLength(0);
  });

  it("rejects retargeting and resume after the creator loses access to the target", async () => {
    const api = routes();
    api.asUser(owner);
    const created = await api.app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routineBody("workflow", "wf-owner")),
    });
    expect(created.status).toBe(201);
    const saved = await created.json() as { id: string };

    const retarget = await api.app.request(`/routines/${saved.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType: "workflow", targetId: "wf-member" }),
    });
    expect(retarget.status).toBe(400);
    expect((await store.getRoutine(saved.id, owner))?.targetId).toBe("wf-owner");

    await store.deleteWorkflow("wf-owner", owner);
    await store.saveWorkflow(workflow("wf-owner"), member);
    const resume = await api.app.request(`/routines/${saved.id}/resume`, { method: "POST" });
    expect(resume.status).toBe(400);
    const pause = await api.app.request(`/routines/${saved.id}/pause`, { method: "POST" });
    expect(pause.status).toBe(200);
  });

  it("allows a routine for the creator's own target, a shared workflow, or a system agent", async () => {
    const api = routes();
    api.asUser(owner);
    expect((await api.app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routineBody("agent", "agent-owner")),
    })).status).toBe(201);

    api.asUser(member);
    expect((await api.app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routineBody("workflow", "wf-shared")),
    })).status).toBe(201);
    expect((await api.app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routineBody("agent", "agent-system")),
    })).status).toBe(201);
  });

  it("rejects a task routine whose workflow or agent belongs to someone else", async () => {
    await store.saveTask(task("task-private-workflow", "wf-owner"), member);
    await store.saveTask({ ...task("task-private-agent", ""), workflowId: null, assignedAgent: "agent-owner" }, member);
    const api = routes();
    const workflowTask = await api.app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routineBody("task", "task-private-workflow")),
    });
    expect(workflowTask.status).toBe(400);
    const agentTask = await api.app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routineBody("task", "task-private-agent")),
    });
    expect(agentTask.status).toBe(400);
  });

  it("runs the creator's workflow and refuses it after ownership moves", async () => {
    await store.saveRoutine(routine({
      id: "routine-owner",
      ownerId: "owner",
      targetType: "workflow",
      targetId: "wf-owner",
      inputPayload: { hello: "world" },
    }), owner);
    await new RoutineScheduler(store, { pollIntervalMs: 60_000 }).tick();

    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore);
    const processor = new TriggerOutboxProcessor(
      store,
      executor,
      undefined,
      { workerId: "worker-owner", pollIntervalMs: 60_000 },
      new RunOrganizationAccess(store),
    );
    await processor.tick();

    const runs = runStore.list();
    expect(runs).toHaveLength(1);
    expect(runs[0].ownerId).toBe("owner");
    expect(runs[0].initiatorKind).toBe("user");
    expect(runs[0].input).toMatchObject({
      routineOwnerId: "owner",
      input: { hello: "world" },
    });
    expect((await store.listTriggerEvents({ tenantId: "org-a" }))[0].status).toBe("processed");

    await store.saveRoutine(routine({
      id: "routine-moved",
      ownerId: "owner",
      targetType: "workflow",
      targetId: "wf-owner",
    }), owner);
    await new RoutineScheduler(store, { pollIntervalMs: 60_000 }).tick();
    await store.deleteWorkflow("wf-owner", owner);
    await store.saveWorkflow(workflow("wf-owner"), member);

    const start = jest.fn().mockReturnValue("run-should-not-exist");
    const revokedProcessor = new TriggerOutboxProcessor(
      store,
      { start } as never,
      undefined,
      { workerId: "worker-moved", pollIntervalMs: 60_000 },
      new RunOrganizationAccess(store),
    );
    await revokedProcessor.tick();
    expect(start).not.toHaveBeenCalled();
    const moved = (await store.listTriggerEvents({ tenantId: "org-a" })).find((event) => event.targetId === "wf-owner" && event.status !== "processed");
    expect(moved?.status).toBe("dead_letter");
    expect(moved?.lastError).toContain("ROUTINE_TARGET_FORBIDDEN");
  });

  it("runs the creator's agent and refuses another user's private agent", async () => {
    await store.saveRoutine(routine({
      id: "routine-agent",
      ownerId: "owner",
      targetType: "agent",
      targetId: "agent-owner",
    }), owner);
    await store.saveRoutine(routine({
      id: "routine-stolen-agent",
      ownerId: "member",
      targetType: "agent",
      targetId: "agent-owner",
    }), member);
    await new RoutineScheduler(store, { pollIntervalMs: 60_000, claimLimit: 10 }).tick();

    const start = jest.fn().mockReturnValue("run-agent");
    const processor = new TriggerOutboxProcessor(
      store,
      { start } as never,
      undefined,
      { workerId: "worker-agent", pollIntervalMs: 60_000 },
      new RunOrganizationAccess(store),
    );
    await processor.tick();
    await processor.tick();

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0].agents[0].id).toBe("agent-owner");
    expect(start.mock.calls[0][2]).toMatchObject({ userId: "owner", tenantId: "org-a" });
    const denied = (await store.listTriggerEvents({ tenantId: "org-a" })).find((event) => event.payload.routineId === "routine-stolen-agent");
    expect(denied?.status).toBe("dead_letter");
    expect(denied?.lastError).toContain("ROUTINE_TARGET_FORBIDDEN");
  });

  it("does not treat a forged routineOwnerId as the actor", async () => {
    await store.saveRoutine(routine({
      id: "routine-forged",
      ownerId: "member",
      targetType: "workflow",
      targetId: "wf-owner",
    }), member);
    await store.enqueueTriggerEvent({
      tenantId: "org-a",
      eventType: "routine_tick",
      targetType: "workflow",
      targetId: "wf-owner",
      idempotencyKey: "forged-owner",
      payload: { routineId: "routine-forged", routineOwnerId: "owner", input: { pwned: true } },
    });
    const start = jest.fn().mockReturnValue("run-forged");
    const processor = new TriggerOutboxProcessor(store, { start } as never, undefined, { pollIntervalMs: 60_000 });
    await processor.tick();
    expect(start).not.toHaveBeenCalled();
    expect((await store.listTriggerEvents({ tenantId: "org-a" }))[0].status).toBe("dead_letter");
  });

  it("stops an already queued routine when the creator's membership is removed", async () => {
    await store.saveRoutine(routine({
      id: "routine-member",
      ownerId: "member",
      targetType: "workflow",
      targetId: "wf-member",
    }), member);
    await new RoutineScheduler(store, { pollIntervalMs: 60_000 }).tick();
    const membership = await store.getMembership("org-a", "member");
    await store.saveMembership({
      ...membership!,
      status: "removed",
      version: membership!.version + 1,
      removedAt: nowIso(),
    });

    const start = jest.fn().mockReturnValue("run-removed");
    const processor = new TriggerOutboxProcessor(
      store,
      { start } as never,
      undefined,
      { pollIntervalMs: 60_000 },
      new RunOrganizationAccess(store),
    );
    await processor.tick();
    expect(start).not.toHaveBeenCalled();
    const event = (await store.listTriggerEvents({ tenantId: "org-a" }))[0];
    expect(event.status).toBe("dead_letter");
    expect(event.lastError).toBe("ORGANIZATION_ACCESS_REVOKED");
  });

  it("still dispatches authorized webhook and heartbeat events for private targets", async () => {
    const start = jest.fn().mockReturnValue("run-service");
    const processor = new TriggerOutboxProcessor(store, {
      start,
      getStore: () => ({ waitForPersistence: async () => ({ success: true }) }),
    } as never, undefined, { pollIntervalMs: 60_000 });
    await store.saveWebhookTrigger({ id: "trigger-owner", tenantId: "org-a", ownerId: "owner", name: "owner", description: "", secretHash: "encrypted", targetType: "workflow", targetId: "wf-owner", enabled: true, rateLimitPerMinute: 60, createdAt: nowIso(), updatedAt: nowIso() }, owner);
    await store.enqueueTriggerEvent({
      tenantId: "org-a",
      eventType: "webhook_inbound",
      targetType: "workflow",
      targetId: "wf-owner",
      idempotencyKey: "webhook-private",
      payload: { triggerId: "trigger-owner", deliveryId: "delivery-1" },
    });
    await store.enqueueTriggerEvent({
      tenantId: "org-a",
      eventType: "routine_tick",
      targetType: "agent",
      targetId: "agent-owner",
      idempotencyKey: "heartbeat-private",
      payload: { heartbeat: true, agentId: "agent-owner" },
    });
    await processor.tick();
    await processor.tick();
    expect(start).toHaveBeenCalledTimes(2);
    const statuses = (await store.listTriggerEvents({ tenantId: "org-a" })).map((event) => event.status);
    expect(statuses).toEqual(["processed", "processed"]);
  });
});
