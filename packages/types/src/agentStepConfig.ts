/**
 * Pure resolve/validate for per-node agent step configuration.
 * Never mutates the shared AgentRecord.
 */

import type {
  AgentExecutionMode,
  AgentModelSettings,
  AgentNodeConfig,
  AgentNodeInputMode,
  AgentRecord,
  AgentResumePromptMode,
  AgentSessionMode,
  ToolRecord,
} from "./index";
import { modelSettingsSchema } from "./agentConfiguration";

export const INVALID_AGENT_NODE_TASK_INSTRUCTION = "INVALID_AGENT_NODE_TASK_INSTRUCTION" as const;
export const INVALID_AGENT_NODE_MODEL_OVERRIDE = "INVALID_AGENT_NODE_MODEL_OVERRIDE" as const;
export const UNSUPPORTED_STEP_MODEL_OVERRIDE = "UNSUPPORTED_STEP_MODEL_OVERRIDE" as const;
export const INVALID_AGENT_NODE_ACTIVE_TOOLS = "INVALID_AGENT_NODE_ACTIVE_TOOLS" as const;
export const UNSUPPORTED_STEP_ACTIVE_TOOLS = "UNSUPPORTED_STEP_ACTIVE_TOOLS" as const;
export const INCOMPATIBLE_STEP_CONFIG_FOR_AGENT = "INCOMPATIBLE_STEP_CONFIG_FOR_AGENT" as const;
export const INVALID_AGENT_NODE_SESSION_MODE = "INVALID_AGENT_NODE_SESSION_MODE" as const;
export const INVALID_AGENT_NODE_SESSION_KEY = "INVALID_AGENT_NODE_SESSION_KEY" as const;
export const INVALID_AGENT_NODE_RESUME_PROMPT_MODE = "INVALID_AGENT_NODE_RESUME_PROMPT_MODE" as const;
export const INVALID_AGENT_NODE_INPUT_MODE = "INVALID_AGENT_NODE_INPUT_MODE" as const;

export type StepConfigIssueCode =
  | typeof INVALID_AGENT_NODE_TASK_INSTRUCTION
  | typeof INVALID_AGENT_NODE_MODEL_OVERRIDE
  | typeof UNSUPPORTED_STEP_MODEL_OVERRIDE
  | typeof INVALID_AGENT_NODE_ACTIVE_TOOLS
  | typeof UNSUPPORTED_STEP_ACTIVE_TOOLS
  | typeof INCOMPATIBLE_STEP_CONFIG_FOR_AGENT
  | typeof INVALID_AGENT_NODE_SESSION_MODE
  | typeof INVALID_AGENT_NODE_SESSION_KEY
  | typeof INVALID_AGENT_NODE_RESUME_PROMPT_MODE
  | typeof INVALID_AGENT_NODE_INPUT_MODE
  | "MISSING_AGENT_CONFIG"
  | "AGENT_DISABLED"
  | string;

export interface StepConfigIssue {
  code: StepConfigIssueCode;
  message: string;
  path?: string;
}

export interface EffectiveAgentStepConfig {
  agentId: string;
  taskInstruction?: string;
  modelSettings: AgentModelSettings;
  toolIds: string[];
  tools: ToolRecord[];
  executionMode: AgentExecutionMode;
  maxToolSteps: number;
  sessionMode: AgentSessionMode;
  sessionKey?: string;
  resumePromptMode: AgentResumePromptMode;
  inputMode: AgentNodeInputMode;
  incompatibilities: StepConfigIssue[];
}

export interface ResolveEffectiveAgentStepConfigInput {
  agent: AgentRecord;
  nodeConfig: AgentNodeConfig;
  /** Registry tools visible for this resolve (tenant/project slice). */
  registryTools: Array<Pick<ToolRecord, "id"> & { enabled?: boolean }>;
}

/** Backends that can apply modelSettingsOverride. */
function supportsModelSettingsOverride(backendType: string): boolean {
  return backendType === "api" || backendType === "local";
}

/**
 * Backends that can enforce activeTools via ToolRuntime tool loop.
 * Local does not currently participate in ToolRuntime ReAct binding.
 */
function supportsActiveTools(backendType: string): boolean {
  return backendType === "api";
}

