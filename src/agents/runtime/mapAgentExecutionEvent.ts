import { nowIso, uid, type RunEvent, type RunEventType } from "@multi-agent/types";
import type { AgentExecutionEvent } from "./types";

const TYPE_MAP: Record<AgentExecutionEvent["type"], RunEventType> = {
  "agent.started": "agent.started",
  "agent.output": "log",
  "agent.completed": "agent.completed",
  "agent.failed": "agent.failed",
  "tool.started": "tool.started",
  "tool.completed": "tool.completed",
  "tool.failed": "tool.failed",
  "memory.read": "memory.read",
  "memory.write": "memory.write",
  log: "log",
};

/** Map executor-boundary events into the Phase 4 RunEvent stream. */
export function mapAgentExecutionEvent(event: AgentExecutionEvent, runId: string): RunEvent[] {
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : { value: event.payload };

  return [
    {
      id: uid("event"),
      runId: event.runId ?? runId,
      type: TYPE_MAP[event.type],
      timestamp: event.timestamp || nowIso(),
      nodeId: event.nodeId,
      agentId: event.agentId,
      sequence: 0,
      payload,
    },
  ];
}
