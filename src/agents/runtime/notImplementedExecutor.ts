import { nowIso } from "@multi-agent/types";
import type { AgentBackend } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { UnsupportedBackendError } from "./errors";

/**
 * Placeholder for future CLI / local backends.
 * Fails explicitly — never falls back to API execution.
 */
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

/** Future Codex CLI integration boundary. */
export class CodexCliExecutor extends NotImplementedAgentExecutor {
  constructor() {
    super({ type: "cli", provider: "codex" });
  }
}

/** Future Claude Code CLI integration boundary. */
export class ClaudeCodeCliExecutor extends NotImplementedAgentExecutor {
  constructor() {
    super({ type: "cli", provider: "claude-code" });
  }
}

/** Future agy CLI integration boundary. */
export class AgyCliExecutor extends NotImplementedAgentExecutor {
  constructor() {
    super({ type: "cli", provider: "agy" });
  }
}

/** Future Ollama local runtime boundary. */
export class OllamaLocalExecutor extends NotImplementedAgentExecutor {
  constructor(model = "llama3") {
    super({ type: "local", provider: "ollama", model });
  }
}
