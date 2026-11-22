import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { ConditionNodeConfig, NodeResultEnvelope, WorkflowDefinition } from "@multi-agent/types";
import type { ShortTermHistories } from "../../../../src/agents/runtime/shortTermMemory";

type CheckpointTuple = NonNullable<Awaited<ReturnType<BaseCheckpointSaver["getTuple"]>>>;
type Checkpoint = CheckpointTuple["checkpoint"];
type CheckpointMetadata = NonNullable<CheckpointTuple["metadata"]>;

export interface RetryCheckpointResumeResult {
  resumed: true;
  sourceRunId: string;
  checkpointId: string;
  nextNodes: string[];
  completedNodeOutcomes: Record<string, NodeResultEnvelope>;
  priorStepCount: number;
}

export interface RetryCheckpointFallbackResult {
  resumed: false;
  reason:
    | "no_checkpoint"
    | "no_pending_nodes"
    | "at_input_node"
    | "workflow_topology_changed"
    | "clone_failed";
  error?: string;
}

export type RetryCheckpointResult = RetryCheckpointResumeResult | RetryCheckpointFallbackResult;

interface InspectableCompiledGraph {
  getState: (config: { configurable: { thread_id: string; checkpoint_id?: string } }) => Promise<{
    next?: unknown;
    values?: unknown;
  }>;
}

function scheduledNodes(state: { next?: unknown }): string[] {
  return Array.isArray(state.next)
    ? state.next.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }
}

/**
 * Remap shortTermHistories keys whose first tuple element is `sourceRunId` so
 * the retried run reads and continues the prior run's short-term turn history.
 */
export function remapShortTermHistoriesRunId(
  histories: unknown,
  sourceRunId: string,
  targetRunId: string,
): ShortTermHistories | undefined {
  if (!histories || typeof histories !== "object" || Array.isArray(histories)) return undefined;
  const remapped: ShortTermHistories = {};
  for (const [key, entry] of Object.entries(histories as ShortTermHistories)) {
    let nextKey = key;
    try {
      const parsed = JSON.parse(key);
      if (Array.isArray(parsed) && parsed.length >= 2 && parsed[0] === sourceRunId) {
        parsed[0] = targetRunId;
        nextKey = JSON.stringify(parsed);
      }
    } catch {
      // Non-JSON custom key; keep as-is.
    }
    remapped[nextKey] = cloneValue(entry);
  }
  return remapped;
}

