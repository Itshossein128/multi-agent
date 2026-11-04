import type { Run, RunEvent } from "@multi-agent/types";
import { createEmptyDefinition } from "@multi-agent/types";
import { buildLiveRunTrayModel } from "../apps/web/src/lib/liveRunTray";
const run = (status: Run["status"]): Run => ({ id: "r", workflowId: "w", status, startedAt: "2026-11-04T00:00:00Z", metadata: {} });
const event = (type: RunEvent["type"], sequence: number, payload = {}): RunEvent => ({ id: String(sequence), runId: "r", type, sequence, timestamp: "2026-11-04T00:00:03Z", payload });
test.each(["queued", "running", "waiting_for_human", "completed", "failed", "cancelled"] as const)("uses authoritative %s status and control availability", status => {
 const model = buildLiveRunTrayModel({ runId: "r", run: run(status), events: [], streamStatus: "live", now: Date.parse("2026-11-04T00:00:05Z") });
 expect(model.status).toBe(status); expect(model.canCancel).toBe(["queued", "running", "waiting_for_human"].includes(status)); expect(model.canRetry).toBe(status === "failed"); expect(model.stepMax).toBe(1000);
});
test("uses configured step max and observed step, terminal timing, and exact filters", () => {
 const events = [event("node.started", 1, { step: 7 }), event("tool.started", 2), event("node.failed", 3), event("log", 4)];
 const definition = { ...createEmptyDefinition("Test"), archetypeConfig: { category: "linear-pipeline" as const, maxExecutionSteps: 50 } };
 const base = { runId: "r", run: { ...run("failed"), completedAt: "2026-11-04T00:00:03Z" }, events, streamStatus: "closed" as const, definition, now: Date.parse("2026-11-04T00:00:15Z") };
 expect(buildLiveRunTrayModel(base)).toMatchObject({ stepCurrent: 7, stepMax: 50, elapsedMs: 3000 });
 expect(buildLiveRunTrayModel({ ...base, eventFilter: "all" }).events).toEqual(events);
 expect(buildLiveRunTrayModel({ ...base, eventFilter: "node" }).events).toEqual([events[0], events[2]]);
 expect(buildLiveRunTrayModel({ ...base, eventFilter: "tool" }).events).toEqual([events[1]]);
 expect(buildLiveRunTrayModel({ ...base, eventFilter: "error" }).events).toEqual([events[2]]);
});
test("missing header does not authorize actions or use another run's evidence", () => {
 const model = buildLiveRunTrayModel({ runId: "other", run: run("running"), events: [event("node.started", 1)], streamStatus: "connecting", now: 0 });
 expect(model.canCancel).toBe(false); expect(model.canRetry).toBe(false); expect(model.events).toEqual([]); expect(model.elapsedMs).toBe(0);
});
