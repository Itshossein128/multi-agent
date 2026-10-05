import type { AgentBackend } from "@multi-agent/types";
import { ApiAgentExecutor } from "./apiAgentExecutor";
import {
  NotImplementedAgentExecutor,
} from "./notImplementedExecutor";
import { CliAgentExecutor, cliRuntimePolicyFromEnvironment } from "./cliAgentExecutor";
import { LocalAgentExecutor } from "./localAgentExecutor";
import { OfflineTestAgentExecutor } from "./offlineTestAgentExecutor";
import { ProcessAgentExecutor, processRuntimePolicyFromEnvironment, type ProcessRuntimePolicy } from "./processAgentExecutor";
import { WebhookAgentExecutor } from "./webhookAgentExecutor";
import { webhookPolicyFromEnvironment, type WebhookPolicyConfig } from "./ssrfProtection";
import type { AgentExecutor } from "./types";
import { ExecutionTelemetry } from "../../observability/telemetry";
import type { WorkerRuntime } from "./workerRuntime";
import { NO_WORKER_CREDENTIALS, type WorkerCredentialResolver } from "./workerCredentials";
import { NO_API_CREDENTIALS, type ApiProviderCredentialResolver } from "../../security/providerCredentials";
import type { CredentialGateway } from "../../security/credentialGateway";

export class AgentExecutorFactory {
  constructor(
    private readonly telemetry: ExecutionTelemetry = ExecutionTelemetry.disabled(),
    private readonly workerRuntime: WorkerRuntime | undefined = undefined,
    private readonly cliRuntimePolicy = cliRuntimePolicyFromEnvironment(),
    private readonly credentialResolver: WorkerCredentialResolver = NO_WORKER_CREDENTIALS,
    private readonly apiCredentialResolver: ApiProviderCredentialResolver = NO_API_CREDENTIALS,
    private readonly credentialGateway: CredentialGateway | undefined = undefined,
    private readonly processPolicy: ProcessRuntimePolicy = processRuntimePolicyFromEnvironment(),
    private readonly webhookPolicy: WebhookPolicyConfig = webhookPolicyFromEnvironment(),
    private readonly allowOfflineTest: boolean = false,
  ) {}

  create(backend: AgentBackend): AgentExecutor {
    if (backend.type === "api") {
      return new ApiAgentExecutor(undefined, this.telemetry, this.apiCredentialResolver);
    }

    if (backend.type === "cli") {
      return new CliAgentExecutor(this.workerRuntime, this.cliRuntimePolicy, this.credentialResolver);
    }

    if (backend.type === "local") {
      if (this.allowOfflineTest && (backend.provider === "offline-test" || backend.provider === "self-test")) {
        return new OfflineTestAgentExecutor();
      }
      if (backend.provider === "ollama" || backend.provider === "lmstudio") return new LocalAgentExecutor();
      return new NotImplementedAgentExecutor(backend);
    }

    if (backend.type === "process") {
      return new ProcessAgentExecutor(this.workerRuntime, this.processPolicy);
    }

    if (backend.type === "webhook") {
      return new WebhookAgentExecutor(this.credentialGateway, this.webhookPolicy);
    }

    const exhaustive: never = backend;
    return new NotImplementedAgentExecutor(exhaustive);
  }
}

export const agentExecutorFactory = new AgentExecutorFactory();
