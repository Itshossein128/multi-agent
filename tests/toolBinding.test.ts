import { createToolRecord } from "@multi-agent/types";
import { buildBoundToolSchemas, resolveToolCallName, asBindToolsInput } from "../src/agents/runtime/toolBinding";

describe("toolBinding", () => {
  test("each ToolRecord becomes a bindable schema with unique call name", () => {
    const a = createToolRecord({ name: "lookup", description: "Look things up" });
    a.inputSchema = {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    };
    const b = createToolRecord({ name: "lookup", description: "Other lookup" });
    const schemas = buildBoundToolSchemas([a, b]);
    expect(schemas).toHaveLength(2);
    expect(schemas[0].callName).toBe("lookup");
    expect(schemas[1].callName).not.toBe(schemas[0].callName);
    expect(schemas[0].description).toBe("Look things up");
    expect(schemas[0].inputSchema).toMatchObject({
      type: "object",
      properties: { q: { type: "string" } },
    });
    expect(schemas[0].toolId).toBe(a.id);
  });

  test("disabled and empty lists are handled", () => {
    expect(buildBoundToolSchemas([])).toEqual([]);
    const disabled = createToolRecord({ name: "off" });
    disabled.enabled = false;
    expect(buildBoundToolSchemas([disabled])).toEqual([]);
  });

  test("resolveToolCallName maps call name back to tool", () => {
    const tool = createToolRecord({ name: "search" });
    const schemas = buildBoundToolSchemas([tool]);
    expect(resolveToolCallName(schemas[0].callName, [tool])?.id).toBe(tool.id);
    expect(resolveToolCallName("not_a_tool", [tool])).toBeUndefined();
  });

  test("asBindToolsInput produces function tool defs", () => {
    const tool = createToolRecord({ name: "echo", description: "Echo" });
    const bound = asBindToolsInput(buildBoundToolSchemas([tool]));
    expect(bound[0]).toMatchObject({
      type: "function",
      function: { name: "echo", description: "Echo" },
    });
    expect(bound[0].function.parameters).toBeDefined();
  });
});
