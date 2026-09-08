/**
 * Canonical shared workflow and run domain models.
 *
 * This package is used by both web and server runtime so execution and UI
 * share the same contract for workflow definitions and event streams.
 */

export type WorkflowNodeType =
  | "agent"
  | "tool"
  | "approval"
  | "memory"
  | "condition"
  | "input"
  | "output";

export type WorkflowPosition = { x: number; y: number };

export type WorkflowEdgeKind = "normal" | "conditional";

/**
 * How an agent executes. LangGraph orchestrates agents; this describes the
 * runtime behind each agent (API providers, CLI agents, or local models).
 */
export type AgentBackend =
  | {
    type: "api";
    /** Extensible provider id — openai, anthropic, google, gemini, etc. */
    provider: string;
    model: string;
    settings?: AgentModelSettings;
  }
  | {
    type: "cli";
    provider: "codex" | "claude-code" | "agy" | (string & {});
    model?: string;
    executable?: string;
    args?: string[];
  }
  | {
    type: "local";
    provider: "ollama" | "lmstudio" | (string & {});
    model: string;
    baseUrl?: string;
  };

export type AgentBackendType = AgentBackend["type"];

export interface AgentModelSettings {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

/** Bounded conversation memory, isolated to a run; persistence belongs to Phase 8. */
export interface AgentMemoryConfig {
  enabled: boolean;
  type: "run";
  scope: "agent" | "node";
  mode: "read" | "write" | "read_write";
  maxEntries: number;
}

/** Future CLI/local execution constraints — not fully enforced yet. */
export interface AgentExecutionPolicy {
  filesystem?: "none" | "read" | "read-write";
  shell?: "disabled" | "restricted" | "full";
  network?: boolean;
  workspaceRoot?: string;
  allowedCommands?: string[];
}

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  backend: AgentBackend;
  systemPrompt: string;
  tools: string[];
  enabled?: boolean;
  memory?: AgentMemoryConfig;
  executionPolicy?: AgentExecutionPolicy;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

/** Legacy persisted agent shape (pre-backend abstraction). */
export interface LegacyAgentRecord {
  id: string;
  name: string;
  description?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  tools?: string[];
  enabled?: boolean;
  memory?: AgentMemoryConfig;
  metadata?: Record<string, string | number | boolean>;
  createdAt?: string;
  updatedAt?: string;
  backend?: AgentBackend;
  executionPolicy?: AgentExecutionPolicy;
}

export function createApiBackend(provider = "openai", model = "gpt-4o"): AgentBackend {
  return { type: "api", provider, model };
}

/** Human-readable model/provider label for UI chips and validation messages. */
export function agentBackendLabel(backend: AgentBackend): string {
  if (backend.type === "cli") {
    return backend.model ? `${backend.provider}:${backend.model}` : backend.provider;
  }
  if (backend.type === "local") {
    return `${backend.provider}/${backend.model}`;
  }
  return backend.model || backend.provider;
}

export function agentRequiresModel(backend: AgentBackend): boolean {
  return backend.type === "api" || backend.type === "local";
}

export function agentHasConfiguredModel(agent: AgentRecord): boolean {
  if (agent.backend.type === "cli") {
    return Boolean(agent.backend.provider.trim());
  }
  return Boolean(agent.backend.model.trim());
}

function inferApiProvider(model: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim().toLowerCase();
  const lower = model.toLowerCase();
  if (lower.includes("claude")) return "anthropic";
  if (lower.includes("gemini")) return "google";
  if (lower.startsWith("gpt") || lower.includes("o1") || lower.includes("o3")) return "openai";
  return "openai";
}

/**
 * Normalize persisted / inbound agent records to the current schema.
 * Migrates `{ model, provider? }` → `{ backend: { type: "api", ... } }`.
 */
export function migrateAgentRecord(raw: unknown): AgentRecord {
  const record = (raw ?? {}) as LegacyAgentRecord;
  const stamp = nowIso();
  let backend = record.backend;
  if (!backend || typeof backend !== "object" || !("type" in backend)) {
    const model =
      typeof record.model === "string" && record.model.trim()
        ? record.model.trim()
        : "gpt-4o";
    const metaProvider =
      typeof record.metadata?.provider === "string" ? String(record.metadata.provider) : undefined;
    backend = createApiBackend(inferApiProvider(model, record.provider ?? metaProvider), model);
  }

  return {
    id: typeof record.id === "string" && record.id ? record.id : uid("agent"),
    name: typeof record.name === "string" && record.name.trim() ? record.name : "New Agent",
    description: typeof record.description === "string" ? record.description : "",
    backend,
    systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : "",
    tools: Array.isArray(record.tools) ? record.tools.filter((t): t is string => typeof t === "string") : [],
    executionPolicy: record.executionPolicy,
    enabled: record.enabled !== false,
    memory: record.memory,
    metadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata
        : {},
    createdAt: typeof record.createdAt === "string" ? record.createdAt : stamp,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : stamp,
  };
}

export interface AgentNodeConfig {
  agentId: string | null;
}

export interface ToolNodeConfig {
  toolId: string;
  name: string;
  description: string;
  config: Record<string, string | number | boolean>;
}

export interface ApprovalNodeConfig {
  message: string;
  approvalType: "manual" | "timeout";
  timeoutSeconds: number;
}

export interface MemoryNodeConfig {
  memoryType: "short_term" | "long_term" | "shared";
  mode: "read" | "write" | "read_write";
  key: string;
}

export interface ConditionBranch {
  key: string;
  label: string;
}

export interface ConditionNodeConfig {
  branches: ConditionBranch[];
}

export interface InputNodeConfig {
  inputKey: string;
  description: string;
}

export interface OutputNodeConfig {
  outputKey: string;
  description: string;
}

export type WorkflowNodeConfig =
  | AgentNodeConfig
  | ToolNodeConfig
  | ApprovalNodeConfig
  | MemoryNodeConfig
  | ConditionNodeConfig
  | InputNodeConfig
  | OutputNodeConfig;

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  /** Layout only — never part of node identity or configuration. */
  position: WorkflowPosition;
  config: WorkflowNodeConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  kind: WorkflowEdgeKind;
  label: string;
  /** Branch key for conditional edges leaving a condition/router node. */
  branchKey: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  updatedAt: string;
}

