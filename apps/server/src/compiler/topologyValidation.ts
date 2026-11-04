/**
 * Topology validation helpers for expanded archetypes and primitives (feature 014).
 */
import type {
  ParallelJoinNodeConfig,
  SubgraphNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
} from "@multi-agent/types";
import {
  DEFAULT_MAX_CONCURRENT_BRANCHES,
  MAX_SUBGRAPH_DEPTH,
  MAX_SWARM_ACTIVE_PEER_TASKS,
  MAX_SWARM_DEPTH,
  MAX_SWARM_HOPS,
  MIN_RECURSION_ITERATIONS,
  MAX_RECURSION_ITERATIONS,
  MIN_SWARM_ACTIVE_PEER_TASKS,
  MIN_SWARM_DEPTH,
  MIN_SWARM_HOPS,
  resolveWorkflowArchetype,
} from "@multi-agent/types";
import type { WorkflowIssue } from "./validation";

type AddIssue = (level: WorkflowIssue["level"], code: string, message: string, nodeId?: string, edgeId?: string) => void;

function branchWired(definition: WorkflowDefinition, branchKey: string): boolean {
  return definition.edges.some((edge) => edge.kind === "conditional" && edge.branchKey === branchKey);
}

function conditionDeclaresBranch(definition: WorkflowDefinition, branchKey: string): boolean {
  return definition.nodes.some((node) => {
    if (node.type !== "condition") return false;
    const branches = (node.config as { branches?: Array<{ key?: string }> }).branches ?? [];
    return branches.some((branch) => branch.key === branchKey);
  });
}

/** Evaluator-optimizer specific rules. */
export function validateEvaluatorOptimizer(
  definition: WorkflowDefinition,
  nodes: Map<string, WorkflowNode>,
  cycleNodes: Set<string>,
  add: AddIssue,
): void {
  const eo = definition.archetypeConfig?.evaluatorOptimizer;
  if (!eo) {
    add("error", "EVALUATOR_OPTIMIZER_CONFIG_REQUIRED", "Evaluator-optimizer workflow requires archetypeConfig.evaluatorOptimizer.");
    return;
  }

  if (!Array.isArray(eo.generatorNodeIds) || eo.generatorNodeIds.length < 1 || !Array.isArray(eo.evaluatorNodeIds) || eo.evaluatorNodeIds.length < 1) {
    add("error", "EVALUATOR_OPTIMIZER_CONFIG_REQUIRED", "Evaluator-optimizer requires generatorNodeIds and evaluatorNodeIds (min 1 each).");
  }

  for (const id of eo.generatorNodeIds ?? []) {
    const node = nodes.get(id);
    if (!node || node.type !== "agent") {
      add("error", "EVALUATOR_OPTIMIZER_ROLE_INVALID", `Generator node "${id}" must exist and be an agent node.`, id);
    }
  }
  for (const id of eo.evaluatorNodeIds ?? []) {
    const node = nodes.get(id);
    if (!node || (node.type !== "agent" && node.type !== "condition")) {
      add("error", "EVALUATOR_OPTIMIZER_ROLE_INVALID", `Evaluator node "${id}" must exist and be an agent or condition node.`, id);
    }
  }

  if (typeof eo.maxIterations !== "number" || !Number.isInteger(eo.maxIterations) || eo.maxIterations < MIN_RECURSION_ITERATIONS || eo.maxIterations > MAX_RECURSION_ITERATIONS) {
    add("error", "EVALUATOR_OPTIMIZER_CEILING_REQUIRED", `Evaluator-optimizer maxIterations must be an integer between ${MIN_RECURSION_ITERATIONS} and ${MAX_RECURSION_ITERATIONS}.`);
  }

  const pass = eo.passBranch?.trim();
  const fail = eo.failBranch?.trim();
  if (!pass || !fail || !conditionDeclaresBranch(definition, pass) || !conditionDeclaresBranch(definition, fail) || !branchWired(definition, pass) || !branchWired(definition, fail)) {
    add(
      "error",
      "EVALUATOR_OPTIMIZER_ROUTING_INVALID",
      "Evaluator-optimizer pass/fail branches must be declared on a condition node and wired with conditional edges.",
    );
  }

  if (eo.exhaustionOutcome === "exit_path") {
    const exhaustion = eo.exhaustionBranch?.trim();
    if (!exhaustion || !conditionDeclaresBranch(definition, exhaustion) || !branchWired(definition, exhaustion)) {
      add(
        "error",
        "EVALUATOR_OPTIMIZER_EXHAUSTION_UNWIRED",
        "Evaluator-optimizer exhaustionOutcome is exit_path but exhaustionBranch is missing or not wired.",
      );
    }
  }

  if (cycleNodes.size > 0) {
    const generators = new Set(eo.generatorNodeIds ?? []);
    const failEdge = definition.edges.find((edge) => edge.kind === "conditional" && edge.branchKey === fail);
    const failTargetsGenerator = Boolean(failEdge && (generators.has(failEdge.target) || canReachIds(definition, failEdge.target, generators)));
    // Allow cycles only when fail feedback can reach a generator and every cycle node is on a path involving generators/evaluators.
    const roleIds = new Set([...(eo.generatorNodeIds ?? []), ...(eo.evaluatorNodeIds ?? [])]);
    const unrelated = [...cycleNodes].filter((id) => !roleIds.has(id) && !isAdjacentToRoles(definition, id, roleIds));
    if (!failTargetsGenerator || unrelated.length > 0) {
      for (const nodeId of unrelated.length ? unrelated : cycleNodes) {
        add(
          "error",
          "EVALUATOR_OPTIMIZER_CYCLE_INVALID",
          `Evaluator-optimizer feedback cycle must route fail back to a generator; unrelated cycle involving "${nodeId}" is not allowed.`,
          nodeId,
        );
      }
    }
  }
}

