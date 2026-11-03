/**
 * UI Contracts: Workflow Archetype Controls and State Management
 *
 * Defines the contract boundaries between the React presentation components,
 * the Zustand workflow store, and validation services in Agent Studio.
 */

import type {
  WorkflowArchetypeCategory,
  WorkflowArchetypeConfig,
  WorkflowRecursionGuardConfig,
  WorkflowDefinition,
} from "@multi-agent/types";
import type { WorkflowIssue } from "@/lib/workflow/validation";

/**
 * Display descriptor defining metadata and visual styling for each archetype.
 */
export interface ArchetypeOptionDescriptor {
  id: WorkflowArchetypeCategory;
  label: string;
  badgeClass: string;
  badgeBorderClass: string;
  description: string;
  executionModel: string;
  topologyConstraint: string;
}

export const ARCHETYPE_DESCRIPTORS: Record<WorkflowArchetypeCategory, ArchetypeOptionDescriptor> = {
  "linear-pipeline": {
    id: "linear-pipeline",
    label: "Linear Pipeline",
    badgeClass: "border-blue-500/40 bg-blue-950/60 text-blue-300",
    badgeBorderClass: "border-blue-500/40",
    description: "Sequential, deterministic multi-agent pipeline executing an acyclic directed graph with discrete stage handoffs.",
    executionModel: "Acyclic sequential batch execution",
    topologyConstraint: "Directed acyclic graph (DAG) — feedback cycles are strictly prohibited.",
  },
  "hierarchical-supervisor": {
    id: "hierarchical-supervisor",
    label: "Hierarchical Supervisor",
    badgeClass: "border-purple-500/40 bg-purple-950/60 text-purple-300",
    badgeBorderClass: "border-purple-500/40",
    description: "Hub-and-spoke multi-agent coordination architecture with dynamic condition routing, feedback remediation loops, and recursion guardrails.",
    executionModel: "Cyclic hub-and-spoke coordination with stateful routing",
    topologyConstraint: "Cyclic routes permitted when protected by monitored recursion guards.",
  },
};

/**
 * Input parameters required when creating a new workflow via the creation dialog.
 */
export interface CreateWorkflowDialogSubmitPayload {
  name: string;
  archetype: WorkflowArchetypeCategory;
}

/**
 * Props for the Create Workflow Dialog component.
 */
export interface CreateWorkflowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateWorkflowDialogSubmitPayload) => Promise<void>;
  isSubmitting?: boolean;
}

/**
 * Store action contracts added to WorkflowStoreState to manage archetype configuration.
 */
export interface WorkflowStoreArchetypeActions {
  /**
   * Explicitly set the workflow archetype.
   * - Preserves 100% of nodes, edges, and configurations.
   * - Retains dormant supervisor configuration when converting to linear-pipeline.
   * - Marks workflow dirty and registers history entry for Undo/Redo.
   */
  setWorkflowArchetype: (archetype: WorkflowArchetypeCategory) => void;

  /**
   * Update supervisor configuration parameters (hub ID, execution step limit, approval requirement).
   */
  updateSupervisorConfig: (patch: Partial<Omit<WorkflowArchetypeConfig, "category">>) => void;

  /**
   * Add a new recursion guard to the active supervisor configuration.
   */
  addRecursionGuard: (guard: WorkflowRecursionGuardConfig) => void;

  /**
   * Update an existing recursion guard at the specified index.
   */
  updateRecursionGuard: (index: number, patch: Partial<WorkflowRecursionGuardConfig>) => void;

  /**
   * Remove a recursion guard at the specified index.
   */
  removeRecursionGuard: (index: number) => void;
}

/**
 * Validation summary contract exposed to the UI toolbar and Overview panel.
 */
export interface ArchetypeValidationState {
  effectiveArchetype: WorkflowArchetypeCategory;
  isLegacyUntyped: boolean;
  hasBlockingErrors: boolean;
  blockingErrors: WorkflowIssue[];
  warnings: WorkflowIssue[];
  isRunnable: boolean;
}