function extractCompletedNodeOutcomes(
  channelValues: Record<string, unknown> | undefined,
  nextNodes: readonly string[],
): Record<string, NodeResultEnvelope> {
  const outcomes = channelValues?.nodeOutcomes;
  if (!outcomes || typeof outcomes !== "object" || Array.isArray(outcomes)) return {};
  const nextSet = new Set(nextNodes);
  const completed: Record<string, NodeResultEnvelope> = {};
  for (const [nodeId, raw] of Object.entries(outcomes as Record<string, unknown>)) {
    if (nextSet.has(nodeId)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const envelope = raw as NodeResultEnvelope;
    if (envelope.status === "failed" || envelope.status === "policy_rejected") continue;
    completed[nodeId] = cloneValue(envelope);
  }
  return completed;
}

/**
 * Inspect `sourceRunId`'s latest LangGraph checkpoint and, if it can safely
 * resume against `workflow`, clone it into `targetRunId` (clearing `__error__`
 * and `__interrupt__` writes) so `streamEvents(null, { thread_id: targetRunId })`
 * resumes directly at the failed/interrupted node(s).
 */
export async function cloneCheckpointForRetry(params: {
  checkpointer: BaseCheckpointSaver;
  sourceRunId: string;
  targetRunId: string;
  workflow: WorkflowDefinition;
  compiledGraph: InspectableCompiledGraph;
  sourceErrorCode?: string;
}): Promise<RetryCheckpointResult> {
  const { checkpointer, sourceRunId, targetRunId, workflow, compiledGraph, sourceErrorCode } = params;
  try {
    let tuple = await checkpointer.getTuple({ configurable: { thread_id: sourceRunId } });
    if (!tuple?.checkpoint) {
      return { resumed: false, reason: "no_checkpoint" };
    }

    let nextNodes = scheduledNodes(await compiledGraph.getState({ configurable: { thread_id: sourceRunId } }));
    let rerunReceiptProducer = false;
    const sequenceNode = workflow.nodes.find((node) => node.id === nextNodes[0] && node.type === "condition" &&
      (node.config as ConditionNodeConfig).workPackages);
    const parentId = tuple.parentConfig?.configurable?.checkpoint_id;
    if (sourceErrorCode === "WORK_PACKAGE_COMPLETION_UNVERIFIED" && nextNodes.length === 1 &&
        sequenceNode && typeof parentId === "string") {
      const parentConfig = { configurable: { thread_id: sourceRunId, checkpoint_id: parentId } };
      const parent = await checkpointer.getTuple(parentConfig);
      const parentNodes = scheduledNodes(await compiledGraph.getState(parentConfig));
      const producer = workflow.nodes.find((node) => node.id === parentNodes[0] && node.type === "agent");
      if (parent && parentNodes.length === 1 && producer && workflow.edges.some((edge) =>
        edge.source === producer.id && edge.target === sequenceNode.id && edge.kind === "normal"
      )) {
        // Replaying the sequence router alone would revalidate the same stale receipt.
        tuple = parent;
        nextNodes = parentNodes;
        rerunReceiptProducer = true;
      }
    }
    if (nextNodes.length === 0) {
      return { resumed: false, reason: "no_pending_nodes" };
    }

    const validNodeIds = new Set(workflow.nodes.map((node) => node.id));
    if (!nextNodes.every((nodeId) => validNodeIds.has(nodeId))) {
      return { resumed: false, reason: "workflow_topology_changed" };
    }

    // If nothing after the input node has run yet, starting fresh is identical and cleaner.
    const inputNodeIds = new Set(workflow.nodes.filter((node) => node.type === "input").map((node) => node.id));
    const step = typeof tuple.metadata?.step === "number" ? tuple.metadata.step : 0;
    if (step < 0 || nextNodes.every((nodeId) => inputNodeIds.has(nodeId))) {
      return { resumed: false, reason: "at_input_node" };
    }

    const clonedChannelValues = cloneValue(
      (tuple.checkpoint.channel_values ?? {}) as Record<string, unknown>,
    );
    const remappedHistories = remapShortTermHistoriesRunId(
      clonedChannelValues.shortTermHistories,
      sourceRunId,
      targetRunId,
    );
    if (remappedHistories) {
      clonedChannelValues.shortTermHistories = remappedHistories;
    }

    const clonedCheckpoint: Checkpoint = {
      ...cloneValue(tuple.checkpoint),
      channel_values: clonedChannelValues,
    };

    const metadata: CheckpointMetadata = tuple.metadata
      ? cloneValue(tuple.metadata)
      : { source: "loop", step: Math.max(0, step), parents: {} };

    const targetConfig = await checkpointer.put(
      { configurable: { thread_id: targetRunId, checkpoint_ns: "" } },
      clonedCheckpoint,
      metadata,
      clonedCheckpoint.channel_versions ?? {},
    );

    // Preserve completed sibling writes from the interrupted superstep, while
    // dropping `__error__` (failed task marker) and `__interrupt__` (stale pause).
    if (!rerunReceiptProducer && Array.isArray(tuple.pendingWrites) && tuple.pendingWrites.length > 0) {
      const writesByTask = new Map<string, Array<[string, unknown]>>();
      for (const [taskId, channel, value] of tuple.pendingWrites) {
        if (channel === "__error__" || channel === "__interrupt__") continue;
        const list = writesByTask.get(taskId) ?? [];
        list.push([channel, cloneValue(value)]);
        writesByTask.set(taskId, list);
      }
      for (const [taskId, writes] of writesByTask) {
        await checkpointer.putWrites(targetConfig, writes, taskId);
      }
    }

    const completedNodeOutcomes = extractCompletedNodeOutcomes(clonedChannelValues, nextNodes);
    const priorStepCount = Math.max(Object.keys(completedNodeOutcomes).length, Math.max(0, step));

    return {
      resumed: true,
      sourceRunId,
      checkpointId: clonedCheckpoint.id,
      nextNodes,
      completedNodeOutcomes,
      priorStepCount,
    };
  } catch (error) {
    return {
      resumed: false,
      reason: "clone_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
