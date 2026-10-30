import type { AgentRecord, ToolCategory, ToolRecord, WorkflowDefinition, WorkflowNode, WorkflowNodeType } from "@multi-agent/types";
import { agentHasConfiguredModel, validateAgent, validateTool, validateRawNodeContract } from "@multi-agent/types";
import { NODE_VALIDATORS, type ValidationContext } from "./nodeValidators";

/**
 * Issue codes that make a definition structurally unsafe or policy-violating
 * to persist: identifier/structure integrity, contract declarations, allowed
 * branch values, and retry safety. Graph *completeness* issues (missing input
 * or output nodes, unlinked agents, …) stay saveable drafts and are enforced
 * authoritatively when a run is created.
 */
export const SAVE_BLOCKING_ISSUE_CODES: ReadonlySet<string> = new Set([
  "INVALID_WORKFLOW", "INVALID_WORKFLOW_MEMBER", "NODE_LIMIT_EXCEEDED", "EDGE_LIMIT_EXCEEDED",
  "INVALID_NODE_ID", "DUPLICATE_NODE_ID", "UNKNOWN_NODE_TYPE", "INVALID_NODE_POSITION", "INVALID_NODE_CONFIG",
  "INVALID_RETRY_ATTEMPTS", "INVALID_RETRY_BACKOFF", "INVALID_RETRY_MULTIPLIER", "UNSAFE_NODE_RETRY",
  "INVALID_EDGE_ID", "DUPLICATE_EDGE_ID", "INVALID_EDGE_KIND", "DUPLICATE_EDGE", "INVALID_EDGE_REFERENCE",
  "UNSAFE_CYCLE", "MISSING_BRANCH_KEY", "INVALID_CONNECTION", "AMBIGUOUS_BRANCHING", "INVALID_CONDITIONAL_SOURCE",
  "INVALID_APPROVAL_BRANCH", "INVALID_CONDITION_SOURCE", "INVALID_CONDITION_FIELD", "MISSING_CONDITION_BRANCHES",
  "BRANCH_LIMIT_EXCEEDED", "INVALID_BRANCH_KEY", "DUPLICATE_BRANCH_KEY", "AMBIGUOUS_BRANCH_KEY",
  "INVALID_CONDITIONAL_BRANCH", "INVALID_UNKNOWN_ROUTE",
  "INVALID_INPUT_KEY", "INVALID_INPUT_DESCRIPTION", "INVALID_OUTPUT_KEY", "INVALID_OUTPUT_DESCRIPTION",
  "INVALID_OUTPUT_INPUT_MODE", "INVALID_MEMORY_MODE", "INVALID_MEMORY_TYPE",
  "INVALID_APPROVAL_TYPE", "INVALID_APPROVAL_TIMEOUT",
  "INVALID_CONTRACT_SCHEMA", "INVALID_CONTRACT_VERSION", "UNSUPPORTED_CONTRACT_VERSION",
  "UNSUPPORTED_SCHEMA_KEYWORD", "INVALID_PAYLOAD_BOUNDS", "INVALID_CONTRACT_EVIDENCE",
  "INVALID_ARCHETYPE", "LINEAR_PIPELINE_CYCLE_FORBIDDEN", "MISSING_SUPERVISOR_HUB",
  "INVALID_SUPERVISOR_HUB", "MISSING_ROUTING_NODES", "UNGUARDED_CYCLE", "INVALID_RECURSION_GUARD",
]);

