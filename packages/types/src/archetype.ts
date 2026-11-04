/**
 * Workflow Archetype Categories and Configurations
 *
 * Defines the structural classification and topology constraints governing
 * workflow validation, compilation, and execution:
 * - "linear-pipeline": Sequential, acyclic execution (DAG) with deterministic batch handoffs.
 * - "hierarchical-supervisor": Hub-and-spoke supervisor graph with dynamic condition routing,
 *   iterative feedback loops with recursion guards, and Kanban board synchronization.
 * - "evaluator-optimizer": Generator ↔ evaluator feedback with iteration ceiling and exhaustion.
 * - "autonomous-swarm": Peer handoffs without a permanent hub, bounded by hops/depth/concurrency.
 */

export type WorkflowArchetypeCategory =
  | "linear-pipeline"
  | "hierarchical-supervisor"
  | "evaluator-optimizer"
  | "autonomous-swarm";

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

/** Platform default fan-out concurrency budget for parallel_split. */
export const DEFAULT_MAX_CONCURRENT_BRANCHES = 8;
/** Maximum nested subgraph resolve depth (parent counts as depth 0). */
export const MAX_SUBGRAPH_DEPTH = 3;

export const MIN_SWARM_HOPS = 1;
export const MAX_SWARM_HOPS = 20;
export const DEFAULT_SWARM_HOPS = 10;

export const MIN_SWARM_DEPTH = 1;
export const MAX_SWARM_DEPTH = 20;
export const DEFAULT_SWARM_DEPTH = 5;

export const MIN_SWARM_ACTIVE_PEER_TASKS = 1;
export const MAX_SWARM_ACTIVE_PEER_TASKS = 8;
export const DEFAULT_SWARM_ACTIVE_PEER_TASKS = 4;

export type EvaluatorOptimizerExhaustionOutcome = "fail" | "exit_path";

export interface EvaluatorOptimizerConfig {
  /** Generator / producer node ids (≥1; must exist in the graph). */
  generatorNodeIds: string[];
  /** Evaluator / critic node ids (≥1; must exist in the graph). */
  evaluatorNodeIds: string[];
  /** Hard iteration ceiling (integer 1–10; default 3). */
  maxIterations: number;
  /** Condition branchKey that exits the loop toward success/output. */
  passBranch: string;
  /** Condition branchKey that routes fail feedback back toward the generator. */
  failBranch: string;
  /** Behavior when the iteration ceiling is exhausted. */
  exhaustionOutcome: EvaluatorOptimizerExhaustionOutcome;
  /** Required when exhaustionOutcome is `exit_path`; wired to a terminal path. */
  exhaustionBranch?: string;
}

export interface SwarmConfig {
  /** Maximum peer handoff hops (integer 1–20). */
  maxHops: number;
  /** Maximum peer task nesting depth (integer 1–20). */
  maxDepth: number;
  /** Maximum concurrently active peer tasks (integer 1–8; ≤ concurrency budget). */
  maxActivePeerTasks: number;
  /** Optional explicit exit branch key. */
  terminationBranch?: string;
}

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
  /** Evaluator-optimizer loop roles, ceiling, and exhaustion routing. */
  evaluatorOptimizer?: EvaluatorOptimizerConfig;
  /** Autonomous swarm hop/depth/concurrency ceilings. */
  swarm?: SwarmConfig;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
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
 * Factory helper to construct a valid Evaluator-Optimizer archetype configuration.
 */
export function createEvaluatorOptimizerConfig(
  evaluatorOptimizer?: Partial<EvaluatorOptimizerConfig>,
  overrides?: Partial<WorkflowArchetypeConfig>
): WorkflowArchetypeConfig {
  const mergedEo = {
    ...evaluatorOptimizer,
    ...overrides?.evaluatorOptimizer,
  };
  const maxIterations = clampInt(
    mergedEo.maxIterations ?? DEFAULT_MAX_RECURSION_ITERATIONS,
    MIN_RECURSION_ITERATIONS,
    MAX_RECURSION_ITERATIONS
  );
  const exhaustionOutcome: EvaluatorOptimizerExhaustionOutcome =
    mergedEo.exhaustionOutcome === "fail" ? "fail" : "exit_path";
  const eo: EvaluatorOptimizerConfig = {
    generatorNodeIds: mergedEo.generatorNodeIds?.length ? [...mergedEo.generatorNodeIds] : [],
    evaluatorNodeIds: mergedEo.evaluatorNodeIds?.length ? [...mergedEo.evaluatorNodeIds] : [],
    maxIterations,
    passBranch: mergedEo.passBranch ?? "pass",
    failBranch: mergedEo.failBranch ?? "fail",
    exhaustionOutcome,
    ...(exhaustionOutcome === "exit_path"
      ? { exhaustionBranch: mergedEo.exhaustionBranch ?? "loop_limit_exceeded" }
      : mergedEo.exhaustionBranch
        ? { exhaustionBranch: mergedEo.exhaustionBranch }
        : {}),
  };
  const { evaluatorOptimizer: _ignoredEo, category: _ignoredCategory, ...rest } = overrides ?? {};
  return {
    maxExecutionSteps: DEFAULT_MAX_EXECUTION_STEPS,
    humanApprovalGateRequired: false,
    ...rest,
    category: "evaluator-optimizer",
    evaluatorOptimizer: eo,
  };
}

