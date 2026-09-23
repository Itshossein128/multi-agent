/**
 * Canonical shared workflow and run domain models.
 *
 * This package is used by both web and server runtime so execution and UI
 * share the same contract for workflow definitions and event streams.
 */

export * from "./memory";
export * from "./toolConfiguration";
export * from "./approval";
import type { ToolRecord } from "./toolConfiguration";

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
    provider: "codex" | "claude-code" | "agy" | "cursor" | (string & {});
    model?: string;
    executable?: string;
    args?: string[];
  }
  | {
    type: "local";
    provider: "ollama" | "lmstudio" | (string & {});
    model: string;
    baseUrl?: string;
    settings?: AgentModelSettings;
  };

export type AgentBackendType = AgentBackend["type"];

export interface AgentModelSettings {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

/** Legacy run settings remain compatible; long-term memory is an optional separate subsystem. */
export interface AgentMemoryConfig {
  enabled: boolean;
  type: "run";
  scope: "agent" | "node";
  mode: "read" | "write" | "read_write";
  maxEntries: number;
  shortTerm?: { enabled: boolean; maxTokens?: number };
  longTerm?: import("./memory").LongTermMemoryConfig;
}

/** Per-agent execution constraints. CLI runtime combines these with server-owned allowlists. */
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
  ownerId?: string;
  tenantId?: string;
  isSystem?: boolean;
}

export type AgentDiagnosticStatus = "ready" | "unavailable" | "not_authenticated" | "misconfigured" | "unsupported" | "unknown";

/** Safe server-side capability status; never contains credentials or credential paths. */
export interface AgentDiagnostics {
  status: AgentDiagnosticStatus;
  checkedAt: string;
  backend: { type: AgentBackendType; provider: string; model?: string };
  message: string;
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
  /** References a ToolRecord in the tool registry — configuration lives there, shared across nodes. */
  toolId: string | null;
}

/** Legacy inline tool node shape (pre-registry). Detected during migration. */
export interface LegacyToolNodeConfig {
  toolId?: string;
  name?: string;
  description?: string;
  config?: Record<string, string | number | boolean>;
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
  /** Optional source for machine gates; the default preserves input-based routing. */
  valueSource?: "input" | "last_value";
  /** Optional field to read from the selected value, e.g. `status`. */
  valueField?: string;
}

export interface InputNodeConfig {
  inputKey: string;
  description: string;
}

export interface OutputNodeConfig {
  outputKey: string;
  description: string;
  /** Select the immediately preceding active path instead of joining all predecessors. */
  inputMode?: "last_value" | "join";
}

export type WorkflowNodeConfig =
  | AgentNodeConfig
  | ToolNodeConfig
  | ApprovalNodeConfig
  | MemoryNodeConfig
  | ConditionNodeConfig
  | InputNodeConfig
  | OutputNodeConfig;

/** Optional node-scoped retry request. The server clamps every value to its own limits. */
export interface NodeRetryPolicy {
  /** Total executions including the initial attempt. */
  maxAttempts: number;
  /** Delay before the second attempt. */
  backoffMs: number;
  /** Multiplier applied after each failed attempt. */
  backoffMultiplier?: number;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  /** Layout only — never part of node identity or configuration. */
  position: WorkflowPosition;
  config: WorkflowNodeConfig;
  retryPolicy?: NodeRetryPolicy;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  kind: WorkflowEdgeKind;
  label: string;
  /** Branch key for conditional edges leaving a condition/router node. */
  branchKey: string;
  /** Structured, non-secret edge data used by routers and future compiler passes. */
  metadata?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  updatedAt: string;
  ownerId?: string;
  tenantId?: string;
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
  options?: { agentId?: string; toolId?: string }
): WorkflowNode {
  let config: WorkflowNodeConfig;
  switch (type) {
    case "agent":
      config = { agentId: options?.agentId ?? null };
      break;
    case "tool":
      config = { toolId: options?.toolId ?? null };
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
  metadata?: Record<string, unknown>;
}

export function createEdge(input: CreateEdgeInput): WorkflowEdge {
  return {
    id: uid("edge"),
    source: input.source,
    target: input.target,
    kind: input.kind ?? "normal",
    label: input.label ?? "",
    branchKey: input.branchKey ?? "",
    ...(input.metadata ? { metadata: structuredCloneSafe(input.metadata) } : {}),
  };
}

/**
 * Return the workflow domain payload without React Flow-only fields.
 * Positions remain as layout metadata on domain nodes; execution is defined
 * exclusively by node types/configuration and edge endpoints.
 */
export function serializeWorkflowDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  if (!definition || typeof definition !== "object") throw new Error("Workflow definition must be an object.");
  if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    throw new Error("Workflow definition must contain nodes and edges arrays.");
  }
  return structuredCloneSafe({
    id: definition.id,
    name: definition.name,
    nodes: definition.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      config: node.config,
      ...(node.retryPolicy ? { retryPolicy: node.retryPolicy } : {}),
    })),
    edges: definition.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.label,
      branchKey: edge.branchKey,
      ...(edge.metadata ? { metadata: edge.metadata } : {}),
    })),
    updatedAt: definition.updatedAt,
    ...(definition.ownerId ? { ownerId: definition.ownerId } : {}),
    ...(definition.tenantId ? { tenantId: definition.tenantId } : {}),
  });
}

