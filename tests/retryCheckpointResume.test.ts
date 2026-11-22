import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  nowIso,
  type AgentRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { MemorySaver } from "@langchain/langgraph";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { RunApiService } from "../apps/server/src/api/runs/runApiService";
import { InMemoryStudioStore } from "../src/studio/infrastructure";
import { remapShortTermHistoriesRunId } from "../apps/server/src/runtime/checkpointResume";

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition");
}

function threeStageWorkflow(agents: { stage1: AgentRecord; stage2: AgentRecord; stage3: AgentRecord }): {
  workflow: WorkflowDefinition;
  nodeIds: { input: string; stage1: string; mem1: string; stage2: string; stage3: string; output: string };
} {
  const input = createNode("input", { x: 0, y: 0 });
  const stage1 = createNode("agent", { x: 1, y: 0 }, { agentId: agents.stage1.id, label: "Stage 1 Discovery" });
  const mem1 = createNode("memory", { x: 2, y: 0 }, { key: "stage1_snapshot", mode: "write" });
  const stage2 = createNode("agent", { x: 3, y: 0 }, { agentId: agents.stage2.id, label: "Stage 2 SpecKit" });
  const stage3 = createNode("agent", { x: 4, y: 0 }, { agentId: agents.stage3.id, label: "Stage 3 Implement" });
  const output = createNode("output", { x: 5, y: 0 });
  const workflow: WorkflowDefinition = {
    ...createEmptyDefinition("Three-Stage Checkpoint Resume Workflow"),
    id: "wf-checkpoint-resume-test",
    nodes: [input, stage1, mem1, stage2, stage3, output],
    edges: [
      createEdge({ source: input.id, target: stage1.id }),
      createEdge({ source: stage1.id, target: mem1.id }),
      createEdge({ source: mem1.id, target: stage2.id }),
      createEdge({ source: stage2.id, target: stage3.id }),
      createEdge({ source: stage3.id, target: output.id }),
    ],
  };
  return {
    workflow,
    nodeIds: {
      input: input.id,
      stage1: stage1.id,
      mem1: mem1.id,
      stage2: stage2.id,
      stage3: stage3.id,
      output: output.id,
    },
  };
}

