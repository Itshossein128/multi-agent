import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { nowIso } from "@multi-agent/types";
import type { RunExecutor } from "./runExecutor";
import type { RunStoreContract } from "./runStore";

/**
 * After durable hydrate: restore pause maps for waiting_for_human runs that still
 * have a workflow snapshot + checkpointer. Otherwise mark them failed honestly.
 */
export function recoverInterruptedRuns(
  executor: RunExecutor,
  store: RunStoreContract,
  checkpointer: BaseCheckpointSaver | undefined,
): { restored: string[]; failed: string[] } {
  const restored: string[] = [];
  const failed: string[] = [];
  for (const run of store.list({ status: "waiting_for_human" })) {
    const paused = store.getPausedContext?.(run.id);
    const workflow = paused?.workflow ?? store.getWorkflowSnapshot?.(run.id);
    const agents = paused?.agents ?? store.get(run.id)?.agentsSnapshot;
    if (!checkpointer || !workflow || !agents?.length) {
      store.update(run.id, {
        status: "failed",
        completedAt: nowIso(),
        error: "Run could not be recovered after server restart (missing checkpoint or workflow snapshot).",
      });
      store.append(run.id, {
        id: `recovery-${run.id}`,
        runId: run.id,
        type: "run.failed",
        timestamp: nowIso(),
        sequence: 0,
        payload: { error: "unrecoverable after restart" },
      });
      store.setPausedContext?.(run.id, null);
      failed.push(run.id);
      continue;
    }
    executor.restorePausedRun(run.id, { workflow, agents, tools: paused?.tools ?? store.getToolSnapshot?.(run.id), memoryAccess: paused?.memoryAccess }, checkpointer);
    executor.rearmApprovalTimers(run.id);
    restored.push(run.id);
  }

  for (const run of store.list()) {
    if (run.status === "queued" || run.status === "running") {
      store.update(run.id, {
        status: "failed",
        completedAt: nowIso(),
        error: "Run interrupted by server restart and cannot continue safely.",
      });
      store.append(run.id, {
        id: `recovery-${run.id}`,
        runId: run.id,
        type: "run.failed",
        timestamp: nowIso(),
        sequence: 0,
        payload: { error: "interrupted by restart" },
      });
      failed.push(run.id);
    }
  }
  return { restored, failed };
}
