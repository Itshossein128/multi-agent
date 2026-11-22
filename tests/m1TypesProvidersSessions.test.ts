import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  createToolRecord,
  DEFAULT_DYNAMIC_FANOUT_CONCURRENCY,
  DEFAULT_DYNAMIC_FANOUT_MAX_ITEMS,
  deserializeWorkflowDefinition,
  DYNAMIC_FANOUT_TARGET_AMBIGUOUS,
  DYNAMIC_FANOUT_TARGET_MISSING,
  INVALID_AGENT_NODE_REINVOKE_ON_CLARIFICATION,
  INVALID_AGENT_NODE_SHORT_TERM_MEMORY_MAX_TOKENS,
  INVALID_DYNAMIC_FANOUT_AGGREGATE_FIELD,
  INVALID_DYNAMIC_FANOUT_CONCURRENCY,
  INVALID_DYNAMIC_FANOUT_ITEMS_FIELD,
  INVALID_DYNAMIC_FANOUT_MAX_ITEMS,
  INVALID_DYNAMIC_FANOUT_SESSION_MODE,
  isWorkflowNodeType,
  MAX_STEP_SHORT_TERM_MEMORY_MAX_TOKENS,
  MIN_STEP_SHORT_TERM_MEMORY_MAX_TOKENS,
  NODE_TYPE_META,
  serializeWorkflowDefinition,
  validateAgentNodeStepConfig,
  validateDynamicFanoutNodeConfig,
  WORKFLOW_NODE_TYPES,
  type AgentNodeConfig,
  type DynamicFanoutNodeConfig,
  type RunEventType,
} from "@multi-agent/types";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import { ApiAgentExecutor } from "../src/agents/runtime/apiAgentExecutor";
import {
  boundHistory,
  DEFAULT_SHORT_TERM_MEMORY_MAX_TOKENS,
  MAX_SHORT_TERM_MEMORY_MAX_TOKENS,
  SHARED_SESSION_DEFAULT_SHORT_TERM_MEMORY_MAX_TOKENS,
} from "../src/agents/runtime/shortTermMemory";
import { AgentService } from "../apps/server/src/api/studio/agentService";
import { compileWorkflow, type AgentExecutionEvent as CompilerAgentEvent } from "../apps/server/src/compiler/workflowCompiler";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import type { RequestPrincipal } from "../apps/server/src/auth/principal";