/** Autonomous swarm bounds and peer-loop safety. */
export function validateAutonomousSwarm(
  definition: WorkflowDefinition,
  cycleNodes: Set<string>,
  add: AddIssue,
): void {
  const swarm = definition.archetypeConfig?.swarm;
  if (!swarm) {
    add("error", "SWARM_BOUNDS_REQUIRED", "Autonomous-swarm workflow requires archetypeConfig.swarm with maxHops, maxDepth, and maxActivePeerTasks.");
    if (cycleNodes.size > 0) {
      add("error", "SWARM_UNBOUNDED_PEER_LOOP", "Autonomous-swarm contains peer cycles but has no enforceable hop/depth bounds.");
    }
    return;
  }

  const missing =
    typeof swarm.maxHops !== "number" ||
    typeof swarm.maxDepth !== "number" ||
    typeof swarm.maxActivePeerTasks !== "number";
  if (missing) {
    add("error", "SWARM_BOUNDS_REQUIRED", "Autonomous-swarm requires maxHops, maxDepth, and maxActivePeerTasks.");
  }

  const hopsOk = Number.isInteger(swarm.maxHops) && swarm.maxHops >= MIN_SWARM_HOPS && swarm.maxHops <= MAX_SWARM_HOPS;
  const depthOk = Number.isInteger(swarm.maxDepth) && swarm.maxDepth >= MIN_SWARM_DEPTH && swarm.maxDepth <= MAX_SWARM_DEPTH;
  const activeOk =
    Number.isInteger(swarm.maxActivePeerTasks) &&
    swarm.maxActivePeerTasks >= MIN_SWARM_ACTIVE_PEER_TASKS &&
    swarm.maxActivePeerTasks <= MAX_SWARM_ACTIVE_PEER_TASKS &&
    swarm.maxActivePeerTasks <= DEFAULT_MAX_CONCURRENT_BRANCHES;
  if (!missing && (!hopsOk || !depthOk || !activeOk)) {
    add(
      "error",
      "SWARM_BOUNDS_INVALID",
      `Autonomous-swarm bounds invalid: maxHops ${MIN_SWARM_HOPS}-${MAX_SWARM_HOPS}, maxDepth ${MIN_SWARM_DEPTH}-${MAX_SWARM_DEPTH}, maxActivePeerTasks ${MIN_SWARM_ACTIVE_PEER_TASKS}-${MAX_SWARM_ACTIVE_PEER_TASKS} (≤ concurrency budget ${DEFAULT_MAX_CONCURRENT_BRANCHES}).`,
    );
  }

  if (cycleNodes.size > 0 && (missing || !hopsOk || !depthOk)) {
    add("error", "SWARM_UNBOUNDED_PEER_LOOP", "Autonomous-swarm peer cycles require enforceable hop/depth ceilings.");
  }
  if (cycleNodes.size > 0 && swarm && hopsOk && depthOk) {
    const termination = swarm.terminationBranch?.trim();
    if (!termination || !conditionDeclaresBranch(definition, termination) || !branchWired(definition, termination)) {
      add(
        "error",
        "SWARM_UNBOUNDED_PEER_LOOP",
        "Autonomous-swarm peer cycles require a reachable terminationBranch on a condition node.",
      );
    }
  }
}