function normalizeExecutionMode(mode: unknown): AgentExecutionMode | undefined {
  return mode === "single_turn" || mode === "react" ? mode : undefined;
}

function resolveModeAndSteps(input: {
  toolIds: readonly string[];
  agentMode?: AgentExecutionMode | string;
  agentMaxToolSteps?: number;
  nodeMode?: AgentExecutionMode | string;
  nodeMaxToolSteps?: number;
}): { executionMode: AgentExecutionMode; maxToolSteps: number } {
  const executionMode =
    normalizeExecutionMode(input.nodeMode) ??
    normalizeExecutionMode(input.agentMode) ??
    (input.toolIds.length > 0 ? "react" : "single_turn");
  const raw = input.nodeMaxToolSteps ?? input.agentMaxToolSteps ?? 5;
  const maxToolSteps = Math.min(10, Math.max(1, Math.trunc(Number(raw)) || 5));
  return { executionMode, maxToolSteps };
}

function trimTaskInstruction(value: unknown): { instruction?: string; issue?: StepConfigIssue } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") {
    return {
      issue: {
        code: INVALID_AGENT_NODE_TASK_INSTRUCTION,
        message: "taskInstruction must be a string.",
        path: "taskInstruction",
      },
    };
  }
  const trimmed = value.trim();
  return trimmed ? { instruction: trimmed } : {};
}