/**
 * Normalize a persisted workflow back into the domain model. The legacy edge
 * `type` field is accepted during migration, but never emitted by serialization.
 */
export function deserializeWorkflowDefinition(raw: unknown): WorkflowDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Workflow definition must be an object.");
  }
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("Workflow definition must contain nodes and edges arrays.");
  }
  const definition = {
    ...value,
    nodes: value.nodes.map((rawNode) => {
      const node = (rawNode ?? {}) as Record<string, unknown>;
      const position = (node.position ?? {}) as Record<string, unknown>;
      return {
        ...node,
        id: typeof node.id === "string" ? node.id : "",
        type: node.type,
        position: {
          x: typeof position.x === "number" && Number.isFinite(position.x) ? position.x : 0,
          y: typeof position.y === "number" && Number.isFinite(position.y) ? position.y : 0,
        },
        config: node.config && typeof node.config === "object" && !Array.isArray(node.config) ? node.config : {},
      };
    }),
    edges: value.edges.map((rawEdge) => {
      const edge = (rawEdge ?? {}) as Record<string, unknown>;
      return {
        ...edge,
        kind: edge.kind ?? edge.type ?? "normal",
        label: typeof edge.label === "string" ? edge.label : "",
        branchKey: typeof edge.branchKey === "string" ? edge.branchKey : "",
      };
    }),
  } as WorkflowDefinition;
  return serializeWorkflowDefinition(definition);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

export function createSingleAgentWorkflow(agent: AgentRecord, name = "Single Agent Task Workflow"): WorkflowDefinition {
  const inputNode = createNode("input", { x: 100, y: 100 });
  const agentNode = createNode("agent", { x: 300, y: 100 }, { agentId: agent.id });
  const outputNode = createNode("output", { x: 500, y: 100 });
  const edge1 = createEdge({ source: inputNode.id, target: agentNode.id });
  const edge2 = createEdge({ source: agentNode.id, target: outputNode.id });
  return {
    id: uid("wf-task"),
    name,
    nodes: [inputNode, agentNode, outputNode],
    edges: [edge1, edge2],
    updatedAt: nowIso(),
  };
}

export function nodeConfig<T extends WorkflowNodeConfig>(node: WorkflowNode): T {
  return node.config as T;
}

/** Remove only this tool's node instances and their incident edges. */
export function removeToolNodes(workflow: WorkflowDefinition, toolId: string): WorkflowDefinition {
  const removed = new Set(workflow.nodes.filter((node) => node.type === "tool" && (node.config as ToolNodeConfig).toolId === toolId).map((node) => node.id));
  return { ...workflow, nodes: workflow.nodes.filter((node) => !removed.has(node.id)), edges: workflow.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)) };
}

/**
 * Upgrade legacy inline tool nodes (`{ toolId, name, description, config }`) into
 * registry references, synthesizing a ToolRecord per unique legacy node when one
 * isn't already present in `tools`. Idempotent — nodes already in the new
 * `{ toolId }` shape are left untouched.
 */
