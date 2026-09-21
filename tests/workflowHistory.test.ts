import { WorkflowHistory } from "../apps/web/src/store/workflowHistory";
import { createEmptyDefinition } from "@multi-agent/types";

describe("WorkflowHistory", () => {
  const def = (name: string) => ({ ...createEmptyDefinition(), name });

  it("pushes snapshots and undoes/redoes correctly", () => {
    const history = new WorkflowHistory();
    const original = def("v1");
    history.push(original);
    const edited = def("v2");

    expect(history.canUndo).toBe(true);
    expect(history.undo(edited)).toEqual(original);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redo(original)).toEqual(edited);
    expect(history.canRedo).toBe(false);
  });

  it("undo on empty history is a no-op", () => {
    const history = new WorkflowHistory();
    expect(history.undo(def("x"))).toBeUndefined();
    expect(history.redo(def("x"))).toBeUndefined();
  });

  it("coalesces rapid edits under the same key", () => {
    const history = new WorkflowHistory();
    const v1 = def("v1");
    const v2 = def("v2");
    const v3 = def("v3");

    history.pushCoalesced(v1, "node:1", 1_000);
    // Same key within coalesce window: no new snapshot
    history.pushCoalesced(v2, "node:1", 1_100);
    expect(history.undo(def("v-dirty"))?.name).toBe(v1.name);

    // Different key: new snapshot
    history.pushCoalesced(v2, "node:2", 1_200);
    history.pushCoalesced(v3, "node:2", 1_300);
    expect(history.undo(def("v-dirty2"))?.name).toBe(v2.name);
  });

  it("does not coalesce after the window elapses", () => {
    const history = new WorkflowHistory();
    history.pushCoalesced(def("v1"), "node:1", 1_000);
    history.pushCoalesced(def("v2"), "node:1", 1_000 + 2_000);
    expect(history.undo(def("dirty"))?.name).toBe("v2");
  });

  it("bounds the undo stack at HISTORY_LIMIT", () => {
    const history = new WorkflowHistory();
    for (let i = 0; i < 60; i++) history.push(def(`v${i}`));
    let count = 0;
    let current = def("head");
    while (history.canUndo) {
      current = history.undo(current)!;
      count++;
    }
    expect(count).toBeLessThanOrEqual(50);
  });

  it("clear() resets both stacks", () => {
    const history = new WorkflowHistory();
    history.push(def("v1"));
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo(def("x"))).toBeUndefined();
  });

  it("snapshots are deep copies (later mutation does not corrupt history)", () => {
    const history = new WorkflowHistory();
    const original = def("v1");
    history.push(original);
    original.name = "mutated";
    expect(history.undo(def("head"))?.name).toBe("v1");
  });
});
