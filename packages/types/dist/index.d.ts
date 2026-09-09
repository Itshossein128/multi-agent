/**
 * Canonical shared workflow and run domain models.
 *
 * This package is used by both web and server runtime so execution and UI
 * share the same contract for workflow definitions and event streams.
 */
export * from "./memory";
export * from "./toolConfiguration";
import type { ToolRecord } from "./toolConfiguration";
export type WorkflowNodeType = "agent" | "tool" | "approval" | "memory" | "condition" | "input" | "output";
export type WorkflowPosition = {
    x: number;
    y: number;
};
export type WorkflowEdgeKind = "normal" | "conditional";
/**
 * How an agent executes. LangGraph orchestrates agents; this describes the
 * runtime behind each agent (API providers, CLI agents, or local models).
 */
export type AgentBackend = {
    type: "api";
    /** Extensible provider id — openai, anthropic, google, gemini, etc. */
    provider: string;
    model: string;
    settings?: AgentModelSettings;
} | {
    type: "cli";
    provider: "codex" | "claude-code" | "agy" | (string & {});
    model?: string;
    executable?: string;
    args?: string[];
} | {
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
/** Legacy run settings remain compatible; long-term memory is an optional separate subsystem. */
export interface AgentMemoryConfig {
    enabled: boolean;
    type: "run";
    scope: "agent" | "node";
    mode: "read" | "write" | "read_write";
    maxEntries: number;
    shortTerm?: {
        enabled: boolean;
        maxTokens?: number;
    };
    longTerm?: import("./memory").LongTermMemoryConfig;
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
export declare function createApiBackend(provider?: string, model?: string): AgentBackend;
/** Human-readable model/provider label for UI chips and validation messages. */
export declare function agentBackendLabel(backend: AgentBackend): string;
export declare function agentRequiresModel(backend: AgentBackend): boolean;
export declare function agentHasConfiguredModel(agent: AgentRecord): boolean;
/**
 * Normalize persisted / inbound agent records to the current schema.
 * Migrates `{ model, provider? }` → `{ backend: { type: "api", ... } }`.
 */
export declare function migrateAgentRecord(raw: unknown): AgentRecord;
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
}
export interface InputNodeConfig {
    inputKey: string;
    description: string;
}
export interface OutputNodeConfig {
    outputKey: string;
    description: string;
}
export type WorkflowNodeConfig = AgentNodeConfig | ToolNodeConfig | ApprovalNodeConfig | MemoryNodeConfig | ConditionNodeConfig | InputNodeConfig | OutputNodeConfig;
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
export declare const NODE_TYPE_META: Record<WorkflowNodeType, WorkflowNodeMeta>;
export declare const WORKFLOW_NODE_TYPES: WorkflowNodeType[];
export declare function isWorkflowNodeType(value: string): value is WorkflowNodeType;
export declare function uid(prefix: string): string;
export declare function nowIso(): string;
export declare function createAgentRecord(input?: {
    name?: string;
    model?: string;
    provider?: string;
    backend?: AgentBackend;
}): AgentRecord;
export declare function createNode(type: WorkflowNodeType, position: WorkflowPosition, options?: {
    agentId?: string;
    toolId?: string;
}): WorkflowNode;
export interface CreateEdgeInput {
    source: string;
    target: string;
    kind?: WorkflowEdgeKind;
    label?: string;
    branchKey?: string;
}
export declare function createEdge(input: CreateEdgeInput): WorkflowEdge;
export declare function createEmptyDefinition(name?: string): WorkflowDefinition;
export declare function nodeConfig<T extends WorkflowNodeConfig>(node: WorkflowNode): T;
/** Remove only this tool's node instances and their incident edges. */
export declare function removeToolNodes(workflow: WorkflowDefinition, toolId: string): WorkflowDefinition;
/**
 * Upgrade legacy inline tool nodes (`{ toolId, name, description, config }`) into
 * registry references, synthesizing a ToolRecord per unique legacy node when one
 * isn't already present in `tools`. Idempotent — nodes already in the new
 * `{ toolId }` shape are left untouched.
 */
export declare function migrateWorkflowToolNodes(definition: WorkflowDefinition, tools: ToolRecord[]): {
    definition: WorkflowDefinition;
    newTools: ToolRecord[];
};
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "waiting_for_human";
export type RunEventType = "run.started" | "run.completed" | "run.failed" | "node.started" | "node.completed" | "node.failed" | "edge.traversed" | "agent.started" | "agent.completed" | "agent.failed" | "tool.started" | "tool.completed" | "tool.failed" | "human_approval.requested" | "human_approval.resolved" | "memory.read" | "memory.write" | "log";
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
export interface AgentTestRequest {
    agent: AgentRecord;
    input: Record<string, unknown>;
}
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
