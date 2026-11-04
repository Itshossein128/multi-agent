/**
 * Contract sketch: Independent Agent Step Configuration (013).
 * Not imported by production code — documents shapes for implementers and tests.
 */

export type AgentExecutionMode = "single_turn" | "react";

export interface AgentModelSettings {
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

/** Persisted on WorkflowNode.config when type === "agent". */
export interface AgentNodeConfigContract {
  agentId: string | null;
  mutatesCode?: boolean;
  role?: string;
  executionMode?: AgentExecutionMode;
  maxToolSteps?: number;
  /** Additive step guidance; omit/blank ⇒ legacy behavior. */
  taskInstruction?: string;
  /**
   * Partial overrides. Absent keys inherit from base agent backend.settings.
   * Explicit 0 is a value. Cleared keys must be removed from the object.
   */
  modelSettingsOverride?: Partial<AgentModelSettings>;
  /**
   * undefined ⇒ inherit agent.tools ∩ usable registry tools
   * [] ⇒ no tools
   * nonempty ⇒ subset of allowed∩usable (else invalid)
   */
  activeTools?: string[];
}

export interface StepConfigIssue {
  code:
    | "INVALID_AGENT_NODE_TASK_INSTRUCTION"
    | "INVALID_AGENT_NODE_MODEL_OVERRIDE"
    | "UNSUPPORTED_STEP_MODEL_OVERRIDE"
    | "INVALID_AGENT_NODE_ACTIVE_TOOLS"
    | "UNSUPPORTED_STEP_ACTIVE_TOOLS"
    | "INCOMPATIBLE_STEP_CONFIG_FOR_AGENT"
    | "MISSING_AGENT_CONFIG"
    | "AGENT_DISABLED"
    | string;
  message: string;
  path?: string;
}

export interface EffectiveAgentStepConfigContract {
  agentId: string;
  taskInstruction?: string;
  modelSettings: AgentModelSettings;
  toolIds: string[];
  executionMode: AgentExecutionMode;
  maxToolSteps: number;
  incompatibilities: StepConfigIssue[];
}

/**
 * Conceptual resolve signature (implemented in packages/types).
 * MUST be pure: no mutation of the provided agent record.
 */
export type ResolveEffectiveAgentStepConfig = (input: {
  agent: {
    id: string;
    tools: string[];
    enabled?: boolean;
    executionMode?: AgentExecutionMode;
    maxToolSteps?: number;
    backend: { type: string; settings?: AgentModelSettings; provider?: string; model?: string };
    systemPrompt: string;
  };
  nodeConfig: AgentNodeConfigContract;
  /** Registry tools visible for this resolve (tenant/project slice). */
  registryTools: Array<{ id: string; enabled?: boolean }>;
}) => EffectiveAgentStepConfigContract;

/**
 * Runtime input fields the compiler must populate for agent nodes.
 * Trusted server composition only.
 */
export interface AgentExecutionStepFields {
  taskInstruction?: string;
  modelSettingsOverride?: Partial<AgentModelSettings>;
  /** resolvedTools already filtered to effective step tools */
  nodeExecutionMode?: AgentExecutionMode;
  nodeMaxToolSteps?: number;
}

/** UI surface obligations for AgentForm. */
export interface AgentNodePropertiesPanelContract {
  updatesNodeConfigOnly: true;
  mustNotCallUpdateAgentRecord: true;
  showsBaseAgentSelector: true;
  showsReadOnlyBaseSummary: true;
  showsStepInstructions: true;
  showsModelInheritOverrideClear: true;
  showsActiveToolsInheritEmptySubset: true;
  showsNodeExecutionModeAndMaxToolSteps: true;
  editAgentInRegistryIsExplicit: true;
  editAgentInRegistryWarnsSharedImpact: true;
}