describe("M1 Types & Validation Contracts", () => {
  test("dynamic_fanout is registered across WorkflowNodeType, WORKFLOW_NODE_TYPES, NODE_TYPE_META, createNode, and RunEventType", () => {
    expect(WORKFLOW_NODE_TYPES).toContain("dynamic_fanout");
    expect(isWorkflowNodeType("dynamic_fanout")).toBe(true);
    expect(NODE_TYPE_META.dynamic_fanout.label).toBe("Dynamic Fan-Out");

    const node = createNode("dynamic_fanout", { x: 100.4, y: 200.6 }, {
      label: "Verify Stories",
      targetAgentId: "agent-qa",
      itemsField: "stories",
      itemPromptTemplate: "Verify {{item}}",
      maxConcurrency: 6,
      maxItems: 40,
      aggregateField: "verdicts",
      failFast: true,
      taskInstruction: "Be thorough",
      sessionMode: "node",
    });
    expect(node.type).toBe("dynamic_fanout");
    const cfg = node.config as DynamicFanoutNodeConfig;
    expect(cfg).toEqual({
      label: "Verify Stories",
      targetAgentId: "agent-qa",
      itemsField: "stories",
      itemPromptTemplate: "Verify {{item}}",
      maxConcurrency: 6,
      maxItems: 40,
      aggregateField: "verdicts",
      failFast: true,
      taskInstruction: "Be thorough",
      sessionMode: "node",
    });

    const defaultsNode = createNode("dynamic_fanout", { x: 0, y: 0 }, { targetAgentId: "agent-qa" });
    expect((defaultsNode.config as DynamicFanoutNodeConfig).maxConcurrency).toBe(DEFAULT_DYNAMIC_FANOUT_CONCURRENCY);
    expect((defaultsNode.config as DynamicFanoutNodeConfig).maxItems).toBe(DEFAULT_DYNAMIC_FANOUT_MAX_ITEMS);
    expect((defaultsNode.config as DynamicFanoutNodeConfig).failFast).toBe(false);

    const fanoutEvents: RunEventType[] = [
      "fanout.started",
      "fanout.item_started",
      "fanout.item_completed",
      "fanout.item_failed",
      "fanout.completed",
    ];
    expect(fanoutEvents).toHaveLength(5);
  });

  test("validateDynamicFanoutNodeConfig enforces target mutual exclusion, bounds, sessionMode, and safe dot-paths", () => {
    expect(validateDynamicFanoutNodeConfig({
      targetAgentId: "a1",
      maxConcurrency: 16,
      maxItems: 200,
      sessionMode: "stateless",
      itemsField: "data.user_stories.items",
      aggregateField: "results.verdict-list",
    })).toEqual([]);

    expect(validateDynamicFanoutNodeConfig({}).map((i) => i.code)).toContain(DYNAMIC_FANOUT_TARGET_MISSING);
    expect(validateDynamicFanoutNodeConfig({ targetAgentId: "a1", workflowId: "w1" }).map((i) => i.code)).toContain(DYNAMIC_FANOUT_TARGET_AMBIGUOUS);
    expect(validateDynamicFanoutNodeConfig({ targetAgentId: "a1", maxConcurrency: 17 }).map((i) => i.code)).toContain(INVALID_DYNAMIC_FANOUT_CONCURRENCY);
    expect(validateDynamicFanoutNodeConfig({ targetAgentId: "a1", maxItems: 201 }).map((i) => i.code)).toContain(INVALID_DYNAMIC_FANOUT_MAX_ITEMS);
    expect(validateDynamicFanoutNodeConfig({ targetAgentId: "a1", sessionMode: "shared" as unknown as "node" }).map((i) => i.code)).toContain(INVALID_DYNAMIC_FANOUT_SESSION_MODE);

    const dangerousPaths = [
      "__proto__",
      "constructor",
      "prototype",
      "data.__proto__.items",
      "a.constructor.b",
      "items..0",
      "items.",
      ".items",
      "a".repeat(129),
    ];
    for (const payload of dangerousPaths) {
      expect(validateDynamicFanoutNodeConfig({ targetAgentId: "a1", itemsField: payload }).map((i) => i.code))
        .toContain(INVALID_DYNAMIC_FANOUT_ITEMS_FIELD);
      expect(validateDynamicFanoutNodeConfig({ targetAgentId: "a1", aggregateField: payload }).map((i) => i.code))
        .toContain(INVALID_DYNAMIC_FANOUT_AGGREGATE_FIELD);
    }
  });

  test("AgentNodeConfig reinvokeOnClarification and shortTermMemoryMaxTokens round-trip and validate cleanly", () => {
    expect(MIN_STEP_SHORT_TERM_MEMORY_MAX_TOKENS).toBe(64);
    expect(MAX_STEP_SHORT_TERM_MEMORY_MAX_TOKENS).toBe(65536);
    expect(MAX_SHORT_TERM_MEMORY_MAX_TOKENS).toBe(65536);

    const agent = createAgentRecord({ name: "SpecKit" });
    const input = createNode("input", { x: 0, y: 0 });
    const agentNode = createNode("agent", { x: 200, y: 0 }, {
      agentId: agent.id,
      sessionMode: "shared",
      sessionKey: "speckit-main",
      reinvokeOnClarification: true,
      shortTermMemoryMaxTokens: 65536,
    });
    const fanoutNode = createNode("dynamic_fanout", { x: 400, y: 0 }, {
      targetAgentId: agent.id,
      maxConcurrency: 4,
      maxItems: 50,
    });
    const output = createNode("output", { x: 600, y: 0 });

    const def = {
      ...createEmptyDefinition("M1 Roundtrip"),
      nodes: [input, agentNode, fanoutNode, output],
      edges: [
        createEdge({ source: input.id, target: agentNode.id }),
        createEdge({ source: agentNode.id, target: fanoutNode.id }),
        createEdge({ source: fanoutNode.id, target: output.id }),
      ],
    };

    const roundTrip = deserializeWorkflowDefinition(serializeWorkflowDefinition(def));
    const restoredAgentCfg = roundTrip.nodes[1].config as AgentNodeConfig;
    expect(restoredAgentCfg.reinvokeOnClarification).toBe(true);
    expect(restoredAgentCfg.shortTermMemoryMaxTokens).toBe(65536);

    const serverIssues = validateWorkflow(roundTrip, [agent]);
    expect(serverIssues.filter((i) => i.level === "error")).toEqual([]);

    const stepIssues = validateAgentNodeStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, reinvokeOnClarification: "bad" as unknown as boolean, shortTermMemoryMaxTokens: 128.5 },
      registryTools: [],
    });
    expect(stepIssues.map((i) => i.code)).toContain(INVALID_AGENT_NODE_REINVOKE_ON_CLARIFICATION);
    expect(stepIssues.map((i) => i.code)).toContain(INVALID_AGENT_NODE_SHORT_TERM_MEMORY_MAX_TOKENS);
  });
});

