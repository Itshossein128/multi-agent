import type {
  AgentExecutionMode,
  AgentModelSettings,
  AgentRecord,
  AgentResumePromptMode,
  AgentSessionMode,
  AgentSessionState,
  ToolRecord,
} from "@multi-agent/types";
import type { MemoryAccessContext } from "../../memory/contracts";
import type { ShortTermHistories } from "./shortTermMemory";
import type { TrustedCredentialPrincipal } from "./workerCredentials";
import type { AssembledContext } from "./contextAssembler";
import type { AgentHandoff } from "./handoff";
import type { WorkingMemoryEntries } from "./workingMemory";
import type { ToolRuntime } from "../../tools/toolRuntime";

export type AgentExecutionEventType =
  | "agent.started"
  | "agent.output"
  | "agent.completed"
  | "agent.failed"
  | "llm.started"
  | "llm.completed"
  | "llm.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "memory.read"
  | "memory.write"
  | "log";

export interface AgentExecutionEvent {
  type: AgentExecutionEventType;
  timestamp: string;
  payload?: unknown;
  agentId?: string;
  nodeId?: string;
  runId?: string;
}

export interface AgentExecutionInput {
  agent: AgentRecord;
  input: unknown;
  runId: string;
  nodeId: string;
  workflowId?: string;
  context?: Record<string, unknown>;
  /** Server-owned, non-secret workflow state exposed as structured context. */
  runtimeState?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Trusted server composition only; configuration is never an authorization grant. */
  memoryAccess?: MemoryAccessContext;
  /** Trusted server composition only; never derive this from workflow/agent configuration. */
  credentialPrincipal?: TrustedCredentialPrincipal;
  shortTermHistories?: ShortTermHistories;
  onShortTermUpdate?: (update: ShortTermHistories) => void;
  /**
   * Untrusted working-memory candidates extracted from the agent output. The
   * runtime strips the channel from the output before it reaches history,
   * long-term extraction or node values, so this is the only delivery path.
   */
  onWorkingMemoryUpdate?: (updates: unknown[]) => void;
  /** Background events only. The owner maps/appends these to the existing RunStore,
   * including after the execution iterable and run have completed. Never replay them. */
  onBackgroundEvent?: (event: AgentExecutionEvent) => void | Promise<void>;
  memoryStore?: Map<string, { input: unknown; output: unknown }[]>;
  /** Pre-assembled context from ContextAssembler. If provided, executors consume this directly. */
  assembledContext?: AssembledContext;
  /** Structured handoffs from predecessor nodes. Keyed by source nodeId. */
  handoffs?: Record<string, AgentHandoff>;
  /**
   * Run-scoped structured working memory from checkpointed state. Read-only for
   * executors: ContextAssembler selects the entries this agent may see.
   */
  workingMemory?: WorkingMemoryEntries;
  /**
   * Trusted server composition only — ToolRuntime execute boundary.
   * Never treat client config as an authorization grant.
   */
  toolRuntime?: Pick<ToolRuntime, "execute">;
  /**
   * Trusted server composition only — tools already filtered to
   * effective step tools (agent.tools ∩ registry ∩ enabled ∩ activeTools).
   */
  resolvedTools?: ToolRecord[];
  /** Node-level executionMode override (wins over agent). */
  nodeExecutionMode?: AgentExecutionMode;
  /** Node-level maxToolSteps override (wins over agent; clamped at resolve). */
  nodeMaxToolSteps?: number;
  /**
   * Additive step task instruction from AgentNodeConfig.
   * Trusted server composition only — delivered without mutating AgentRecord.systemPrompt.
   */
  taskInstruction?: string;
  /**
   * Partial model settings override from AgentNodeConfig.
   * Applied ephemerally at model construction; never written back to the registry.
   */
  modelSettingsOverride?: Partial<AgentModelSettings>;
  /**
   * When set (including `[]`), the step explicitly restricted tools via `activeTools`.
   * Omitted means inherit — empty `resolvedTools` with assigned agent tools then fails closed in ReAct.
   */
  activeTools?: string[];
  /** Session continuation mode ("stateless" | "node" | "shared"). */
  sessionMode?: AgentSessionMode;
  /** Shared session key across workflow nodes (when sessionMode === "shared"). */
  sessionKey?: string;
  /** Prompt composition strategy when resuming an existing CLI session. */
  resumePromptMode?: AgentResumePromptMode;
  /** Prior session state from workflow checkpoint when continuing an active session. */
  resumeSession?: AgentSessionState;
  /** Callback invoked when a provider/CLI session starts or continues. */
  onSessionUpdate?: (session: AgentSessionState) => void;
}

/**
 * Backend-agnostic agent execution contract.
 * LangGraph nodes delegate here; provider/CLI details stay behind implementations.
 */
export interface AgentExecutor {
  execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
