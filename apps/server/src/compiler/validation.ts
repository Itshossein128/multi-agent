import type { AgentRecord, ToolCategory, ToolRecord, WorkflowDefinition, WorkflowNode, WorkflowNodeType } from "@multi-agent/types";
import { agentHasConfiguredModel, validateAgent, validateTool } from "@multi-agent/types";

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
    if (node.type === "agent") {
      const agentId = (node.config as { agentId?: string | null }).agentId;
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) add("error", "MISSING_AGENT_CONFIG", "Agent node is not linked to an agent", node.id);
      else if (!agentHasConfiguredModel(agent)) {
        const detail =
          agent.backend.type === "cli"
            ? "has no CLI provider configured"
            : "has no model configured";
        add("error", "MISSING_AGENT_MODEL", `Agent "${agent.name}" ${detail}`, node.id);
      }
      if (agent?.enabled === false) add("error", "AGENT_DISABLED", `Agent "${agent.name}" is disabled`, node.id);
      if (agent) for (const message of validateAgent(agent)) add("error", "INVALID_AGENT_CONFIG", message, node.id);
      if (agent) for (const toolId of Array.isArray(agent.tools) ? agent.tools : []) {
        const assigned = tools.find((tool) => tool.id === toolId);
        if (!assigned) add("error", "UNKNOWN_AGENT_TOOL", `Agent "${agent.name}" references missing tool "${toolId}".`, node.id);
        else if (!assigned.enabled) add("error", "DISABLED_AGENT_TOOL", `Agent "${agent.name}" references disabled tool "${toolId}".`, node.id);
      }
      if (node.retryPolicy && (!agent || agent.backend.type === "cli" || (Array.isArray(agent.tools) && agent.tools.length > 0))) {
        add("error", "UNSAFE_NODE_RETRY", "Agent retries require a non-CLI agent with no assigned side-effecting tools.", node.id);
      }
    }
    if (node.type === "tool") {
      const toolId = (node.config as { toolId?: string | null }).toolId;
      const tool = tools.find(candidate => candidate.id === toolId);
      if (!toolId?.trim()) add("error", "MISSING_TOOL_CONFIG", "Tool node is not linked to a tool.", node.id);
      else if (!tool) add("error", "UNKNOWN_TOOL", "Tool node references a missing tool.", node.id);
      else if (tool.enabled === false) add("error", "DISABLED_TOOL", "Tool node references a disabled tool.", node.id);
      if (tool) for (const message of validateTool(tool)) add("error", "INVALID_TOOL_CONFIG", message, node.id);
      if (tool && !supportedToolCategories.has(tool.category)) add("error", "UNSUPPORTED_TOOL_CATEGORY", `Tool category "${tool.category}" is not executable by this server.`, node.id);
      if (tool && tool.impact !== "read-only" && limits.allowToolSideEffects !== true) add("error", "TOOL_IMPACT_DENIED", `Tool impact "${tool.impact}" is disabled by server policy.`, node.id);
      if (node.retryPolicy && (!tool || tool.impact !== "read-only" || tool.metadata?.idempotent !== true)) {
        add("error", "UNSAFE_NODE_RETRY", "Tool retries require an explicitly idempotent, read-only tool.", node.id);
      }
    }
    if (node.type === "memory") {
      const config = node.config as { key?: string; mode?: string; memoryType?: string };
      if (typeof config.key !== "string" || !config.key.trim()) add("error", "MISSING_MEMORY_KEY", "Memory node has no memory key", node.id);
      if (!['read', 'write', 'read_write'].includes(config.mode ?? "")) add("error", "INVALID_MEMORY_MODE", "Memory node has an invalid mode.", node.id);
      if (!['short_term', 'long_term', 'shared'].includes(config.memoryType ?? "")) add("error", "INVALID_MEMORY_TYPE", "Memory node has an invalid type.", node.id);
    }
    if (node.type === "approval") {
      const config = node.config as { message?: string; approvalType?: string; timeoutSeconds?: number };
      if (typeof config.message !== "string" || !config.message.trim()) add("error", "MISSING_APPROVAL_MESSAGE", "Approval node requires a message.", node.id);
      if (!['manual', 'timeout'].includes(config.approvalType ?? "")) add("error", "INVALID_APPROVAL_TYPE", "Approval node has an invalid type.", node.id);
      if (!Number.isFinite(config.timeoutSeconds) || config.timeoutSeconds! < 0 || config.timeoutSeconds! > 86_400) add("error", "INVALID_APPROVAL_TIMEOUT", "Approval timeout must be between 0 and 86400 seconds.", node.id);
      const outgoing = definition.edges.filter((edge) => edge.source === node.id);
      for (const edge of outgoing) {
        if (edge.kind === "conditional" && edge.branchKey !== "approved" && edge.branchKey !== "rejected") add("error", "INVALID_APPROVAL_BRANCH", "Approval branches must be named approved or rejected.", node.id, edge.id);
      }
    }
    if (node.type === "condition") {
      const rawBranches = (node.config as { branches?: unknown }).branches;
      const branches = Array.isArray(rawBranches) ? rawBranches.filter((branch): branch is { key: string } => Boolean(branch && typeof branch === "object")) : [];
      const keys = new Set(branches.map((branch) => branch.key));
      if (!branches.length) add("error", "MISSING_CONDITION_BRANCHES", "Condition node requires at least one branch.", node.id);
      if (branches.length > maxBranches) add("error", "BRANCH_LIMIT_EXCEEDED", `Condition node exceeds the ${maxBranches}-branch limit.`, node.id);
      if (branches.some(branch => typeof branch.key !== "string" || !branch.key.trim())) add("error", "INVALID_BRANCH_KEY", "Condition node has an empty branch key.", node.id);
      if (keys.size !== branches.length) add("error", "DUPLICATE_BRANCH_KEY", "Condition node has duplicate branch keys", node.id);
      for (const edge of definition.edges.filter((candidate) => candidate.source === node.id && candidate.kind === "conditional")) {
        if (!keys.has(edge.branchKey)) add("error", "INVALID_CONDITIONAL_BRANCH", `Edge branch "${edge.branchKey}" is not defined on the Condition node`, node.id, edge.id);
      }
      for (const branch of branches) if (!definition.edges.some(edge => edge.source === node.id && edge.kind === "conditional" && edge.branchKey === branch.key)) add("warning", "UNCONNECTED_BRANCH", `Condition branch "${branch.key}" has no outgoing edge.`, node.id);
    }
    if (node.type === "input") {
      const config = node.config as { inputKey?: string; description?: string };
      if (typeof config.inputKey !== "string" || !config.inputKey.trim() || config.inputKey.length > 200) add("error", "INVALID_INPUT_KEY", "Input node requires a key of at most 200 characters.", node.id);
      if (typeof config.description !== "string" || config.description.length > 2_000) add("error", "INVALID_INPUT_DESCRIPTION", "Input description must be at most 2000 characters.", node.id);
    }
    if (node.type === "output") {
      const config = node.config as { outputKey?: string; description?: string };
      if (typeof config.outputKey !== "string" || !config.outputKey.trim() || config.outputKey.length > 200) add("error", "INVALID_OUTPUT_KEY", "Output node requires a key of at most 200 characters.", node.id);
      if (typeof config.description !== "string" || config.description.length > 2_000) add("error", "INVALID_OUTPUT_DESCRIPTION", "Output description must be at most 2000 characters.", node.id);
    }
    if (node.retryPolicy && node.type !== "agent" && node.type !== "tool") {
      add("error", "UNSAFE_NODE_RETRY", `Node type "${node.type}" is not retryable.`, node.id);
    }
  }
  detectCycles(definition, nodes, add);
  return issues;
}

function detectCycles(definition: WorkflowDefinition, nodes: Map<string, WorkflowNode>, add: (level: WorkflowIssue["level"], code: string, message: string, nodeId?: string, edgeId?: string) => void) {
  const visiting = new Set<string>(), visited = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) { add("warning", "CYCLE_REQUIRES_GUARDRAIL", "Cycle will be bounded by the server recursion limit.", id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of definition.edges.filter(candidate => candidate.source === id && nodes.has(candidate.target))) walk(edge.target);
    visiting.delete(id); visited.add(id);
  };
  for (const node of definition.nodes) walk(node.id);
}

export function nodeLabel(node: WorkflowNode, agents: AgentRecord[]): string {
  if (node.type === "agent") {
    const agentId = (node.config as { agentId?: string | null }).agentId;
    return agents.find((agent) => agent.id === agentId)?.name ?? node.id;
  }
  return node.type;
}