/** Parallel split/join structural rules. */
export function validateParallelTopology(
  definition: WorkflowDefinition,
  add: AddIssue,
  maxConcurrentBranches: number = DEFAULT_MAX_CONCURRENT_BRANCHES,
): void {
  const maxBranches = Math.max(1, maxConcurrentBranches);
  const joinIds = new Set(definition.nodes.filter((node) => node.type === "parallel_join").map((node) => node.id));
  for (const node of definition.nodes) {
    if (node.type === "parallel_split") {
      const outgoing = definition.edges.filter((edge) => edge.source === node.id);
      if (outgoing.length < 2) {
        add(
          "error",
          "PARALLEL_SPLIT_JOIN_MISMATCH",
          `Parallel split "${node.id}" requires at least two outgoing specialist lanes.`,
          node.id,
        );
      }
      if (outgoing.length > maxBranches) {
        add(
          "error",
          "PARALLEL_BRANCH_LIMIT_EXCEEDED",
          `Parallel split "${node.id}" fans out to ${outgoing.length} branches; platform limit is ${maxBranches}.`,
          node.id,
        );
      }
      // Orphan split: no descendant path reaches a parallel_join.
      const reachesJoin = outgoing.some((edge) => canReachIds(definition, edge.target, joinIds) || joinIds.has(edge.target));
      if (joinIds.size > 0 && !reachesJoin) {
        add(
          "error",
          "PARALLEL_SPLIT_JOIN_MISMATCH",
          `Parallel split "${node.id}" is not connected to a parallel_join.`,
          node.id,
        );
      }
    }
    if (node.type === "parallel_join") {
      const config = node.config as ParallelJoinNodeConfig;
      const policy = config.joinPolicy ?? "all_success";
      if (policy !== "all_success" && policy !== "partial_allowed") {
        add("error", "PARALLEL_JOIN_POLICY_INVALID", `Parallel join "${node.id}" has invalid joinPolicy.`, node.id);
      }
      const incoming = definition.edges.filter((edge) => edge.target === node.id);
      if (incoming.length < 2) {
        add(
          "error",
          "PARALLEL_SPLIT_JOIN_MISMATCH",
          `Parallel join "${node.id}" requires at least two incoming specialist lanes.`,
          node.id,
        );
      }
      if (Array.isArray(config.requiredBranchKeys) && config.requiredBranchKeys.length) {
        const sources = new Set(incoming.map((edge) => edge.source));
        for (const key of config.requiredBranchKeys) {
          if (!sources.has(key)) {
            add(
              "error",
              "PARALLEL_JOIN_POLICY_INVALID",
              `Parallel join "${node.id}" requiredBranchKeys entry "${key}" is not an incoming source.`,
              node.id,
            );
          }
        }
      }
    }
  }
}

export interface SubgraphValidationOptions {
  knownWorkflowIds?: ReadonlySet<string> | string[];
  resolveWorkflowDefinition?: (workflowId: string) => WorkflowDefinition | null | undefined;
}

