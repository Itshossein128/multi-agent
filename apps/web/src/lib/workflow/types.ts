/**
 * Workflow domain model for the visual multi-agent programming editor.
 *
 * This is the *domain representation* of a workflow — deliberately
 * independent of React Flow's internal data structures. React Flow is the
 * editor/view layer only; this definition is what will be serialized to
 * the backend and compiled into a LangGraph StateGraph.
 */

export type WorkflowNodeType =
  | "agent"
  | "tool"
  | "approval"
  | "memory"
  | "condition"
  | "input"
  | "output";

export type WorkflowEdgeKind = "normal" | "conditional";

/** Agent identity/configuration — persisted separately from graph layout. */
export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
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
  position: { x: number; y: number };
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

export interface WorkflowPosition {
  x: number;
  y: number;
}

/**
 * The serializable workflow definition. The backend will transform this
 * into a LangGraph StateGraph:
 *
 *   React Flow Graph Editor → Workflow Definition → Backend API
 *     → Workflow Compiler → LangGraph StateGraph → Execution
 */
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
  return (WORKFLOW_NODE_TYPES as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createAgentRecord(input?: { name?: string; model?: string }): AgentRecord {
  const stamp = nowIso();
  return {
    id: uid("agent"),
    name: input?.name ?? "New Agent",
    description: "",
    model: input?.model ?? "gpt-4o",
    systemPrompt: "",
    tools: [],
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

/** Resolve the config of a node for a known type (narrowing helper). */
export function nodeConfig<T extends WorkflowNodeConfig>(node: WorkflowNode): T {
  return node.config as T;
}
