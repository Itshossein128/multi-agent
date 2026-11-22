import { assertNoCredentials, createAgentRecord, migrateAgentRecord, nowIso, removeAgentNodes, uid, type AgentDiagnosticDetails, type AgentDiagnosticStatus, type AgentDiagnostics, type AgentRecord } from "@multi-agent/types";
import { cliExecutableAvailable, defaultCliExecutable, resolveCliSpawnExecutable, cliRuntimePolicyFromEnvironment, type CliWorkerMode } from "../../../../../src/agents/runtime/cliAgentExecutor";
import { assertContainerWorkerConfiguration, containerWorkerPolicyFromEnvironment } from "../../../../../src/agents/runtime/workerRuntime";
import {
  PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES,
  assertClaudeCredentialsFileUsable,
  resolveClaudeCredentialsFilePath,
  resolveCodexAuthFilePath,
} from "../../../../../src/agents/runtime/workerCredentials";
import { apiCredentialAlias } from "../../../../../src/security/providerCredentials";
import { brokerClientConfigFromEnvironment } from "../../../../../src/broker/config";
import { localRuntimePolicyFromEnvironment } from "../../../../../src/agents/runtime/localAgentExecutor";
import { processRuntimePolicyFromEnvironment } from "../../../../../src/agents/runtime/processAgentExecutor";
import { webhookPolicyFromEnvironment } from "../../../../../src/agents/runtime/ssrfProtection";
import fs from "node:fs";
import path from "node:path";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { requireResource } from "./resource";
import { requireCredentialMutationPermission } from "../../auth/credentialResourcePermissions";

const SESSION_SUPPORTED_CLI_PROVIDERS = new Set(["codex", "claude-code", "agy", "cursor"]);

function diagnoseBrokerClientConfig(
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; enabled: boolean } | { ok: false; message: string } {
  try {
    const config = brokerClientConfigFromEnvironment(env);
    return { ok: true, enabled: config.enabled };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid credential broker configuration.",
    };
  }
}

function diagnoseCliBrokerCredentials(
  providerLabel: string,
  env: Readonly<Record<string, string | undefined>>,
): { status: AgentDiagnosticStatus; message: string; details: Pick<AgentDiagnosticDetails, "credentialMode" | "credentialReady"> } {
  if (env.NODE_ENV === "production" && env.CREDENTIAL_BROKER_TRUSTED_SERVER_DELIVERY !== "true") {
    return {
      status: "misconfigured",
      message: `${providerLabel} broker credential delivery requires CREDENTIAL_BROKER_TRUSTED_SERVER_DELIVERY=true in production.`,
      details: { credentialMode: "broker", credentialReady: false },
    };
  }
  const broker = diagnoseBrokerClientConfig(env);
  if (!broker.ok) {
    return {
      status: "misconfigured",
      message: `${providerLabel} CLI broker configuration is invalid: ${broker.message}`,
      details: { credentialMode: "broker", credentialReady: false },
    };
  }
  if (!broker.enabled && env.TOOL_CREDENTIAL_GATEWAY_ENABLED !== "true") {
    return {
      status: "misconfigured",
      message: `${providerLabel} CLI broker alias is set, but CREDENTIAL_BROKER_URL is not configured.`,
      details: { credentialMode: "broker", credentialReady: false },
    };
  }
  return {
    status: "ready",
    message: `${providerLabel} CLI executable and broker credential delivery are configured.`,
    details: { credentialMode: "broker", credentialReady: true },
  };
}