/** Subgraph reference and mapping rules. */
export function validateSubgraphNodes(
  definition: WorkflowDefinition,
  add: AddIssue,
  options: SubgraphValidationOptions = {},
): void {
  const known = options.knownWorkflowIds
    ? options.knownWorkflowIds instanceof Set
      ? options.knownWorkflowIds
      : new Set(options.knownWorkflowIds)
    : undefined;

  for (const node of definition.nodes) {
    if (node.type !== "subgraph") continue;
    const config = node.config as SubgraphNodeConfig;
    const workflowId = typeof config.workflowId === "string" ? config.workflowId.trim() : "";
    if (!workflowId) {
      add("error", "SUBGRAPH_REF_MISSING", `Subgraph node "${node.id}" requires a workflowId.`, node.id);
    } else if (workflowId === definition.id) {
      add("error", "SUBGRAPH_NESTING_UNSAFE", `Subgraph node "${node.id}" cannot reference its parent workflow (self-reference).`, node.id);
    } else if (known && !known.has(workflowId)) {
      add("error", "SUBGRAPH_REF_MISSING", `Subgraph node "${node.id}" references inaccessible workflow "${workflowId}".`, node.id);
    }

    const depth = (config as { nestingDepth?: number }).nestingDepth;
    if (typeof depth === "number" && depth > MAX_SUBGRAPH_DEPTH) {
      add(
        "error",
        "SUBGRAPH_DEPTH_EXCEEDED",
        `Subgraph nesting depth ${depth} exceeds platform max ${MAX_SUBGRAPH_DEPTH}.`,
        node.id,
      );
    }

    if (workflowId && options.resolveWorkflowDefinition) {
      const visited = new Set<string>([definition.id]);
      let cursor: string | undefined = workflowId;
      let hops = 1;
      while (cursor) {
        if (visited.has(cursor)) {
          add("error", "SUBGRAPH_NESTING_UNSAFE", `Subgraph node "${node.id}" participates in a cyclic workflow reference.`, node.id);
          break;
        }
        if (hops > MAX_SUBGRAPH_DEPTH) {
          add("error", "SUBGRAPH_DEPTH_EXCEEDED", `Subgraph nesting depth exceeds platform max ${MAX_SUBGRAPH_DEPTH}.`, node.id);
          break;
        }
        visited.add(cursor);
        const child = options.resolveWorkflowDefinition(cursor);
        if (!child) break;
        const next = child.nodes
          .filter((candidate) => candidate.type === "subgraph")
          .map((candidate) => String((candidate.config as { workflowId?: string }).workflowId ?? "").trim())
          .find(Boolean);
        cursor = next;
        hops += 1;
      }
    }

    for (const mapping of [...(config.inputMappings ?? []), ...(config.outputMappings ?? [])]) {
      const required = mapping.required !== false;
      if (required && (!mapping.source?.trim() || !mapping.target?.trim())) {
        add(
          "error",
          "SUBGRAPH_MAPPING_INVALID",
          `Subgraph node "${node.id}" has a required mapping with empty source or target.`,
          node.id,
        );
      }
    }
  }
}

export function validateExpandedTopology(
  definition: WorkflowDefinition,
  nodes: Map<string, WorkflowNode>,
  cycleNodes: Set<string>,
  add: AddIssue,
  limits?: {
    maxConcurrentBranches?: number;
    knownWorkflowIds?: ReadonlySet<string> | string[];
    resolveWorkflowDefinition?: (workflowId: string) => WorkflowDefinition | null | undefined;
  },
): void {
  const archetype = resolveWorkflowArchetype(definition);
  if (archetype === "evaluator-optimizer") {
    validateEvaluatorOptimizer(definition, nodes, cycleNodes, add);
  }
  if (archetype === "autonomous-swarm") {
    validateAutonomousSwarm(definition, cycleNodes, add);
  }
  validateParallelTopology(definition, add, limits?.maxConcurrentBranches ?? DEFAULT_MAX_CONCURRENT_BRANCHES);
  validateSubgraphNodes(definition, add, {
    knownWorkflowIds: limits?.knownWorkflowIds,
    resolveWorkflowDefinition: limits?.resolveWorkflowDefinition,
  });
}

function canReachIds(definition: WorkflowDefinition, startId: string, targets: Set<string>): boolean {
  const visiting = new Set<string>();
  const walk = (id: string): boolean => {
    if (targets.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    for (const edge of definition.edges.filter((candidate) => candidate.source === id)) {
      if (walk(edge.target)) return true;
    }
    return false;
  };
  return walk(startId);
}

function isAdjacentToRoles(definition: WorkflowDefinition, nodeId: string, roleIds: Set<string>): boolean {
  return definition.edges.some(
    (edge) =>
      (edge.source === nodeId && roleIds.has(edge.target)) ||
      (edge.target === nodeId && roleIds.has(edge.source)),
  );
}