describe("M1 Short-Term Memory Bounds", () => {
  test("boundHistory retains > 16384 bytes up to 65536 when configured, while defaulting omitted maxTokens to 4096", () => {
    expect(DEFAULT_SHORT_TERM_MEMORY_MAX_TOKENS).toBe(4096);
    expect(SHARED_SESSION_DEFAULT_SHORT_TERM_MEMORY_MAX_TOKENS).toBe(16384);
    expect(MAX_SHORT_TERM_MEMORY_MAX_TOKENS).toBe(65536);

    const bigText = "X".repeat(12_000);
    const entries = [
      { id: "n1:1", input: "turn 1", output: bigText, toolSummary: "[1] read() -> ok" },
      { id: "n2:1", input: "turn 2", output: bigText, toolSummary: "[1] plan() -> ok" },
      { id: "n3:1", input: "turn 3", output: bigText },
    ];

    const retained = boundHistory({ entries, maxEntries: 20, maxTokens: 65536 });
    expect(retained.maxTokens).toBe(65536);
    expect(retained.entries).toHaveLength(3);

    const defaulted = boundHistory({
      entries: [{ id: "1", input: "a", output: "b" }],
      maxEntries: 20,
      maxTokens: Number.NaN,
    });
    expect(defaulted.maxTokens).toBe(4096);
  });
});

