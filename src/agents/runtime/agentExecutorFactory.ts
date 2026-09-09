import type { AgentBackend } from "@multi-agent/types";
import { ApiAgentExecutor } from "./apiAgentExecutor";
import {
  AgyCliExecutor,
  ClaudeCodeCliExecutor,
  CodexCliExecutor,
  NotImplementedAgentExecutor,
  OllamaLocalExecutor,
} from "./notImplementedExecutor";
import type { AgentExecutor } from "./types";
import { ExecutionTelemetry } from "../../observability/telemetry";

export class AgentExecutorFactory {
  constructor(private readonly telemetry: ExecutionTelemetry = ExecutionTelemetry.disabled()) {}
  create(backend: AgentBackend): AgentExecutor {
    if (backend.type === "api") {
      return new ApiAgentExecutor(undefined, this.telemetry);
    }

    if (backend.type === "cli") {
      switch (backend.provider) {
        case "codex":
          return new CodexCliExecutor();
        case "claude-code":
          return new ClaudeCodeCliExecutor();
        case "agy":
          return new AgyCliExecutor();
        default:
          return new NotImplementedAgentExecutor(backend);
      }
    }

    if (backend.type === "local") {
      if (backend.provider === "ollama") {
        return new OllamaLocalExecutor(backend.model);
      }
      return new NotImplementedAgentExecutor(backend);
    }

    const exhaustive: never = backend;
    return new NotImplementedAgentExecutor(exhaustive);
  }
}

export const agentExecutorFactory = new AgentExecutorFactory();
