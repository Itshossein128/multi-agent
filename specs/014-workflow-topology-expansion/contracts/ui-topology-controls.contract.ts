/**
 * UI Contracts: Expanded Workflow Topology Controls
 *
 * Boundaries between CreateWorkflowDialog / NodePalette / Overview forms,
 * the Zustand workflow store, and validation for feature 014.
 *
 * Extends patterns from specs/010-workflow-archetype-selection/contracts/ui-archetype-controls.contract.ts
 */

import type {
  WorkflowArchetypeCategory,
  WorkflowDefinition,
  WorkflowNodeType,
} from "@multi-agent/types";

/** Extended archetype union (mirrors packages/types once implemented). */
export type TopologyArchetypeCategory =
  | "linear-pipeline"
  | "hierarchical-supervisor"
  | "evaluator-optimizer"
  | "autonomous-swarm";

export type TopologyNodeType = WorkflowNodeType | "parallel_split" | "parallel_join" | "subgraph";

export interface TopologyArchetypeDescriptor {
  id: TopologyArchetypeCategory;
  label: string;
  description: string;
  executionModel: string;
  topologyConstraint: string;
  /** When true, create path must attach a minimal valid scaffold graph. */
  requiresScaffold: boolean;
}

/**
 * Create dialog must list all four archetypes with descriptions.
 * Default selection remains linear-pipeline.
 */
export interface CreateWorkflowDialogSubmitPayloadV14 {
  name: string;
  archetype: TopologyArchetypeCategory;
}

/**
 * Store actions for topology authoring (additive).
 */
export interface WorkflowStoreTopologyActions {
  setWorkflowArchetype: (archetype: TopologyArchetypeCategory) => void;
  /** Update EO config fields; marks dirty + history. */
  updateEvaluatorOptimizerConfig: (
    patch: NonNullable<NonNullable<WorkflowDefinition["archetypeConfig"]> extends infer C ? C : never> | Record<string, unknown>,
  ) => void;
  /** Update swarm safety bounds. */
  updateSwarmConfig: (patch: {
    maxHops?: number;
    maxDepth?: number;
    maxActivePeerTasks?: number;
    terminationBranch?: string;
  }) => void;
  /** Set join policy / timeouts on a parallel_join node. */
  updateParallelJoinConfig: (
    nodeId: string,
    patch: {
      joinPolicy?: "all_success" | "partial_allowed";
      requiredBranchKeys?: string[];
      branchTimeoutMs?: number;
    },
  ) => void;
  /** Set subgraph reference + mappings. */
  updateSubgraphConfig: (
    nodeId: string,
    patch: {
      workflowId?: string;
      label?: string;
      inputMappings?: Array<{ source: string; target: string; required?: boolean }>;
      outputMappings?: Array<{ source: string; target: string; required?: boolean }>;
    },
  ) => void;
}

/**
 * Palette contract: topology primitives available for drag/add.
 */
export const TOPOLOGY_PALETTE_NODE_TYPES: ReadonlyArray<{
  type: Extract<TopologyNodeType, "parallel_split" | "parallel_join" | "subgraph">;
  label: string;
  description: string;
}> = [
  {
    type: "parallel_split",
    label: "Parallel Split",
    description: "Fan out one input across independent specialist branches.",
  },
  {
    type: "parallel_join",
    label: "Parallel Join",
    description: "Join specialist results with an explicit success/partial policy.",
  },
  {
    type: "subgraph",
    label: "Sub-workflow",
    description: "Embed another saved workflow as a reusable nested block.",
  },
];

/**
 * Live projection inputs the canvas expects for topology chrome.
 */
export interface TopologyLiveProjectionHints {
  iterationByNodeId?: Record<string, { current: number; max: number; phase?: string }>;
  parallelBranchesBySplitId?: Record<
    string,
    Array<{ branchKey: string; nodeId?: string; status: "pending" | "running" | "completed" | "failed" | "timed_out" }>
  >;
  subgraphFrames?: Array<{
    parentNodeId: string;
    workflowId: string;
    depth: number;
    status: "running" | "exited" | "failed";
  }>;
}

/**
 * Scaffold guarantee: after create with requiresScaffold archetype,
 * client validation must not report blocking structural errors before user edits.
 */
export type ScaffoldValidationExpectation = {
  archetype: Extract<TopologyArchetypeCategory, "evaluator-optimizer" | "autonomous-swarm">;
  blockingIssueCount: 0;
};
