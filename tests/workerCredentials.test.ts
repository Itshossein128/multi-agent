import { createAgentRecord, createEdge, createEmptyDefinition, createNode } from "@multi-agent/types";
import { EnvironmentWorkerCredentialResolver, environmentWorkerCredentialResolverFromEnvironment } from "../src/agents/runtime/workerCredentials";
import type { AgentExecutionInput } from "../src/agents/runtime/types";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";

describe("worker credential foundation", () => {
  test("development environment resolver is explicit, provider constrained, and fail closed", async () => {
    const disabled = environmentWorkerCredentialResolverFromEnvironment({
      OPENAI_API_KEY: "dummy-disabled",
      CLI_CODEX_CREDENTIAL_ENV_VAR: "OPENAI_API_KEY",
    });
    await expect(disabled.resolve({ tenantId: "t", principalId: "u", runId: "r", agentId: "a", provider: "codex" })).resolves.toBeUndefined();

    const resolver = new EnvironmentWorkerCredentialResolver({
      enabled: true,
      providerEnvironmentNames: { codex: "OPENAI_API_KEY" },
    }, { OPENAI_API_KEY: "dummy-codex-secret" });
    await expect(resolver.resolve({ tenantId: "tenant-a", principalId: "user-a", runId: "run-a", agentId: "agent-a", provider: "codex" }))
      .resolves.toEqual({ environment: { OPENAI_API_KEY: "dummy-codex-secret" } });
    await expect(resolver.resolve({ tenantId: "tenant-a", principalId: "user-a", runId: "run-a", agentId: "agent-a", provider: "claude-code" }))
      .resolves.toBeUndefined();

    const invalid = new EnvironmentWorkerCredentialResolver({
      enabled: true,
      providerEnvironmentNames: { codex: "DATABASE_URL" },
    }, { DATABASE_URL: "dummy-database-secret" });
    await expect(invalid.resolve({ tenantId: "t", principalId: "u", runId: "r", agentId: "a", provider: "codex" }))
      .rejects.toThrow(/unsupported server credential environment selection/i);
  });

  test("RunExecutor propagates only its authenticated principal into agent execution", async () => {
    let capture!: (input: AgentExecutionInput) => void;
    const captured = new Promise<AgentExecutionInput>((resolve) => { capture = resolve; });
    const runtime = {
      async *execute(input: AgentExecutionInput) {
        capture(input);
        yield { type: "agent.completed" as const, timestamp: new Date().toISOString(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { content: "ok" } };
      },
    };
    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex" } });
    agent.tenantId = "tenant-from-agent-record";
    agent.ownerId = "user-from-agent-record";
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    const executor = new RunExecutor(new InMemoryRunStore(), runtime);
    const runId = executor.startAgentTest({ agent, input: { value: "test" } }, undefined, { tenantId: "tenant-server", userId: "user-server" });

    const input = await captured;
    expect(input.runId).toBe(runId);
    expect(input.credentialPrincipal).toEqual({ tenantId: "tenant-server", principalId: "user-server" });
    expect(input.credentialPrincipal).not.toEqual({ tenantId: agent.tenantId, principalId: agent.ownerId });
  });

  test("normal workflow execution propagates trusted principal through the compiler path", async () => {
    let capture!: (input: AgentExecutionInput) => void;
    const captured = new Promise<AgentExecutionInput>((resolve) => { capture = resolve; });
    const runtime = {
      async *execute(input: AgentExecutionInput) {
        capture(input);
        yield { type: "agent.completed" as const, timestamp: new Date().toISOString(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { content: "ok" } };
      },
    };
    const agent = createAgentRecord();
    const inputNode = createNode("input", { x: 0, y: 0 });
    const agentNode = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
    const outputNode = createNode("output", { x: 2, y: 0 });
    const workflow = {
      ...createEmptyDefinition(),
      nodes: [inputNode, agentNode, outputNode],
      edges: [createEdge({ source: inputNode.id, target: agentNode.id }), createEdge({ source: agentNode.id, target: outputNode.id })],
    };
    const executor = new RunExecutor(new InMemoryRunStore(), runtime);
    const runId = executor.start({ workflow, agents: [agent], input: { value: "test" } }, undefined, { tenantId: "tenant-workflow", userId: "user-workflow" });

    const execution = await captured;
    expect(execution.runId).toBe(runId);
    expect(execution.credentialPrincipal).toEqual({ tenantId: "tenant-workflow", principalId: "user-workflow" });
  });
});