function hasProxyInWorkerAllowedEnvKeys(env: Readonly<Record<string, string | undefined>>): boolean {
  const allowed = new Set(
    (env.WORKER_ALLOWED_ENV_KEYS ?? "")
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
  if ((env.HTTP_PROXY?.trim() || env.http_proxy?.trim()) && !allowed.has("HTTP_PROXY")) {
    return false;
  }
  if ((env.HTTPS_PROXY?.trim() || env.https_proxy?.trim()) && !allowed.has("HTTPS_PROXY")) {
    return false;
  }
  return true;
}

function diagnoseCliCredentials(
  provider: string,
  workerMode: CliWorkerMode,
  env: Readonly<Record<string, string | undefined>>,
): { status: AgentDiagnosticStatus; message: string; details: Pick<AgentDiagnosticDetails, "credentialMode" | "credentialReady"> } {
  const envEnabled = env.CLI_CREDENTIAL_ENVIRONMENT_ENABLED === "true";
  const fileEnabled = env.CLI_CREDENTIAL_FILE_ENABLED === "true";
  const brokerEnabled = env.CLI_CREDENTIAL_BROKER_ENABLED === "true";
  const brokerKey = `CLI_CREDENTIAL_BROKER_ALIAS_${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const brokerAlias = env[brokerKey]?.trim();

  if (provider === "cursor") {
    if (brokerEnabled && brokerAlias) {
      return diagnoseCliBrokerCredentials("Cursor", env);
    }
    if (envEnabled) {
      const envVar = env.CLI_CURSOR_CREDENTIAL_ENV_VAR?.trim() || "CURSOR_API_KEY";
      if (!PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES.cursor.has(envVar)) {
        return {
          status: "misconfigured",
          message: "Unsupported CLI_CURSOR_CREDENTIAL_ENV_VAR selection for Cursor.",
          details: { credentialMode: "unconfigured", credentialReady: false },
        };
      }
      if (env[envVar]?.trim()) {
        return {
          status: "ready",
          message: "Cursor CLI executable and CURSOR_API_KEY delivery are ready.",
          details: { credentialMode: "environment", credentialReady: true },
        };
      }
      return {
        status: "not_authenticated",
        message: "Cursor CLI executable is ready, but CURSOR_API_KEY is not set on the execution server.",
        details: { credentialMode: "unconfigured", credentialReady: false },
      };
    }
    return {
      status: "not_authenticated",
      message: "Cursor CLI requires CURSOR_API_KEY delivery (enable CLI_CREDENTIAL_ENVIRONMENT_ENABLED=true with CURSOR_API_KEY, or configure the credential broker).",
      details: { credentialMode: "unconfigured", credentialReady: false },
    };
  }

  if (provider === "codex") {
    if (brokerEnabled && brokerAlias) {
      return diagnoseCliBrokerCredentials("Codex", env);
    }
    if (fileEnabled) {
      try {
        const stat = fs.statSync(resolveCodexAuthFilePath(env));
        if (stat.isFile() && stat.size > 0) {
          return {
            status: "ready",
            message: "Codex CLI executable and server Codex auth file delivery are ready.",
            details: { credentialMode: "file", credentialReady: true },
          };
        }
      } catch {
        /* fall through */
      }
      return {
        status: "not_authenticated",
        message: "Codex CLI executable is ready, but the configured Codex auth file is missing or empty.",
        details: { credentialMode: "unconfigured", credentialReady: false },
      };
    }
    const envVar = env.CLI_CODEX_CREDENTIAL_ENV_VAR?.trim();
    if (envEnabled && envVar) {
      if (!PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES.codex.has(envVar)) {
        return {
          status: "misconfigured",
          message: "Unsupported CLI_CODEX_CREDENTIAL_ENV_VAR selection for Codex.",
          details: { credentialMode: "unconfigured", credentialReady: false },
        };
      }
      if (env[envVar]?.trim()) {
        return {
          status: "ready",
          message: "Codex CLI executable and environment credential delivery are ready.",
          details: { credentialMode: "environment", credentialReady: true },
        };
      }
      return {
        status: "not_authenticated",
        message: `Codex CLI executable is ready, but ${envVar} is not set on the execution server.`,
        details: { credentialMode: "unconfigured", credentialReady: false },
      };
    }
    if (workerMode === "local") {
      try {
        const stat = fs.statSync(resolveCodexAuthFilePath(env));
        if (stat.isFile() && stat.size > 0) {
          return {
            status: "ready",
            message: "Codex CLI executable is ready and local Codex auth state is present (token validity is verified on execution).",
            details: { credentialMode: "cli_login", credentialReady: true },
          };
        }
      } catch {
        /* fall through */
      }
    }
    return {
      status: "not_authenticated",
      message: "Codex CLI executable is ready, but no local Codex login or server credential delivery is configured.",
      details: { credentialMode: "unconfigured", credentialReady: false },
    };
  }

  if (provider === "claude-code") {
    if (brokerEnabled && brokerAlias) {
      return diagnoseCliBrokerCredentials("Claude", env);
    }
    if (fileEnabled) {
      try {
        const content = fs.readFileSync(resolveClaudeCredentialsFilePath(env));
        if (content.length > 0) {
          assertClaudeCredentialsFileUsable(content);
          return {
            status: "ready",
            message: "Claude CLI executable and server Claude credential file delivery are ready.",
            details: { credentialMode: "file", credentialReady: true },
          };
        }
      } catch {
        /* fall through */
      }
      return {
        status: "not_authenticated",
        message: "Claude CLI executable is ready, but the configured Claude credential file is unavailable or invalid.",
        details: { credentialMode: "unconfigured", credentialReady: false },
      };
    }
    const envVar = env.CLI_CLAUDE_CREDENTIAL_ENV_VAR?.trim();
    if (envEnabled && envVar) {
      if (!PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES["claude-code"].has(envVar)) {
        return {
          status: "misconfigured",
          message: "Unsupported CLI_CLAUDE_CREDENTIAL_ENV_VAR selection for Claude.",
          details: { credentialMode: "unconfigured", credentialReady: false },
        };
      }
      if (env[envVar]?.trim()) {
        return {
          status: "ready",
          message: "Claude CLI executable and environment credential delivery are ready.",
          details: { credentialMode: "environment", credentialReady: true },
        };
      }
      return {
        status: "not_authenticated",
        message: `Claude CLI executable is ready, but ${envVar} is not set on the execution server.`,
        details: { credentialMode: "unconfigured", credentialReady: false },
      };
    }
    if (workerMode === "local") {
      try {
        const content = fs.readFileSync(resolveClaudeCredentialsFilePath(env));
        if (content.length > 0) {
          assertClaudeCredentialsFileUsable(content);
          return {
            status: "ready",
            message: "Claude CLI executable is ready and local Claude credentials are present.",
            details: { credentialMode: "cli_login", credentialReady: true },
          };
        }
      } catch {
        /* fall through */
      }
    }
    return {
      status: "not_authenticated",
      message: "Claude CLI executable is ready, but no local Claude login or server credential delivery is configured.",
      details: { credentialMode: "unconfigured", credentialReady: false },
    };
  }

  if (provider === "agy") {
    const proxyOk = hasProxyInWorkerAllowedEnvKeys(env);
    return {
      status: "unknown",
      message: proxyOk
        ? "Antigravity (agy) CLI executable is ready; authentication is managed by the host agy CLI session."
        : "Antigravity (agy) CLI executable is ready, but host HTTP_PROXY/HTTPS_PROXY variables are not included in WORKER_ALLOWED_ENV_KEYS.",
      details: { credentialMode: "cli_login" },
    };
  }

  return {
    status: "unknown",
    message: "CLI executable and server policy are ready, but authentication is owned by the CLI and was not inspected.",
    details: { credentialMode: "cli_login" },
  };
}

export class AgentService {
  constructor(
    private readonly store: StudioStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly env: Readonly<Record<string, string | undefined>> = process.env,
  ) {}
  list(principal: RequestPrincipal) { return this.store.listAgents(principal); }
  async get(id: string, principal: RequestPrincipal) { return requireResource(await this.store.getAgent(id, principal), "Agent"); }
  async diagnostics(id: string, principal: RequestPrincipal): Promise<AgentDiagnostics> {
    const agent = await this.get(id, principal);
    const checkedAt = nowIso();
    const backend: AgentDiagnostics["backend"] = {
      type: agent.backend.type,
      ...("provider" in agent.backend && agent.backend.provider ? { provider: agent.backend.provider } : {}),
      ...("model" in agent.backend && agent.backend.model ? { model: agent.backend.model } : {}),
      ...(agent.backend.type === "process" ? { command: agent.backend.command } : {}),
      ...(agent.backend.type === "webhook" ? { url: agent.backend.url } : {}),
    };
    if (agent.backend.type === "api") {
      const providerLower = agent.backend.provider.toLowerCase();
      const leasedProviders = (this.env.API_CREDENTIAL_LEASED_PROVIDERS ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      if (leasedProviders.includes(providerLower)) {
        const broker = diagnoseBrokerClientConfig(this.env);
        if (!broker.ok) {
          return {
            status: "misconfigured",
            checkedAt,
            backend,
            message: `Credential broker configuration for ${agent.backend.provider} is invalid: ${broker.message}`,
            details: { credentialMode: "broker", credentialReady: false, sessionSupported: true },
          };
        }
        const alias = apiCredentialAlias(agent.backend.provider, this.env) ?? apiCredentialAlias(providerLower, this.env);
        if (broker.enabled || this.env.TOOL_CREDENTIAL_GATEWAY_ENABLED === "true") {
          if (alias) {
            return {
              status: "ready",
              checkedAt,
              backend,
              message: `Broker-leased credential alias for ${agent.backend.provider} is configured.`,
              details: { credentialMode: "broker", credentialReady: true, sessionSupported: true },
            };
          }
          return {
            status: "misconfigured",
            checkedAt,
            backend,
            message: `Broker-leased API provider "${agent.backend.provider}" is missing its credential alias configuration.`,
            details: { credentialMode: "unconfigured", credentialReady: false, sessionSupported: true },
          };
        }
        if (alias) {
          return {
            status: "misconfigured",
            checkedAt,
            backend,
            message: `Broker-leased API provider "${agent.backend.provider}" has an alias configured, but CREDENTIAL_BROKER_URL is not configured.`,
            details: { credentialMode: "broker", credentialReady: false, sessionSupported: true },
          };
        }
      }
      const envName = providerLower === "openai" ? "OPENAI_API_KEY"
        : providerLower === "anthropic" ? "ANTHROPIC_API_KEY"
          : ["google", "gemini"].includes(providerLower) ? "GEMINI_API_KEY or GOOGLE_API_KEY" : undefined;
      if (!envName) {
        return {
          status: "unsupported",
          checkedAt,
          backend,
          message: `API provider "${agent.backend.provider}" is not supported by the server.`,
          details: { credentialMode: "unconfigured", credentialReady: false, sessionSupported: false },
        };
      }
      const configured = envName.includes(" or ")
        ? Boolean(this.env.GEMINI_API_KEY?.trim() || this.env.GOOGLE_API_KEY?.trim())
        : Boolean(this.env[envName]?.trim());
      return {
        status: configured ? "ready" : "not_authenticated",
        checkedAt,
        backend,
        message: configured ? `Server credential for ${envName} is configured.` : `Server credential for ${envName} is not configured.`,
        details: {
          credentialMode: configured ? "environment" : "unconfigured",
          credentialReady: configured,
          sessionSupported: true,
        },
      };
    }
    if (agent.backend.type === "cli") {
      const sessionSupported = SESSION_SUPPORTED_CLI_PROVIDERS.has(agent.backend.provider);
      let policy;
      try { policy = cliRuntimePolicyFromEnvironment(this.env); }
      catch (error) {
        return { status: "misconfigured", checkedAt, backend, message: error instanceof Error ? error.message : "Invalid CLI worker configuration." };
      }
      if (!policy.enabled) {
        return {
          status: "unavailable",
          checkedAt,
          backend,
          message: "CLI execution is disabled by the server policy.",
          details: { workerMode: policy.workerMode, sessionSupported },
        };
      }
      const configuredExecutable = agent.backend.executable || defaultCliExecutable(agent.backend.provider);
      if (policy.workerMode === "container") {
        try {
          assertContainerWorkerConfiguration(configuredExecutable, policy, containerWorkerPolicyFromEnvironment(this.env));
        } catch (error) {
          return {
            status: "misconfigured",
            checkedAt,
            backend,
            message: error instanceof Error ? error.message : "Invalid container worker configuration.",
            details: { workerMode: "container", executable: configuredExecutable, executableAllowlisted: false, sessionSupported },
          };
        }
        if (agent.backend.provider === "agy") {
          return {
            status: "misconfigured",
            checkedAt,
            backend,
            message: "Antigravity (agy) requires CLI_WORKER_MODE=local and cannot use hardened container credential injection.",
            details: {
              workerMode: "container",
              executable: configuredExecutable,
              executableAllowlisted: true,
              credentialMode: "unconfigured",
              credentialReady: false,
              sessionSupported,
            },
          };
        }
        const cred = diagnoseCliCredentials(agent.backend.provider, policy.workerMode, this.env);
        return {
          status: cred.status,
          checkedAt,
          backend,
          message: cred.status === "ready"
            ? `Digest-pinned worker image and ${cred.details.credentialMode} credential delivery are configured.`
            : cred.message,
          details: {
            workerMode: "container",
            executable: configuredExecutable,
            executableAllowlisted: true,
            sessionSupported,
            ...cred.details,
          },
        };
      }
      const executable = resolveCliSpawnExecutable(configuredExecutable, policy.allowedExecutables, this.env, policy.workerMode);
      const allowed = policy.allowedExecutables.some((item) => item === executable || (!item.includes("/") && !item.includes("\\") && item === configuredExecutable));
      if (!allowed) {
        return {
          status: "misconfigured",
          checkedAt,
          backend,
          message: "The configured CLI is not in the server executable allowlist.",
          details: { workerMode: policy.workerMode, executable: configuredExecutable, executableAllowlisted: false, sessionSupported },
        };
      }
      if (!cliExecutableAvailable(executable, this.env)) {
        return {
          status: "unavailable",
          checkedAt,
          backend,
          message: "The configured CLI executable is not available on the execution server.",
          details: {
            workerMode: policy.workerMode,
            executable: configuredExecutable,
            executableAllowlisted: true,
            executableAvailable: false,
            sessionSupported,
          },
        };
      }
      const cred = diagnoseCliCredentials(agent.backend.provider, policy.workerMode, this.env);
      return {
        status: cred.status,
        checkedAt,
        backend,
        message: cred.message,
        details: {
          workerMode: policy.workerMode,
          executable: configuredExecutable,
          executableAllowlisted: true,
          executableAvailable: true,
          sessionSupported,
          ...cred.details,
        },
      };
    }
    if (agent.backend.type === "process") {
      const policy = processRuntimePolicyFromEnvironment(this.env);
      if (!policy.enabled) return { status: "unavailable", checkedAt, backend, message: "Process agent execution is disabled by the server policy." };
      const command = agent.backend.command;
      const isAllowed = policy.allowedCommands.some((item) => item === command || (path.isAbsolute(item) && path.basename(item) === command));
      if (!isAllowed) return { status: "misconfigured", checkedAt, backend, message: "The configured process command is not in the server allowlist." };
      return { status: "ready", checkedAt, backend, message: "Process command and server policy are ready." };
    }
    if (agent.backend.type === "webhook") {
      const policy = webhookPolicyFromEnvironment(this.env);
      if (!policy.enabled) return { status: "unavailable", checkedAt, backend, message: "Webhook agent execution is disabled by the server policy." };
      return { status: "ready", checkedAt, backend, message: "Webhook agent destination is configured." };
    }
    if (agent.backend.type === "local") {
      if (agent.backend.provider !== "ollama" && agent.backend.provider !== "lmstudio") {
        return { status: "unsupported", checkedAt, backend, message: `Local provider "${agent.backend.provider}" is not supported by the server.` };
      }
      try {
        const baseUrl = agent.backend.baseUrl || (agent.backend.provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234");
        const origin = new URL(baseUrl).origin;
        const policy = localRuntimePolicyFromEnvironment(this.env);
        if (!policy.allowedOrigins.includes(origin)) return { status: "misconfigured", checkedAt, backend, message: "The local model origin is not allowed by the server policy." };
        const endpoint = agent.backend.provider === "ollama" ? new URL("/api/tags", baseUrl) : new URL("/v1/models", baseUrl);
        const response = await this.fetchImpl(endpoint, { method: "GET", signal: AbortSignal.timeout(2000) });
        return { status: response.ok ? "ready" : "unavailable", checkedAt, backend, message: response.ok ? "Local model service responded successfully." : `Local model service returned HTTP ${response.status}.` };
      } catch { return { status: "unavailable", checkedAt, backend, message: "The local model service could not be reached from the execution server." }; }
    }
    return { status: "unsupported", checkedAt, backend, message: "Agent backend type is not supported by the server." };
  }
  async create(body: Partial<AgentRecord> & { name?: string }, principal: RequestPrincipal) {
    assertNoCredentials(body);
    const agent = body.id ? migrateAgentRecord(body as AgentRecord) : createAgentRecord(body);
    requireCredentialMutationPermission(principal, agent, await this.store.getAgent(agent.id, principal));
    return this.store.saveAgent({ ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false }, principal);
  }
  async duplicate(id: string, principal: RequestPrincipal) {
    const original = await this.get(id, principal); const stamp = nowIso();
    requireCredentialMutationPermission(principal, original);
    return this.store.saveAgent({ ...structuredClone(original), id: uid("agent"), name: `${original.name} (copy)`, ownerId: principal.userId,
      tenantId: principal.tenantId, isSystem: false, createdAt: stamp, updatedAt: stamp }, principal);
  }
  async update(id: string, patch: Partial<Omit<AgentRecord, "id" | "createdAt">>, principal: RequestPrincipal) {
    assertNoCredentials(patch); const original = await this.get(id, principal);
    if (original.isSystem) throw new ApiError(403, "Cannot modify system agent");
    requireCredentialMutationPermission(principal, original, patch);
    return this.store.saveAgent({ ...migrateAgentRecord({ ...original, ...patch }), ...patch, id: original.id, ownerId: original.ownerId,
      tenantId: original.tenantId, isSystem: false, createdAt: original.createdAt, updatedAt: nowIso() }, principal);
  }
  async delete(id: string, removeReferences: boolean, principal: RequestPrincipal) {
    const original = await this.get(id, principal);
    if (original.isSystem) throw new ApiError(403, "Cannot delete system agent");
    requireCredentialMutationPermission(principal, original);
    const referencing = (await this.store.listWorkflows(principal)).filter((workflow) => workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === id));
    if (referencing.length && !removeReferences) throw new ApiError(409, "Remove this agent’s nodes in the Graph Editor and save the workflows before deleting the agent.");
    if (!removeReferences) return this.store.deleteAgent(id, principal);
    try {
      await this.store.transaction(async (transaction) => {
        for (const workflow of referencing) await transaction.saveWorkflow({ ...removeAgentNodes(workflow, id), updatedAt: nowIso() }, principal);
        await transaction.deleteAgent(id, principal);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, error instanceof Error ? error.message : String(error));
    }
  }

  async getHeartbeat(id: string, principal: RequestPrincipal) {
    await this.get(id, principal);
    const hb = await this.store.getAgentHeartbeat(id, principal);
    if (!hb) {
      return {
        agentId: id,
        tenantId: principal.tenantId,
        enabled: false,
        intervalSeconds: 300,
        lastHeartbeatAt: null,
        nextHeartbeatAt: null,
      };
    }
    return hb;
  }

  async saveHeartbeat(id: string, body: Record<string, unknown>, principal: RequestPrincipal) {
    await this.get(id, principal);
    const enabled = body.enabled === true;
    const intervalSeconds = typeof body.intervalSeconds === "number" && body.intervalSeconds >= 10
      ? Math.floor(body.intervalSeconds)
      : 300;

    const existing = await this.store.getAgentHeartbeat(id, principal);
    const nextHeartbeatAt = enabled
      ? new Date(Date.now() + intervalSeconds * 1000).toISOString()
      : null;

    const updated = await this.store.saveAgentHeartbeat(
      {
        agentId: id,
        tenantId: principal.tenantId,
        enabled,
        intervalSeconds,
        lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
        nextHeartbeatAt,
      },
      principal,
    );
    return updated;
  }
}
