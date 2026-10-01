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
import { ExecutionPolicyError, assertExecutionPolicy } from "../src/agents/runtime/executionPolicy";
import { defaultCliExecutable } from "../src/agents/runtime/cliProviderDefaults";
import { CliAgentExecutor, cliRuntimePolicyFromEnvironment, codexArgs, cursorArgs, agyArgs, agyStreamInput, parseAgyStreamOutput, resolveCliSpawnExecutable, cliExecutableAvailable, type CliWorkerMode } from "../src/agents/runtime/cliAgentExecutor";
import { ContainerWorkerRuntime } from "../src/agents/runtime/workerRuntime";
import { LocalAgentExecutor } from "../src/agents/runtime/localAgentExecutor";
import type { AgentExecutionEvent, AgentExecutor } from "../src/agents/runtime/types";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

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
      expect.objectContaining({ executable: expect.stringContaining("codex"), args: ["exec", "--skip-git-repo-check", "--json", "-"], cwd: "/workspace" }),
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
    const streamStdout = [
      JSON.stringify({ event: "init", session_id: "sess-1" }),
      JSON.stringify({ event: "step", step: 1 }),
      JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "Agy answer" } }),
    ].join("\n");
    const wait = jest.fn(async () => ({ code: 0, stdout: streamStdout, stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

    const agent = createAgentRecord({ backend: { type: "cli", provider: "agy", model: "gpt-5" } });
    agent.systemPrompt = "Be concise.";
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace/project", allowedCommands: ["agy"] };
    const runtimePolicy = { enabled: true, workerMode: "local" as const, allowedExecutables: ["agy"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096 };

    const events: AgentExecutionEvent[] = [];
    for await (const event of new CliAgentExecutor(workerRuntime, runtimePolicy).execute({ agent, input: { task: "review" }, runId: "r", nodeId: "n" })) {
      events.push(event);
    }

    const expectedArgs = ["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands", "--model", "gpt-5"];
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: expect.stringContaining("agy"),
        args: expectedArgs,
        cwd: "/workspace/project",
      }),
      undefined,
      expect.any(String),
      undefined,
    );

    const callArgs = ((start.mock.calls as any[][])[0][0] as { args: string[] }).args;
    expect(JSON.stringify(callArgs)).not.toContain("review");
    expect(JSON.stringify(callArgs)).not.toContain("concise");

    const decodedStdin = JSON.parse((start.mock.calls as any[][])[0][2]);
    expect(decodedStdin).toEqual({
      event: "user",
      message: {
        role: "user",
        content: expect.stringContaining("SYSTEM INSTRUCTIONS:\nBe concise."),
      },
    });
    expect(decodedStdin.message.content).toContain("review");

    expect(events.map((e) => e.type)).toEqual(["agent.started", "agent.output", "agent.completed"]);
    expect((events[1].payload as { content: string }).content).toBe("Agy answer");
    expect((events[2].payload as { content: string }).content).toBe("Agy answer");
  });

  describe("agyArgs helper", () => {
    test("provides deterministic noninteractive defaults for empty or undefined args", () => {
      expect(agyArgs(undefined)).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs([])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
    });

    test("removes --print and does not include it", () => {
      expect(agyArgs(["--print"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--print", "text"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--print", "--print", "--print"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--verbose", "--print"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands", "--verbose"]);
    });

    test("forces --output-format stream-json even if a different format was passed", () => {
      expect(agyArgs(["--output-format", "json"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--output-format=json"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--output-format", "text"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
    });

    test("ensures --disable-slash-commands is present and deduplicated", () => {
      expect(agyArgs(["--disable-slash-commands"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--disable-slash-commands", "--verbose"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands", "--verbose"]);
    });

    test("preserves ordinary explicit flags", () => {
      expect(agyArgs(["--verbose", "--thinking", "medium"])).toEqual([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--disable-slash-commands",
        "--verbose",
        "--thinking",
        "medium",
      ]);
    });

    test("strips all --input-format forms and separate values", () => {
      expect(agyArgs(["--input-format", "text"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--input-format=text"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--input-format", "json"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--input-format=json"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--input-format", "stream-json"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
      expect(agyArgs(["--input-format=stream-json"])).toEqual(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
    });

    test("rejects or removes conflicting interactive and session flags without adding bypass permissions", () => {
      const explicit = [
        "--prompt-interactive",
        "--continue",
        "-c",
        "-i",
        "--remote-control",
        "--input-format",
        "stream-json",
        "--input-format=stream-json",
        "--input-format",
        "text",
        "--input-format=json",
        "--custom-flag",
        "value",
      ];
      const result = agyArgs(explicit);
      expect(result).toEqual([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--disable-slash-commands",
        "--custom-flag",
        "value",
      ]);
      expect(result).not.toContain("--prompt-interactive");
      expect(result).not.toContain("--continue");
      expect(result).not.toContain("-c");
      expect(result).not.toContain("-i");
      expect(result).not.toContain("--remote-control");
      expect(result).not.toContain("--dangerously-skip-permissions");
      expect(result).not.toContain("--print");
    });
  });

  describe("parseAgyStreamOutput and agyStreamInput helpers", () => {
    test("encodes agyStreamInput with event=user and role=user ending with newline", () => {
      const encoded = agyStreamInput("test prompt");
      expect(encoded.endsWith("\n")).toBe(true);
      expect(JSON.parse(encoded)).toEqual({
        event: "user",
        message: {
          role: "user",
          content: "test prompt",
        },
      });
    });

    test("parses successful final result from nested NDJSON stream", () => {
      const stdout = [
        JSON.stringify({ event: "init", id: "1" }),
        JSON.stringify({ event: "step", step: 1 }),
        JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "all done!" } }),
      ].join("\n");
      expect(parseAgyStreamOutput(stdout)).toBe("all done!");
    });

    test("throws generic non-secret error for malformed line", () => {
      const secret = "SUPER_SECRET_TOKEN";
      const stdout = `{"event":"init"}\n{invalid_json:${secret}\n`;
      expect(() => parseAgyStreamOutput(stdout)).toThrow(/Failed to parse agy stream output: invalid JSON/);
      try {
        parseAgyStreamOutput(stdout);
      } catch (err: any) {
        expect(err.message).not.toContain(secret);
      }
    });

    test("throws generic non-secret error when no result event is present", () => {
      const secret = "SENSITIVE_DATA_123";
      const stdout = [
        JSON.stringify({ event: "init", session: secret }),
        JSON.stringify({ event: "step", step: 1, secret }),
      ].join("\n");
      expect(() => parseAgyStreamOutput(stdout)).toThrow(/missing final result event/);
      try {
        parseAgyStreamOutput(stdout);
      } catch (err: any) {
        expect(err.message).not.toContain(secret);
      }
    });

    test("throws generic non-secret error on nested ERROR status", () => {
      const secret = "API_KEY_LEAK";
      const failedStdout = JSON.stringify({ event: "result", result: { status: "ERROR", error: secret } });
      expect(() => parseAgyStreamOutput(failedStdout)).toThrow(/Agy execution failed or returned invalid response/);
      try {
        parseAgyStreamOutput(failedStdout);
      } catch (err: any) {
        expect(err.message).not.toContain(secret);
      }
    });

    test("throws generic non-secret error on nested SUCCESS with non-string response", () => {
      const secret = "SECRET_OBJ_DATA";
      const invalidRespStdout = JSON.stringify({ event: "result", result: { status: "SUCCESS", response: { secret } } });
      expect(() => parseAgyStreamOutput(invalidRespStdout)).toThrow(/Agy execution failed or returned invalid response/);
      try {
        parseAgyStreamOutput(invalidRespStdout);
      } catch (err: any) {
        expect(err.message).not.toContain(secret);
      }
    });
  });

  test("forces saved Codex options through exec mode instead of starting the TUI", async () => {
    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "Codex answer", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex", args: ["--json"] } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    for await (const _event of new CliAgentExecutor(workerRuntime, { enabled: true, workerMode: "local", allowedExecutables: ["codex"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096 }).execute({ agent, input: "test", runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ executable: expect.stringContaining("codex"), args: ["exec", "--skip-git-repo-check", "--json", "-"] }),
      undefined,
      expect.any(String),
      undefined,
    );
  });

  test("keeps local Codex runs free of sandbox bypass and session-ephemeral flags", () => {
    expect(codexArgs(["--json"], "local")).toEqual(["exec", "--skip-git-repo-check", "--json", "-"]);
  });

  test("auto-injects container Codex defaults once without duplicating explicit flags", () => {
    expect(codexArgs([], "container")).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--ephemeral",
      "-",
    ]);
    expect(codexArgs(["--skip-git-repo-check", "--ephemeral"], "container")).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--ephemeral",
      "-",
    ]);
    expect(codexArgs(["exec", "--ephemeral"], "container")).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--ephemeral",
      "-",
    ]);
  });

  test("runs a non-Git workspace Codex agent without the trusted-directory failure", async () => {
    const start = jest.fn(async (..._args: any[]) => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "hi", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    for await (const _event of new CliAgentExecutor(workerRuntime, {
      enabled: true, workerMode: "local", allowedExecutables: ["codex"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096,
    }).execute({ agent, input: "hi", runId: "r", nodeId: "n" })) { /* drain */ }

    const args = (start.mock.calls[0][0] as { args: string[] }).args;
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toEqual(expect.arrayContaining(["exec", "-"]));
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--ephemeral");
  });

  test("keeps Claude permissions enabled for local workers", async () => {
    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "Claude answer", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;
    const agent = createAgentRecord({ backend: { type: "cli", provider: "claude-code", model: "claude-sonnet-4-5" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["claude"] };
    for await (const _event of new CliAgentExecutor(workerRuntime, {
      enabled: true, workerMode: "local", allowedExecutables: ["claude"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096,
    }).execute({ agent, input: "edit", runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: expect.stringContaining("claude"),
        args: ["--print", "--output-format", "text", "--model", "claude-sonnet-4-5"],
      }),
      undefined,
      expect.any(String),
      undefined,
    );
  });

  test("uses Claude permission bypass only for container workers", async () => {
    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "Claude answer", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;
    const agent = createAgentRecord({ backend: { type: "cli", provider: "claude-code" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["claude"] };

    for await (const _event of new CliAgentExecutor(workerRuntime, {
      enabled: true, workerMode: "container", allowedExecutables: ["claude"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096,
    }).execute({ agent, input: "edit", runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--print", "--output-format", "text", "--dangerously-skip-permissions"] }),
      undefined,
      expect.any(String),
      undefined,
    );
  });

  test("keeps Cursor force disabled for local workers", async () => {
    expect(cursorArgs([], false)).toEqual(["-p", "--output-format", "text", "--trust"]);
    expect(cursorArgs(["-p", "--force"], false)).toEqual(["-p", "--force", "--output-format", "text", "--trust"]);

    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "Cursor answer", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;
    const agent = createAgentRecord({ backend: { type: "cli", provider: "cursor", model: "composer-2.5" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["agent"] };
    for await (const _event of new CliAgentExecutor(workerRuntime, {
      enabled: true, workerMode: "local", allowedExecutables: ["agent"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096,
    }).execute({ agent, input: "edit", runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: expect.stringContaining("agent"),
        args: ["-p", "--output-format", "text", "--trust", "--model", "composer-2.5"],
      }),
      undefined,
      expect.any(String),
      undefined,
    );
  });

  test("uses Cursor --force only for container workers", async () => {
    expect(cursorArgs([], true)).toEqual(["-p", "--output-format", "text", "--trust", "--force"]);

    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "Cursor answer", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;
    const agent = createAgentRecord({ backend: { type: "cli", provider: "cursor" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["agent"] };

    for await (const _event of new CliAgentExecutor(workerRuntime, {
      enabled: true, workerMode: "container", allowedExecutables: ["agent"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096,
    }).execute({ agent, input: "edit", runId: "r", nodeId: "n" })) { /* drain */ }

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["-p", "--output-format", "text", "--trust", "--force"] }),
      undefined,
      expect.any(String),
      undefined,
    );
  });

  test("resolves provider default executables from one shared mapping", () => {
    expect(defaultCliExecutable("codex")).toBe("codex");
    expect(defaultCliExecutable("claude-code")).toBe("claude");
    expect(defaultCliExecutable("cursor")).toBe("agent");
    expect(defaultCliExecutable("agy")).toBe("agy");
    // Extensible providers fall back to the provider id itself.
    expect(defaultCliExecutable("unknown-cli")).toBe("unknown-cli");
  });

  test("restricted policy validates the provider default executable without an explicit executable", () => {
    // claude-code maps to claude
    const claudeAgent = createAgentRecord({ backend: { type: "cli", provider: "claude-code" } });
    claudeAgent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["claude"] };
    expect(() => assertExecutionPolicy(claudeAgent)).not.toThrow();

    // cursor maps to agent
    const cursorAgent = createAgentRecord({ backend: { type: "cli", provider: "cursor" } });
    cursorAgent.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["agent"] };
    expect(() => assertExecutionPolicy(cursorAgent)).not.toThrow();

    // codex and agy map to themselves
    const codexAgent = createAgentRecord({ backend: { type: "cli", provider: "codex" } });
    codexAgent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["codex"] };
    expect(() => assertExecutionPolicy(codexAgent)).not.toThrow();

    const agyAgent = createAgentRecord({ backend: { type: "cli", provider: "agy" } });
    agyAgent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["agy"] };
    expect(() => assertExecutionPolicy(agyAgent)).not.toThrow();
  });

  test("restricted policy honors an explicit custom executable over provider defaults", () => {
    const agent = createAgentRecord({ backend: { type: "cli", provider: "cursor", executable: "/opt/cursor/agent" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["/opt/cursor/agent"] };
    expect(() => assertExecutionPolicy(agent)).not.toThrow();

    // A custom executable is not satisfied by the provider default name.
    const rejected = createAgentRecord({ backend: { type: "cli", provider: "cursor", executable: "/opt/cursor/agent-cli" } });
    rejected.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["agent"] };
    expect(() => assertExecutionPolicy(rejected)).toThrow(ExecutionPolicyError);
  });

  test("rejects Cursor container execution when agent is not server-allowlisted", async () => {
    const spawnFn = jest.fn();
    const containerPolicy = {
      image: `registry.example/agent@sha256:${"a".repeat(64)}`,
      dockerExecutable: process.execPath,
      allowNetwork: true,
      memory: "512m",
      cpus: "0.5",
      pidsLimit: 64,
      user: "65534:65534",
    };
    const cliPolicy = {
      enabled: true, workerMode: "container" as const, allowedExecutables: ["codex", "claude"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096,
    };
    // Real ContainerWorkerRuntime: the allowlist check must fire before any Docker call.
    const workerRuntime = new ContainerWorkerRuntime(cliPolicy, containerPolicy, spawnFn as any);
    const agent = createAgentRecord({ backend: { type: "cli", provider: "cursor" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["agent"] };

    await expect(async () => {
      for await (const _event of new CliAgentExecutor(workerRuntime, cliPolicy).execute({ agent, input: "hi", runId: "r", nodeId: "n" })) { /* drain */ }
    }).rejects.toThrow(/not allowed by the server runtime/i);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  test("does not deliver Cursor credentials when environment delivery is disabled", async () => {
    const start = jest.fn(async () => ({ workerId: "w1", runId: "r" }));
    const wait = jest.fn(async () => ({ code: 0, stdout: "ok", stderr: "", reason: "completed" }));
    const workerRuntime = { start, wait, cleanup: jest.fn() } as any;
    const resolve = jest.fn(async () => undefined); // CLI_CREDENTIAL_ENVIRONMENT_ENABLED=false
    const agent = createAgentRecord({ backend: { type: "cli", provider: "cursor" } });
    agent.executionPolicy = { shell: "restricted", filesystem: "read-write", workspaceRoot: "/workspace", allowedCommands: ["agent"] };

    for await (const _event of new CliAgentExecutor(workerRuntime, {
      enabled: true, workerMode: "container", allowedExecutables: ["agent"], workspaceRoots: ["/workspace"], maxOutputBytes: 4096,
    }, { resolve }).execute({ agent, input: "hi", runId: "r", nodeId: "n" })) { /* drain */ }

    // The resolver is still consulted for the trusted principal, but no secret
    // material is attached to the worker launch when delivery is disabled.
    expect(start).toHaveBeenCalledWith(expect.anything(), undefined, expect.any(String), undefined);
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

  describe("portable executable resolution and availability", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("an exactly allowlisted bare agy stays bare and cliExecutableAvailable finds it via PATH", () => {
      const execName = process.platform === "win32" ? "agy.exe" : "agy";
      const filePath = path.join(tempDir, execName);
      fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const fakeEnv = { PATH: tempDir };
      expect(cliExecutableAvailable("agy", fakeEnv)).toBe(true);
      expect(resolveCliSpawnExecutable("agy", ["agy"], fakeEnv)).toBe("agy");
    });

    test("an explicitly allowlisted absolute path resolves absolute", () => {
      const execName = process.platform === "win32" ? "tool.exe" : "tool";
      const filePath = path.join(tempDir, execName);
      fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const resolved = resolveCliSpawnExecutable(filePath, [filePath], { PATH: "" });
      expect(resolved).toBe(path.resolve(filePath));
      expect(cliExecutableAvailable(filePath)).toBe(true);
    });

    test("a non-executable file is unavailable", () => {
      const nonExecName = process.platform === "win32" ? "nonexec.exe" : "nonexec";
      const filePath = path.join(tempDir, nonExecName);
      fs.writeFileSync(filePath, "data", { mode: 0o644 });
      if (process.platform !== "win32") {
        fs.chmodSync(filePath, 0o644);
      }

      const fakeEnv = { PATH: tempDir };
      if (process.platform !== "win32") {
        expect(cliExecutableAvailable(filePath)).toBe(false);
        expect(cliExecutableAvailable(nonExecName, fakeEnv)).toBe(false);
      } else {
        // On platforms where execute bits are checked via X_OK
        expect(typeof cliExecutableAvailable(filePath)).toBe("boolean");
      }
    });

    test("an explicit absolute path is never rewritten merely because bare agy is allowlisted", () => {
      const customExec = path.join(tempDir, process.platform === "win32" ? "custom-bin.exe" : "custom-bin");
      fs.writeFileSync(customExec, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const resolved = resolveCliSpawnExecutable(customExec, ["agy"], { PATH: tempDir });
      expect(resolved).toBe(path.resolve(customExec));
      expect(resolved).not.toBe("agy");
    });
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
