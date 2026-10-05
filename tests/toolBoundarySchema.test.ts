import { createToolRecord } from "@multi-agent/types";
import { ToolRuntime } from "../src/tools/toolRuntime";

/**
 * Gap proof: ToolRecord.inputSchema/outputSchema must be enforced at the tool
 * execution boundary (before execute / after return), not treated as
 * display-only metadata.
 */
describe("tool boundary schema enforcement", () => {
  const schemaTool = () => ({
    ...createToolRecord({ name: "guarded", category: "function" }),
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  });

  test("rejects tool input that violates the declared input schema", async () => {
    const runtime = new ToolRuntime();
    await expect(runtime.execute(schemaTool(), { q: 42, extra: "not-allowed" } as never)).rejects.toThrow(
      /TOOL_INPUT_INVALID/
    );
  });

  test("accepts tool input that satisfies the declared input schema", async () => {
    const runtime = new ToolRuntime();
    const output = await runtime.execute(schemaTool(), { q: "hello" } as never);
    expect(output).toMatchObject({ q: "hello" });
  });

  test("rejects tool output that violates the declared output schema", async () => {
    const runtime = new ToolRuntime();
    const tool = { ...schemaTool(), outputSchema: { type: "object", properties: { missing: { type: "string" } }, required: ["missing"] } };
    await expect(runtime.execute(tool, { q: "hello" } as never)).rejects.toThrow(/TOOL_OUTPUT_INVALID/);
  });
});
