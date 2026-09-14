import { assertNoCredentials, createAgentRecord, migrateAgentRecord, nowIso, removeAgentNodes, uid, type AgentDiagnostics, type AgentRecord } from "@multi-agent/types";
import fs from "node:fs";
import { defaultCliExecutable, resolveCliSpawnExecutable, cliRuntimePolicyFromEnvironment } from "../../../../../src/agents/runtime/cliAgentExecutor";
import { assertContainerWorkerConfiguration, containerWorkerPolicyFromEnvironment } from "../../../../../src/agents/runtime/workerRuntime";
import { localRuntimePolicyFromEnvironment } from "../../../../../src/agents/runtime/localAgentExecutor";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { requireResource } from "./resource";

export class AgentService {
  constructor(private readonly store: StudioStore, private readonly fetchImpl: typeof fetch = fetch) {}
  list(principal: RequestPrincipal) { return this.store.listAgents(principal); }
  async get(id: string, principal: RequestPrincipal) { return requireResource(await this.store.getAgent(id, principal), "Agent"); }
  async diagnostics(id: string, principal: RequestPrincipal): Promise<AgentDiagnostics> {
    const agent = await this.get(id, principal);
    const checkedAt = nowIso();
    const backend = { type: agent.backend.type, provider: agent.backend.provider, ...(agent.backend.type !== "cli" ? { model: agent.backend.model } : agent.backend.model ? { model: agent.backend.model } : {}) } as AgentDiagnostics["backend"];
    if (agent.backend.type === "api") {
      const envName = agent.backend.provider.toLowerCase() === "openai" ? "OPENAI_API_KEY"
        : agent.backend.provider.toLowerCase() === "anthropic" ? "ANTHROPIC_API_KEY"
          : ["google", "gemini"].includes(agent.backend.provider.toLowerCase()) ? "GEMINI_API_KEY or GOOGLE_API_KEY" : undefined;
      if (!envName) return { status: "unsupported", checkedAt, backend, message: `API provider "${agent.backend.provider}" is not supported by the server.` };
      const configured = envName.includes(" or ") ? Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) : Boolean(process.env[envName]);
      return { status: configured ? "ready" : "not_authenticated", checkedAt, backend, message: configured ? `Server credential for ${envName} is configured.` : `Server credential for ${envName} is not configured.` };
    }
    if (agent.backend.type === "cli") {
      let policy;
      try { policy = cliRuntimePolicyFromEnvironment(); }
      catch (error) {
        return { status: "misconfigured", checkedAt, backend, message: error instanceof Error ? error.message : "Invalid CLI worker configuration." };
      }
      if (!policy.enabled) return { status: "unavailable", checkedAt, backend, message: "CLI execution is disabled by the server policy." };
      const configuredExecutable = agent.backend.executable || defaultCliExecutable(agent.backend.provider);
      if (policy.workerMode === "container") {
        try {
          assertContainerWorkerConfiguration(configuredExecutable, policy, containerWorkerPolicyFromEnvironment());
        } catch (error) {
          return { status: "misconfigured", checkedAt, backend, message: error instanceof Error ? error.message : "Invalid container worker configuration." };
        }
        return { status: "unknown", checkedAt, backend, message: "Digest-pinned worker image and container executable are configured; image availability and CLI authentication were not inspected." };
      }
      const executable = resolveCliSpawnExecutable(configuredExecutable, policy.allowedExecutables, process.env, policy.workerMode);
      const allowed = policy.allowedExecutables.some((item) => item === executable || (!item.includes("/") && !item.includes("\\") && item === configuredExecutable));
      if (!allowed) return { status: "misconfigured", checkedAt, backend, message: "The configured CLI is not in the server executable allowlist." };
      try { fs.accessSync(executable, fs.constants.X_OK); }
      catch { return { status: "unavailable", checkedAt, backend, message: "The configured CLI executable is not available on the execution server." }; }
      return { status: "unknown", checkedAt, backend, message: "CLI executable and server policy are ready, but authentication is owned by the CLI and was not inspected." };
    }
    if (agent.backend.provider !== "ollama" && agent.backend.provider !== "lmstudio") {
      return { status: "unsupported", checkedAt, backend, message: `Local provider "${agent.backend.provider}" is not supported by the server.` };
    }
    try {
      const baseUrl = agent.backend.baseUrl || (agent.backend.provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234");
      const origin = new URL(baseUrl).origin;
      const policy = localRuntimePolicyFromEnvironment();
      if (!policy.allowedOrigins.includes(origin)) return { status: "misconfigured", checkedAt, backend, message: "The local model origin is not allowed by the server policy." };
      const endpoint = agent.backend.provider === "ollama" ? new URL("/api/tags", baseUrl) : new URL("/v1/models", baseUrl);
      const response = await this.fetchImpl(endpoint, { method: "GET", signal: AbortSignal.timeout(2000) });
      return { status: response.ok ? "ready" : "unavailable", checkedAt, backend, message: response.ok ? "Local model service responded successfully." : `Local model service returned HTTP ${response.status}.` };
    } catch { return { status: "unavailable", checkedAt, backend, message: "The local model service could not be reached from the execution server." }; }
  }
  async create(body: Partial<AgentRecord> & { name?: string }, principal: RequestPrincipal) {
    assertNoCredentials(body);
    const agent = body.id ? migrateAgentRecord(body as AgentRecord) : createAgentRecord(body);
    return this.store.saveAgent({ ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false }, principal);
  }
  async duplicate(id: string, principal: RequestPrincipal) {
    const original = await this.get(id, principal); const stamp = nowIso();
    return this.store.saveAgent({ ...structuredClone(original), id: uid("agent"), name: `${original.name} (copy)`, ownerId: principal.userId,
      tenantId: principal.tenantId, isSystem: false, createdAt: stamp, updatedAt: stamp }, principal);
  }
  async update(id: string, patch: Partial<Omit<AgentRecord, "id" | "createdAt">>, principal: RequestPrincipal) {
    assertNoCredentials(patch); const original = await this.get(id, principal);
    if (original.isSystem) throw new ApiError(403, "Cannot modify system agent");
    return this.store.saveAgent({ ...migrateAgentRecord({ ...original, ...patch }), ...patch, id: original.id, ownerId: original.ownerId,
      tenantId: original.tenantId, isSystem: false, createdAt: original.createdAt, updatedAt: nowIso() }, principal);
  }
  async delete(id: string, removeReferences: boolean, principal: RequestPrincipal) {
    const original = await this.get(id, principal);
    if (original.isSystem) throw new ApiError(403, "Cannot delete system agent");
    const referencing = (await this.store.listWorkflows(principal)).filter((workflow) => workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === id));
    if (referencing.length && !removeReferences) throw new ApiError(409, "Remove this agent’s nodes in the Graph Editor and save the workflows before deleting the agent.");
    if (!removeReferences) return this.store.deleteAgent(id, principal);
    await this.store.transaction(async (transaction) => {
      for (const workflow of referencing) await transaction.saveWorkflow({ ...removeAgentNodes(workflow, id), updatedAt: nowIso() }, principal);
      await transaction.deleteAgent(id, principal);
    });
  }
}