export interface WorkflowIssue {
  id: string;
  /** Stable machine-readable reason suitable for API/UI handling. */
  code: string;
  /** Preferred structured severity; `severity` remains for existing consumers. */
  level: "error" | "warning";
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowValidationLimits {
  maxNodes?: number;
  maxEdges?: number;
  maxBranches?: number;
  maxNodeRetryAttempts?: number;
  maxNodeRetryBackoffMs?: number;
  supportedToolCategories?: ToolCategory[];
  allowToolSideEffects?: boolean;
}

const NODE_TYPES = new Set<WorkflowNodeType>(["agent", "tool", "approval", "memory", "condition", "input", "output"]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ALL_TARGETS = new Set<WorkflowNodeType>(["agent", "tool", "approval", "memory", "condition", "output"]);
const CONNECTION_TARGETS: Record<WorkflowNodeType, ReadonlySet<WorkflowNodeType>> = {
  input: ALL_TARGETS,
  agent: ALL_TARGETS,
  tool: ALL_TARGETS,
  approval: ALL_TARGETS,
  memory: ALL_TARGETS,
  condition: ALL_TARGETS,
  output: new Set(),
};

export function validateWorkflow(definition: WorkflowDefinition, agents: AgentRecord[], limits: WorkflowValidationLimits = {}, tools: ToolRecord[] = []): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const add = (level: WorkflowIssue["level"], code: string, message: string, nodeId?: string, edgeId?: string) =>
    issues.push({ id: `${level}-${code}-${issues.length}`, code, level, severity: level, message, nodeId, edgeId });
  if (!definition || typeof definition !== "object") return [{ id: "error-invalid-definition", code: "INVALID_WORKFLOW", level: "error", severity: "error", message: "Workflow definition must be an object." }];
  if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    return [{ id: "error-invalid-definition-shape", code: "INVALID_WORKFLOW", level: "error", severity: "error", message: "Workflow definition must contain nodes and edges arrays." }];
  }
  if (definition.nodes.some((node) => !node || typeof node !== "object" || Array.isArray(node)) || definition.edges.some((edge) => !edge || typeof edge !== "object" || Array.isArray(edge))) {
    return [{ id: "error-invalid-member-shape", code: "INVALID_WORKFLOW_MEMBER", level: "error", severity: "error", message: "Every workflow node and edge must be an object." }];
  }
  const maxNodes = limits.maxNodes ?? 100;
  const maxEdges = limits.maxEdges ?? 250;
  const maxBranches = limits.maxBranches ?? 25;
  const maxRetryAttempts = limits.maxNodeRetryAttempts ?? 3;
  const maxRetryBackoffMs = limits.maxNodeRetryBackoffMs ?? 30_000;
  const supportedToolCategories = new Set(limits.supportedToolCategories ?? ["function", "http"]);
  if (definition.nodes.length > maxNodes) add("error", "NODE_LIMIT_EXCEEDED", `Workflow exceeds the ${maxNodes}-node limit.`);
  if (definition.edges.length > maxEdges) add("error", "EDGE_LIMIT_EXCEEDED", `Workflow exceeds the ${maxEdges}-edge limit.`);
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const ids = new Set<string>(), edgeIds = new Set<string>(), edgeKeys = new Set<string>();
  for (const node of definition.nodes) {
    const nodeId = typeof node.id === "string" ? node.id : "";
    if (!IDENTIFIER.test(nodeId)) add("error", "INVALID_NODE_ID", "Node id must be 1-200 safe identifier characters.", nodeId);
    if (ids.has(node.id)) add("error", "DUPLICATE_NODE_ID", `Duplicate node id "${node.id}"`, node.id);
    ids.add(node.id);
    if (!NODE_TYPES.has(node.type)) add("error", "UNKNOWN_NODE_TYPE", `Unsupported node type "${String(node.type)}".`, node.id);
    if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) add("error", "INVALID_NODE_POSITION", "Node position must contain finite x/y coordinates.", node.id);
    if (!node.config || typeof node.config !== "object" || Array.isArray(node.config)) add("error", "INVALID_NODE_CONFIG", "Node configuration must be an object.", node.id);
    const retry = node.retryPolicy;
    if (retry) {
      if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > maxRetryAttempts) add("error", "INVALID_RETRY_ATTEMPTS", `Retry attempts must be between 1 and ${maxRetryAttempts}.`, node.id);
      if (!Number.isInteger(retry.backoffMs) || retry.backoffMs < 0 || retry.backoffMs > maxRetryBackoffMs) add("error", "INVALID_RETRY_BACKOFF", `Retry backoff must be between 0 and ${maxRetryBackoffMs} ms.`, node.id);
      if (retry.backoffMultiplier !== undefined && (!Number.isFinite(retry.backoffMultiplier) || retry.backoffMultiplier < 1 || retry.backoffMultiplier > 4)) add("error", "INVALID_RETRY_MULTIPLIER", "Retry multiplier must be between 1 and 4.", node.id);
    }
  }
  for (const edge of definition.edges) {
    const edgeId = typeof edge.id === "string" ? edge.id : "";
    const sourceId = typeof edge.source === "string" ? edge.source : "";
    const targetId = typeof edge.target === "string" ? edge.target : "";
    const branchKey = typeof edge.branchKey === "string" ? edge.branchKey : "";
    if (!IDENTIFIER.test(edgeId)) add("error", "INVALID_EDGE_ID", "Edge id must be 1-200 safe identifier characters.", undefined, edgeId);
    if (edgeIds.has(edge.id)) add("error", "DUPLICATE_EDGE_ID", `Duplicate edge id "${edge.id}"`, undefined, edge.id);
    edgeIds.add(edge.id);
    if (edge.kind !== "normal" && edge.kind !== "conditional") add("error", "INVALID_EDGE_KIND", "Edge kind must be normal or conditional.", undefined, edgeId);
    const edgeKey = `${sourceId}\u0000${targetId}\u0000${edge.kind}\u0000${branchKey}`;
    if (edgeKeys.has(edgeKey)) add("error", "DUPLICATE_EDGE", "Duplicate edge connection.", undefined, edgeId);
    edgeKeys.add(edgeKey);
    if (!nodes.has(sourceId)) add("error", "INVALID_EDGE_REFERENCE", `Edge references missing source node "${sourceId}"`, undefined, edgeId);
    if (!nodes.has(targetId)) add("error", "INVALID_EDGE_REFERENCE", `Edge references missing target node "${targetId}"`, undefined, edgeId);
    if (sourceId === targetId && sourceId) add("error", "UNSAFE_CYCLE", "Self-referential edges are not supported.", sourceId, edgeId);
    if (edge.kind === "conditional" && !branchKey.trim()) add("error", "MISSING_BRANCH_KEY", "Conditional edge is missing a branch key", undefined, edgeId);
    if (edge.kind !== "conditional" && branchKey.trim()) add("warning", "UNUSED_BRANCH_KEY", "Normal edges ignore branch keys.", undefined, edgeId);
    const source = nodes.get(sourceId), target = nodes.get(targetId);
    if (source && target && NODE_TYPES.has(source.type) && NODE_TYPES.has(target.type) && !CONNECTION_TARGETS[source.type].has(target.type)) {
      add("error", "INVALID_CONNECTION", `${source.type} nodes cannot connect to ${target.type} nodes.`, source.id, edgeId);
    }
    if (target?.type === "input") add("error", "INVALID_CONNECTION", "Input nodes cannot have incoming edges.", target.id, edgeId);
    if (source?.type === "output") add("error", "INVALID_CONNECTION", "Output nodes cannot have outgoing edges.", source.id, edgeId);
    if (source?.type === "condition" && edge.kind !== "conditional") add("error", "AMBIGUOUS_BRANCHING", "Condition nodes require conditional outgoing edges.", source.id, edgeId);
    if (edge.kind === "conditional" && source?.type !== "condition" && source?.type !== "approval") add("error", "INVALID_CONDITIONAL_SOURCE", "Conditional edges may only leave condition or approval nodes.", source?.id, edgeId);
  }
  const inputs = definition.nodes.filter((node) => node.type === "input");
  const outputs = definition.nodes.filter((node) => node.type === "output");
  if (inputs.length !== 1) add("error", "INVALID_INPUT_COUNT", `Workflow must have exactly one Input node (found ${inputs.length})`);
  if (outputs.length !== 1) add("error", "INVALID_OUTPUT_COUNT", `Workflow must have exactly one Output node (found ${outputs.length})`);
  for (const node of definition.nodes) {
    // Versioned node contracts are validated against the raw value so
    // malformed author input surfaces with stable codes instead of being
    // silently normalized away.
    for (const contractIssue of validateRawNodeContract(node.contract)) {
      add("error", contractIssue.code, contractIssue.field ? `${contractIssue.message} (${contractIssue.field})` : contractIssue.message, node.id);
    }
    // Dispatch to the node-type-specific validator from the registry.
    const validator = NODE_VALIDATORS[node.type];
    if (validator) {
      const ctx: ValidationContext = { add, definition, agents, tools, limits, maxBranches, supportedToolCategories };
      validator(node, ctx);
    }
    if (node.retryPolicy && node.type !== "agent" && node.type !== "tool") {
      add("error", "UNSAFE_NODE_RETRY", `Node type "${node.type}" is not retryable.`, node.id);
    }
  }
  const cycleNodes = detectCycles(definition, nodes, add);
  validateArchetype(definition, nodes, cycleNodes, add);
  return issues;
}

