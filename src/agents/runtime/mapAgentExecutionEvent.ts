import { nowIso, uid, type RunEvent, type RunEventType } from "@multi-agent/types";
import type { AgentExecutionEvent } from "./types";

const TYPE_MAP: Record<AgentExecutionEvent["type"], RunEventType> = {
  "agent.started": "agent.started",
  "agent.output": "log",
  "agent.completed": "agent.completed",
  "agent.failed": "agent.failed",
  "llm.started": "llm.started",
  "llm.completed": "llm.completed",
  "llm.failed": "llm.failed",
  "tool.started": "tool.started",
  "tool.completed": "tool.completed",
  "tool.failed": "tool.failed",
  "memory.read": "memory.read",
  "memory.write": "memory.write",
  log: "log",
};

const SHARED_EVENT_TYPES = new Set<RunEventType>([
  "run.created", "run.started", "run.paused", "run.resumed", "run.completed", "run.failed", "run.cancelled",
  "node.started", "node.completed", "node.failed", "node.retrying", "edge.traversed",
  "agent.started", "agent.completed", "agent.failed", "llm.started", "llm.completed", "llm.failed",
  "tool.started", "tool.completed", "tool.failed", "human_approval.requested", "human_approval.approved",
  "human_approval.rejected", "human_approval.resolved", "state.updated", "memory.read", "memory.write", "log",
]);

type MappableExecutionEvent = Omit<AgentExecutionEvent, "type"> & { type: string };

/** Map executor-boundary events into the Phase 4 RunEvent stream. */
export function mapAgentExecutionEvent(event: MappableExecutionEvent, runId: string): RunEvent[] {
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : { value: event.payload };

  return [
    {
      id: uid("event"),
      runId: event.runId ?? runId,
      // Compiler/runtime lifecycle events already use the shared vocabulary;
      // executor-specific events are translated by the table above.
      // Keep the public stream closed over the shared vocabulary. A future or
      // provider-specific executor event is still useful as a diagnostic log,
      // but must not silently create an invalid RunEvent type.
      type: SHARED_EVENT_TYPES.has(event.type as RunEventType)
        ? event.type as RunEventType
        : TYPE_MAP[event.type as AgentExecutionEvent["type"]] ?? "log",
      timestamp: event.timestamp || nowIso(),
      nodeId: event.nodeId,
      agentId: event.agentId,
      toolId: typeof payload.toolId === "string" ? payload.toolId : undefined,
      sequence: 0,
      payload,
    },
  ];
}