export interface WorkflowNodeMeta {
  label: string;
  description: string;
  iconBg: string;
  iconText: string;
  border: string;
  borderSelected: string;
  chipBg: string;
}

export const NODE_TYPE_META: Record<WorkflowNodeType, WorkflowNodeMeta> = {
  agent: {
    label: "Agent",
    description: "AI agent with model, prompt, and tools",
    iconBg: "bg-indigo-500/15",
    iconText: "text-indigo-300",
    border: "border-indigo-500/30",
    borderSelected: "border-indigo-400",
    chipBg: "bg-indigo-950/50",
  },
  tool: {
    label: "Tool",
    description: "Executable tool / function call",
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-300",
    border: "border-amber-500/30",
    borderSelected: "border-amber-400",
    chipBg: "bg-amber-950/50",
  },
  approval: {
    label: "Approval",
    description: "Pause and wait for human approval",
    iconBg: "bg-cyan-500/15",
    iconText: "text-cyan-300",
    border: "border-cyan-500/30",
    borderSelected: "border-cyan-400",
    chipBg: "bg-cyan-950/50",
  },
  memory: {
    label: "Memory",
    description: "Read / write workflow memory",
    iconBg: "bg-purple-500/15",
    iconText: "text-purple-300",
    border: "border-purple-500/30",
    borderSelected: "border-purple-400",
    chipBg: "bg-purple-950/50",
  },
  condition: {
    label: "Condition",
    description: "Router with conditional branches",
    iconBg: "bg-orange-500/15",
    iconText: "text-orange-300",
    border: "border-orange-500/30",
    borderSelected: "border-orange-400",
    chipBg: "bg-orange-950/50",
  },
  input: {
    label: "Input",
    description: "Workflow entry point",
    iconBg: "bg-emerald-500/15",
    iconText: "text-emerald-300",
    border: "border-emerald-500/30",
    borderSelected: "border-emerald-400",
    chipBg: "bg-emerald-950/50",
  },
  output: {
    label: "Output",
    description: "Workflow exit point",
    iconBg: "bg-blue-500/15",
    iconText: "text-blue-300",
    border: "border-blue-500/30",
    borderSelected: "border-blue-400",
    chipBg: "bg-blue-950/50",
  },
};

