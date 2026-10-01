import { createEmptyDefinition, deserializeWorkflowDefinition } from "@multi-agent/types";
import { PluginRegistry } from "../src/plugins";

test("legacy workflows migrate to the current schema version and future versions fail closed", () => {
  expect(deserializeWorkflowDefinition({ id: "wf-1", name: "legacy", nodes: [], edges: [], updatedAt: "2026-01-01T00:00:00.000Z" }).schemaVersion).toBe(2);
  expect(() => deserializeWorkflowDefinition({ id: "wf-1", name: "future", schemaVersion: 99, nodes: [], edges: [] })).toThrow(/newer than supported/);
  expect(createEmptyDefinition("new").schemaVersion).toBe(2);
});

test("plugin registry enforces API version and declared capabilities", async () => {
  const registry = new PluginRegistry();
  registry.register({ manifest: { id: "example.plugin", version: "1.0.0", displayName: "Example", apiVersion: "1", capabilities: ["tool-executor"] }, initialize: ({ register }) => register("tool-executor:echo", { execute: () => ({ ok: true }) }) });
  await registry.initializeAll();
  expect(registry.get("example.plugin", "tool-executor:echo")).toBeDefined();
});
