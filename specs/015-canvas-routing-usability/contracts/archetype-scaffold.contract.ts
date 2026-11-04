/**
 * Create-path contract: archetype starter scaffolds
 * Feature: 015-canvas-routing-usability
 *
 * Aligns with apps/server stampWorkflowArchetype + topologyScaffolds patterns (feature 014).
 */

import type { WorkflowArchetypeCategory } from "@multi-agent/types";

/** Structural error codes that MUST NOT appear on first open of a hierarchical scaffold. */
export const HIERARCHICAL_EMPTY_CANVAS_CODES = [
  "MISSING_SUPERVISOR_HUB",
  "MISSING_ROUTING_NODES",
  "MISSING_APPROVAL_GATE",
] as const;

export type HierarchicalEmptyCanvasCode = (typeof HIERARCHICAL_EMPTY_CANVAS_CODES)[number];

export interface ArchetypeScaffoldPolicy {
  category: WorkflowArchetypeCategory;
  /** When true, create path MUST attach a minimal valid starter graph. */
  requireValidStarterScaffold: boolean;
  /** Conceptual pattern taught to designers (documentation / tests). */
  taughtPattern?: string;
  /** Existing codes that the starter MUST clear on first validation. */
  mustNotEmitOnCreate?: readonly string[];
}

/**
 * Policies for this feature. EO/swarm already scaffolded in 014; hierarchical is the gap.
 * Linear: no mandatory large scaffold unless empty-canvas structural traps are proven.
 */
export const ARCHETYPE_SCAFFOLD_POLICIES: ArchetypeScaffoldPolicy[] = [
  {
    category: "hierarchical-supervisor",
    requireValidStarterScaffold: true,
    taughtPattern: "Input → Supervisor Hub → Condition Router → Worker Agent(s) → Approval Gate → Output",
    mustNotEmitOnCreate: [...HIERARCHICAL_EMPTY_CANVAS_CODES],
  },
  {
    category: "evaluator-optimizer",
    requireValidStarterScaffold: true, // already implemented in 014
  },
  {
    category: "autonomous-swarm",
    requireValidStarterScaffold: true, // already implemented in 014
  },
  {
    category: "linear-pipeline",
    requireValidStarterScaffold: false,
  },
];

export interface HierarchicalScaffoldExpectations {
  hasInput: true;
  hasOutput: true;
  hasSupervisorHubAgent: true;
  supervisorHubNodeIdMatchesHub: true;
  hasConditionRouter: true;
  hasApprovalWhenGateRequired: true;
  /** Prefer acyclic starter to avoid UNGUARDED_CYCLE on day one. */
  preferAcyclicStarter: true;
  fullyEditableAfterCreate: true;
}
