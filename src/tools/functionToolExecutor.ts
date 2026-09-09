import type { ToolExecutionInput, ToolExecutor } from "./types";

/**
 * Safe local echo executor for the "function" category — no network, filesystem,
 * or process access. Proves the test-tool wiring end to end without any I/O.
 */
export class FunctionToolExecutor implements ToolExecutor {
  async execute({ tool, input }: ToolExecutionInput): Promise<Record<string, unknown>> {
    return { ...tool.configuration, ...input };
  }
}
