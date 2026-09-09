import { createToolRecord, validateTool } from "@multi-agent/types";

describe("validateTool", () => {
  test("a freshly created tool has no validation errors", () => {
    expect(validateTool(createToolRecord())).toEqual([]);
  });

  test("requires a nonempty name", () => {
    const tool = { ...createToolRecord(), name: "  " };
    expect(validateTool(tool)).toContain("Tool name is required.");
  });

  test("rejects an invalid category", () => {
    const tool = { ...createToolRecord(), category: "not-a-real-category" as never };
    expect(validateTool(tool)).toContain("A valid tool category is required.");
  });

  test("rejects an invalid impact level", () => {
    const tool = { ...createToolRecord(), impact: "catastrophic" as never };
    expect(validateTool(tool)).toContain("A valid tool impact/permission level is required.");
  });

  test("rejects non-primitive configuration values", () => {
    const tool = { ...createToolRecord(), configuration: { nested: { a: 1 } } as never };
    expect(validateTool(tool)).toContain("Configuration values must be strings, numbers, or booleans.");
  });

  test("rejects credential-shaped configuration", () => {
    const tool = { ...createToolRecord(), configuration: { apiKey: "sk-abcdefghijklmnop" } };
    expect(validateTool(tool).some((message) => /Credentials/.test(message))).toBe(true);
  });
});
