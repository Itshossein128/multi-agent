import { validateAgent, type AgentBackend, type AgentRecord } from "@multi-agent/types";

/** Suggested identifiers; providers remain extensible in the domain model. */
export const BACKEND_PROVIDERS = {
  api: ["openai", "anthropic", "google", "gemini"],
  cli: ["codex", "claude-code", "agy", "cursor"],
  local: ["ollama", "lmstudio"],
  process: ["process"],
  webhook: ["webhook"],
} satisfies Record<AgentBackend["type"], string[]>;

export function emptyBackend(type: AgentBackend["type"]): AgentBackend {
  if (type === "cli") return { type, provider: "codex" };
  if (type === "local") return { type, provider: "ollama", model: "" };
  if (type === "process") return { type, provider: "process", command: "" };
  if (type === "webhook") return { type, provider: "webhook", url: "" };
  return { type: "api", provider: "openai", model: "" };
}

export function validateAgentConfiguration(agent: AgentRecord): string[] {
  return validateAgent(agent);
}


export function runDuration(start: string, end?: string): string {
  if (!end) return "In progress";
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? `${Math.max(0, ms / 1000).toFixed(1)}s` : "Unknown";
}
