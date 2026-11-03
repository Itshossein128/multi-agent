/**
 * Workflow Archetype Categories and Configurations
 *
 * Defines the structural classification and topology constraints governing
 * workflow validation, compilation, and execution:
 * - "linear-pipeline": Sequential, acyclic execution (DAG) with deterministic batch handoffs.
 * - "hierarchical-supervisor": Hub-and-spoke supervisor graph with dynamic condition routing,
 *   iterative feedback loops with recursion guards, and Kanban board synchronization.
 */

export type WorkflowArchetypeCategory = "linear-pipeline" | "hierarchical-supervisor";

export function resolveWorkflowArchetype(definition: {
  archetype?: WorkflowArchetypeCategory;
  archetypeConfig?: WorkflowArchetypeConfig;
}): WorkflowArchetypeCategory {
  return definition.archetype ?? definition.archetypeConfig?.category ?? "linear-pipeline";
}

export const DEFAULT_MAX_RECURSION_ITERATIONS = 3;
export const MIN_RECURSION_ITERATIONS = 1;
export const MAX_RECURSION_ITERATIONS = 10;

export const DEFAULT_MAX_EXECUTION_STEPS = 1000;
export const MIN_EXECUTION_STEPS = 1;
export const MAX_EXECUTION_STEPS = 5000;

export interface WorkflowRecursionGuardConfig {
  /** Maximum iterations allowed for a cyclical feedback route (e.g. 3 for QA remediation loops). */
  maxIterations: number;
  /** Route or edge key monitored by this guard. */
  routeKey: string;
  /** Fallback branch taken when recursion limit is exceeded (e.g. "loop_limit_exceeded"). */
  fallbackBranch: string;
}

export interface WorkflowArchetypeConfig {
  /** Declared archetype category. */
  category: WorkflowArchetypeCategory;
  /** Primary supervisor hub node id (required for hierarchical-supervisor). */
  supervisorHubNodeId?: string;
  /** Server-level maximum step limit override (optional, defaults to 1,000). */
  maxExecutionSteps?: number;
  /** Granular recursion guards for cyclic routes. */
  recursionGuards?: WorkflowRecursionGuardConfig[];
  /** Whether the workflow incorporates a mandatory human approval gate before mutating code. */
  humanApprovalGateRequired?: boolean;
}

/**
 * Factory helper to construct a valid Linear Pipeline archetype configuration.
 */
export function createLinearPipelineConfig(
  overrides?: Partial<WorkflowArchetypeConfig>
): WorkflowArchetypeConfig {
  return {
    category: "linear-pipeline",
    maxExecutionSteps: overrides?.maxExecutionSteps ?? DEFAULT_MAX_EXECUTION_STEPS,
    humanApprovalGateRequired: overrides?.humanApprovalGateRequired ?? false,
    ...overrides,
  };
}

/**
 * Factory helper to construct a valid Hierarchical Supervisor archetype configuration.
 */
export function createHierarchicalSupervisorConfig(
  supervisorHubNodeId?: string,
  overrides?: Partial<WorkflowArchetypeConfig>
): WorkflowArchetypeConfig {
  return {
    category: "hierarchical-supervisor",
    supervisorHubNodeId,
    maxExecutionSteps: overrides?.maxExecutionSteps ?? DEFAULT_MAX_EXECUTION_STEPS,
    humanApprovalGateRequired: overrides?.humanApprovalGateRequired ?? true,
    recursionGuards: overrides?.recursionGuards ?? [
      {
        routeKey: "qa_verify->implement_spec",
        maxIterations: DEFAULT_MAX_RECURSION_ITERATIONS,
        fallbackBranch: "loop_limit_exceeded",
      },
    ],
    ...overrides,
  };
}

/**
 * Helper to build a recursion guard config with clamped iteration bounds.
 */
export function createRecursionGuard(
  routeKey: string,
  fallbackBranch = "loop_limit_exceeded",
  maxIterations = DEFAULT_MAX_RECURSION_ITERATIONS
): WorkflowRecursionGuardConfig {
  const clamped = Math.max(
    MIN_RECURSION_ITERATIONS,
    Math.min(MAX_RECURSION_ITERATIONS, Math.floor(maxIterations))
  );
  return {
    routeKey,
    fallbackBranch,
    maxIterations: clamped,
  };
}

/**
 * Checks whether an archetype category or configuration represents a hierarchical supervisor.
 */
export function isHierarchicalSupervisor(
  archetype?: WorkflowArchetypeCategory | WorkflowArchetypeConfig | null
): boolean {
  if (!archetype) return false;
  if (typeof archetype === "string") return archetype === "hierarchical-supervisor";
  return archetype.category === "hierarchical-supervisor";
}

/**
 * Checks whether an archetype category or configuration represents a linear pipeline.
 */
export function isLinearPipeline(
  archetype?: WorkflowArchetypeCategory | WorkflowArchetypeConfig | null
): boolean {
  if (!archetype) return true; // Default fallback is linear pipeline
  if (typeof archetype === "string") return archetype === "linear-pipeline";
  return archetype.category === "linear-pipeline";
}

/**
 * Display metadata for archetype selectors, badges, and creation dialogs.
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

export function getArchetypeDescriptor(archetype: WorkflowArchetypeCategory): ArchetypeOptionDescriptor {
  return ARCHETYPE_DESCRIPTORS[archetype];
}

/** True when the value is one of the persisted archetype categories. */
export function isWorkflowArchetypeValid(value: unknown): value is WorkflowArchetypeCategory {
  return value === "linear-pipeline" || value === "hierarchical-supervisor";
}

/**
 * Untyped legacy workflows declare neither `archetype` nor `archetypeConfig.category`.
 * They display as Linear Pipeline and bypass strict cycle enforcement until promoted.
 */
export function isLegacyUntypedWorkflow(definition: {
  archetype?: WorkflowArchetypeCategory;
  archetypeConfig?: Pick<WorkflowArchetypeConfig, "category"> | null;
}): boolean {
  return definition.archetype === undefined && definition.archetypeConfig?.category === undefined;
}
