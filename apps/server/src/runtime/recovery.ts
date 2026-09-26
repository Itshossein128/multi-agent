import type { BaseCheckpointSaver } from "@langchain/langgraph";
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
    if (!checkpointer || !workflow || !agents) {
      executor.recordRecoveredFailure(run.id, "Run could not be recovered after server restart (missing checkpoint or workflow snapshot).");
      store.setPausedContext?.(run.id, null);
      failed.push(run.id);
      continue;
    }
    executor.restorePausedRun(run.id, {
      workflow,
      agents,
      tools: paused?.tools ?? store.getToolSnapshot?.(run.id),
      memoryAccess: paused?.memoryAccess,
      stepBudget: paused?.stepBudget,
      pendingHuman: paused?.pendingHuman,
    }, checkpointer);
    executor.rearmApprovalTimers(run.id);
    restored.push(run.id);
  }

  // Queued runs have durable workflow/agent snapshots and can be safely
  // handed back to the bounded scheduler after a process restart.
  for (const run of store.list({ status: "queued" })) {
    if (executor.resumeQueuedRun(run.id)) restored.push(run.id);
    else {
      executor.recordRecoveredFailure(run.id, "Queued run could not be recovered after server restart (missing workflow snapshot).");
      failed.push(run.id);
    }
  }

  for (const run of store.list()) {
    if (run.status === "running") {
      executor.recordRecoveredFailure(run.id);
      failed.push(run.id);
    }
  }

  // A process can die after the terminal run state is durable but before the
  // optional memory write finishes. The idempotency key makes this retry safe.
  for (const run of store.list()) {
    if (failed.includes(run.id)) continue;
    const entry = store.get(run.id);
    if (entry?.episodicMemoryStatus === "pending" || entry?.episodicMemoryStatus === "failed") {
      executor.retryPendingEpisodicMemory(run.id);
    }
    if (entry?.proceduralMemoryStatus === "pending" || entry?.proceduralMemoryStatus === "failed") {
      executor.retryPendingProceduralMemory(run.id);
    }
  }
  return { restored, failed };
}
