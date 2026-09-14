import { createAgentRecord, createEdge, createEmptyDefinition, createNode } from "@multi-agent/types";
import {
  assertAllowedCredentialContainerPath,
  assertClaudeCredentialsFileUsable,
  ClaudeCredentialsFileCredentialResolver,
  CLAUDE_CONTAINER_CREDENTIALS_PATH,
  CodexAuthFileCredentialResolver,
  EnvironmentWorkerCredentialResolver,
  environmentWorkerCredentialResolverFromEnvironment,
  persistCodexAuthFile,
  persistCredentialFile,
  sha256Hex,
  workerCredentialResolverFromEnvironment,
} from "../src/agents/runtime/workerCredentials";
import type { AgentExecutionInput } from "../src/agents/runtime/types";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function usableClaudeCredentials(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    claudeAiOauth: {
      accessToken: "dummy-claude-access-token",
      refreshToken: "dummy-claude-refresh-token",
      expiresAt: Date.now() + 60_000,
      refreshTokenExpiresAt: Date.now() + 86_400_000,
      scopes: ["user:inference"],
      subscriptionType: "pro",
      ...overrides,
    },
  }));
}

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

  test("Codex auth file resolver delivers only auth.json bytes and writebacks under CAS", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));
    const authPath = path.join(dir, "auth.json");
    const original = Buffer.from(JSON.stringify({ token: "dummy-original-token", version: 1 }));
    fs.writeFileSync(authPath, original, { mode: 0o600 });
    try {
      const resolver = new CodexAuthFileCredentialResolver({ enabled: true, authFilePath: authPath });
      const secrets = await resolver.resolve({
        tenantId: "tenant-a",
        principalId: "user-a",
        runId: "run-a",
        agentId: "agent-a",
        provider: "codex",
      });
      expect(secrets?.environment).toEqual({});
      expect(secrets?.files).toHaveLength(1);
      expect(secrets!.files![0].containerPath).toBe("/home/worker/.codex/auth.json");
      expect(secrets!.files![0].mode).toBe(0o600);
      expect(secrets!.files![0].content.equals(original)).toBe(true);
      expect(JSON.stringify(secrets!.files![0])).not.toContain("dummy-original-token");

      const refreshed = Buffer.from(JSON.stringify({ token: "dummy-refreshed-token", version: 2 }));
      await secrets!.persistRefreshedFiles?.([{
        containerPath: "/home/worker/.codex/auth.json",
        content: refreshed,
        mode: 0o600,
        contentSha256: sha256Hex(refreshed),
      }]);
      expect(fs.readFileSync(authPath).equals(refreshed)).toBe(true);

      const conflictOriginal = sha256Hex(Buffer.from("other"));
      const conflictResult = await persistCodexAuthFile(authPath, conflictOriginal, Buffer.from("conflict-write"));
      expect(conflictResult).toBe("skipped_conflict");
      expect(fs.readFileSync(authPath).equals(refreshed)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Claude credentials file resolver is provider scoped, validates usability, and writebacks under CAS", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cred-"));
    const credentialsPath = path.join(dir, ".credentials.json");
    const original = usableClaudeCredentials();
    fs.writeFileSync(credentialsPath, original, { mode: 0o600 });
    try {
      expect(() => assertAllowedCredentialContainerPath(CLAUDE_CONTAINER_CREDENTIALS_PATH)).not.toThrow();
      expect(() => assertAllowedCredentialContainerPath("/home/worker/.claude/settings.json")).toThrow(/unsupported container path/i);
      expect(() => assertClaudeCredentialsFileUsable(Buffer.from("{}"))).toThrow(/usable OAuth material/i);
      expect(() => assertClaudeCredentialsFileUsable(usableClaudeCredentials({ accessToken: "", refreshToken: "x" }))).toThrow(/usable OAuth material/i);
      expect(() => assertClaudeCredentialsFileUsable(usableClaudeCredentials({
        refreshTokenExpiresAt: Date.now() - 1_000,
      }))).toThrow(/refresh token is expired/i);

      const resolver = new ClaudeCredentialsFileCredentialResolver({
        enabled: true,
        credentialsFilePath: credentialsPath,
      });
      await expect(resolver.resolve({
        tenantId: "tenant-a", principalId: "user-a", runId: "run-a", agentId: "agent-a", provider: "codex",
      })).resolves.toBeUndefined();

      const secrets = await resolver.resolve({
        tenantId: "tenant-a",
        principalId: "user-a",
        runId: "run-a",
        agentId: "agent-a",
        provider: "claude-code",
      });
      expect(secrets?.environment).toEqual({});
      expect(secrets?.files).toHaveLength(1);
      expect(secrets!.files![0].containerPath).toBe(CLAUDE_CONTAINER_CREDENTIALS_PATH);
      expect(secrets!.files![0].mode).toBe(0o600);
      expect(secrets!.files![0].content.equals(original)).toBe(true);
      expect(JSON.stringify(secrets!.files![0])).not.toContain("dummy-claude-access-token");

      const refreshed = usableClaudeCredentials({ accessToken: "dummy-claude-access-token-refreshed" });
      await secrets!.persistRefreshedFiles?.([{
        containerPath: CLAUDE_CONTAINER_CREDENTIALS_PATH,
        content: refreshed,
        mode: 0o600,
        contentSha256: sha256Hex(refreshed),
      }]);
      expect(fs.readFileSync(credentialsPath).equals(refreshed)).toBe(true);
      expect(await persistCredentialFile(credentialsPath, sha256Hex(refreshed), refreshed)).toBe("unchanged");
      expect(await persistCredentialFile(credentialsPath, sha256Hex(Buffer.from("other")), usableClaudeCredentials({ accessToken: "conflict" })))
        .toBe("skipped_conflict");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Claude credentials resolver rejects empty OAuth material before launch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-empty-"));
    const credentialsPath = path.join(dir, ".credentials.json");
    fs.writeFileSync(credentialsPath, Buffer.from(JSON.stringify({
      claudeAiOauth: { accessToken: "", refreshToken: "", expiresAt: 0 },
    })), { mode: 0o600 });
    try {
      const resolver = new ClaudeCredentialsFileCredentialResolver({
        enabled: true,
        credentialsFilePath: credentialsPath,
      });
      await expect(resolver.resolve({
        tenantId: "t", principalId: "u", runId: "r", agentId: "a", provider: "claude-code",
      })).rejects.toThrow(/usable OAuth material/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("composite resolver prefers file delivery over environment credentials", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));
    const authPath = path.join(dir, "auth.json");
    const claudePath = path.join(dir, ".credentials.json");
    fs.writeFileSync(authPath, Buffer.from("{}"), { mode: 0o600 });
    fs.writeFileSync(claudePath, usableClaudeCredentials(), { mode: 0o600 });
    try {
      const resolver = workerCredentialResolverFromEnvironment({
        CLI_CREDENTIAL_FILE_ENABLED: "true",
        CLI_CODEX_AUTH_FILE: authPath,
        CLI_CLAUDE_CREDENTIALS_FILE: claudePath,
        CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "true",
        CLI_CODEX_CREDENTIAL_ENV_VAR: "OPENAI_API_KEY",
        CLI_CLAUDE_CREDENTIAL_ENV_VAR: "ANTHROPIC_API_KEY",
        OPENAI_API_KEY: "dummy-env-secret",
        ANTHROPIC_API_KEY: "dummy-anthropic-secret",
      });
      const codex = await resolver.resolve({
        tenantId: "t", principalId: "u", runId: "r", agentId: "a", provider: "codex",
      });
      expect(codex?.files?.[0]?.containerPath).toBe("/home/worker/.codex/auth.json");
      expect(codex?.environment).toEqual({});

      const claude = await resolver.resolve({
        tenantId: "t", principalId: "u", runId: "r", agentId: "a", provider: "claude-code",
      });
      expect(claude?.files?.[0]?.containerPath).toBe(CLAUDE_CONTAINER_CREDENTIALS_PATH);
      expect(claude?.environment).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