function detectCycles(
  definition: WorkflowDefinition,
  nodes: Map<string, WorkflowNode>,
  add: (level: WorkflowIssue["level"], code: string, message: string, nodeId?: string, edgeId?: string) => void
): Set<string> {
  const visiting = new Set<string>(), visited = new Set<string>();
  const cycleNodes = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) {
      cycleNodes.add(id);
      add("warning", "CYCLE_REQUIRES_GUARDRAIL", "Cycle will be bounded by the server recursion limit.", id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of definition.edges.filter(candidate => candidate.source === id && nodes.has(candidate.target))) walk(edge.target);
    visiting.delete(id); visited.add(id);
  };
  for (const node of definition.nodes) walk(node.id);
  return cycleNodes;
}

function validateArchetype(
  definition: WorkflowDefinition,
  nodes: Map<string, WorkflowNode>,
  cycleNodes: Set<string>,
  add: (level: WorkflowIssue["level"], code: string, message: string, nodeId?: string, edgeId?: string) => void
) {
  if (definition.archetype !== undefined && definition.archetype !== "linear-pipeline" && definition.archetype !== "hierarchical-supervisor") {
    add("error", "INVALID_ARCHETYPE", `Unknown workflow archetype "${String(definition.archetype)}". Allowed archetypes are "linear-pipeline" and "hierarchical-supervisor".`);
  }

  if (definition.archetypeConfig?.category !== undefined && definition.archetypeConfig.category !== "linear-pipeline" && definition.archetypeConfig.category !== "hierarchical-supervisor") {
    add("error", "INVALID_ARCHETYPE", `Unknown archetypeConfig category "${String(definition.archetypeConfig.category)}". Allowed categories are "linear-pipeline" and "hierarchical-supervisor".`);
  }

  // Linear pipeline constraints: acyclic DAG
  if (definition.archetype === "linear-pipeline" || definition.archetypeConfig?.category === "linear-pipeline") {
    if (cycleNodes.size > 0) {
      for (const nodeId of cycleNodes) {
        add("error", "LINEAR_PIPELINE_CYCLE_FORBIDDEN", `Linear pipeline workflows cannot contain cycles. Node "${nodeId}" is part of a cycle.`, nodeId);
      }
    }
  }

  // Hierarchical supervisor constraints
  if (definition.archetype === "hierarchical-supervisor" || definition.archetypeConfig?.category === "hierarchical-supervisor") {
    const hubId = definition.archetypeConfig?.supervisorHubNodeId;
    if (!hubId) {
      add("error", "MISSING_SUPERVISOR_HUB", "Hierarchical supervisor workflow requires 'supervisorHubNodeId' in archetypeConfig.");
    } else {
      const hubNode = nodes.get(hubId);
      if (!hubNode || hubNode.type !== "agent") {
        add("error", "INVALID_SUPERVISOR_HUB", `Supervisor hub node "${hubId}" must exist and be an agent node.`, hubId);
      }
    }

    const hasConditionNode = definition.nodes.some((n) => n.type === "condition");
    if (!hasConditionNode) {
      add("error", "MISSING_ROUTING_NODES", "Hierarchical supervisor workflow requires at least one condition routing node.");
    }

    const guards = definition.archetypeConfig?.recursionGuards;
    if (cycleNodes.size > 0 && (!guards || guards.length === 0)) {
      add("error", "UNGUARDED_CYCLE", "Hierarchical supervisor workflow contains cycles but has no recursion guards configured.");
    }

    if (guards && Array.isArray(guards)) {
      for (const guard of guards) {
        if (!guard.routeKey || typeof guard.routeKey !== "string" || !guard.routeKey.trim()) {
          add("error", "INVALID_RECURSION_GUARD", "Recursion guard must specify a valid routeKey.");
        }
        if (typeof guard.maxIterations !== "number" || !Number.isInteger(guard.maxIterations) || guard.maxIterations < 1 || guard.maxIterations > 10) {
          add("error", "INVALID_RECURSION_GUARD", `Recursion guard for route "${guard.routeKey ?? "unknown"}" has invalid maxIterations ${String(guard.maxIterations)}. Must be an integer between 1 and 10.`);
        }
        if (!guard.fallbackBranch || typeof guard.fallbackBranch !== "string" || !guard.fallbackBranch.trim()) {
          add("error", "INVALID_RECURSION_GUARD", `Recursion guard for route "${guard.routeKey ?? "unknown"}" must specify a fallbackBranch.`);
        }
      }
    }
  }
}

export function nodeLabel(node: WorkflowNode, agents: AgentRecord[]): string {
  if (node.type === "agent") {
    const agentId = (node.config as { agentId?: string | null }).agentId;
    return agents.find((agent) => agent.id === agentId)?.name ?? node.id;
  }
  return node.type;
}
