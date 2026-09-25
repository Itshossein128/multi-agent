import { createEdge, createEmptyDefinition, createNode, nowIso, type WorkflowDefinition } from "@multi-agent/types";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { validateWorkflow } from "../apps/server/src/compiler/validation";

/**
 * Fail-closed condition routing.
 *
 * A condition node must never silently select the first configured branch when
 * the requested branch value is missing, malformed, not declared, incorrectly
 * typed, ambiguous, or produced from invalid output. The safe outcome is a
 * typed routing error (BRANCH_ROUTING_UNKNOWN) unless the workflow explicitly
 * declares an unknown/error route.
 */

function routingWorkflow(branches: { key: string; label: string }[], unknownRoute?: string) {
  const input = createNode("input", { x: 0, y: 0 });
  const condition = createNode("condition", { x: 1, y: 0 });
  condition.config = { branches, ...(unknownRoute ? { unknownRoute } : {}) };
  const targets = branches.map((branch, index) => {
    const memory = createNode("memory", { x: 2 + index, y: index });
    memory.config = { memoryType: "short_term", mode: "write", key: `route_${branch.key}` };
    return { branch: branch.key, node: memory };
  });
  const output = createNode("output", { x: 5, y: 0 });
  const edges = [
    createEdge({ source: input.id, target: condition.id }),
    ...targets.map(({ branch, node }) =>
      createEdge({ source: condition.id, target: node.id, kind: "conditional", branchKey: branch })
    ),
    ...targets.map(({ node }) => createEdge({ source: node.id, target: output.id })),
  ];
  const definition: WorkflowDefinition = {
    ...createEmptyDefinition("routing"),
    nodes: [input, condition, ...targets.map((entry) => entry.node), output],
    edges,
  };
  return { definition, edgeByBranch: new Map(targets.map(({ branch, node }) => [branch, definition.edges.find((edge) => edge.source === condition.id && edge.branchKey === branch)!.id])) , nodeByBranch: new Map(targets.map(({branch, node}) => [branch, node.id])) };
}

async function runRouting(input: Record<string, unknown>, branches = [{ key: "first", label: "First" }, { key: "second", label: "Second" }], unknownRoute?: string) {
  const { definition, edgeByBranch } = routingWorkflow(branches, unknownRoute);
  const traversed: string[] = [];
  const graph = compileWorkflow(definition, [], {
    onAgentEvent: (event) => {
      if (event.type === "edge.traversed") traversed.push((event.payload as { edgeId?: string }).edgeId ?? "");
    },
  });
  const state = await graph.graph.invoke({ input } as never);
  return { state, traversed, edgeByBranch };
}

describe("fail-closed condition routing", () => {
  test("an unknown branch value never falls through to the first configured branch", async () => {
    await expect(runRouting({ branch: "not-declared" })).rejects.toThrow(/BRANCH_ROUTING_UNKNOWN/);
  });

  test("a missing branch value does not silently select the first branch", async () => {
    await expect(runRouting({})).rejects.toThrow(/BRANCH_ROUTING_UNKNOWN/);
  });

  test("an incorrectly typed branch value is rejected instead of defaulting", async () => {
    await expect(runRouting({ branch: 42 })).rejects.toThrow(/BRANCH_ROUTING_UNKNOWN/);
  });

  test("a declared branch routes to its own target", async () => {
    const { state, traversed, edgeByBranch } = await runRouting({ branch: "second" });
    expect(traversed).toContain(edgeByBranch.get("second"));
    expect(traversed).not.toContain(edgeByBranch.get("first"));
    expect((state.memory as Record<string, unknown>).route_second).toBeDefined();
    expect((state.memory as Record<string, unknown>).route_first).toBeUndefined();
  });

  test("case-insensitive legacy input routing remains supported", async () => {
    const { traversed, edgeByBranch } = await runRouting({ branch: "FIRST" });
    expect(traversed).toContain(edgeByBranch.get("first"));
  });

  test("an explicitly declared unknown/error route receives unroutable values", async () => {
    const { traversed, edgeByBranch } = await runRouting({ branch: "nope" }, [
      { key: "first", label: "First" },
      { key: "unknown", label: "Unknown" },
    ], "unknown");
    expect(traversed).toContain(edgeByBranch.get("unknown"));
    expect(traversed).not.toContain(edgeByBranch.get("first"));
  });

  test("ambiguous case-insensitive branch declarations are rejected by server validation", () => {
    const { definition } = routingWorkflow([
      { key: "Yes", label: "Yes" },
      { key: "yes", label: "yes" },
    ]);
    const issues = validateWorkflow(definition, []);
    expect(issues.some((issue) => issue.code === "AMBIGUOUS_BRANCH_KEY" && issue.level === "error")).toBe(true);
  });

  test("an unknownRoute that is not a declared branch is rejected by server validation", () => {
    const { definition } = routingWorkflow([{ key: "first", label: "First" }], "not-a-branch");
    const issues = validateWorkflow(definition, []);
    expect(issues.some((issue) => issue.code === "INVALID_UNKNOWN_ROUTE" && issue.level === "error")).toBe(true);
  });
});