export const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = [
  "agent",
  "tool",
  "condition",
  "approval",
  "memory",
  "input",
  "output",
];

export function isWorkflowNodeType(value: string): value is WorkflowNodeType {
  return (WORKFLOW_NODE_TYPES as readonly string[]).includes(value);
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createAgentRecord(input?: {
  name?: string;
  model?: string;
  provider?: string;
  backend?: AgentBackend;
}): AgentRecord {
  const stamp = nowIso();
  const backend =
    input?.backend ??
    createApiBackend(input?.provider ?? "openai", input?.model ?? "gpt-4o");
  return {
    id: uid("agent"),
    name: input?.name ?? "New Agent",
    description: "",
    backend,
    systemPrompt: "",
    tools: [],
    enabled: true,
    metadata: {},
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function createNode(
  type: WorkflowNodeType,
  position: WorkflowPosition,
  options?: { agentId?: string }
): WorkflowNode {
  let config: WorkflowNodeConfig;
  switch (type) {
    case "agent":
      config = { agentId: options?.agentId ?? null };
      break;
    case "tool":
      config = { toolId: uid("tool"), name: "New Tool", description: "", config: {} };
      break;
    case "approval":
      config = { message: "Approve to continue?", approvalType: "manual", timeoutSeconds: 300 };
      break;
    case "memory":
      config = { memoryType: "short_term", mode: "read_write", key: "" };
      break;
    case "condition":
      config = {
        branches: [
          { key: "yes", label: "Yes" },
          { key: "no", label: "No" },
        ],
      };
      break;
    case "input":
      config = { inputKey: "input", description: "" };
      break;
    case "output":
      config = { outputKey: "output", description: "" };
      break;
  }

  return {
    id: uid(type),
    type,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    config,
  };
}

export interface CreateEdgeInput {
  source: string;
  target: string;
  kind?: WorkflowEdgeKind;
  label?: string;
  branchKey?: string;
}

export function createEdge(input: CreateEdgeInput): WorkflowEdge {
  return {
    id: uid("edge"),
    source: input.source,
    target: input.target,
    kind: input.kind ?? "normal",
    label: input.label ?? "",
    branchKey: input.branchKey ?? "",
  };
}

export function createEmptyDefinition(name?: string): WorkflowDefinition {
  return {
    id: uid("wf"),
    name: name ?? "Untitled Workflow",
    nodes: [],
    edges: [],
    updatedAt: nowIso(),
  };
}

export function nodeConfig<T extends WorkflowNodeConfig>(node: WorkflowNode): T {
  return node.config as T;
}

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_for_human";

export type RunEventType =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "node.started"
  | "node.completed"
  | "node.failed"
  | "edge.traversed"
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "human_approval.requested"
  | "human_approval.resolved"
  | "memory.read"
  | "memory.write"
  | "log";

export interface Run {
  id: string;
  workflowId: string;
  taskId?: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  currentNodeId?: string;
  metadata: Record<string, unknown>;
}

export interface RunCreateRequest {
  workflow: WorkflowDefinition;
  agents: AgentRecord[];
  input?: Record<string, unknown>;
  taskId?: string;
}

export interface RunCreateResponse {
  runId: string;
}

export interface AgentTestRequest { agent: AgentRecord; input: Record<string, unknown> }

export { assertNoCredentials, credentialIssues, validateAgent, modelSettingsSchema, API_PROVIDER_SCHEMAS, removeAgentNodes } from "./agentConfiguration";

export interface RunEvent {
  id: string;
  runId: string;
  type: RunEventType;
  timestamp: string;
  nodeId?: string;
  agentId?: string;
  toolId?: string;
  parentEventId?: string;
  sequence: number;
  payload: Record<string, unknown>;
}
