import { nowIso } from "@multi-agent/types";
import type { AgentBackend } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { UnsupportedBackendError } from "./errors";

/** Fails explicitly for an unknown backend and never falls back to API execution. */
export class NotImplementedAgentExecutor implements AgentExecutor {
  constructor(private readonly backend: AgentBackend) {}

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    const key = `${this.backend.type}:${"provider" in this.backend ? this.backend.provider : "unknown"}`;
    const message = `Backend "${key}" is not implemented yet.`;
    yield {
      type: "agent.failed",
      timestamp: nowIso(),
      agentId: input.agent.id,
      nodeId: input.nodeId,
      runId: input.runId,
      payload: { error: message },
    };
    throw new UnsupportedBackendError(this.backend, message);
  }
}