describe("M1 AgentService.diagnostics Provider Readiness", () => {
  const principal: RequestPrincipal = { userId: "u-1", tenantId: "t-1", organizationId: "t-1" };

  function makeFakeBinDir(names: string[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-diag-bin-"));
    for (const name of names) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    return dir;
  }

  test("cursor, codex, claude-code, agy, and broker-leased api diagnostics report accurate non-secret status", async () => {
    const binDir = makeFakeBinDir(["agent", "codex", "claude", "agy"]);
    const credDir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-diag-cred-"));
    const codexAuth = path.join(credDir, "auth.json");
    const claudeAuth = path.join(credDir, ".credentials.json");
    fs.writeFileSync(codexAuth, JSON.stringify({ token: "secret-codex-token" }), { mode: 0o600 });
    fs.writeFileSync(
      claudeAuth,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "secret-claude-access",
          refreshToken: "secret-claude-refresh",
          refreshTokenExpiresAt: Date.now() + 86_400_000,
        },
      }),
      { mode: 0o600 },
    );

    try {
      const store = new InMemoryStudioStore();
      const cursorAgent = await store.saveAgent({
        ...createAgentRecord({ name: "Cursor", backend: { type: "cli", provider: "cursor" } }),
        tenantId: principal.tenantId,
      }, principal);
      const codexAgent = await store.saveAgent({
        ...createAgentRecord({ name: "Codex", backend: { type: "cli", provider: "codex" } }),
        tenantId: principal.tenantId,
      }, principal);
      const claudeAgent = await store.saveAgent({
        ...createAgentRecord({ name: "Claude", backend: { type: "cli", provider: "claude-code" } }),
        tenantId: principal.tenantId,
      }, principal);
      const agyAgent = await store.saveAgent({
        ...createAgentRecord({ name: "Agy", backend: { type: "cli", provider: "agy" } }),
        tenantId: principal.tenantId,
      }, principal);
      const apiAgent = await store.saveAgent({
        ...createAgentRecord({ name: "OpenAI", backend: { type: "api", provider: "openai", model: "gpt-4o" } }),
        tenantId: principal.tenantId,
      }, principal);

      // 1. Cursor missing from allowlist
      const notAllowlistedSvc = new AgentService(store, fetch, {
        PATH: binDir,
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: "codex,claude,agy",
      });
      const d1 = await notAllowlistedSvc.diagnostics(cursorAgent.id, principal);
      expect(d1.status).toBe("misconfigured");
      expect(d1.details?.executableAllowlisted).toBe(false);

      // 2. Cursor env delivery missing key / whitespace key
      const missingKeySvc = new AgentService(store, fetch, {
        PATH: binDir,
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: "agent",
        CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "true",
        CURSOR_API_KEY: "   ",
      });
      const d2 = await missingKeySvc.diagnostics(cursorAgent.id, principal);
      expect(d2.status).toBe("not_authenticated");
      expect(d2.details?.credentialReady).toBe(false);

      // 3. Cursor env ready (never leaks secret)
      const cursorSecret = "cur_super_secret_key_value";
      const readyCursorSvc = new AgentService(store, fetch, {
        PATH: binDir,
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: "agent",
        CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "true",
        CLI_CURSOR_CREDENTIAL_ENV_VAR: "CURSOR_API_KEY",
        CURSOR_API_KEY: cursorSecret,
      });
      const d3 = await readyCursorSvc.diagnostics(cursorAgent.id, principal);
      expect(d3.status).toBe("ready");
      expect(d3.details).toMatchObject({
        workerMode: "local",
        executable: "agent",
        executableAllowlisted: true,
        executableAvailable: true,
        credentialMode: "environment",
        credentialReady: true,
        sessionSupported: true,
      });
      expect(JSON.stringify(d3)).not.toContain(cursorSecret);

      // 4. Cursor broker ready (requires CREDENTIAL_BROKER_URL + CREDENTIAL_BROKER_SERVICE_TOKEN) & misconfigured without URL
      const brokerUrl = "https://broker.internal";
      const brokerToken = "secret-broker-service-token-999";
      const brokerCursorSvc = new AgentService(store, fetch, {
        PATH: binDir,
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: "agent",
        CLI_CREDENTIAL_BROKER_ENABLED: "true",
        CLI_CREDENTIAL_BROKER_ALIAS_CURSOR: "velora-cursor",
        CREDENTIAL_BROKER_ENABLED: "true",
        CREDENTIAL_BROKER_URL: brokerUrl,
        CREDENTIAL_BROKER_SERVICE_TOKEN: brokerToken,
      });
      const d4 = await brokerCursorSvc.diagnostics(cursorAgent.id, principal);
      expect(d4.status).toBe("ready");
      expect(d4.details?.credentialMode).toBe("broker");
      expect(JSON.stringify(d4)).not.toContain(brokerUrl);
      expect(JSON.stringify(d4)).not.toContain(brokerToken);

      const brokerCursorMissingUrlSvc = new AgentService(store, fetch, {
        PATH: binDir,
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: "agent",
        CLI_CREDENTIAL_BROKER_ENABLED: "true",
        CLI_CREDENTIAL_BROKER_ALIAS_CURSOR: "velora-cursor",
        CREDENTIAL_BROKER_ENABLED: "true",
      });
      const d4MissingUrl = await brokerCursorMissingUrlSvc.diagnostics(cursorAgent.id, principal);
      expect(d4MissingUrl.status).toBe("misconfigured");
      expect(d4MissingUrl.details?.credentialMode).toBe("broker");
      expect(d4MissingUrl.details?.credentialReady).toBe(false);

      // 5. Codex & Claude file readiness without leaking file paths or tokens
      const fileSvc = new AgentService(store, fetch, {
        PATH: binDir,
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: "codex,claude,agy",
        CLI_CREDENTIAL_FILE_ENABLED: "true",
        CLI_CODEX_AUTH_FILE: codexAuth,
        CLI_CLAUDE_CREDENTIALS_FILE: claudeAuth,
        HTTP_PROXY: "http://127.0.0.1:8080",
      });
      const dCodex = await fileSvc.diagnostics(codexAgent.id, principal);
      expect(dCodex.status).toBe("ready");
      expect(dCodex.details?.credentialMode).toBe("file");
      expect(JSON.stringify(dCodex)).not.toContain(codexAuth);
      expect(JSON.stringify(dCodex)).not.toContain("secret-codex-token");

      const dClaude = await fileSvc.diagnostics(claudeAgent.id, principal);
      expect(dClaude.status).toBe("ready");
      expect(dClaude.details?.credentialMode).toBe("file");
      expect(JSON.stringify(dClaude)).not.toContain(claudeAuth);
      expect(JSON.stringify(dClaude)).not.toContain("secret-claude-access");

      // 6. Agy local proxy warning & container rejection
      const dAgyLocal = await fileSvc.diagnostics(agyAgent.id, principal);
      expect(dAgyLocal.status).toBe("unknown");
      expect(dAgyLocal.message).toMatch(/WORKER_ALLOWED_ENV_KEYS/);

      const containerSvc = new AgentService(store, fetch, {
        PATH: binDir,
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "container",
        CLI_AGENT_ALLOWED_EXECUTABLES: "agy",
        CLI_WORKER_IMAGE: "multi-agent-cli-worker@sha256:" + "a".repeat(64),
      });
      const dAgyContainer = await containerSvc.diagnostics(agyAgent.id, principal);
      expect(dAgyContainer.status).toBe("misconfigured");

      // 7. Broker-leased API provider ready (with URL+token, and URL without CREDENTIAL_BROKER_ENABLED=true) vs missing URL/alias
      const apiBrokerSvc = new AgentService(store, fetch, {
        CREDENTIAL_BROKER_ENABLED: "true",
        CREDENTIAL_BROKER_URL: brokerUrl,
        CREDENTIAL_BROKER_SERVICE_TOKEN: brokerToken,
        API_CREDENTIAL_LEASED_PROVIDERS: "openai",
        API_CREDENTIAL_ALIAS_OPENAI: "org-openai-alias",
      });
      const dApi = await apiBrokerSvc.diagnostics(apiAgent.id, principal);
      expect(dApi.status).toBe("ready");
      expect(dApi.details?.credentialMode).toBe("broker");
      expect(JSON.stringify(dApi)).not.toContain(brokerUrl);
      expect(JSON.stringify(dApi)).not.toContain(brokerToken);

      const apiBrokerUrlOnlySvc = new AgentService(store, fetch, {
        CREDENTIAL_BROKER_URL: brokerUrl,
        CREDENTIAL_BROKER_SERVICE_TOKEN: brokerToken,
        API_CREDENTIAL_LEASED_PROVIDERS: "openai",
        API_CREDENTIAL_ALIAS_OPENAI: "org-openai-alias",
      });
      const dApiUrlOnly = await apiBrokerUrlOnlySvc.diagnostics(apiAgent.id, principal);
      expect(dApiUrlOnly.status).toBe("ready");
      expect(dApiUrlOnly.details?.credentialMode).toBe("broker");
      expect(JSON.stringify(dApiUrlOnly)).not.toContain(brokerUrl);
      expect(JSON.stringify(dApiUrlOnly)).not.toContain(brokerToken);

      const apiBrokerMissingUrlSvc = new AgentService(store, fetch, {
        CREDENTIAL_BROKER_ENABLED: "true",
        API_CREDENTIAL_LEASED_PROVIDERS: "openai",
        API_CREDENTIAL_ALIAS_OPENAI: "org-openai-alias",
      });
      expect((await apiBrokerMissingUrlSvc.diagnostics(apiAgent.id, principal)).status).toBe("misconfigured");

      const apiBrokerMissingAliasSvc = new AgentService(store, fetch, {
        CREDENTIAL_BROKER_ENABLED: "true",
        CREDENTIAL_BROKER_URL: brokerUrl,
        CREDENTIAL_BROKER_SERVICE_TOKEN: brokerToken,
        API_CREDENTIAL_LEASED_PROVIDERS: "openai",
      });
      expect((await apiBrokerMissingAliasSvc.diagnostics(apiAgent.id, principal)).status).toBe("misconfigured");
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
      fs.rmSync(credDir, { recursive: true, force: true });
    }
  });
});

