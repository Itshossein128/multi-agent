import {
  createAgentRecord,
  migrateAgentRecord,
  agentBackendLabel,
  type AgentBackend,
} from "@multi-agent/types";
import { AgentExecutorFactory } from "../src/agents/runtime/agentExecutorFactory";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import { ApiAgentExecutor } from "../src/agents/runtime/apiAgentExecutor";
import { mapAgentExecutionEvent } from "../src/agents/runtime/mapAgentExecutionEvent";
import { UnsupportedBackendError } from "../src/agents/runtime/errors";
import { ExecutionPolicyError } from "../src/agents/runtime/executionPolicy";
import { CliAgentExecutor, cliRuntimePolicyFromEnvironment, resolveCliSpawnExecutable } from "../src/agents/runtime/cliAgentExecutor";
import { LocalAgentExecutor } from "../src/agents/runtime/localAgentExecutor";
import type { AgentExecutionEvent, AgentExecutor } from "../src/agents/runtime/types";
import path from "node:path";

describe("Agent backend abstraction", () => {
  test("migrates legacy model/provider records into api backend", () => {
    const migrated = migrateAgentRecord({
      id: "agent-1",
      name: "Reviewer",
      model: "claude-3-5-sonnet",
      provider: "anthropic",
      systemPrompt: "review code",
      tools: [],
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(migrated.backend).toEqual({
      type: "api",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
    });
    expect(agentBackendLabel(migrated.backend)).toBe("claude-3-5-sonnet");
  });

  test("createAgentRecord defaults to api/openai backend", () => {
    const agent = createAgentRecord({ name: "Planner" });
    expect(agent.backend).toEqual({ type: "api", provider: "openai", model: "gpt-4o" });
  });
});

describe("AgentExecutorFactory", () => {
  const factory = new AgentExecutorFactory();

  test("resolves api backend to ApiAgentExecutor", () => {
    const executor = factory.create({ type: "api", provider: "openai", model: "gpt-4o" });
    expect(executor).toBeInstanceOf(ApiAgentExecutor);
  });

  test("unknown backends fail explicitly", async () => {
    const backend: AgentBackend = { type: "local", provider: "unknown", model: "x" };
    const executor = factory.create(backend);
    const agent = createAgentRecord({ backend });

    const events: AgentExecutionEvent[] = [];
    await expect(async () => {
      for await (const event of executor.execute({
        agent,
        input: { prompt: "hi" },
        runId: "run-1",
        nodeId: "node-1",
      })) {
        events.push(event);
      }
    }).rejects.toBeInstanceOf(UnsupportedBackendError);

    expect(events.some((event) => event.type === "agent.failed")).toBe(true);
    const failed = events.find((e) => e.type === "agent.failed");
    expect(JSON.stringify(failed?.payload)).toMatch(/not implemented/i);
  });
});

describe("AgentRuntime", () => {
  test("delegates to the factory-selected executor", async () => {
    const calls: string[] = [];
    const stub: AgentExecutor = {
      async *execute() {
        calls.push("executed");
        yield {
          type: "agent.completed",
          timestamp: new Date().toISOString(),
          payload: { content: "ok" },
        };
      },
    };

    const factory = {
      create: (backend: AgentBackend) => {
        calls.push(`create:${backend.type}`);
        return stub;
      },
    };

    const runtime = new AgentRuntime(factory as AgentExecutorFactory);
    const agent = createAgentRecord();
    const events: AgentExecutionEvent[] = [];
    for await (const event of runtime.execute({
      agent,
      input: "hello",
      runId: "run-1",
      nodeId: "agent-node",
    })) {
      events.push(event);
    }

    expect(calls).toEqual(["create:api", "executed"]);
    expect(events[0]?.type).toBe("agent.completed");
  });

  test("blocks CLI execution until a server-side policy explicitly permits it", async () => {
    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex", executable: "codex" } });
    const runtime = new AgentRuntime({ create: jest.fn() } as unknown as AgentExecutorFactory);
    const events: AgentExecutionEvent[] = [];
    await expect(async () => {
      for await (const event of runtime.execute({ agent, input: "hi", runId: "run", nodeId: "node" })) events.push(event);
    }).rejects.toBeInstanceOf(ExecutionPolicyError);
    expect(events).toMatchObject([{ type: "agent.failed", payload: { error: expect.stringMatching(/explicitly allow/i) } }]);
  });

  test("enforces restricted allowedCommands before dispatching CLI execution", async () => {
    const create = jest.fn();
    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex", executable: "codex" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["git"] };
    await expect(async () => {
      for await (const _event of new AgentRuntime({ create } as unknown as AgentExecutorFactory).execute({ agent, input: "hi", runId: "run", nodeId: "node" })) { /* drain */ }
    }).rejects.toThrow(/not permitted/);
    expect(create).not.toHaveBeenCalled();
  });

  test("blocks networked backends when network is denied", async () => {
    const agent = createAgentRecord();
    agent.executionPolicy = { network: false };
    await expect(async () => {
      for await (const _event of new AgentRuntime().execute({ agent, input: "hi", runId: "run", nodeId: "node" })) { /* drain */ }
    }).rejects.toThrow(/forbids network/);
  });
});

describe("CLI and local executors", () => {
  test("runs a permitted CLI command directly with stdin and an approved workspace", async () => {
    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "CLI answer", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex", executable: "codex", args: ["exec", "--json"] } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    const events: AgentExecutionEvent[] = [];
    const serverPolicy = { enabled: true, workerMode: "local" as const, allowedExecutables: ["codex"], workspaceRoots: ["/workspace"], maxOutputBytes: 1024 };

    for await (const event of new CliAgentExecutor(workerRuntime, serverPolicy).execute({ agent, input: "summarize", runId: "r", nodeId: "n" })) events.push(event);

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ executable: expect.stringContaining("codex"), args: ["exec", "--json", "-"], cwd: "/workspace" }),
      undefined,
      expect.stringContaining("USER INPUT:\nsummarize"),
      undefined,
    );
    expect(events.map(event => event.type)).toEqual(["agent.started", "agent.output", "agent.completed"]);
    expect((events[2].payload as { content: string }).content).toBe("CLI answer");
  });

  test("resolves trusted launch secrets from the exact server credential context", async () => {
    const secret = "dummy-credential-value";
    const start = jest.fn(async (..._arguments: any[]) => ({ workerId: "w1", runId: "run-credential" }));
    const workerRuntime = { start, wait: jest.fn(async () => ({ code: 0, stdout: "ok", stderr: "", reason: "completed" })), cleanup: jest.fn() } as any;
    const resolve = jest.fn(async () => ({ environment: { OPENAI_API_KEY: secret } }));
    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex" } });
    agent.id = "agent-credential";
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    const events: AgentExecutionEvent[] = [];

    for await (const event of new CliAgentExecutor(workerRuntime, {
      enabled: true,
      workerMode: "container",
      allowedExecutables: ["codex"],
      workspaceRoots: ["/workspace"],
      maxOutputBytes: 4096,
    }, { resolve }).execute({
      agent,
      input: "hi",
      runId: "run-credential",
      nodeId: "node-credential",
      credentialPrincipal: { tenantId: "tenant-a", principalId: "user-a" },
    })) events.push(event);

    expect(resolve).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      principalId: "user-a",
      runId: "run-credential",
      agentId: "agent-credential",
      provider: "codex",
    });
    expect(start.mock.calls[0][3]).toEqual({ environment: { OPENAI_API_KEY: secret } });
    expect(JSON.stringify(start.mock.calls[0][0])).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  test("does not resolve credentials without trusted principal context and sanitizes resolver failures", async () => {
    const secret = "dummy-resolver-error-secret";
    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const workerRuntime = { start, wait: jest.fn(async () => ({ code: 0, stdout: "ok", stderr: "", reason: "completed" })), cleanup: jest.fn() } as any;
    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    const runtimePolicy = { enabled: true, workerMode: "container" as const, allowedExecutables: ["codex"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096 };
    const resolve = jest.fn(async () => { throw new Error(secret); });

    for await (const _event of new CliAgentExecutor(workerRuntime, runtimePolicy, { resolve }).execute({ agent, input: "hi", runId: "r", nodeId: "n" })) { /* drain */ }
    expect(resolve).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(expect.anything(), undefined, expect.any(String), undefined);

    const events: AgentExecutionEvent[] = [];
    await expect(async () => {
      for await (const event of new CliAgentExecutor(workerRuntime, runtimePolicy, { resolve }).execute({
        agent,
        input: "hi",
        runId: "r2",
        nodeId: "n2",
        credentialPrincipal: { tenantId: "tenant", principalId: "user" },
      })) events.push(event);
    }).rejects.toThrow("CLI credential resolution failed");
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  test("calls the Ollama local API with its configured model and normalized events", async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ message: { content: "local answer" } }), { status: 200 }));
    const agent = createAgentRecord({ backend: { type: "local", provider: "ollama", model: "llama3", baseUrl: "http://ollama.test" } });
    const events: AgentExecutionEvent[] = [];
    for await (const event of new LocalAgentExecutor(fetchImpl, { allowedOrigins: ["http://ollama.test"] }).execute({ agent, input: "hello", runId: "r", nodeId: "n" })) events.push(event);
    expect(fetchImpl).toHaveBeenCalledWith(new URL("http://ollama.test/api/chat"), expect.objectContaining({ method: "POST" }));
    expect(events.map(event => event.type)).toEqual(["agent.started", "llm.started", "llm.completed", "agent.output", "agent.completed"]);
    expect((events[4].payload as { content: string }).content).toBe("local answer");
  });

  test("uses safe non-interactive defaults for agy and includes model and prompt context", async () => {
    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "Agy answer", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

    const agent = createAgentRecord({ backend: { type: "cli", provider: "agy", model: "gpt-5" } });
    agent.systemPrompt = "Be concise.";
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace/project", allowedCommands: ["agy"] };
    const runtimePolicy = { enabled: true, workerMode: "local" as const, allowedExecutables: ["agy"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096 };

    for await (const _event of new CliAgentExecutor(workerRuntime, runtimePolicy).execute({ agent, input: { task: "review" }, runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ executable: expect.stringContaining("agy"), args: ["--print", "--output-format", "text", "--disable-slash-commands", "--model", "gpt-5"], cwd: "/workspace/project" }),
      undefined,
      expect.stringContaining("SYSTEM INSTRUCTIONS"),
      undefined,
    );
    expect((start.mock.calls[0] as any[])[2]).toContain("review");
  });

  test("forces saved Codex options through exec mode instead of starting the TUI", async () => {
    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "Codex answer", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex", args: ["--json"] } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    for await (const _event of new CliAgentExecutor(workerRuntime, { enabled: true, workerMode: "local", allowedExecutables: ["codex"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096 }).execute({ agent, input: "test", runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ executable: expect.stringContaining("codex"), args: ["exec", "--json", "-"] }),
      undefined,
      expect.any(String),
      undefined,
    );
  });

  test("blocks CLI executables and workspaces outside server-owned allowlists", async () => {
    const start = jest.fn().mockRejectedValue(new Error("workspace is not allowed"));
    const workerRuntime = { start } as any;

    const agent = createAgentRecord({ backend: { type: "cli", provider: "agy" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/tmp/escape", allowedCommands: ["agy"] };
    const runtimePolicy = { enabled: true, workerMode: "local" as const, allowedExecutables: ["agy"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096 };
    await expect(async () => { for await (const _event of new CliAgentExecutor(workerRuntime, runtimePolicy).execute({ agent, input: {}, runId: "r", nodeId: "n" })) { /* drain */ } }).rejects.toThrow(/workspace.*not allowed/i);
  });

  test("resolves bare CLI names to an allowlisted absolute executable for shell-less spawn", async () => {
    const absolute = process.platform === "win32" ? "C:\\tools\\codex.exe" : "/usr/local/bin/codex";
    expect(resolveCliSpawnExecutable("codex", ["codex", absolute])).toBe(require("node:path").resolve(absolute));

    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "ok", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    for await (const _event of new CliAgentExecutor(workerRuntime, { enabled: true, workerMode: "local", allowedExecutables: ["codex", absolute], workspaceRoots: ["/workspace"], maxOutputBytes: 4096 }).execute({ agent, input: "hi", runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ executable: require("node:path").resolve(absolute) }),
      undefined,
      expect.any(String),
      undefined,
    );
  });

  test("preserves container command names instead of resolving them against the host", async () => {
    const hostExecutable = process.platform === "win32" ? "C:\\host-tools\\codex.exe" : "/host-tools/codex";
    expect(resolveCliSpawnExecutable("codex", ["codex", hostExecutable], { PATH: path.dirname(hostExecutable) }, "container")).toBe("codex");
    expect(resolveCliSpawnExecutable("/usr/local/bin/claude", ["/usr/local/bin/claude"], { PATH: path.dirname(hostExecutable) }, "container")).toBe("/usr/local/bin/claude");

    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const workerRuntime = { start, wait: jest.fn(async () => ({ code: 0, stdout: "ok", stderr: "", reason: "completed" })), cleanup: jest.fn() } as any;
    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };

    for await (const _event of new CliAgentExecutor(workerRuntime, { enabled: true, workerMode: "container", allowedExecutables: ["codex"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096 }).execute({ agent, input: "hi", runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(expect.objectContaining({ executable: "codex" }), undefined, expect.any(String), undefined);
    expect(JSON.stringify(start.mock.calls)).not.toContain(hostExecutable);
  });

  test("rejects unknown CLI worker modes instead of falling back to local execution", () => {
    expect(() => cliRuntimePolicyFromEnvironment({ CLI_WORKER_MODE: "dockre" })).toThrow(/Invalid CLI_WORKER_MODE/);

    const previous = process.env.CLI_WORKER_MODE;
    process.env.CLI_WORKER_MODE = "dockre";
    try {
      expect(() => new AgentRuntime({ create: jest.fn() } as unknown as AgentExecutorFactory)).toThrow(/Invalid CLI_WORKER_MODE/);
    } finally {
      if (previous === undefined) delete process.env.CLI_WORKER_MODE;
      else process.env.CLI_WORKER_MODE = previous;
    }
  });

  test("calls LM Studio's OpenAI-compatible endpoint with sampling settings", async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "LM answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }), { status: 200 }));
    const agent = createAgentRecord({ backend: { type: "local", provider: "lmstudio", model: "local-model", baseUrl: "http://lm.test", settings: { temperature: 0.2, maxTokens: 300 } } });
    const events: AgentExecutionEvent[] = [];
    for await (const event of new LocalAgentExecutor(fetchImpl, { allowedOrigins: ["http://lm.test"] }).execute({ agent, input: "hello", runId: "r", nodeId: "n" })) events.push(event);
    expect(fetchImpl).toHaveBeenCalledWith(new URL("http://lm.test/v1/chat/completions"), expect.objectContaining({ body: expect.stringContaining('"max_tokens":300') }));
    expect((events[4].payload as { content: string }).content).toBe("LM answer");
    expect(events[2].payload).toEqual(expect.objectContaining({ usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }, finishReason: "stop" }));
  });

  test("blocks unapproved local-model origins before making a request", async () => {
    const fetchImpl = jest.fn();
    const agent = createAgentRecord({ backend: { type: "local", provider: "ollama", model: "llama3", baseUrl: "http://169.254.169.254" } });
    await expect(async () => { for await (const _event of new LocalAgentExecutor(fetchImpl, { allowedOrigins: ["http://127.0.0.1:11434"] }).execute({ agent, input: "hello", runId: "r", nodeId: "n" })) { /* drain */ } }).rejects.toThrow(/not allowed/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ApiAgentExecutor", () => {
  test("invokes model via factory and emits started/output/completed", async () => {
    const invoke = jest.fn(async () => ({ content: "answer", usage_metadata: { input_tokens: 8, output_tokens: 3, total_tokens: 11 }, response_metadata: { finish_reason: "stop" } }));
    const executor = new ApiAgentExecutor(() => ({
      getModel: (provider, options) => {
        expect(provider).toBe("openai");
        expect(options?.model).toBe("gpt-4o-mini");
        return { invoke };
      },
    }));

    const agent = createAgentRecord({
      backend: { type: "api", provider: "openai", model: "gpt-4o-mini" },
    });
    agent.systemPrompt = "Be brief.";

    const events: AgentExecutionEvent[] = [];
    for await (const event of executor.execute({
      agent,
      input: { q: "2+2" },
      runId: "run-1",
      nodeId: "n1",
    })) {
      events.push(event);
    }

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual([
      "agent.started",
      "llm.started",
      "llm.completed",
      "agent.output",
      "agent.completed",
    ]);
    expect((events[4]?.payload as { content: string }).content).toBe("answer");
    expect(events[2]?.payload).toEqual(expect.objectContaining({ usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 }, finishReason: "stop" }));
  });
});

describe("mapAgentExecutionEvent", () => {
  test("maps executor events into RunEvents", () => {
    const [runEvent] = mapAgentExecutionEvent(
      {
        type: "agent.failed",
        timestamp: "2026-01-01T00:00:00.000Z",
        agentId: "a1",
        nodeId: "n1",
        runId: "r1",
        payload: { error: "boom" },
      },
      "r1"
    );

    expect(runEvent.type).toBe("agent.failed");
    expect(runEvent.agentId).toBe("a1");
    expect(runEvent.nodeId).toBe("n1");
    expect(runEvent.payload).toEqual({ error: "boom" });
  });
});