describe("checkpoint-resuming workflow retry", () => {
  const principal = { userId: "user-resume", tenantId: "tenant-resume", principalKind: "user" as const };

  test("retry resumes from the failed node using updated agent model without re-running completed earlier stages", async () => {
    const studioStore = new InMemoryStudioStore();
    const runStore = new InMemoryRunStore();
    const checkpointer = new MemorySaver();

    const stage1Agent = {
      ...createAgentRecord({
        name: "Stage 1 Discovery",
        backend: { type: "api", provider: "openai", model: "gpt-cheap" },
      }),
      id: "agent-stage1",
    };
    const stage2Agent = {
      ...createAgentRecord({
        name: "Stage 2 SpecKit",
        backend: { type: "api", provider: "google", model: "quota-exhausted-model" },
      }),
      id: "agent-stage2",
    };
    const stage3Agent = {
      ...createAgentRecord({
        name: "Stage 3 Implement",
        backend: { type: "api", provider: "openai", model: "gpt-coder" },
      }),
      id: "agent-stage3",
    };
    const { workflow, nodeIds } = threeStageWorkflow({
      stage1: stage1Agent,
      stage2: stage2Agent,
      stage3: stage3Agent,
    });

    await studioStore.saveAgent({ ...stage1Agent, ownerId: principal.userId, tenantId: principal.tenantId }, principal);
    await studioStore.saveAgent({ ...stage2Agent, ownerId: principal.userId, tenantId: principal.tenantId }, principal);
    await studioStore.saveAgent({ ...stage3Agent, ownerId: principal.userId, tenantId: principal.tenantId }, principal);
    await studioStore.saveWorkflow({ ...workflow, ownerId: principal.userId, tenantId: principal.tenantId }, principal);

    const executions: Array<{ runId: string; nodeId: string; model: string; memoryKeys: string[] }> = [];
    const runtime = {
      async *execute(input: {
        agent: AgentRecord;
        runId: string;
        nodeId: string;
        context?: { memory?: Record<string, unknown> };
      }) {
        const workflowMemory = input.context?.memory ?? {};
        const memoryKeys = Object.keys(workflowMemory);
        const model = "model" in input.agent.backend ? String(input.agent.backend.model ?? "") : "";
        executions.push({
          runId: input.runId,
          nodeId: input.nodeId,
          model,
          memoryKeys,
        });
        if (input.nodeId === nodeIds.stage1) {
          yield {
            type: "agent.completed" as const,
            timestamp: nowIso(),
            agentId: input.agent.id,
            nodeId: input.nodeId,
            runId: input.runId,
            payload: { content: "STAGE1_DISCOVERY_ARTIFACT" },
          };
          return;
        }
        if (input.nodeId === nodeIds.stage2) {
          if (model === "quota-exhausted-model") {
            yield {
              type: "agent.failed" as const,
              timestamp: nowIso(),
              agentId: input.agent.id,
              nodeId: input.nodeId,
              runId: input.runId,
              payload: { error: "RESOURCE_EXHAUSTED (code 429): Individual quota reached" },
            };
            return;
          }
          yield {
            type: "agent.completed" as const,
            timestamp: nowIso(),
            agentId: input.agent.id,
            nodeId: input.nodeId,
            runId: input.runId,
            payload: { content: `STAGE2_OK_WITH_${model}` },
          };
          return;
        }
        yield {
          type: "agent.completed" as const,
          timestamp: nowIso(),
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          payload: { content: "STAGE3_COMPLETE" },
        };
      },
    };

    const executor = new RunExecutor(runStore, runtime, checkpointer, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
    const service = new RunApiService(executor, async () => null, studioStore, async () => principal);

    const firstRunId = executor.start(
      { workflow, agents: [stage1Agent, stage2Agent, stage3Agent], input: { phase: "A.1" } },
      undefined,
      principal,
    );
    await waitFor(() => runStore.get(firstRunId)?.run.status === "failed");

    expect(executions.filter((e) => e.nodeId === nodeIds.stage1)).toHaveLength(1);
    expect(executions.filter((e) => e.nodeId === nodeIds.stage2)).toHaveLength(1);
    expect(executions.filter((e) => e.nodeId === nodeIds.stage3)).toHaveLength(0);

    // User switches Stage 2 agent's model after hitting quota, then clicks Retry.
    await studioStore.saveAgent(
      {
        ...stage2Agent,
        backend: { type: "api", provider: "google", model: "gemini-4-neon-medium" },
        ownerId: principal.userId,
        tenantId: principal.tenantId,
      },
      principal,
    );

    const retried = await service.retry(
      firstRunId,
      new Request(`http://localhost/runs/${firstRunId}/retry`, { method: "POST" }),
      principal,
    );
    expect(retried.runId).not.toBe(firstRunId);
    await waitFor(() => runStore.get(retried.runId)?.run.status === "completed");

    // Stage 1 was NOT re-executed!
    expect(executions.filter((e) => e.nodeId === nodeIds.stage1)).toHaveLength(1);
    // Stage 2 ran once on the failed run and once on the resumed run with the updated model.
    const stage2Runs = executions.filter((e) => e.nodeId === nodeIds.stage2);
    expect(stage2Runs).toHaveLength(2);
    expect(stage2Runs[1]).toMatchObject({
      runId: retried.runId,
      model: "gemini-4-neon-medium",
    });
    // Workflow memory written by Stage 1's memory node was preserved into Stage 2!
    expect(stage2Runs[1].memoryKeys).toContain("stage1_snapshot");
    // Stage 3 ran to completion.
    expect(executions.filter((e) => e.nodeId === nodeIds.stage3)).toHaveLength(1);

    const retriedRun = runStore.get(retried.runId)!.run;
    expect(retriedRun.metadata).toMatchObject({
      retriedFromRunId: firstRunId,
      resumedAtNodes: [nodeIds.stage2],
    });
    expect(typeof retriedRun.metadata?.resumedFromCheckpointId).toBe("string");

    const retriedEvents = runStore.events(retried.runId);
    expect(retriedEvents.some((event) => event.type === "run.resumed" && event.nodeId === nodeIds.stage2)).toBe(true);
    expect(
      retriedEvents.some(
        (event) =>
          event.type === "node.completed" &&
          event.nodeId === nodeIds.stage1 &&
          event.payload.resumedFromCheckpoint === true,
      ),
    ).toBe(true);
  });

  test("chained retries preserve checkpoint state when the same node fails twice", async () => {
    const runStore = new InMemoryRunStore();
    const stage1Agent = createAgentRecord({ name: "A1" });
    const stage2Agent = createAgentRecord({ name: "A2" });
    const stage3Agent = createAgentRecord({ name: "A3" });
    const { workflow, nodeIds } = threeStageWorkflow({
      stage1: stage1Agent,
      stage2: stage2Agent,
      stage3: stage3Agent,
    });

    let stage1Calls = 0;
    let stage2Calls = 0;
    const executor = new RunExecutor(runStore, {
      async *execute(input) {
        if (input.nodeId === nodeIds.stage1) {
          stage1Calls += 1;
          yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "s1" } };
          return;
        }
        if (input.nodeId === nodeIds.stage2) {
          stage2Calls += 1;
          if (stage2Calls <= 2) {
            yield { type: "agent.failed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: `fail-${stage2Calls}` } };
            return;
          }
          yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "s2-ok" } };
          return;
        }
        yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "s3-ok" } };
      },
    });

    const run1 = executor.start({ workflow, agents: [stage1Agent, stage2Agent, stage3Agent], input: {} }, undefined, principal);
    await waitFor(() => runStore.get(run1)?.run.status === "failed");

    const run2 = await executor.retry(run1);
    await waitFor(() => runStore.get(run2)?.run.status === "failed");

    const run3 = await executor.retry(run2);
    await waitFor(() => runStore.get(run3)?.run.status === "completed");

    // Stage 1 only ever ran ONCE across run1, run2, and run3!
    expect(stage1Calls).toBe(1);
    expect(stage2Calls).toBe(3);
  });

  test("explicit mode='restart' re-runs the workflow from Stage 1", async () => {
    const runStore = new InMemoryRunStore();
    const stage1Agent = createAgentRecord({ name: "R1" });
    const stage2Agent = createAgentRecord({ name: "R2" });
    const stage3Agent = createAgentRecord({ name: "R3" });
    const { workflow, nodeIds } = threeStageWorkflow({
      stage1: stage1Agent,
      stage2: stage2Agent,
      stage3: stage3Agent,
    });

    let stage1Calls = 0;
    let stage2Calls = 0;
    const executor = new RunExecutor(runStore, {
      async *execute(input) {
        if (input.nodeId === nodeIds.stage1) {
          stage1Calls += 1;
          yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "s1" } };
          return;
        }
        if (input.nodeId === nodeIds.stage2) {
          stage2Calls += 1;
          if (stage2Calls === 1) {
            yield { type: "agent.failed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: "boom" } };
            return;
          }
        }
        yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "ok" } };
      },
    });

    const run1 = executor.start({ workflow, agents: [stage1Agent, stage2Agent, stage3Agent], input: {} }, undefined, principal);
    await waitFor(() => runStore.get(run1)?.run.status === "failed");

    const restarted = await executor.retry(run1, undefined, { mode: "restart" });
    await waitFor(() => runStore.get(restarted)?.run.status === "completed");

    expect(stage1Calls).toBe(2);
    expect(runStore.get(restarted)?.run.metadata?.retryMode).toBe("restart");
    expect(runStore.get(restarted)?.run.metadata?.resumedFromCheckpointId).toBeUndefined();
  });

  test("falls back cleanly to a fresh run if the pending node was removed from the workflow", async () => {
    const runStore = new InMemoryRunStore();
    const stage1Agent = createAgentRecord({ name: "F1" });
    const stage2Agent = createAgentRecord({ name: "F2" });
    const stage3Agent = createAgentRecord({ name: "F3" });
    const { workflow, nodeIds } = threeStageWorkflow({
      stage1: stage1Agent,
      stage2: stage2Agent,
      stage3: stage3Agent,
    });

    let stage1Calls = 0;
    const executor = new RunExecutor(runStore, {
      async *execute(input) {
        if (input.nodeId === nodeIds.stage1) {
          stage1Calls += 1;
          yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "s1" } };
          return;
        }
        if (input.nodeId === nodeIds.stage2) {
          yield { type: "agent.failed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: "removed later" } };
          return;
        }
        yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "s3" } };
      },
    });

    const run1 = executor.start({ workflow, agents: [stage1Agent, stage2Agent, stage3Agent], input: {} }, undefined, principal);
    await waitFor(() => runStore.get(run1)?.run.status === "failed");

    // Updated workflow deletes stage2 and wires mem1 -> stage3 directly.
    const updatedWorkflow: WorkflowDefinition = {
      ...workflow,
      nodes: workflow.nodes.filter((n) => n.id !== nodeIds.stage2),
      edges: [
        ...workflow.edges.filter((e) => e.source !== nodeIds.stage2 && e.target !== nodeIds.stage2),
        createEdge({ source: nodeIds.mem1, target: nodeIds.stage3 }),
      ],
    };

    const run2 = await executor.retry(run1, undefined, {
      workflow: updatedWorkflow,
      agents: [stage1Agent, stage3Agent],
    });
    await waitFor(() => runStore.get(run2)?.run.status === "completed");

    // Gracefully fell back to fresh start because stage2 no longer exists in updatedWorkflow.
    expect(stage1Calls).toBe(2);
  });

  test("remapShortTermHistoriesRunId rewrites sourceRunId prefix for agent, node, and shared-session keys", () => {
    const histories = {
      [JSON.stringify(["run-old", "agent-1", "agent"])]: {
        entries: [{ id: "e1", input: "a", output: "b" }],
        maxEntries: 20,
        maxTokens: 4096,
      },
      [JSON.stringify(["run-old", "shared-session", "speckit-lifecycle"])]: {
        entries: [{ id: "e2", input: "c", output: "d" }],
        maxEntries: 20,
        maxTokens: 32768,
      },
      [JSON.stringify(["run-other", "agent-2", "agent"])]: {
        entries: [],
        maxEntries: 20,
        maxTokens: 2048,
      },
    };
    const remapped = remapShortTermHistoriesRunId(histories, "run-old", "run-new")!;
    expect(Object.keys(remapped)).toEqual([
      JSON.stringify(["run-new", "agent-1", "agent"]),
      JSON.stringify(["run-new", "shared-session", "speckit-lifecycle"]),
      JSON.stringify(["run-other", "agent-2", "agent"]),
    ]);
    expect(remapped[JSON.stringify(["run-new", "shared-session", "speckit-lifecycle"])].entries).toHaveLength(1);
  });

  const pgUrl = process.env.MEMORY_TEST_DATABASE_URL;
  const pgTest = pgUrl ? test : test.skip;
  pgTest("resumes from real PostgresSaver checkpoint without re-running completed stages", async () => {
    const { createRequire } = await import("node:module");
    const path = await import("node:path");
    const { PostgresRunStore } = await import("../apps/server/src/runtime/store/postgresRunStore");
    const { Pool } = await import("pg");
    const serverRequire = createRequire(path.join(process.cwd(), "apps/server/package.json"));
    const { PostgresSaver } = serverRequire("@langchain/langgraph-checkpoint-postgres") as {
      PostgresSaver: {
        fromConnString: (url: string) => import("@langchain/langgraph").BaseCheckpointSaver & {
          setup: () => Promise<void>;
          deleteThread: (id: string) => Promise<void>;
          end: () => Promise<void>;
        };
      };
    };
    const saver = PostgresSaver.fromConnString(pgUrl!);
    await saver.setup();

    const pool = new Pool({ connectionString: pgUrl! });
    const runStore = new PostgresRunStore(pool, { instanceId: "test-pg-resume", leaseRenewalIntervalMs: 0 });

    const pgPrincipal = {
      userId: "user-pg-resume",
      tenantId: "4cc4a715-3ac8-42d4-84ad-83bbdc45f03a",
      principalKind: "user" as const,
    };

    const stage1Agent = createAgentRecord({ name: "PG Stage 1" });
    const stage2Agent = createAgentRecord({ name: "PG Stage 2" });
    const stage3Agent = createAgentRecord({ name: "PG Stage 3" });
    const { workflow, nodeIds } = threeStageWorkflow({
      stage1: stage1Agent,
      stage2: stage2Agent,
      stage3: stage3Agent,
    });

    let stage1Calls = 0;
    let stage2Calls = 0;
    let stage2SeenSnapshot: unknown;
    const executor = new RunExecutor(
      runStore,
      {
        async *execute(input) {
          if (input.nodeId === nodeIds.stage1) {
            stage1Calls += 1;
            yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "PG_STAGE1_DATA" } };
            return;
          }
          if (input.nodeId === nodeIds.stage2) {
            stage2Calls += 1;
            stage2SeenSnapshot = (input.context as { memory?: Record<string, unknown> } | undefined)?.memory?.stage1_snapshot;
            if (stage2Calls === 1) {
              yield { type: "agent.failed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: "PG quota error" } };
              return;
            }
            yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "PG_STAGE2_OK" } };
            return;
          }
          yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "PG_STAGE3_OK" } };
        },
      },
      saver,
    );

    const run1 = executor.start({ workflow, agents: [stage1Agent, stage2Agent, stage3Agent], input: { phase: "A.1" } }, undefined, pgPrincipal);
    let run2: string | undefined;
    try {
      await waitFor(() => runStore.get(run1)?.run.status === "failed");
      run2 = await executor.retry(run1);
      await waitFor(() => runStore.get(run2!)?.run.status === "completed");

      expect(stage1Calls).toBe(1);
      expect(stage2Calls).toBe(2);
      expect(stage2SeenSnapshot).toBe("PG_STAGE1_DATA");
      expect(runStore.get(run2)?.run.metadata?.resumedAtNodes).toEqual([nodeIds.stage2]);
    } finally {
      await runStore.waitForPersistence(run1).catch(() => undefined);
      if (run2) await runStore.waitForPersistence(run2).catch(() => undefined);
      await runStore.close();
      await saver.deleteThread(run1).catch(() => undefined);
      if (run2) await saver.deleteThread(run2).catch(() => undefined);
      await pool.query("DELETE FROM studio_runs WHERE id = ANY($1)", [[run1, ...(run2 ? [run2] : [])]]).catch(() => undefined);
      await pool.end();
      await saver.end();
    }
  }, 15_000);
});