function definedOverrideKeys(
  override: Partial<AgentModelSettings> | undefined
): Partial<AgentModelSettings> {
  if (!override || typeof override !== "object" || Array.isArray(override)) return {};
  const out: Partial<AgentModelSettings> = {};
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function validateMergedModelSettings(
  agent: AgentRecord,
  override: Partial<AgentModelSettings> | undefined,
  issues: StepConfigIssue[],
  asIncompatibility = false
): AgentModelSettings {
  const backend = agent.backend;
  const hasOverrideObject = override !== undefined && override !== null;
  const defined = definedOverrideKeys(hasOverrideObject ? override : undefined);

  if (!supportsModelSettingsOverride(backend.type)) {
    // Any present modelSettingsOverride (including `{}`) is rejected on unsupported backends.
    if (hasOverrideObject) {
      issues.push({
        code: asIncompatibility ? INCOMPATIBLE_STEP_CONFIG_FOR_AGENT : UNSUPPORTED_STEP_MODEL_OVERRIDE,
        message: `modelSettingsOverride is not supported for backend type "${backend.type}".`,
        path: "modelSettingsOverride",
      });
    }
    return {};
  }

  const baseSettings =
    (backend.type === "api" || backend.type === "local") && backend.settings
      ? { ...backend.settings }
      : {};
  const effective: AgentModelSettings = { ...baseSettings, ...defined };

  if (!hasOverrideObject) {
    return effective;
  }

  const fields = modelSettingsSchema(backend);
  const code = asIncompatibility ? INCOMPATIBLE_STEP_CONFIG_FOR_AGENT : INVALID_AGENT_NODE_MODEL_OVERRIDE;

  for (const [key, value] of Object.entries(defined)) {
    if (key === "reasoningEffort") {
      if (
        backend.type !== "api" ||
        backend.provider.toLowerCase() !== "openai" ||
        !["low", "medium", "high"].includes(String(value))
      ) {
        issues.push({
          code,
          message: "Invalid or unsupported model setting override: reasoningEffort.",
          path: `modelSettingsOverride.reasoningEffort`,
        });
      }
      continue;
    }
    const schema = fields.find((field) => field.key === key);
    if (
      !schema ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < schema.min ||
      value > schema.max ||
      (schema.step === 1 && !Number.isInteger(value))
    ) {
      issues.push({
        code,
        message: `Invalid or unsupported model setting override: ${key}.`,
        path: `modelSettingsOverride.${key}`,
      });
    }
  }

  if (
    backend.type === "api" &&
    backend.provider.toLowerCase() === "anthropic" &&
    effective.temperature !== undefined &&
    effective.topP !== undefined
  ) {
    issues.push({
      code,
      message: "Choose temperature or Top P for Anthropic, not both (effective merged settings).",
      path: "modelSettingsOverride",
    });
  }

  return effective;
}

function resolveToolIds(
  agent: AgentRecord,
  nodeConfig: AgentNodeConfig,
  registryTools: Array<{ id: string; enabled?: boolean }>,
  issues: StepConfigIssue[],
  asIncompatibility = false
): { toolIds: string[]; tools: ToolRecord[] } {
  const byId = new Map(registryTools.map((tool) => [tool.id, tool]));
  const allowedIds: string[] = [];
  const allowedTools: ToolRecord[] = [];
  for (const toolId of agent.tools ?? []) {
    const tool = byId.get(toolId);
    if (tool && tool.enabled !== false) {
      allowedIds.push(toolId);
      allowedTools.push(tool as ToolRecord);
    }
  }

  const activeTools = nodeConfig.activeTools;

  if (activeTools !== undefined && !supportsActiveTools(agent.backend.type)) {
    issues.push({
      code: asIncompatibility ? INCOMPATIBLE_STEP_CONFIG_FOR_AGENT : UNSUPPORTED_STEP_ACTIVE_TOOLS,
      message: `activeTools is not supported for backend type "${agent.backend.type}".`,
      path: "activeTools",
    });
    // Still compute inherit for diagnostics; incompatibilities block runs.
    return { toolIds: [...allowedIds], tools: [...allowedTools] };
  }

  if (activeTools === undefined) {
    return { toolIds: [...allowedIds], tools: [...allowedTools] };
  }

  if (!Array.isArray(activeTools) || activeTools.some((id) => typeof id !== "string" || !id.trim())) {
    issues.push({
      code: asIncompatibility ? INCOMPATIBLE_STEP_CONFIG_FOR_AGENT : INVALID_AGENT_NODE_ACTIVE_TOOLS,
      message: "activeTools must be an array of nonempty strings.",
      path: "activeTools",
    });
    return { toolIds: [], tools: [] };
  }

  if (activeTools.length === 0) {
    return { toolIds: [], tools: [] };
  }

  const allowedSet = new Set(allowedIds);
  const toolIds: string[] = [];
  const tools: ToolRecord[] = [];
  for (let i = 0; i < activeTools.length; i++) {
    const id = activeTools[i];
    if (!allowedSet.has(id)) {
      issues.push({
        code: asIncompatibility ? INCOMPATIBLE_STEP_CONFIG_FOR_AGENT : INVALID_AGENT_NODE_ACTIVE_TOOLS,
        message: `activeTools contains tool "${id}" that is not in the base agent's allowed usable tools.`,
        path: `activeTools[${i}]`,
      });
      continue;
    }
    if (!toolIds.includes(id)) {
      toolIds.push(id);
      const tool = byId.get(id);
      if (tool) tools.push(tool as ToolRecord);
    }
  }

  return { toolIds, tools };
}

/**
 * Pure effective step-config resolution. Allocates new objects only;
 * never assigns into the shared AgentRecord.
 */
export function resolveEffectiveAgentStepConfig(
  input: ResolveEffectiveAgentStepConfigInput
): EffectiveAgentStepConfig {
  const { agent, nodeConfig, registryTools } = input;
  const incompatibilities: StepConfigIssue[] = [];

  if (!nodeConfig.agentId || agent.id !== nodeConfig.agentId) {
    // Caller may still pass agent when agentId is set; missing agent is usually handled upstream.
  }

  if (agent.enabled === false) {
    incompatibilities.push({
      code: "AGENT_DISABLED",
      message: `Agent "${agent.name}" is disabled.`,
    });
  }

  const { instruction, issue: instructionIssue } = trimTaskInstruction(nodeConfig.taskInstruction);
  if (instructionIssue) incompatibilities.push(instructionIssue);

  const modelSettings = validateMergedModelSettings(
    agent,
    nodeConfig.modelSettingsOverride,
    incompatibilities,
    true
  );

  const { toolIds, tools } = resolveToolIds(agent, nodeConfig, registryTools, incompatibilities, true);

  const { executionMode, maxToolSteps } = resolveModeAndSteps({
    toolIds,
    agentMode: agent.executionMode,
    agentMaxToolSteps: agent.maxToolSteps,
    nodeMode: nodeConfig.executionMode,
    nodeMaxToolSteps: nodeConfig.maxToolSteps,
  });

  const sessionConfig = validateSessionAndInputConfig(nodeConfig, incompatibilities);

  return {
    agentId: agent.id,
    ...(instruction ? { taskInstruction: instruction } : {}),
    modelSettings,
    toolIds,
    tools,
    executionMode,
    maxToolSteps,
    sessionMode: sessionConfig.sessionMode,
    ...(sessionConfig.sessionKey ? { sessionKey: sessionConfig.sessionKey } : {}),
    resumePromptMode: sessionConfig.resumePromptMode,
    inputMode: sessionConfig.inputMode,
    incompatibilities,
  };
}

const SESSION_KEY_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function validateSessionAndInputConfig(
  nodeConfig: AgentNodeConfig,
  issues: StepConfigIssue[]
): {
  sessionMode: AgentSessionMode;
  sessionKey?: string;
  resumePromptMode: AgentResumePromptMode;
  inputMode: AgentNodeInputMode;
} {
  let sessionMode: AgentSessionMode = "stateless";
  if (nodeConfig.sessionMode !== undefined) {
    if (
      nodeConfig.sessionMode === "stateless" ||
      nodeConfig.sessionMode === "node" ||
      nodeConfig.sessionMode === "shared"
    ) {
      sessionMode = nodeConfig.sessionMode;
    } else {
      issues.push({
        code: INVALID_AGENT_NODE_SESSION_MODE,
        message: 'Agent node sessionMode must be "stateless", "node", or "shared".',
        path: "sessionMode",
      });
    }
  }

  let sessionKey: string | undefined;
  if (nodeConfig.sessionKey !== undefined) {
    if (typeof nodeConfig.sessionKey !== "string" || !SESSION_KEY_IDENTIFIER.test(nodeConfig.sessionKey.trim())) {
      issues.push({
        code: INVALID_AGENT_NODE_SESSION_KEY,
        message: "Agent node sessionKey must be 1-120 safe identifier characters.",
        path: "sessionKey",
      });
    } else {
      sessionKey = nodeConfig.sessionKey.trim();
    }
  }
  if (sessionMode === "shared" && !sessionKey) {
    issues.push({
      code: INVALID_AGENT_NODE_SESSION_KEY,
      message: 'Agent node sessionKey is required when sessionMode is "shared".',
      path: "sessionKey",
    });
  }

  let resumePromptMode: AgentResumePromptMode = "delta";
  if (nodeConfig.resumePromptMode !== undefined) {
    if (nodeConfig.resumePromptMode === "delta" || nodeConfig.resumePromptMode === "full") {
      resumePromptMode = nodeConfig.resumePromptMode;
    } else {
      issues.push({
        code: INVALID_AGENT_NODE_RESUME_PROMPT_MODE,
        message: 'Agent node resumePromptMode must be "delta" or "full".',
        path: "resumePromptMode",
      });
    }
  }

  let inputMode: AgentNodeInputMode = "auto";
  if (nodeConfig.inputMode !== undefined) {
    if (nodeConfig.inputMode === "auto" || nodeConfig.inputMode === "last_value") {
      inputMode = nodeConfig.inputMode;
    } else {
      issues.push({
        code: INVALID_AGENT_NODE_INPUT_MODE,
        message: 'Agent node inputMode must be "auto" or "last_value".',
        path: "inputMode",
      });
    }
  }

  return { sessionMode, sessionKey, resumePromptMode, inputMode };
}

/**
 * Structured validation for web + server validators.
 * Returns issues without throwing. Does not mutate agent.
 */
export function validateAgentNodeStepConfig(input: ResolveEffectiveAgentStepConfigInput): StepConfigIssue[] {
  const { agent, nodeConfig, registryTools } = input;
  const issues: StepConfigIssue[] = [];

  const { issue: instructionIssue } = trimTaskInstruction(nodeConfig.taskInstruction);
  if (instructionIssue) issues.push(instructionIssue);

  // Model override: use validation codes (not incompatibility) for design-time.
  validateMergedModelSettings(agent, nodeConfig.modelSettingsOverride, issues, false);

  // Tools: use validation codes.
  resolveToolIds(agent, nodeConfig, registryTools, issues, false);

  // Session continuation & input mode validation.
  validateSessionAndInputConfig(nodeConfig, issues);

  // Surface incompatibilities that matter after agent switch (same checks).
  // When overrides are present but invalid for this agent/backend, also emit
  // INCOMPATIBLE when the combination fails subset/support — validate already
  // emits the specific codes above; callers may map them.

  return issues;
}
