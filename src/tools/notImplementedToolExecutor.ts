import type { ToolRecord } from "@multi-agent/types";
import type { ToolExecutionInput, ToolExecutor } from "./types";

export class UnsupportedToolCategoryError extends Error {
  constructor(public readonly category: ToolRecord["category"]) {
    super(`Tool category "${category}" is not implemented yet.`);
    this.name = "UnsupportedToolCategoryError";
  }
}

/**
 * Placeholder for future HTTP / database / search / file / MCP / CLI / custom executors.
 * Fails explicitly — never falls back to a no-op success.
 */
export class NotImplementedToolExecutor implements ToolExecutor {
  constructor(private readonly category: ToolRecord["category"]) {}

  async execute(_input: ToolExecutionInput): Promise<Record<string, unknown>> {
    void _input;
    throw new UnsupportedToolCategoryError(this.category);
  }
}
