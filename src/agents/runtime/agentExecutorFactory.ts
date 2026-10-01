import type { AgentBackend } from "@multi-agent/types";
import { ApiAgentExecutor } from "./apiAgentExecutor";
import {
  NotImplementedAgentExecutor,
} from "./notImplementedExecutor";
import { CliAgentExecutor } from "./cliAgentExecutor";
import { LocalAgentExecutor } from "./localAgentExecutor";
import type { AgentExecutor, AgentExecutionInput, AgentExecutionEvent } from "./types";
import { ExecutionTelemetry } from "../../observability/telemetry";
import type { WorkerRuntime } from "./workerRuntime";
import { cliRuntimePolicyFromEnvironment } from "./cliAgentExecutor";
import { NO_WORKER_CREDENTIALS, type WorkerCredentialResolver } from "./workerCredentials";
import { NO_API_CREDENTIALS, type ApiProviderCredentialResolver } from "../../security/providerCredentials";

export class AgentExecutorFactory {
  constructor(
    private readonly telemetry: ExecutionTelemetry = ExecutionTelemetry.disabled(),
    private readonly workerRuntime: WorkerRuntime | undefined = undefined,
    private readonly cliRuntimePolicy = cliRuntimePolicyFromEnvironment(),
    private readonly credentialResolver: WorkerCredentialResolver = NO_WORKER_CREDENTIALS,
    private readonly apiCredentialResolver: ApiProviderCredentialResolver = NO_API_CREDENTIALS,
  ) {}
  create(backend: AgentBackend): AgentExecutor {
    if (backend.type === "api") {
      return new ApiAgentExecutor(undefined, this.telemetry, this.apiCredentialResolver);
    }

    if (backend.type === "cli") {
      return new CliAgentExecutor(this.workerRuntime, this.cliRuntimePolicy, this.credentialResolver);
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
