import type { AgentRecord, ToolRecord, WorkflowDefinition, WorkflowNode, WorkflowNodeType } from "@multi-agent/types";
import { agentHasConfiguredModel, validateAgent, validateTool } from "@multi-agent/types";
import type { WorkflowIssue, WorkflowValidationLimits } from "./validation";

export interface ValidationContext {
  add(level: WorkflowIssue["level"], code: string, message: string, nodeId?: string, edgeId?: string): void;
  definition: WorkflowDefinition;
  agents: AgentRecord[];
  tools: ToolRecord[];
  limits: WorkflowValidationLimits;
  maxBranches: number;
  supportedToolCategories: Set<string>;
}

export type NodeValidator = (node: WorkflowNode, ctx: ValidationContext) => void;

function validateAgentNode(node: WorkflowNode, ctx: ValidationContext) {
  const agentId = (node.config as { agentId?: string | null }).agentId;
  const agent = ctx.agents.find((candidate) => candidate.id === agentId);
  if (!agent) ctx.add("error", "MISSING_AGENT_CONFIG", "Agent node is not linked to an agent", node.id);
  else if (!agentHasConfiguredModel(agent)) {
    const detail = agent.backend.type === "cli" ? "has no CLI provider configured" : "has no model configured";
    ctx.add("error", "MISSING_AGENT_MODEL", `Agent "${agent.name}" ${detail}`, node.id);
  }
  if (agent?.enabled === false) ctx.add("error", "AGENT_DISABLED", `Agent "${agent.name}" is disabled`, node.id);
  if (agent) for (const message of validateAgent(agent)) ctx.add("error", "INVALID_AGENT_CONFIG", message, node.id);
  if (agent) for (const toolId of Array.isArray(agent.tools) ? agent.tools : []) {
    const assigned = ctx.tools.find((tool) => tool.id === toolId);
    if (!assigned) ctx.add("error", "UNKNOWN_AGENT_TOOL", `Agent "${agent.name}" references missing tool "${toolId}".`, node.id);
    else if (!assigned.enabled) ctx.add("error", "DISABLED_AGENT_TOOL", `Agent "${agent.name}" references disabled tool "${toolId}".`, node.id);
  }
  if (node.retryPolicy && (!agent || agent.backend.type === "cli" || (Array.isArray(agent.tools) && agent.tools.length > 0))) {
    ctx.add("error", "UNSAFE_NODE_RETRY", "Agent retries require a non-CLI agent with no assigned side-effecting tools.", node.id);
  }
}

function validateToolNode(node: WorkflowNode, ctx: ValidationContext) {
  const toolId = (node.config as { toolId?: string | null }).toolId;
  const tool = ctx.tools.find(candidate => candidate.id === toolId);
  if (!toolId?.trim()) ctx.add("error", "MISSING_TOOL_CONFIG", "Tool node is not linked to a tool.", node.id);
  else if (!tool) ctx.add("error", "UNKNOWN_TOOL", "Tool node references a missing tool.", node.id);
  else if (tool.enabled === false) ctx.add("error", "DISABLED_TOOL", "Tool node references a disabled tool.", node.id);
  if (tool) for (const message of validateTool(tool)) ctx.add("error", "INVALID_TOOL_CONFIG", message, node.id);
  if (tool && !ctx.supportedToolCategories.has(tool.category)) ctx.add("error", "UNSUPPORTED_TOOL_CATEGORY", `Tool category "${tool.category}" is not executable by this server.`, node.id);
  if (tool && tool.impact !== "read-only" && ctx.limits.allowToolSideEffects !== true) ctx.add("error", "TOOL_IMPACT_DENIED", `Tool impact "${tool.impact}" is disabled by server policy.`, node.id);
  if (node.retryPolicy && (!tool || tool.impact !== "read-only" || tool.metadata?.idempotent !== true)) {
    ctx.add("error", "UNSAFE_NODE_RETRY", "Tool retries require an explicitly idempotent, read-only tool.", node.id);
  }
}

function validateMemoryNode(node: WorkflowNode, ctx: ValidationContext) {
  const config = node.config as { key?: string; mode?: string; memoryType?: string };
  if (typeof config.key !== "string" || !config.key.trim()) ctx.add("error", "MISSING_MEMORY_KEY", "Memory node has no memory key", node.id);
  if (!['read', 'write', 'read_write'].includes(config.mode ?? "")) ctx.add("error", "INVALID_MEMORY_MODE", "Memory node has an invalid mode.", node.id);
  if (!['short_term', 'long_term', 'shared'].includes(config.memoryType ?? "")) ctx.add("error", "INVALID_MEMORY_TYPE", "Memory node has an invalid type.", node.id);
}

function validateApprovalNode(node: WorkflowNode, ctx: ValidationContext) {
  const config = node.config as { message?: string; approvalType?: string; timeoutSeconds?: number };
  if (typeof config.message !== "string" || !config.message.trim()) ctx.add("error", "MISSING_APPROVAL_MESSAGE", "Approval node requires a message.", node.id);
  if (!['manual', 'timeout'].includes(config.approvalType ?? "")) ctx.add("error", "INVALID_APPROVAL_TYPE", "Approval node has an invalid type.", node.id);
  if (!Number.isFinite(config.timeoutSeconds) || config.timeoutSeconds! < 0 || config.timeoutSeconds! > 86_400) ctx.add("error", "INVALID_APPROVAL_TIMEOUT", "Approval timeout must be between 0 and 86400 seconds.", node.id);
  const outgoing = ctx.definition.edges.filter((edge) => edge.source === node.id);
  for (const edge of outgoing) {
    if (edge.kind === "conditional" && edge.branchKey !== "approved" && edge.branchKey !== "rejected") ctx.add("error", "INVALID_APPROVAL_BRANCH", "Approval branches must be named approved or rejected.", node.id, edge.id);
  }
}

