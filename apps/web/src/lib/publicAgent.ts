import { migrateAgentRecord, type AgentRecord } from "@multi-agent/types";

/** Strip legacy credential fields before an agent reaches React/query state. */
export function publicAgent(raw: unknown): AgentRecord {
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") return value
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, "[redacted]")
      .replace(/((?:api[_-]?key|password|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key === "maxTokens" || !/secret|token|password|api[-_]?key|authorization|credential|^env$/i.test(key)).map(([key, item]) => [key, scrub(item)]));
  };
  const agent = migrateAgentRecord(scrub(raw));
  if (agent.backend.type === "local" && agent.backend.baseUrl) {
    try {
      const url = new URL(agent.backend.baseUrl);
      url.username = ""; url.password = ""; url.search = ""; url.hash = "";
      agent.backend.baseUrl = url.toString();
    } catch { agent.backend.baseUrl = ""; }
  }
  return agent;
}
