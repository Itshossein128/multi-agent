import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { createEmptyDefinition, createAgentRecord, createToolRecord, nowIso } from "@multi-agent/types";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { recoverInterruptedRuns } from "../apps/server/src/runtime/recovery";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { MemorySaver } from "@langchain/langgraph";

test("studio store round-trips workflows agents tools and tasks", async () => {
  const store = new InMemoryStudioStore();
  const workflow = createEmptyDefinition("Demo");
  const agent = createAgentRecord({ name: "Writer" });
  const tool = createToolRecord({ name: "Search" });
  await store.saveWorkflow(workflow);
  await store.saveAgent(agent);
  await store.saveTool(tool);
  await store.saveTask({
    id: "task-1",
    title: "Ship phase 9",
    description: "",
    priority: "high",
    status: "todo",
    assignedAgent: null,
    dependencies: [],
    output: null,
    retryCount: 0,
    paused: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  expect((await store.listWorkflows())[0].id).toBe(workflow.id);
  expect((await store.listAgents())[0].id).toBe(agent.id);
  expect((await store.listTools())[0].id).toBe(tool.id);
  expect((await store.listTasks())[0].title).toBe("Ship phase 9");
  await store.importWorkspace({
    workflows: [{ ...workflow, name: "Imported" }],
    agents: [agent],
    tools: [tool],
  });
  expect((await store.getWorkflow(workflow.id))?.name).toBe("Imported");
});

test("run store filters and snapshots", () => {
  const store = new InMemoryRunStore();
  const stamp = nowIso();
  store.create(
    { id: "run-1", workflowId: "wf-1", taskId: "task-1", status: "completed", startedAt: stamp, metadata: {} },
    undefined,
    { workflow: createEmptyDefinition("Demo"), agents: [createAgentRecord({ name: "A" })] },
  );
  store.append("run-1", { id: "e1", runId: "run-1", type: "run.started", timestamp: stamp, sequence: 0, payload: {}, agentId: "agent-x" });
  store.create({ id: "run-2", workflowId: "wf-2", status: "failed", startedAt: stamp, metadata: {} });
  expect(store.list({ workflowId: "wf-1" })).toHaveLength(1);
  expect(store.list({ taskId: "task-1" })).toHaveLength(1);
  expect(store.list({ status: "failed" })).toHaveLength(1);
  expect(store.getWorkflowSnapshot?.("run-1")?.name).toBe("Demo");
});

test("recovery restores waiting runs and fails interrupted active runs", () => {
  const store = new InMemoryRunStore();
  const stamp = nowIso();
  const workflow = createEmptyDefinition("Paused");
  const agents = [createAgentRecord({ name: "A" })];
  store.create({ id: "wait-1", workflowId: workflow.id, status: "waiting_for_human", startedAt: stamp, metadata: {} }, undefined, { workflow, agents });
  store.setPausedContext?.("wait-1", { workflow, agents });
  store.addApproval("wait-1", {
    id: "appr-1",
    runId: "wait-1",
    nodeId: "n1",
    status: "requested",
    message: "Continue?",
    requestedAt: stamp,
    metadata: {},
  });
  store.create({ id: "run-active", workflowId: workflow.id, status: "running", startedAt: stamp, metadata: {} });
  const executor = new RunExecutor(store, { execute: async function* () { /* unused */ } }, new MemorySaver());
  const result = recoverInterruptedRuns(executor, store, new MemorySaver());
  expect(result.restored).toContain("wait-1");
  expect(result.failed).toContain("run-active");
  expect(store.get("run-active")?.run.status).toBe("failed");
  expect(store.get("wait-1")?.run.status).toBe("waiting_for_human");
});
