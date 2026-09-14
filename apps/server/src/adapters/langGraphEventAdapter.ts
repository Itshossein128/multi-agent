import { nowIso, uid, type AgentRecord, type RunEvent, type RunEventType, type WorkflowDefinition } from "@multi-agent/types";

export class LangGraphEventAdapter {
  adapt(raw: unknown, runId: string, workflow: WorkflowDefinition, agents: AgentRecord[]): RunEvent[] {
    const event = raw as { type?: string; method?: string; params?: { node?: string; namespace?: string[]; data?: unknown } };
    if (event.type !== "event") return [];
    const nodeId = event.params?.node ?? event.params?.namespace?.[0];
    const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
    const payload = redact(event.params?.data);
    // Node lifecycle is emitted by the compiler wrapper, which has the actual
    // node identity and can also emit failures/edge traversals. LangGraph task
    // frames remain safe diagnostic log events here to avoid duplicate
    // node.completed entries and unstable task IDs in the public contract.
    const eventType: RunEventType = "log";
    const result: RunEvent[] = [{ id: uid("event"), runId, type: eventType, timestamp: nowIso(), nodeId, agentId: node?.type === "agent" ? (node.config as { agentId?: string | null }).agentId ?? undefined : undefined, sequence: 0, payload: { method: event.method ?? "unknown", data: payload } }];
    return result;
  }
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "string") return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/((?:api[_-]?key|password|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .slice(0, 12000);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = /secret|token|password|api[-_]?key|authorization|credential|stack/i.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return output;
}
