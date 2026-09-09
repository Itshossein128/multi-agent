import type { ToolRecord } from "@multi-agent/types";
import { toolExecutorFactory } from "./toolExecutorFactory";

export class ToolPolicyError extends Error {}

/** Server-side tool boundary: impact policy and timeout apply before category dispatch. */
export class ToolRuntime {
  constructor(private readonly timeoutMs = configuredTimeout(), private readonly allowSideEffects = process.env.TOOL_ALLOW_SIDE_EFFECTS === "true") {}
  async execute(tool: ToolRecord, input: Record<string, unknown>, parentSignal?: AbortSignal) {
    if (!tool.enabled) throw new ToolPolicyError(`Tool "${tool.name}" is disabled.`);
    if (tool.impact !== "read-only" && !this.allowSideEffects) throw new ToolPolicyError(`Tool "${tool.name}" requires server approval because it is ${tool.impact}.`);
    const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    return toolExecutorFactory.create(tool.category).execute({ tool, input, signal });
  }
}
function configuredTimeout() { const value = Number(process.env.TOOL_MAX_DURATION_MS ?? 30_000); return Number.isInteger(value) && value >= 1_000 && value <= 60 * 60_000 ? value : 30_000; }
