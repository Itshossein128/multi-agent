import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { RunExecutor } from "./runExecutor";
import type { RunStoreContract } from "./runStore";
/**
 * After durable hydrate: restore pause maps for waiting_for_human runs that still
 * have a workflow snapshot + checkpointer. Otherwise mark them failed honestly.
 */
export declare function recoverInterruptedRuns(executor: RunExecutor, store: RunStoreContract, checkpointer: BaseCheckpointSaver | undefined): {
    restored: string[];
    failed: string[];
};
