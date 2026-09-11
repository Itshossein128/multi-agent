import type { AgentBackend } from "@multi-agent/types";
import { ApiAgentExecutor } from "./apiAgentExecutor";
import {
  NotImplementedAgentExecutor,
} from "./notImplementedExecutor";
import { CliAgentExecutor } from "./cliAgentExecutor";
import { LocalAgentExecutor } from "./localAgentExecutor";
import type { AgentExecutor } from "./types";
import { ExecutionTelemetry } from "../../observability/telemetry";

export class AgentExecutorFactory {
  constructor(private readonly telemetry: ExecutionTelemetry = ExecutionTelemetry.disabled()) {}
  create(backend: AgentBackend): AgentExecutor {
    if (backend.type === "api") {
      return new ApiAgentExecutor(undefined, this.telemetry);
    }

    if (backend.type === "cli") {
      return new CliAgentExecutor();
    }

    if (backend.type === "local") {
      if (backend.provider === "ollama" || backend.provider === "lmstudio") return new LocalAgentExecutor();
      return new NotImplementedAgentExecutor(backend);
    }

    const exhaustive: never = backend;
    return new NotImplementedAgentExecutor(exhaustive);
  }
}

export const agentExecutorFactory = new AgentExecutorFactory();
