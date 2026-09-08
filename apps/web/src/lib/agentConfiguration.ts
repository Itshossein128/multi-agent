import type { AgentBackend, AgentRecord } from "@multi-agent/types";

/** Suggested identifiers; providers remain extensible in the domain model. */
export const BACKEND_PROVIDERS = {
  api: ["openai", "anthropic", "google", "gemini"],
  cli: ["codex", "claude-code", "agy"],
  local: ["ollama", "lmstudio"],
} satisfies Record<AgentBackend["type"], string[]>;

export function emptyBackend(type: AgentBackend["type"]): AgentBackend {
  if (type === "cli") return { type, provider: "codex" };
  if (type === "local") return { type, provider: "ollama", model: "" };
  return { type, provider: "openai", model: "" };
}

export function validateAgentConfiguration(agent: AgentRecord): string[] {
  const errors: string[] = [];
  const { backend, executionPolicy: policy } = agent;
  if (!agent.name.trim()) errors.push("Name is required.");
  if (!backend.provider.trim()) errors.push("Backend provider is required.");
  if (backend.type !== "cli" && !backend.model.trim()) errors.push("Model is required for API and local backends.");
  if (backend.type === "local" && backend.baseUrl) {
    try {
      const url = new URL(backend.baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { errors.push("Base URL must be an HTTP(S) URL without credentials, query parameters, or a fragment."); }
  }
  if (policy?.workspaceRoot && (!/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(policy.workspaceRoot) || /[\r\n\0]/.test(policy.workspaceRoot))) errors.push("Workspace root must be an absolute path without control characters.");
  if (policy?.allowedCommands?.some((command) => !command.trim() || /[\r\n\0]/.test(command))) errors.push("Allowed commands must be nonempty, one per line.");
  if (policy?.shell === "disabled" && policy.allowedCommands?.length) errors.push("Remove allowed commands or enable restricted shell access.");
  if (backend.type === "cli" && backend.executable && /[\r\n\0]/.test(backend.executable)) errors.push("Executable must be a single path or command name.");
  if (agent.tools.some((id) => !id.trim())) errors.push("Tool IDs cannot be empty.");
  if (Object.entries(agent.metadata).some(([key, value]) => !key.trim() || !["string", "number", "boolean"].includes(typeof value))) errors.push("Metadata values must be strings, numbers, or booleans.");
  if (Object.keys(agent.metadata).some((key) => /secret|token|password|api[-_]?key|authorization|credential/i.test(key))) errors.push("Credentials belong in the runtime configuration, not agent metadata.");
  if (/\bsk-[a-zA-Z0-9_-]{12,}|Bearer\s+\S+|(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s"},]+/i.test(JSON.stringify(agent))) errors.push("Remove credentials from agent configuration; configure authentication on the execution server.");
  return errors;
}

export function runDuration(start: string, end?: string): string {
  if (!end) return "In progress";
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? `${Math.max(0, ms / 1000).toFixed(1)}s` : "Unknown";
}
