/**
 * Schema-only tool binding for ReAct: convert ToolRecords into bindable
 * definitions for model.bindTools. Side effects stay in ToolRuntime.execute.
 */

import type { ToolRecord } from "@multi-agent/types";

export interface BoundToolSchema {
  toolId: string;
  /** Unique name exposed to the model. */
  callName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** OpenAI-style function tool accepted by LangChain ChatModel.bindTools. */
export interface BindableFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function sanitizeCallName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^[^a-zA-Z_]+/, "_");
  return cleaned.slice(0, 64) || "tool";
}

/**
 * Build bindable schemas for enabled tools. Call names are unique within the set
 * (name collision → append short id suffix).
 */
export function buildBoundToolSchemas(tools: ToolRecord[]): BoundToolSchema[] {
  if (!Array.isArray(tools) || tools.length === 0) return [];

  const enabled = tools.filter((tool) => tool.enabled !== false);
  const used = new Set<string>();
  const result: BoundToolSchema[] = [];

  for (const tool of enabled) {
    let base = sanitizeCallName(typeof tool.name === "string" && tool.name.trim() ? tool.name : tool.id);
    let callName = base;
    if (used.has(callName)) {
      const suffix = tool.id.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "x";
      callName = sanitizeCallName(`${base}_${suffix}`);
      let n = 2;
      while (used.has(callName)) {
        callName = sanitizeCallName(`${base}_${suffix}_${n}`);
        n += 1;
      }
    }
    used.add(callName);
    const inputSchema =
      tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
        ? tool.inputSchema
        : { type: "object", properties: {} };
    result.push({
      toolId: tool.id,
      callName,
      description: typeof tool.description === "string" ? tool.description : "",
      inputSchema,
    });
  }

  return result;
}

/** Resolve a model tool-call name back to the ToolRecord (via bound call names). */
export function resolveToolCallName(name: string, tools: ToolRecord[]): ToolRecord | undefined {
  if (!name || !Array.isArray(tools)) return undefined;
  const bound = buildBoundToolSchemas(tools);
  const match = bound.find((entry) => entry.callName === name);
  if (!match) {
    // Also allow exact tool.id or tool.name match for robustness
    return tools.find((tool) => tool.enabled !== false && (tool.id === name || tool.name === name));
  }
  return tools.find((tool) => tool.id === match.toolId);
}

/** Convert bound schemas into bindTools() arguments (schema-only, no funcs). */
export function asBindToolsInput(schemas: BoundToolSchema[]): BindableFunctionTool[] {
  return schemas.map((schema) => ({
    type: "function" as const,
    function: {
      name: schema.callName,
      description: schema.description,
      parameters:
        schema.inputSchema.type === "object"
          ? schema.inputSchema
          : { type: "object", properties: {}, ...(schema.inputSchema as object) },
    },
  }));
}
