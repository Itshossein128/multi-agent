import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { RunExecutor } from "./runExecutor";
import type { RunStoreContract } from "./runStore";
import type { InMemoryRunStore } from "./store/inMemoryRunStore";
import type { PostgresRunStore } from "./store/postgresRunStore";

/**
 * Recovers interrupted runs after restart.
 * When durable PostgreSQL store with claimOrphanedRuns is used, only runs with
 * expired execution leases (or unowned) are claimed and recovered, preventing
 * interference with runs actively executing on another replica.
 * When in-memory store is used, preserves synchronous single-process recovery.
 */
export function recoverInterruptedRuns(
  executor: RunExecutor,
  store: InMemoryRunStore,
  checkpointer: BaseCheckpointSaver | undefined,
  options?: { instanceId?: string; leaseDurationMs?: number },
): { restored: string[]; failed: string[] };
export function recoverInterruptedRuns(
  executor: RunExecutor,
  store: PostgresRunStore,
  checkpointer: BaseCheckpointSaver | undefined,
  options?: { instanceId?: string; leaseDurationMs?: number },
): Promise<{ restored: string[]; failed: string[] }>;
export function recoverInterruptedRuns(
  executor: RunExecutor,
  store: RunStoreContract,
  checkpointer: BaseCheckpointSaver | undefined,
  options?: { instanceId?: string; leaseDurationMs?: number },
): { restored: string[]; failed: string[] } | Promise<{ restored: string[]; failed: string[] }>;
export function recoverInterruptedRuns(
  executor: RunExecutor,
  store: RunStoreContract,
  checkpointer: BaseCheckpointSaver | undefined,
  options?: { instanceId?: string; leaseDurationMs?: number },
): { restored: string[]; failed: string[] } | Promise<{ restored: string[]; failed: string[] }> {
  if (typeof store.claimOrphanedRuns === "function") {
    return recoverInterruptedRunsDurable(executor, store, checkpointer, options);
  }
  return recoverInterruptedRunsInMemory(executor, store, checkpointer);
}

async function recoverInterruptedRunsDurable(
  executor: RunExecutor,
  store: RunStoreContract,
  checkpointer: BaseCheckpointSaver | undefined,
  options?: { instanceId?: string; leaseDurationMs?: number },
): Promise<{ restored: string[]; failed: string[] }> {
  const restored: string[] = [];
  const failed: string[] = [];
  const ownerId = options?.instanceId ?? (executor as any).instanceId ?? (store as any).instanceId;
  const leaseDurationMs = options?.leaseDurationMs ?? (store as any).leaseDurationMs ?? 30_000;

  const claimed = await store.claimOrphanedRuns!({
    ownerId,
    leaseDurationMs,
    statuses: ["waiting_for_human", "queued", "running"],
  });

  for (const item of claimed) {
    if (item.status === "waiting_for_human") {
      const paused = store.getPausedContext?.(item.id);
      const workflow = paused?.workflow ?? store.getWorkflowSnapshot?.(item.id);
      const agents = paused?.agents ?? store.get(item.id)?.agentsSnapshot;
      if (!checkpointer || !workflow || !agents) {
        executor.recordRecoveredFailure(item.id, "Run could not be recovered after server restart (missing checkpoint or workflow snapshot).");
        store.setPausedContext?.(item.id, null);
        failed.push(item.id);
        continue;
      }
      executor.restorePausedRun(item.id, {
        workflow,
        agents,
        tools: paused?.tools ?? store.getToolSnapshot?.(item.id),
        memoryAccess: paused?.memoryAccess,
        stepBudget: paused?.stepBudget,
        pendingHuman: paused?.pendingHuman,
      }, checkpointer);
      executor.rearmApprovalTimers(item.id);
      restored.push(item.id);
    } else if (item.status === "queued") {
      if (executor.resumeQueuedRun(item.id)) {
        restored.push(item.id);
      } else {
        executor.recordRecoveredFailure(item.id, "Queued run could not be recovered after server restart (missing workflow snapshot).");
        failed.push(item.id);
      }
    } else if (item.status === "running") {
      executor.recordRecoveredFailure(item.id, "Run interrupted by server restart and execution lease expired.");
      failed.push(item.id);
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

function recoverInterruptedRunsInMemory(
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
