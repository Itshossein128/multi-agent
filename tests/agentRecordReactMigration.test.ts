import { createAgentRecord, migrateAgentRecord, validateAgent } from "@multi-agent/types";

describe("AgentRecord ReAct migration", () => {
  test("migrateAgentRecord preserves optional executionMode and maxToolSteps", () => {
    const migrated = migrateAgentRecord({
      id: "a1",
      name: "Lookup",
      tools: ["tool_x"],
      executionMode: "react",
      maxToolSteps: 7,
      backend: { type: "api", provider: "openai", model: "gpt-4o" },
    });
    expect(migrated.executionMode).toBe("react");
    expect(migrated.maxToolSteps).toBe(7);
  });

  test("migrateAgentRecord omits fields when absent", () => {
    const migrated = migrateAgentRecord({
      id: "a2",
      name: "Plain",
      tools: [],
      backend: { type: "api", provider: "openai", model: "gpt-4o" },
    });
    expect(migrated.executionMode).toBeUndefined();
    expect(migrated.maxToolSteps).toBeUndefined();
  });

  test("migrateAgentRecord clamps maxToolSteps to 1–10", () => {
    expect(migrateAgentRecord({ id: "a", maxToolSteps: 99 }).maxToolSteps).toBe(10);
    expect(migrateAgentRecord({ id: "a", maxToolSteps: 0 }).maxToolSteps).toBe(5);
    expect(migrateAgentRecord({ id: "a", maxToolSteps: -2 }).maxToolSteps).toBe(1);
  });

  test("migrateAgentRecord ignores invalid executionMode", () => {
    const migrated = migrateAgentRecord({
      id: "a",
      executionMode: "turbo" as "react",
    });
    expect(migrated.executionMode).toBeUndefined();
  });

  test("createAgentRecord omits ReAct fields by default", () => {
    const agent = createAgentRecord({ name: "Fresh" });
    expect(agent.executionMode).toBeUndefined();
    expect(agent.maxToolSteps).toBeUndefined();
  });

  test("validateAgent rejects invalid executionMode and maxToolSteps", () => {
    const agent = createAgentRecord({ name: "Bad" });
    expect(
      validateAgent({ ...agent, executionMode: "nope" as "react" }).some((e) =>
        e.includes("executionMode")
      )
    ).toBe(true);
    expect(
      validateAgent({ ...agent, maxToolSteps: 50 }).some((e) => e.includes("maxToolSteps"))
    ).toBe(true);
    expect(validateAgent({ ...agent, executionMode: "react", maxToolSteps: 5 })).toEqual([]);
  });
});
