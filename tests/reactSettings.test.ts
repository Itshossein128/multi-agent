import {
  normalizeExecutionMode,
  resolveEffectiveReactSettings,
} from "../src/agents/runtime/reactSettings";

describe("resolveEffectiveReactSettings", () => {
  test("no tools + no overrides ⇒ single_turn, maxToolSteps 5", () => {
    expect(resolveEffectiveReactSettings({ agentTools: [] })).toEqual({
      mode: "single_turn",
      maxToolSteps: 5,
    });
  });

  test("tools present + no overrides ⇒ react", () => {
    expect(resolveEffectiveReactSettings({ agentTools: ["tool_a"] })).toEqual({
      mode: "react",
      maxToolSteps: 5,
    });
  });

  test('explicit agent executionMode "single_turn" with tools ⇒ single_turn', () => {
    expect(
      resolveEffectiveReactSettings({
        agentTools: ["tool_a"],
        agentMode: "single_turn",
      })
    ).toEqual({ mode: "single_turn", maxToolSteps: 5 });
  });

  test("node executionMode overrides agent", () => {
    expect(
      resolveEffectiveReactSettings({
        agentTools: ["tool_a"],
        agentMode: "react",
        nodeMode: "single_turn",
      })
    ).toEqual({ mode: "single_turn", maxToolSteps: 5 });
  });

  test("node/agent maxToolSteps overrides default; clamps to 1–10", () => {
    expect(
      resolveEffectiveReactSettings({
        agentTools: ["t"],
        agentMaxToolSteps: 3,
      }).maxToolSteps
    ).toBe(3);

    expect(
      resolveEffectiveReactSettings({
        agentTools: ["t"],
        agentMaxToolSteps: 3,
        nodeMaxToolSteps: 8,
      }).maxToolSteps
    ).toBe(8);

    expect(
      resolveEffectiveReactSettings({
        agentTools: ["t"],
        agentMaxToolSteps: 99,
      }).maxToolSteps
    ).toBe(10);

    expect(
      resolveEffectiveReactSettings({
        agentTools: ["t"],
        agentMaxToolSteps: 0,
      }).maxToolSteps
    ).toBe(5);

    expect(
      resolveEffectiveReactSettings({
        agentTools: ["t"],
        agentMaxToolSteps: -4,
      }).maxToolSteps
    ).toBe(1);

    expect(
      resolveEffectiveReactSettings({
        agentTools: ["t"],
        agentMaxToolSteps: 2.9 as unknown as number,
      }).maxToolSteps
    ).toBe(2);

    expect(
      resolveEffectiveReactSettings({
        agentTools: ["t"],
        agentMaxToolSteps: Number.NaN,
      }).maxToolSteps
    ).toBe(5);
  });

  test("node single_turn wins over agent react for runtime honor path", () => {
    const settings = resolveEffectiveReactSettings({
      agentTools: ["lookup"],
      agentMode: "react",
      agentMaxToolSteps: 7,
      nodeMode: "single_turn",
      nodeMaxToolSteps: 2,
    });
    expect(settings).toEqual({ mode: "single_turn", maxToolSteps: 2 });
  });

  test("invalid node/agent mode strings are ignored (do not silently disable ReAct)", () => {
    expect(normalizeExecutionMode("nope")).toBeUndefined();
    expect(normalizeExecutionMode("react")).toBe("react");
    expect(
      resolveEffectiveReactSettings({
        agentTools: ["tool_a"],
        agentMode: "react",
        nodeMode: "garbage" as unknown as "react",
      })
    ).toEqual({ mode: "react", maxToolSteps: 5 });
    expect(
      resolveEffectiveReactSettings({
        agentTools: ["tool_a"],
        agentMode: "bogus" as unknown as "react",
      })
    ).toEqual({ mode: "react", maxToolSteps: 5 });
  });
});
