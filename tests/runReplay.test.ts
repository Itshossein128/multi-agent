import { replayRunEvents } from "../apps/server/src/runtime/replay";
import type { RunEvent } from "@multi-agent/types";

const event = (type: RunEvent["type"], payload: Record<string, unknown> = {}, patch: Partial<RunEvent> = {}): RunEvent => ({
  id: type, runId: "run-1", type, timestamp: "2026-09-25T00:00:00.000Z", sequence: 1, payload, ...patch,
});

test("replays persisted lifecycle events into a bounded operational snapshot", () => {
  const snapshot = replayRunEvents("run-1", [
    event("run.started"),
    event("node.completed", {}, { nodeId: "node-a" }),
    event("state.updated", { branch: "pass" }, { nodeId: "node-a" }),
    event("run.completed"),
  ]);
  expect(snapshot).toMatchObject({ runId: "run-1", status: "completed", eventCount: 4, completedNodes: ["node-a"], branches: ["pass"] });
});
