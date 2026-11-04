import type { RunEvent } from "@multi-agent/types";
import { buildNodeExecutionView, isStatusChangingEvent } from "../apps/web/src/lib/runCanvasProjection";
const event = (type: RunEvent["type"], sequence: number, payload: Record<string, unknown> = {}, extra: Partial<RunEvent> = {}): RunEvent => ({ id: `e${sequence}`, runId: "r", nodeId: "n", type, sequence, timestamp: new Date(sequence * 1000).toISOString(), payload, ...extra });
test("projects exact input, timing, step and attempts from ordered evidence", () => {
 const view = buildNodeExecutionView("n", { events: [event("node.completed", 5), event("node.started", 1, { input: { question: "hello" }, step: 7 }), event("node.retrying", 2), event("node.started", 3)] });
 expect(view.input).toEqual({ question: "hello" }); expect(view.stepIndex).toBe(7); expect(view.attemptCount).toBe(3);
 expect(view.startedAt).toBe(new Date(1000).toISOString()); expect(view.completedAt).toBe(new Date(5000).toISOString()); expect(view.durationMs).toBe(4000);
});
test("appends published output/thought chunks without duplicating final content", () => {
 const view = buildNodeExecutionView("n", { events: [event("log", 1, { content: "Hello ", thoughts: "First " }), event("log", 2, { delta: "world", thoughts: "then" }), event("agent.completed", 3, { content: "Hello world" }), event("log", 4, { content: "unrelated" }, { nodeId: "other" })] });
 expect(view.streamText).toBe("Hello world"); expect(view.thoughtsText).toBe("First then"); expect(view.events).toHaveLength(3);
 expect(isStatusChangingEvent("log")).toBe(false);
});
test("correlates nested and concurrent repeated tool calls by invocation id", () => {
 const view = buildNodeExecutionView("n", { events: [event("node.started", 1), event("tool.started", 2, { toolId: "search", toolCallId: "a", arguments: { q: "a" } }), event("tool.started", 3, { toolId: "search", toolCallId: "b", arguments: { q: "b" } }), event("tool.completed", 4, { toolCallId: "b", output: false }, { nodeId: undefined, parentEventId: "e3" }), event("tool.failed", 5, { toolCallId: "a", error: "denied" }, { nodeId: undefined, parentEventId: "e2" })] });
 expect(view.toolCalls).toHaveLength(2);
 expect(view.toolCalls[0]).toMatchObject({ id: "a", arguments: { q: "a" }, status: "failed", error: "denied" });
 expect(view.toolCalls[1]).toMatchObject({ id: "b", arguments: { q: "b" }, status: "completed", result: false });
});
test("retains result envelopes and contract failure diagnostics without asserting missing results", () => {
 const envelope = { contractVersion: 1, status: "success", value: { answer: 42 } };
 expect(buildNodeExecutionView("n", { events: [event("node.completed", 1, { result: envelope })] }).result).toEqual(envelope);
 const failed = buildNodeExecutionView("n", { events: [event("node.failed", 1, { error: "bad output", code: "NODE_OUTPUT_INVALID", diagnostics: [{ path: "value" }] })] });
 expect(failed.error).toContain("bad output"); expect(failed.contractViolation).toEqual({ code: "NODE_OUTPUT_INVALID", diagnostics: [{ path: "value" }] });
 expect(buildNodeExecutionView("n", { events: [] }).result).toBeUndefined();
});

test("associates explicitly keyed state evidence without attributing another node's result", () => {
 const envelope = { contractVersion: 1, status: "success", value: "result" };
 const input = { events: [event("state.updated", 1, { nodeOutcomes: { n: envelope, other: { ...envelope, value: "other" } } }, { nodeId: undefined })] };
 expect(buildNodeExecutionView("n", input).result).toEqual(envelope);
 expect(buildNodeExecutionView("absent", input).result).toBeUndefined();
});

test("preserves explicit null tool arguments and results", () => {
 const view = buildNodeExecutionView("n", { events: [event("tool.started", 1, { toolCallId: "call", arguments: null }), event("tool.completed", 2, { toolCallId: "call", result: null })] });
 expect(view.toolCalls[0].arguments).toBeNull(); expect(view.toolCalls[0].result).toBeNull();
});

test("projects nested ReAct tool activity under an agent nodeId", () => {
  const view = buildNodeExecutionView("agent_node", {
    events: [
      event("agent.started", 1, {}, { nodeId: "agent_node", agentId: "a1" }),
      event(
        "tool.started",
        2,
        { toolId: "tool_lookup", name: "lookup", arguments: { q: "weather" }, iteration: 1, toolCallId: "tc1" },
        { nodeId: "agent_node", agentId: "a1" }
      ),
      event(
        "tool.completed",
        3,
        { toolId: "tool_lookup", output: { temp: 72 }, durationMs: 40, toolCallId: "tc1" },
        { nodeId: "agent_node", agentId: "a1" }
      ),
      event("agent.completed", 4, { content: "72F" }, { nodeId: "agent_node", agentId: "a1" }),
    ],
  });
  expect(view.toolCalls).toHaveLength(1);
  expect(view.toolCalls[0]).toMatchObject({
    id: "tc1",
    arguments: { q: "weather" },
    status: "completed",
    result: { temp: 72 },
  });
});