describe("M1 Multi-Turn API ReAct Session Continuation", () => {
  test("preserves same sessionId, >4096B outputs, and sanitized ReAct toolSummary across specify -> supervisor -> plan -> supervisor -> tasks", async () => {
    const tool = createToolRecord({ name: "speckit_workspace_tool", description: "Read/write spec files" });
    tool.id = "tool_speckit";
    tool.impact = "read-only";
    tool.executionPolicy = { requiresApproval: false, idempotency: "optional", retryable: true };

    const speckitAgent = createAgentRecord({
      name: "SpecKit Executor",
      backend: { type: "api", provider: "openai", model: "gpt-4o" },
    });
    speckitAgent.id = "agent-speckit";
    speckitAgent.systemPrompt = "You execute SpecKit stages.";
    speckitAgent.tools = [tool.id];
    speckitAgent.executionMode = "react";

    const supervisorAgent = createAgentRecord({
      name: "SpecKit Supervisor",
      backend: { type: "api", provider: "openai", model: "gpt-4o" },
    });
    supervisorAgent.id = "agent-supervisor";
    supervisorAgent.systemPrompt = "You review SpecKit artifacts.";

    const invokeCalls: Array<{ agentName: string; messages: Array<{ role: string; content: string }> }> = [];
    const longSpecBody = "SPEC_SECTION_".repeat(520); // > 6000 bytes (would exceed legacy 4096-byte cap!)
    const longPlanBody = "PLAN_SECTION_".repeat(520);

    let speckitModelRound = 0;
    const apiExecutor = new ApiAgentExecutor(() => ({
      getModel: (_provider, _opts) => {
        const model = {
          bindTools: () => model,
          invoke: async (messages: unknown[]) => {
            const typedMessages = messages as Array<{ role: string; content: string }>;
            const sys = typedMessages[0]?.content ?? "";
            const isSpecKit = sys.includes("You execute SpecKit stages.");
            invokeCalls.push({ agentName: isSpecKit ? "speckit" : "supervisor", messages: typedMessages });
            if (!isSpecKit) {
              return { content: "SUPERVISOR_APPROVED" };
            }
            speckitModelRound += 1;
            if (speckitModelRound === 1) {
              // Turn 1 (specify) invokes tool with a secret that must be sanitized
              return {
                content: "",
                tool_calls: [{
                  id: "tc-1",
                  name: "speckit_workspace_tool",
                  args: { action: "read", file: "spec.md", apiKey: "sk-secret1234567890abcdef" },
                }],
              };
            }
            if (speckitModelRound === 2) {
              return { content: `SPEC_DONE:${longSpecBody}` };
            }
            if (speckitModelRound === 3) {
              // Turn 2 (plan) answers directly
              return { content: `PLAN_DONE:${longPlanBody}` };
            }
            // Turn 3 (tasks)
            return { content: "TASKS_DONE" };
          },
        };
        return model;
      },
    }));

    const toolRuntime = {
      execute: jest.fn(async () => ({
        status: "ok",
        summary: "Read spec.md successfully; token=Bearer topsecret-jwt-value",
      })),
    };

    const inputNode = createNode("input", { x: 0, y: 0 });
    const specifyNode = createNode("agent", { x: 100, y: 0 }, {
      agentId: speckitAgent.id,
      sessionMode: "shared",
      sessionKey: "speckit-main",
      shortTermMemoryMaxTokens: 65536,
      taskInstruction: "Run speckit-specify",
    });
    const sup1Node = createNode("agent", { x: 200, y: 0 }, { agentId: supervisorAgent.id });
    const planNode = createNode("agent", { x: 300, y: 0 }, {
      agentId: speckitAgent.id,
      sessionMode: "shared",
      sessionKey: "speckit-main",
      // Omit shortTermMemoryMaxTokens to verify inheritance from Turn 1's 65536 budget
      taskInstruction: "Run speckit-plan",
    });
    const sup2Node = createNode("agent", { x: 400, y: 0 }, { agentId: supervisorAgent.id });
    const tasksNode = createNode("agent", { x: 500, y: 0 }, {
      agentId: speckitAgent.id,
      sessionMode: "shared",
      sessionKey: "speckit-main",
      taskInstruction: "Run speckit-tasks",
    });
    const outputNode = createNode("output", { x: 600, y: 0 });

    const workflow = {
      ...createEmptyDefinition("SpecKit Continuation E2E"),
      nodes: [inputNode, specifyNode, sup1Node, planNode, sup2Node, tasksNode, outputNode],
      edges: [
        createEdge({ source: inputNode.id, target: specifyNode.id }),
        createEdge({ source: specifyNode.id, target: sup1Node.id }),
        createEdge({ source: sup1Node.id, target: planNode.id }),
        createEdge({ source: planNode.id, target: sup2Node.id }),
        createEdge({ source: sup2Node.id, target: tasksNode.id }),
        createEdge({ source: tasksNode.id, target: outputNode.id }),
      ],
    };

    const recordedEvents: CompilerAgentEvent[] = [];
    const runtime = new AgentRuntime({ create: () => apiExecutor });
    const compiled = compileWorkflow(workflow, [speckitAgent, supervisorAgent], {
      runId: "run-speckit-1",
      workflowId: workflow.id,
      runtime,
      tools: [tool],
      toolRuntime,
      checkpointer: new MemorySaver(),
      onAgentEvent: (e) => recordedEvents.push(e),
    });

    const finalState = await compiled.graph.invoke(
      { input: { prompt: "Build Phase A.1" } },
      { configurable: { thread_id: "run-speckit-1" } },
    );

    expect(finalState.lastValue).toBe("TASKS_DONE");

    // 1. Exact same sessionId across specify -> plan -> tasks
    const sharedSession = finalState.agentSessions["speckit-main"];
    expect(sharedSession).toBeDefined();
    expect(sharedSession.sessionKey).toBe("speckit-main");
    expect(sharedSession.sessionId).toBe("openai-session-run-speckit-1-speckit-main");
    expect(sharedSession.turnCount).toBe(3);

    const speckitCompleted = recordedEvents.filter(
      (e) => e.type === "agent.completed" && e.agentId === speckitAgent.id,
    );
    expect(speckitCompleted).toHaveLength(3);
    expect((speckitCompleted[0].payload as { toolSummary?: string }).toolSummary).toContain("speckit_workspace_tool");
    expect((speckitCompleted[0].payload as { toolSummary?: string }).toolSummary).not.toContain("sk-secret1234567890abcdef");
    expect((speckitCompleted[0].payload as { toolSummary?: string }).toolSummary).not.toContain("topsecret-jwt-value");

    // 2. shortTermHistories retained full >6000B Turn 1 & Turn 2 outputs and Turn 2 inherited maxTokens=65536
    const historyKeys = Object.keys(finalState.shortTermHistories);
    const sharedHistoryKey = historyKeys.find((k) => k.includes("shared-session"));
    expect(sharedHistoryKey).toBeDefined();
    const sharedHistory = finalState.shortTermHistories[sharedHistoryKey!];
    expect(sharedHistory.maxTokens).toBe(65536);
    expect(sharedHistory.entries).toHaveLength(3);
    expect(String(sharedHistory.entries[0].output)).toContain(longSpecBody);
    expect(String(sharedHistory.entries[1].output)).toContain(longPlanBody);
    expect(sharedHistory.entries[0].toolSummary).toContain("speckit_workspace_tool");

    // 3. Turn 2 (plan) and Turn 3 (tasks) received Turn 1 toolSummary & ended on a user turn
    const speckitInvokes = invokeCalls.filter((c) => c.agentName === "speckit");
    expect(speckitInvokes).toHaveLength(4); // 2 in Turn 1 ReAct + 1 in Turn 2 + 1 in Turn 3
    const turn2Messages = speckitInvokes[2].messages;
    const turn3Messages = speckitInvokes[3].messages;
    expect(turn2Messages[turn2Messages.length - 1].role).toBe("user");
    expect(turn3Messages[turn3Messages.length - 1].role).toBe("user");
    expect(turn2Messages.some((m) => m.role === "assistant" && m.content.includes("[Tool activity in this turn]") && m.content.includes("speckit_workspace_tool"))).toBe(true);
    expect(turn3Messages.some((m) => m.role === "assistant" && m.content.includes(longSpecBody))).toBe(true);
    expect(turn3Messages.some((m) => m.role === "assistant" && m.content.includes(longPlanBody))).toBe(true);

    // 4. toolSummary did not leak into handoffs or lastValue
    expect(finalState.handoffs[specifyNode.id]?.summary).not.toContain("[Tool activity in this turn]");
    expect(finalState.nodeResults[specifyNode.id]).toBe(`SPEC_DONE:${longSpecBody}`);
  });

  test("shared session Turn 2 omitting shortTermMemoryMaxTokens preserves Turn 1 65536 budget even when agent.memory.shortTerm.maxTokens is 4096", async () => {
    const agent = createAgentRecord({
      name: "Memory-Configured SpecKit",
      backend: { type: "api", provider: "openai", model: "gpt-4o" },
    });
    agent.id = "agent-mem-configured";
    agent.systemPrompt = "You execute SpecKit with memory configured.";
    agent.memory = {
      enabled: true,
      type: "run",
      scope: "agent",
      mode: "read_write",
      maxEntries: 20,
      shortTerm: { enabled: true, maxTokens: 4096 },
    };

    const body1 = "SPEC_6K_".repeat(800); // 6400 bytes (> 4096 / 4 = 1024)
    const body2 = "PLAN_6K_".repeat(800); // 6400 bytes
    const seenMessages: Array<Array<{ role: string; content: string }>> = [];
    let callIdx = 0;

    const apiExecutor = new ApiAgentExecutor(() => ({
      getModel: () => ({
        invoke: async (messages: unknown[]) => {
          seenMessages.push(messages as Array<{ role: string; content: string }>);
          callIdx += 1;
          return { content: callIdx === 1 ? body1 : body2 };
        },
      }),
    }));

    const node1 = createNode("agent", { x: 100, y: 0 }, {
      agentId: agent.id,
      sessionMode: "shared",
      sessionKey: "speckit-mem",
      shortTermMemoryMaxTokens: 65536,
    });
    const node2 = createNode("agent", { x: 300, y: 0 }, {
      agentId: agent.id,
      sessionMode: "shared",
      sessionKey: "speckit-mem",
      // Intentionally omit shortTermMemoryMaxTokens
    });
    const inputNode = createNode("input", { x: 0, y: 0 });
    const outputNode = createNode("output", { x: 500, y: 0 });
    const workflow = {
      ...createEmptyDefinition("Shared Budget Precedence"),
      nodes: [inputNode, node1, node2, outputNode],
      edges: [
        createEdge({ source: inputNode.id, target: node1.id }),
        createEdge({ source: node1.id, target: node2.id }),
        createEdge({ source: node2.id, target: outputNode.id }),
      ],
    };

    const compiled = compileWorkflow(workflow, [agent], {
      runId: "run-mem-precedence",
      workflowId: workflow.id,
      runtime: new AgentRuntime({ create: () => apiExecutor }),
      checkpointer: new MemorySaver(),
    });

    const finalState = await compiled.graph.invoke(
      { input: { prompt: "Start" } },
      { configurable: { thread_id: "run-mem-precedence" } },
    );

    const sharedKey = Object.keys(finalState.shortTermHistories).find((k) => k.includes("shared-session"));
    expect(sharedKey).toBeDefined();
    const sharedHistory = finalState.shortTermHistories[sharedKey!];
    expect(sharedHistory.maxTokens).toBe(65536);
    expect(sharedHistory.entries).toHaveLength(2);
    expect(String(sharedHistory.entries[0].output)).toBe(body1);
    expect(String(sharedHistory.entries[1].output)).toBe(body2);
    expect(seenMessages[1].some((m) => m.role === "assistant" && m.content.includes(body1))).toBe(true);
  });

  test("redacts camelCase/bare secrets, tool.failed errors, and AgentRuntime fallbackToolCalls summaries", async () => {
    const tool = createToolRecord({ name: "secret_probe_tool", description: "Probe redaction" });
    tool.id = "tool_probe";
    tool.impact = "read-only";
    tool.executionPolicy = { requiresApproval: false, idempotency: "optional", retryable: true };

    const reactAgent = createAgentRecord({
      name: "Secret Probe Agent",
      backend: { type: "api", provider: "openai", model: "gpt-4o" },
    });
    reactAgent.id = "agent-secret-probe";
    reactAgent.tools = [tool.id];
    reactAgent.executionMode = "react";

    let round = 0;
    const apiExecutor = new ApiAgentExecutor(() => ({
      getModel: () => {
        const m = {
          bindTools: () => m,
          invoke: async () => {
            round += 1;
            if (round === 1) {
              return {
                content: "",
                tool_calls: [{
                  id: "tc-secret-ok",
                  name: "secret_probe_tool",
                  args: {
                    openaiApiKey: "plain_camel_openai_key_999",
                    clientSecret: "plain_client_secret_999",
                    authToken: "plain_auth_token_999",
                    accessToken: "plain_access_token_999",
                    refreshToken: "plain_refresh_token_999",
                    bearerToken: "plain_bearer_token_999",
                    privateKey: "plain_private_key_999",
                    token: "plain_bare_token_999",
                    secret: "plain_bare_secret_999",
                    password: "plain_bare_password_999",
                    safeQuery: "hello",
                  },
                }],
              };
            }
            if (round === 2) {
              return {
                content: "",
                tool_calls: [{ id: "tc-secret-err", name: "secret_probe_tool", args: { fail: true } }],
              };
            }
            return { content: "done" };
          },
        };
        return m;
      },
    }));

    const toolRuntime = {
      execute: jest.fn(async (_t: unknown, args: Record<string, unknown>) => {
        if (args.fail) {
          throw new Error("Upstream failed with sk-errsecret1234567890abcdef and Bearer err-jwt-secret");
        }
        return {
          status: "ok",
          openaiApiKey: "output_camel_secret_888",
          authToken: "output_auth_token_888",
          token: "output_bare_token_888",
        };
      }),
    };

    const runtime = new AgentRuntime({ create: () => apiExecutor });
    const events: Array<{ type: string; payload?: unknown }> = [];
    const histories: Record<string, { entries: Array<{ id: string; input: unknown; output: unknown; toolSummary?: string }>; maxEntries: number; maxTokens: number }> = {};

    for await (const ev of runtime.execute({
      agent: reactAgent,
      input: "probe",
      runId: "run-secret-1",
      nodeId: "node-secret-1",
      sessionMode: "shared",
      sessionKey: "sec-sess",
      resolvedTools: [tool],
      toolRuntime,
      shortTermHistories: histories,
      onShortTermUpdate: (patch) => Object.assign(histories, patch),
    })) {
      events.push(ev);
    }

    const eventsBlob = JSON.stringify(events);
    for (const leaked of [
      "plain_camel_openai_key_999",
      "plain_client_secret_999",
      "plain_auth_token_999",
      "plain_access_token_999",
      "plain_refresh_token_999",
      "plain_bearer_token_999",
      "plain_private_key_999",
      "plain_bare_token_999",
      "plain_bare_secret_999",
      "plain_bare_password_999",
      "output_camel_secret_888",
      "output_auth_token_888",
      "output_bare_token_888",
      "sk-errsecret1234567890abcdef",
      "err-jwt-secret",
    ]) {
      expect(eventsBlob).not.toContain(leaked);
    }
    const failedEvent = events.find((e) => e.type === "tool.failed");
    expect((failedEvent?.payload as { error?: string }).error).toContain("[redacted]");
    expect((failedEvent?.payload as { error?: string }).error).toContain("Upstream failed");

    // Verify AgentRuntime fallbackToolCalls path when executor emits tool.* events without toolSummary
    const fallbackExecutor = {
      async *execute() {
        yield {
          type: "tool.started" as const,
          timestamp: new Date().toISOString(),
          agentId: reactAgent.id,
          nodeId: "node-fb",
          runId: "run-fb",
          payload: {
            toolCallId: "fb-1",
            name: "http_tool",
            iteration: 1,
            arguments: { openaiApiKey: "sk-fallbackarg1234567890", clientSecret: "fb_secret_val", safe: "ok" },
          },
        };
        yield {
          type: "tool.failed" as const,
          timestamp: new Date().toISOString(),
          agentId: reactAgent.id,
          nodeId: "node-fb",
          runId: "run-fb",
          payload: {
            toolCallId: "fb-1",
            name: "http_tool",
            iteration: 1,
            error: "Failed auth with sk-fallbackerr1234567890 and Bearer fb-jwt-secret",
          },
        };
        yield {
          type: "agent.completed" as const,
          timestamp: new Date().toISOString(),
          agentId: reactAgent.id,
          nodeId: "node-fb",
          runId: "run-fb",
          payload: { content: "done" },
        };
      },
    };

    const fbHistories: Record<string, { entries: Array<{ id: string; input: unknown; output: unknown; toolSummary?: string }>; maxEntries: number; maxTokens: number }> = {};
    for await (const _ev of new AgentRuntime({ create: () => fallbackExecutor }).execute({
      agent: reactAgent,
      input: "probe fallback",
      runId: "run-fb",
      nodeId: "node-fb",
      sessionMode: "shared",
      sessionKey: "fb-sess",
      shortTermHistories: fbHistories,
      onShortTermUpdate: (patch) => Object.assign(fbHistories, patch),
    })) { /* drain */ }

    const fbSummary = Object.values(fbHistories)[0]?.entries[0]?.toolSummary ?? "";
    expect(fbSummary).toContain("http_tool");
    expect(fbSummary).toContain("[redacted]");
    expect(fbSummary).not.toContain("sk-fallbackarg1234567890");
    expect(fbSummary).not.toContain("fb_secret_val");
    expect(fbSummary).not.toContain("sk-fallbackerr1234567890");
    expect(fbSummary).not.toContain("fb-jwt-secret");
  });
});
