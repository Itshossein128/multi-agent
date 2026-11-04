import { mapAgentExecutionEvent } from "../src/agents/runtime/mapAgentExecutionEvent";
import type { AgentExecutionEvent } from "../src/agents/runtime/types";

function evt(
  type: AgentExecutionEvent["type"],
  payload: Record<string, unknown>
): AgentExecutionEvent {
  return {
    type,
    timestamp: "2026-11-04T00:00:00.000Z",
    agentId: "agent_1",
    nodeId: "node_agent",
    runId: "run_1",
    payload,
  };
}

describe("mapAgentExecutionEvent ReAct tool payloads", () => {
  test("maps tool.started/completed/failed with payload preserved", () => {
    const started = mapAgentExecutionEvent(
      evt("tool.started", {
        toolId: "tool_lookup",
        name: "lookup",
        arguments: { q: "a" },
        iteration: 1,
        toolCallId: "tc1",
      }),
      "run_1"
    )[0];
    expect(started.type).toBe("tool.started");
    expect(started.toolId).toBe("tool_lookup");
    expect(started.nodeId).toBe("node_agent");
    expect(started.payload).toMatchObject({
      toolId: "tool_lookup",
      toolCallId: "tc1",
      iteration: 1,
    });

    const completed = mapAgentExecutionEvent(
      evt("tool.completed", {
        toolId: "tool_lookup",
        output: { result: true },
        durationMs: 12,
        toolCallId: "tc1",
      }),
      "run_1"
    )[0];
    expect(completed.type).toBe("tool.completed");
    expect(completed.payload).toMatchObject({ output: { result: true }, durationMs: 12 });

    const failed = mapAgentExecutionEvent(
      evt("tool.failed", { toolId: "tool_lookup", error: "denied", toolCallId: "tc1" }),
      "run_1"
    )[0];
    expect(failed.type).toBe("tool.failed");
    expect(failed.payload).toMatchObject({ error: "denied", toolCallId: "tc1" });
  });
});
