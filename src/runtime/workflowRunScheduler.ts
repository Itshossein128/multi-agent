import type { Pool } from "pg";
import { nowIso, type AgentRecord, type WorkflowDefinition } from "@multi-agent/types";
import { AgentRuntime } from "../agents/runtime/agentRuntime";
import { AgentExecutorFactory } from "../agents/runtime/agentExecutorFactory";

export interface ScheduledRunResult {
  runId: string;
  workflowId: string;
  status: "completed" | "failed";
  eventsEmitted: number;
  output: string;
  persistedRun: {
    id: string;
    workflowId: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    output?: unknown;
  };
  persistedEvents: Array<{
    sequence: number;
    event: any;
  }>;
}

function loadServerRuntime() {
  let RunExecutorClass: any;
  let PostgresRunStoreClass: any;
  try {
    ({ RunExecutor: RunExecutorClass } = require("../../apps/server/src/runtime/runExecutor"));
    ({ PostgresRunStore: PostgresRunStoreClass } = require("../../apps/server/src/runtime/runStore"));
  } catch {
    ({ RunExecutor: RunExecutorClass } = require("../../apps/server/dist/apps/server/src/runtime/runExecutor"));
    ({ PostgresRunStore: PostgresRunStoreClass } = require("../../apps/server/dist/apps/server/src/runtime/runStore"));
  }
  return { RunExecutor: RunExecutorClass, PostgresRunStore: PostgresRunStoreClass };
}

/**
 * Executes a real offline workflow run through the platform's actual workflow compiler,
 * RunExecutor.start(), GraphRunner, and PostgresRunStore with a dedicated safe local
 * test executor restricted to onboarding.
 */
export async function executeOfflineWorkflowRun(
  pool: Pool,
  options: {
    workflow?: WorkflowDefinition;
    agent?: AgentRecord;
    runtime?: AgentRuntime;
  } = {}
): Promise<ScheduledRunResult> {
  const { RunExecutor, PostgresRunStore } = loadServerRuntime();

  const agent: AgentRecord = options.agent ?? {
    id: "onboarding-offline-agent",
    name: "Onboarding Offline Test Agent",
    description: "Dedicated safe local test agent for offline onboarding verification",
    backend: {
      type: "local",
      provider: "offline-test",
      model: "self-test",
    },
    systemPrompt: "Self-test runner",
    tools: [],
    enabled: true,
    metadata: { selfTest: true },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const workflow: WorkflowDefinition = options.workflow ?? {
    id: "onboarding-self-test-workflow",
    name: "Onboarding Self-Test Workflow",
    nodes: [
      { id: "input-node", type: "input", position: { x: 0, y: 0 }, config: { inputKey: "task", description: "Start" } },
      { id: "agent-node", type: "agent", position: { x: 100, y: 0 }, config: { agentId: agent.id } },
      { id: "output-node", type: "output", position: { x: 200, y: 0 }, config: { outputKey: "result", description: "End" } },
    ],
    edges: [
      { id: "edge-1", source: "input-node", target: "agent-node", kind: "normal", label: "", branchKey: "" },
      { id: "edge-2", source: "agent-node", target: "output-node", kind: "normal", label: "", branchKey: "" },
    ],
    updatedAt: nowIso(),
  };

  // Guard: allowOfflineTest is strictly true only for onboarding self-test
  const factory = new AgentExecutorFactory(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
  const runtime = options.runtime ?? new AgentRuntime(factory);

  const runStore = new PostgresRunStore(pool);
  const executor = new RunExecutor(runStore, runtime);

  const runId = executor.start({
    workflow,
    agents: [agent],
    input: { task: "Verify persistent scheduling and execution" },
  });

  // Wait for RunExecutor to drain through pumpQueue and reach terminal status
  const start = Date.now();
  while (true) {
    const entry = runStore.get(runId);
    const status = entry?.run.status;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      if (status !== "completed") {
        throw new Error(`Offline workflow run failed with status "${status}": ${entry?.run.error ?? "unknown error"}`);
      }
      break;
    }
    if (Date.now() - start > 10000) {
      throw new Error(`Timed out waiting for onboarding run ${runId} to reach terminal status.`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  // Flush queued database writes into PostgreSQL
  await runStore.flush();

  // Query PostgreSQL directly to verify persisted records in studio_runs and studio_run_events
  const runRes = await pool.query(
    "SELECT id, workflow_id, status, started_at, completed_at, output, workflow_snapshot, agents_snapshot FROM studio_runs WHERE id = $1",
    [runId]
  );
  if (runRes.rows.length === 0) {
    throw new Error(`Failed to persist and read back run "${runId}" in studio_runs.`);
  }

  const eventsRes = await pool.query(
    "SELECT sequence, event FROM studio_run_events WHERE run_id = $1 ORDER BY sequence ASC",
    [runId]
  );
  if (eventsRes.rows.length === 0) {
    throw new Error(`Failed to persist and read back events for run "${runId}" in studio_run_events.`);
  }

  const persistedRun = {
    id: String(runRes.rows[0].id),
    workflowId: String(runRes.rows[0].workflow_id),
    status: String(runRes.rows[0].status),
    startedAt: new Date(runRes.rows[0].started_at).toISOString(),
    completedAt: runRes.rows[0].completed_at ? new Date(runRes.rows[0].completed_at).toISOString() : undefined,
    output: runRes.rows[0].output,
  };

  const persistedEvents = eventsRes.rows.map((r: { sequence: number; event: any }) => ({
    sequence: r.sequence,
    event: typeof r.event === "string" ? JSON.parse(r.event) : r.event,
  }));

  const outputContent =
    typeof persistedRun.output === "object" && persistedRun.output !== null
      ? (persistedRun.output as any).content ?? JSON.stringify(persistedRun.output)
      : String(persistedRun.output ?? "");

  return {
    runId,
    workflowId: workflow.id,
    status: "completed",
    eventsEmitted: persistedEvents.length,
    output: outputContent,
    persistedRun,
    persistedEvents,
  };
}
