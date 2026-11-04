import type { RunEvent } from "@multi-agent/types";
import { projectRunCanvas } from "../apps/web/src/lib/runCanvasProjection";

const event = (type: RunEvent["type"], sequence = 1, payload = {}, nodeId = "n"): RunEvent => ({
  id: String(sequence),
  runId: "r",
  type,
  sequence,
  timestamp: new Date(sequence * 1000).toISOString(),
  nodeId,
  payload,
});

describe("runCanvasProjection topology events (014)", () => {
  test("maps iteration / parallel / subgraph events to live statuses", () => {
    const projection = projectRunCanvas({
      events: [
        event("node.loop_iteration", 1, { current: 1, max: 3 }, "router"),
        event("parallel.branch_started", 2, {}, "spec-a"),
        event("parallel.branch_completed", 3, {}, "spec-b"),
        event("parallel.branch_failed", 4, {}, "spec-c"),
        event("subgraph.entered", 5, {}, "sub-1"),
        event("subgraph.exited", 6, {}, "sub-2"),
        event("subgraph.failed", 7, {}, "sub-3"),
      ],
    });
    expect(projection.nodeStatus.get("router")).toBe("running");
    expect(projection.nodeStatus.get("spec-a")).toBe("running");
    expect(projection.nodeStatus.get("spec-b")).toBe("completed");
    expect(projection.nodeStatus.get("spec-c")).toBe("failed");
    expect(projection.nodeStatus.get("sub-1")).toBe("running");
    expect(projection.nodeStatus.get("sub-2")).toBe("completed");
    expect(projection.nodeStatus.get("sub-3")).toBe("failed");
  });

  test("builds topologyHints for iteration, parallel branches, and subgraph frames", () => {
    const projection = projectRunCanvas({
      events: [
        event("node.loop_iteration", 1, { current: 2, max: 5, phase: "generate" }, "router"),
        event("parallel.branch_started", 2, { splitNodeId: "split-1", branchKey: "a" }, "a"),
        event("parallel.branch_completed", 3, { splitNodeId: "split-1", branchKey: "a" }, "a"),
        event("subgraph.entered", 4, { parentNodeId: "sub-node", workflowId: "child", depth: 1 }, "sub-node"),
        event("node.loop_limit_reached", 5, { terminationReason: "swarm_hop_ceiling" }, "peer"),
      ],
    });
    expect(projection.topologyHints?.iterationByNodeId?.router).toEqual({ current: 2, max: 5, phase: "generate" });
    expect(projection.topologyHints?.parallelBranchesBySplitId?.["split-1"]?.[0]?.status).toBe("completed");
    expect(projection.topologyHints?.subgraphFrames?.[0]).toMatchObject({ parentNodeId: "sub-node", workflowId: "child", status: "running" });
    expect(projection.topologyHints?.swarmTerminationReason).toBe("swarm_hop_ceiling");
  });
});
