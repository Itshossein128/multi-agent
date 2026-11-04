/**
 * Effective ReAct settings: node → agent → derived defaults.
 * Clamp maxToolSteps to the integer range [1, 10] (default 5).
 *
 * Callers that apply step `activeTools` MUST pass the **effective** tool id list
 * as `agentTools` so derived mode reflects the step (empty effective tools ⇒
 * default `single_turn` when neither node nor agent sets an explicit mode).
 */

export type AgentExecutionMode = "single_turn" | "react";

export interface EffectiveReactSettings {
  mode: AgentExecutionMode;
  /** Clamped to [1, 10]. */
  maxToolSteps: number;
}

/** Stable failure code when the tool-round ceiling is exhausted. */
export const AGENT_TOOL_LIMIT_EXCEEDED = "AGENT_TOOL_LIMIT_EXCEEDED" as const;

export function clampMaxToolSteps(raw: unknown, fallback = 5): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n === 0 && (raw === "" || raw === null || raw === undefined || Number.isNaN(Number(raw)))) {
    return Math.min(10, Math.max(1, Math.trunc(Number(fallback)) || 5));
  }
  if (!Number.isFinite(n)) return Math.min(10, Math.max(1, Math.trunc(Number(fallback)) || 5));
  return Math.min(10, Math.max(1, n || fallback));
}

/** Ignore garbage mode strings so invalid node overrides cannot silently disable ReAct. */
export function normalizeExecutionMode(mode: unknown): AgentExecutionMode | undefined {
  return mode === "single_turn" || mode === "react" ? mode : undefined;
}

export function resolveEffectiveReactSettings(input: {
  agentTools: readonly string[];
  agentMode?: AgentExecutionMode | string;
  agentMaxToolSteps?: number;
  nodeMode?: AgentExecutionMode | string;
  nodeMaxToolSteps?: number;
}): EffectiveReactSettings {
  const mode =
    normalizeExecutionMode(input.nodeMode) ??
    normalizeExecutionMode(input.agentMode) ??
    (input.agentTools.length > 0 ? "react" : "single_turn");
  const raw = input.nodeMaxToolSteps ?? input.agentMaxToolSteps ?? 5;
  const maxToolSteps = Math.min(10, Math.max(1, Math.trunc(Number(raw)) || 5));
  return { mode, maxToolSteps };
}
