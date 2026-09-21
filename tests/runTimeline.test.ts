import {
  applyRunEvent,
  applyTerminalEvent,
  findTerminalEvent,
  mergeTimelineEvents,
  RUN_TIMELINE_EVENT_LIMIT,
} from "../apps/web/src/lib/runTimeline";
import type { Run, RunEvent, RunEventType } from "@multi-agent/types";

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    workflowId: "wf-1",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

function event(type: RunEventType, sequence: number, payload: Record<string, unknown> = {}, nodeId?: string): RunEvent {
  return { id: `e${sequence}`, runId: "run-1", type, timestamp: "2026-01-01T00:00:0" + (sequence % 10) + ".000Z", sequence, payload, nodeId };
}

describe("mergeTimelineEvents", () => {
  it("dedupes by id, sorts by sequence", () => {
    const merged = mergeTimelineEvents(
      [event("agent.started", 3), event("run.started", 1)],
      [event("agent.started", 3), event("run.started", 2)]
    );
    expect(merged.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("bounds the timeline at RUN_TIMELINE_EVENT_LIMIT", () => {
    const many: RunEvent[] = [];
    for (let i = 1; i <= RUN_TIMELINE_EVENT_LIMIT + 10; i++) many.push(event("log", i));
    const merged = mergeTimelineEvents([], many);
    expect(merged).toHaveLength(RUN_TIMELINE_EVENT_LIMIT);
    expect(merged[0].sequence).toBe(11);
  });

  it("prefers the existing live event on id collision (matches original store semantics)", () => {
    const existing = { ...event("agent.started", 1), payload: { live: true } };
    const incoming = { ...event("agent.started", 1), payload: { stale: true } };
    const merged = mergeTimelineEvents([existing], [incoming]);
    expect(merged[0].payload).toEqual({ live: true });
    expect(merged).toHaveLength(1);
  });
});

describe("applyRunEvent", () => {
  it("run.started / run.resumed set status running", () => {
    const paused = run({ status: "waiting_for_human" });
    expect(applyRunEvent(paused, event("run.started", 1)).status).toBe("running");
    expect(applyRunEvent(paused, event("run.resumed", 1)).status).toBe("running");
  });

  it("approval events set waiting_for_human and update currentNodeId", () => {
    const updated = applyRunEvent(run(), event("run.paused", 1, { approvalId: "a1" }, "n5"));
    expect(updated.status).toBe("waiting_for_human");
    expect(updated.currentNodeId).toBe("n5");
  });

  it("non-mutating events leave the run untouched", () => {
    const base = run();
    expect(applyRunEvent(base, event("agent.completed", 1))).toEqual(base);
  });
});

describe("applyTerminalEvent", () => {
  it("run.completed derives completed status and output", () => {
    const result = applyTerminalEvent(run(), event("run.completed", 9, { output: { ok: true } }));
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ok: true });
    expect(result.completedAt).toBeDefined();
  });

  it("run.failed derives failed status and error message", () => {
    const result = applyTerminalEvent(run(), event("run.failed", 9, { error: "boom" }));
    expect(result.status).toBe("failed");
    expect(result.error).toBe("boom");
  });

  it("run.failed with cancelled payload derives cancelled status", () => {
    const result = applyTerminalEvent(run(), event("run.failed", 9, { cancelled: true }));
    expect(result.status).toBe("cancelled");
  });

  it("run.cancelled derives cancelled status", () => {
    expect(applyTerminalEvent(run(), event("run.cancelled", 9)).status).toBe("cancelled");
  });
});

describe("findTerminalEvent", () => {
  it("returns the most recent terminal event", () => {
    const timeline = [event("run.started", 1), event("run.failed", 5, { error: "x" }), event("log", 6)];
    expect(findTerminalEvent(timeline)?.type).toBe("run.failed");
  });

  it("returns undefined when no terminal event exists", () => {
    expect(findTerminalEvent([event("run.started", 1)])).toBeUndefined();
  });
});
