/**
 * FR-027 / US5/AC4 / SC-008: in-progress runs keep step fields from the
 * workflow/agents/tools snapshot even if the draft definition is edited after start.
 */
import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  createToolRecord,
  nowIso,
  type AgentNodeConfig,
  type AgentRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { InMemoryRunStore } from "../apps/server/src/runtime/store/inMemoryRunStore";

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const principal = async () => ({ userId: "step-snap-user", tenantId: "step-snap-tenant" });

function workflowWithStepConfig(step: Partial<AgentNodeConfig>) {
  const tool = { ...createToolRecord({ name: "Lookup" }), id: "tool_lookup", enabled: true };
  const agent: AgentRecord = {
    ...createAgentRecord({ name: "Shared", model: "gpt-4o" }),
    id: "agent_shared",
    tools: [tool.id],
    backend: { type: "api", provider: "openai", model: "gpt-4o", settings: { temperature: 0.7 } },
  };
  const input = createNode("input", { x: 0, y: 0 });
  const agentNode = createNode("agent", { x: 1, y: 0 }, {
    agentId: agent.id,
    taskInstruction: "ORIGINAL_STEP",
    modelSettingsOverride: { temperature: 0 },
    activeTools: [tool.id],
    ...step,
  });
  const output = createNode("output", { x: 2, y: 0 });
  const workflow: WorkflowDefinition = {
    ...createEmptyDefinition("step-snapshot"),
    nodes: [input, agentNode, output],
    edges: [
      createEdge({ source: input.id, target: agentNode.id }),
      createEdge({ source: agentNode.id, target: output.id }),
    ],
  };
  return { workflow, agent, agentNode, tool };
}

describe("agent step config run snapshot immutability", () => {
  test("InMemoryRunStore structuredClone keeps step fields after draft mutation", () => {
    const store = new InMemoryRunStore();
    const { workflow, agent, agentNode, tool } = workflowWithStepConfig({});
    const runId = "run_step_snap";
    store.create(
      {
        id: runId,
        workflowId: workflow.id,
        status: "running",
        startedAt: nowIso(),
        input: {},
        metadata: {},
      },
      undefined,
      { workflow, agents: [agent], tools: [tool] }
    );

    const draftNode = workflow.nodes.find((n) => n.id === agentNode.id)!;
    (draftNode.config as AgentNodeConfig).taskInstruction = "DRAFT_EDITED_AFTER_START";
    (draftNode.config as AgentNodeConfig).modelSettingsOverride = { temperature: 0.9 };
    (draftNode.config as AgentNodeConfig).activeTools = [];

    const snapshot = store.getWorkflowSnapshot(runId);
    const snapConfig = snapshot?.nodes.find((n) => n.id === agentNode.id)?.config as AgentNodeConfig;
    expect(snapConfig.taskInstruction).toBe("ORIGINAL_STEP");
    expect(snapConfig.modelSettingsOverride).toEqual({ temperature: 0 });
    expect(snapConfig.activeTools).toEqual([tool.id]);
    expect((draftNode.config as AgentNodeConfig).taskInstruction).toBe("DRAFT_EDITED_AFTER_START");
  });

  test("RunExecutor.start freezes step fields; draft edits do not change the in-progress snapshot", async () => {
    const store = new RunStore();
    const runtime = {
      async *execute(input: { agent: AgentRecord; nodeId: string; runId: string }) {
        yield {
          type: "agent.completed" as const,
          timestamp: nowIso(),
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          payload: { content: { ok: true } },
        };
      },
    };
    const executor = new RunExecutor(store, runtime);
    const { workflow, agent, agentNode, tool } = workflowWithStepConfig({});

    const runId = executor.start(
      { workflow, agents: [agent], tools: [tool], input: {} },
      undefined,
      await principal()
    );

    const draftNode = workflow.nodes.find((n) => n.id === agentNode.id)!;
    (draftNode.config as AgentNodeConfig).taskInstruction = "CHANGED_WHILE_QUEUED_OR_RUNNING";
    (draftNode.config as AgentNodeConfig).activeTools = [];
    delete (draftNode.config as AgentNodeConfig).modelSettingsOverride;

    const snapshot = store.getWorkflowSnapshot?.(runId);
    const snapConfig = snapshot?.nodes.find((n) => n.id === agentNode.id)?.config as AgentNodeConfig | undefined;
    expect(snapConfig?.taskInstruction).toBe("ORIGINAL_STEP");
    expect(snapConfig?.modelSettingsOverride).toEqual({ temperature: 0 });
    expect(snapConfig?.activeTools).toEqual([tool.id]);

    await waitFor(() => {
      const status = store.get(runId)?.run.status;
      return status === "completed" || status === "failed" || status === "cancelled";
    });

    const afterConfig = store.getWorkflowSnapshot?.(runId)?.nodes.find((n) => n.id === agentNode.id)
      ?.config as AgentNodeConfig | undefined;
    expect(afterConfig?.taskInstruction).toBe("ORIGINAL_STEP");
    expect(afterConfig?.modelSettingsOverride).toEqual({ temperature: 0 });
    expect(afterConfig?.activeTools).toEqual([tool.id]);
  });
});
