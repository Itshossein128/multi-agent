import type { AgentBackend } from "@multi-agent/types";
import { agentBackendLabel } from "@multi-agent/types";

export class UnsupportedBackendError extends Error {
  readonly backend: AgentBackend;

  constructor(backend: AgentBackend, detail?: string) {
    const key = `${backend.type}/${"provider" in backend ? backend.provider : "unknown"}`;
    super(detail ?? `Executor not registered for backend: ${key} (${agentBackendLabel(backend)})`);
    this.name = "UnsupportedBackendError";
    this.backend = backend;
  }
}

export class AgentExecutionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentExecutionFailedError";
  }
}