function validateConditionNode(node: WorkflowNode, ctx: ValidationContext) {
  const conditionConfig = node.config as { valueSource?: unknown; valueField?: unknown; unknownRoute?: unknown; errorRoute?: unknown };
  if (conditionConfig.valueSource !== undefined && !["input", "last_value"].includes(String(conditionConfig.valueSource))) ctx.add("error", "INVALID_CONDITION_SOURCE", "Condition valueSource must be input or last_value.", node.id);
  if (conditionConfig.valueField !== undefined && (typeof conditionConfig.valueField !== "string" || !conditionConfig.valueField.trim() || conditionConfig.valueField.length > 100)) ctx.add("error", "INVALID_CONDITION_FIELD", "Condition valueField must be a non-empty field name of at most 100 characters.", node.id);
  const rawBranches = (node.config as { branches?: unknown }).branches;
  const branches = Array.isArray(rawBranches) ? rawBranches.filter((branch): branch is { key: string } => Boolean(branch && typeof branch === "object")) : [];
  const keys = new Set(branches.map((branch) => branch.key));
  if (!branches.length) ctx.add("error", "MISSING_CONDITION_BRANCHES", "Condition node requires at least one branch.", node.id);
  if (branches.length > ctx.maxBranches) ctx.add("error", "BRANCH_LIMIT_EXCEEDED", `Condition node exceeds the ${ctx.maxBranches}-branch limit.`, node.id);
  if (branches.some(branch => typeof branch.key !== "string" || !branch.key.trim())) ctx.add("error", "INVALID_BRANCH_KEY", "Condition node has an empty branch key.", node.id);
  if (keys.size !== branches.length) ctx.add("error", "DUPLICATE_BRANCH_KEY", "Condition node has duplicate branch keys", node.id);
  // Case-insensitive collisions make case-insensitive routing ambiguous, so
  // they are rejected rather than left to fail closed at runtime.
  const lowered = new Map<string, string[]>();
  for (const branch of branches) {
    if (typeof branch.key !== "string" || !branch.key.trim()) continue;
    const lower = branch.key.trim().toLowerCase();
    lowered.set(lower, [...(lowered.get(lower) ?? []), branch.key]);
  }
  for (const [, duplicates] of lowered) {
    if (duplicates.length > 1) ctx.add("error", "AMBIGUOUS_BRANCH_KEY", `Condition branch keys ${duplicates.map((key) => `"${key}"`).join(", ")} collide case-insensitively.`, node.id);
  }
  for (const [field, code, label] of [["unknownRoute", "INVALID_UNKNOWN_ROUTE", "unknown"], ["errorRoute", "INVALID_ERROR_ROUTE", "error"]] as const) {
    const route = conditionConfig[field];
    if (route === undefined || route === null) continue;
    if (typeof route !== "string" || !route.trim() || !keys.has(route)) {
      ctx.add("error", code, `Condition ${label}Route must name one of the declared branches.`, node.id);
    } else if (!ctx.definition.edges.some(edge => edge.source === node.id && edge.kind === "conditional" && edge.branchKey === route)) {
      ctx.add("error", code, `Condition ${label}Route must have an outgoing conditional edge.`, node.id);
    }
  }
  for (const edge of ctx.definition.edges.filter((candidate) => candidate.source === node.id && candidate.kind === "conditional")) {
    if (!keys.has(edge.branchKey)) ctx.add("error", "INVALID_CONDITIONAL_BRANCH", `Edge branch "${edge.branchKey}" is not defined on the Condition node`, node.id, edge.id);
  }
  for (const branch of branches) if (!ctx.definition.edges.some(edge => edge.source === node.id && edge.kind === "conditional" && edge.branchKey === branch.key)) ctx.add("warning", "UNCONNECTED_BRANCH", `Condition branch "${branch.key}" has no outgoing edge.`, node.id);
}

function validateInputNode(node: WorkflowNode, ctx: ValidationContext) {
  const config = node.config as { inputKey?: string; description?: string };
  if (typeof config.inputKey !== "string" || !config.inputKey.trim() || config.inputKey.length > 200) ctx.add("error", "INVALID_INPUT_KEY", "Input node requires a key of at most 200 characters.", node.id);
  if (typeof config.description !== "string" || config.description.length > 2_000) ctx.add("error", "INVALID_INPUT_DESCRIPTION", "Input description must be at most 2000 characters.", node.id);
}

function validateOutputNode(node: WorkflowNode, ctx: ValidationContext) {
  const config = node.config as { outputKey?: string; description?: string; inputMode?: "last_value" | "join" };
  if (typeof config.outputKey !== "string" || !config.outputKey.trim() || config.outputKey.length > 200) ctx.add("error", "INVALID_OUTPUT_KEY", "Output node requires a key of at most 200 characters.", node.id);
  if (typeof config.description !== "string" || config.description.length > 2_000) ctx.add("error", "INVALID_OUTPUT_DESCRIPTION", "Output description must be at most 2000 characters.", node.id);
  if (config.inputMode !== undefined && config.inputMode !== "last_value" && config.inputMode !== "join") ctx.add("error", "INVALID_OUTPUT_INPUT_MODE", "Output inputMode must be last_value or join.", node.id);
}

/**
 * Registry of per-node-type validators. To add validation for a new node type,
 * simply register a new entry here — no need to modify validateWorkflow.
 */
export const NODE_VALIDATORS: Record<WorkflowNodeType, NodeValidator> = {
  agent: validateAgentNode,
  tool: validateToolNode,
  memory: validateMemoryNode,
  approval: validateApprovalNode,
  condition: validateConditionNode,
  input: validateInputNode,
  output: validateOutputNode,
};