export function migrateWorkflowToolNodes(
  definition: WorkflowDefinition,
  tools: ToolRecord[]
): { definition: WorkflowDefinition; newTools: ToolRecord[] } {
  const known = new Set(tools.map((tool) => tool.id));
  const newTools: ToolRecord[] = [];
  const nodes = definition.nodes.map((node) => {
    if (node.type !== "tool") return node;
    const config = node.config as ToolNodeConfig & LegacyToolNodeConfig;
    const isLegacy = "name" in config || "description" in config || "config" in config;
    if (!isLegacy && (config.toolId === null || (typeof config.toolId === "string" && known.has(config.toolId)))) return node;
    const stamp = nowIso();
    const id = typeof config.toolId === "string" && config.toolId && !known.has(config.toolId) ? config.toolId : uid("tool");
    const record: ToolRecord = {
      id,
      name: typeof config.name === "string" && config.name.trim() ? config.name : "Migrated Tool",
      description: typeof config.description === "string" ? config.description : "",
      category: "function",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      configuration: config.config && typeof config.config === "object" ? config.config : {},
      enabled: true,
      impact: "read-only",
      metadata: {},
      createdAt: stamp,
      updatedAt: stamp,
    };
    known.add(id);
    newTools.push(record);
    return { ...node, config: { toolId: id } };
  });
  return { definition: { ...definition, nodes }, newTools };
}

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_for_human";

export type RunEventType =
  | "run.created"
  | "run.started"
  | "run.paused"
  | "run.resumed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "branch.cancelled"
  | "branch.skipped"
  | "node.started"
  | "node.completed"
  | "node.failed"
  | "node.retrying"
  | "edge.traversed"
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "llm.started"
  | "llm.completed"
  | "llm.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "human_approval.requested"
  | "human_approval.approved"
  | "human_approval.rejected"
  | "human_approval.resolved"
  | "state.updated"
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
  ownerId?: string;
  tenantId?: string;
}

export interface RunCreateRequest {
  workflow: WorkflowDefinition;
  agents: AgentRecord[];
  tools?: ToolRecord[];
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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

export type Phase2TaskStatus =
  | "backlog"
  | "ready"
  | "queued"
  | "running"
  | "blocked"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "cancelled";

export type LegacyTaskStatus =
  | "todo"
  | "planning"
  | "in_progress"
  | "waiting_tool"
  | "review"
  | "done";

export type TaskStatus = Phase2TaskStatus | LegacyTaskStatus;

export type TaskPriority = "high" | "medium" | "low";

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedAgent: string | null;
  assignedAgents: string[];
  workflowId?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  parentTaskId?: string | null;
  dependencies: string[];
  runId?: string | null;
  output: string | null;
  lastError?: string | null;
  retryCount: number;
  paused: boolean;
  metadata: Record<string, unknown>;
  ownerId?: string;
  tenantId?: string;
}

export const LEGACY_TO_CANONICAL_STATUS: Record<LegacyTaskStatus, Phase2TaskStatus> = {
  todo: "backlog",
  planning: "ready",
  in_progress: "running",
  waiting_tool: "blocked",
  review: "waiting_for_human",
  done: "completed",
};

export function toCanonicalStatus(status: TaskStatus): Phase2TaskStatus {
  if (status in LEGACY_TO_CANONICAL_STATUS) {
    return LEGACY_TO_CANONICAL_STATUS[status as LegacyTaskStatus];
  }
  return status as Phase2TaskStatus;
}

export const CANONICAL_STATUS_TRANSITIONS: Record<Phase2TaskStatus, Phase2TaskStatus[]> = {
  backlog: ["ready", "queued", "running", "cancelled"],
  ready: ["backlog", "queued", "running", "cancelled"],
  queued: ["running", "ready", "cancelled"],
  running: ["blocked", "waiting_for_human", "completed", "failed", "cancelled", "ready"],
  blocked: ["running", "ready", "failed", "cancelled"],
  waiting_for_human: ["running", "completed", "failed", "cancelled"],
  completed: ["ready", "backlog"],
  failed: ["ready", "queued", "running", "backlog"],
  cancelled: ["ready", "backlog"],
};

export const DEP_GATED_CANONICAL_STATUSES: Phase2TaskStatus[] = [
  "queued",
  "running",
  "waiting_for_human",
  "completed",
];

export function canTransitionStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  const canonicalFrom = toCanonicalStatus(from);
  const canonicalTo = toCanonicalStatus(to);
  if (canonicalFrom === canonicalTo) return true;
  return (CANONICAL_STATUS_TRANSITIONS[canonicalFrom] ?? []).includes(canonicalTo);
}

export function isStatusDependencyGated(status: TaskStatus): boolean {
  return DEP_GATED_CANONICAL_STATUSES.includes(toCanonicalStatus(status));
}

export function isCompletedStatus(status: TaskStatus): boolean {
  return toCanonicalStatus(status) === "completed";
}