/**
 * Factory helper to construct a valid Autonomous Swarm archetype configuration.
 */
export function createAutonomousSwarmConfig(
  swarm?: Partial<SwarmConfig>,
  overrides?: Partial<WorkflowArchetypeConfig>
): WorkflowArchetypeConfig {
  const mergedSwarm = {
    ...swarm,
    ...overrides?.swarm,
  };
  const resolved: SwarmConfig = {
    maxHops: clampInt(mergedSwarm.maxHops ?? DEFAULT_SWARM_HOPS, MIN_SWARM_HOPS, MAX_SWARM_HOPS),
    maxDepth: clampInt(mergedSwarm.maxDepth ?? DEFAULT_SWARM_DEPTH, MIN_SWARM_DEPTH, MAX_SWARM_DEPTH),
    maxActivePeerTasks: clampInt(
      mergedSwarm.maxActivePeerTasks ?? DEFAULT_SWARM_ACTIVE_PEER_TASKS,
      MIN_SWARM_ACTIVE_PEER_TASKS,
      MAX_SWARM_ACTIVE_PEER_TASKS
    ),
    ...(mergedSwarm.terminationBranch !== undefined
      ? { terminationBranch: mergedSwarm.terminationBranch }
      : {}),
  };
  const { swarm: _ignoredSwarm, category: _ignoredCategory, ...rest } = overrides ?? {};
  return {
    maxExecutionSteps: DEFAULT_MAX_EXECUTION_STEPS,
    humanApprovalGateRequired: false,
    ...rest,
    category: "autonomous-swarm",
    swarm: resolved,
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
 * Checks whether an archetype category or configuration represents evaluator-optimizer.
 */
export function isEvaluatorOptimizer(
  archetype?: WorkflowArchetypeCategory | WorkflowArchetypeConfig | null
): boolean {
  if (!archetype) return false;
  if (typeof archetype === "string") return archetype === "evaluator-optimizer";
  return archetype.category === "evaluator-optimizer";
}

/**
 * Checks whether an archetype category or configuration represents autonomous-swarm.
 */
export function isAutonomousSwarm(
  archetype?: WorkflowArchetypeCategory | WorkflowArchetypeConfig | null
): boolean {
  if (!archetype) return false;
  if (typeof archetype === "string") return archetype === "autonomous-swarm";
  return archetype.category === "autonomous-swarm";
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
  "evaluator-optimizer": {
    id: "evaluator-optimizer",
    label: "Evaluator-Optimizer",
    badgeClass: "border-teal-500/40 bg-teal-950/60 text-teal-300",
    badgeBorderClass: "border-teal-500/40",
    description: "Generator and evaluator feedback loop that refines outputs until quality criteria pass or the iteration ceiling is exhausted.",
    executionModel: "Bounded generate → evaluate feedback with exhaustion outcome",
    topologyConstraint: "Only the designated fail→generator feedback cycle is allowed; unrelated cycles are rejected.",
  },
  "autonomous-swarm": {
    id: "autonomous-swarm",
    label: "Autonomous Swarm",
    badgeClass: "border-rose-500/40 bg-rose-950/60 text-rose-300",
    badgeBorderClass: "border-rose-500/40",
    description: "Peer-to-peer agent handoffs without a permanent supervisor hub, bounded by hop, depth, and concurrency ceilings.",
    executionModel: "Bounded peer handoff coordination",
    topologyConstraint: "Peer cycles require enforceable maxHops/maxDepth/maxActivePeerTasks termination.",
  },
};

export function getArchetypeDescriptor(archetype: WorkflowArchetypeCategory): ArchetypeOptionDescriptor {
  return ARCHETYPE_DESCRIPTORS[archetype];
}

/** True when the value is one of the persisted archetype categories. */
export function isWorkflowArchetypeValid(value: unknown): value is WorkflowArchetypeCategory {
  return (
    value === "linear-pipeline" ||
    value === "hierarchical-supervisor" ||
    value === "evaluator-optimizer" ||
    value === "autonomous-swarm"
  );
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
