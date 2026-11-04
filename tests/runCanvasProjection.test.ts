import type { RunEvent, Run } from "@multi-agent/types";
import { projectRunCanvas, isStatusChangingEvent } from "../apps/web/src/lib/runCanvasProjection";
const event = (type: RunEvent["type"], sequence = 1, payload = {}, nodeId = "n"): RunEvent => ({ id: String(sequence), runId: "r", type, sequence, timestamp: new Date(sequence * 1000).toISOString(), nodeId, payload });
test("nodes without lifecycle evidence stay idle", () => {
  expect(projectRunCanvas({ events: [] }).nodeStatus.get("n") ?? "idle").toBe("idle");
});
test.each(["node.started", "node.retrying", "agent.started", "llm.started", "tool.started"] as const)("%s starts work", type => {
  expect(projectRunCanvas({ events: [event(type)] }).nodeStatus.get("n")).toBe("running");
});
test.each(["node.completed", "agent.completed", "tool.completed"] as const)("%s completes work", type => {
  expect(projectRunCanvas({ events: [event(type)] }).nodeStatus.get("n")).toBe("completed");
});
test.each(["node.failed", "agent.failed", "llm.failed", "tool.failed"] as const)("%s fails work", type => {
  expect(projectRunCanvas({ events: [event(type)] }).nodeStatus.get("n")).toBe("failed");
});
test("orders evidence, ignores stream noise, and associates skipped nodes", () => {
  const result = projectRunCanvas({ events: [event("node.completed", 3), event("node.started", 1), event("log", 4), event("branch.skipped", 2, { nodeId: "skip" }, "")] });
  expect(result.nodeStatus.get("n")).toBe("completed");
  expect(result.nodeStatus.get("skip")).toBe("skipped");
});
test("approval and waiting header identify waiting nodes", () => {
  expect(projectRunCanvas({ events: [event("human_approval.requested")] }).nodeStatus.get("n")).toBe("waiting_human");
  expect(projectRunCanvas({ events: [], run: { status: "waiting_for_human", currentNodeId: "n" } as Run }).nodeStatus.get("n")).toBe("waiting_human");
});
test("accumulates only string edge identifiers", () => {
  expect([...projectRunCanvas({ events: [event("edge.traversed", 1, { edgeId: "e" }), event("edge.traversed", 2, { edgeId: 1 })] }).traversedEdgeIds]).toEqual(["e"]);
});
test("log, state and memory streams do not invalidate canvas status", () => {
  for (const type of ["log", "state.updated", "memory.read", "memory.write", "llm.completed"] as const)
    expect(isStatusChangingEvent(type)).toBe(false);
  expect(isStatusChangingEvent("node.started")).toBe(true);
});
test("nested completions do not finish a node before its lifecycle completes", () => {
  expect(projectRunCanvas({ events: [event("node.started", 1), event("tool.completed", 2), event("agent.completed", 3)] }).nodeStatus.get("n")).toBe("running");
  expect(projectRunCanvas({ events: [event("node.started", 1), event("tool.completed", 2), event("node.completed", 3)] }).nodeStatus.get("n")).toBe("completed");
});

import { edgeLiveStyle } from "../apps/web/src/lib/runCanvasProjection";
import type { WorkflowEdge } from "@multi-agent/types";
test("multi-branch traversal retains both normal and conditional paths", () => {
  const projection = projectRunCanvas({ events: [event("edge.traversed", 1, { edgeId: "normal" }), event("edge.traversed", 2, { edgeId: "branch" })] });
  for (const kind of ["normal", "conditional"] as const) {
    const edge = { id: kind === "normal" ? "normal" : "branch", kind, source: "a", target: "b" } as WorkflowEdge;
    expect(edgeLiveStyle(edge, projection.traversedEdgeIds.has(edge.id))).toEqual({ traversed: true, liveAnimated: true });
    expect(edgeLiveStyle(edge, false)).toEqual({ traversed: false, liveAnimated: false });
  }
});
