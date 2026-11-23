import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAgentRecord, createToolRecord, type AgentRecord, type ToolRecord } from "@multi-agent/types";
import {
  CliAgentExecutor,
  appendCodexMcpConfigArgs,
  startCliMcpBridge,
  STUDIO_MCP_BRIDGE_TOKEN_ENV,
  STUDIO_MCP_BRIDGE_URL_ENV,
  type AgentExecutionEvent,
  type WorkerLaunchSecrets,
} from "../src/agents/runtime";
import type {
  WorkerEvent,
  WorkerHandle,
  WorkerResult,
  WorkerRuntime,
  WorkerSpec,
} from "../src/agents/runtime/workerRuntime";
import { ToolRuntime } from "../src/tools/toolRuntime";
import { executeBrowserQaProbe } from "../src/tools/deliverySystemTools";
import { executeVeloraGraphifyTool } from "../src/tools/veloraGraphifyTool";

function createTestTool(overrides: Partial<ToolRecord> = {}): ToolRecord {
  const base = createToolRecord({
    name: overrides.name ?? "echo_studio_tool",
    category: "function",
    description: overrides.description ?? "Echoes input arguments for testing.",
    impact: overrides.impact ?? "read-only",
    inputSchema: overrides.inputSchema ?? {
      type: "object",
      properties: {
        message: { type: "string" },
      },
    },
    outputSchema: { type: "object", properties: {} },
    configuration: overrides.configuration ?? { source: "studio-bridge-test" },
    executionPolicy: overrides.executionPolicy ?? {
      requiresApproval: false,
      idempotency: "optional",
      retryable: true,
    },
  });
  return {
    ...base,
    ...overrides,
  };
}

function createCodexAgent(workspaceRoot: string, tools: string[]): AgentRecord {
  const base = createAgentRecord({
    name: "Test Codex Agent",
    description: "CLI agent for MCP bridge tests",
    systemPrompt: "Use your assigned Studio MCP tools.",
    tools,
    backend: {
      type: "cli",
      provider: "codex",
      model: "gpt-6-luna",
      args: ["--json"],
    },
    executionPolicy: {
      workspaceRoot,
      filesystem: "read-write",
      network: false,
    },
  });
  return {
    ...base,
    id: "agent-test-codex-mcp",
  };
}

function postLoopback(
  urlString: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const serialized = body !== undefined ? JSON.stringify(body) : "";
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        agent: false,
        headers: {
          ...(serialized ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(serialized, "utf8")) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (serialized) req.write(serialized);
    req.end();
  });
}

function sendStdioRpc(
  bridgeScriptPath: string,
  env: Record<string, string>,
  messages: unknown[],
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgeScriptPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`stdio bridge exited with code ${String(code)}: ${stderr}`));
        return;
      }
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      resolve(lines);
    });
    for (const msg of messages) {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    }
    child.stdin.end();
  });
}

describe("CLI run-scoped MCP bridge", () => {
  it("handles initialize, tools/list, tools/call, unauthorized tool, and policy rejection over stdio", async () => {
    const toolRuntime = new ToolRuntime();
    const allowedTool = createTestTool({ id: "tool-echo", name: "echo_studio_tool" });
    const approvalTool = createTestTool({
      id: "tool-needs-approval",
      name: "dangerous_write_tool",
      impact: "write",
      executionPolicy: { requiresApproval: true, idempotency: "required", retryable: false },
    });

    const events: AgentExecutionEvent[] = [];
    const bridge = await startCliMcpBridge({
      runId: "run-mcp-1",
      nodeId: "node-stage8",
      agentId: "agent-stage8",
      resolvedTools: [allowedTool, approvalTool],
      toolRuntime,
      onEvent: (ev) => events.push(ev),
    });

    try {
      // Direct unauthenticated HTTP request is rejected
      const unauthRes = await postLoopback(`${bridge.url}/tools/list`);
      expect(unauthRes.status).toBe(401);

      const wrongTokenRes = await postLoopback(`${bridge.url}/tools/list`, {
        authorization: "Bearer wrong-token",
      });
      expect(wrongTokenRes.status).toBe(401);

      const responses = await sendStdioRpc(bridge.bridgeScriptPath, bridge.env, [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "echo_studio_tool", arguments: { message: "hello" } },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "unassigned_tool", arguments: {} },
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "dangerous_write_tool", arguments: {} },
        },
      ]);

      expect(responses).toHaveLength(5);

      // 1. initialize
      expect((responses[0].result as Record<string, unknown>).protocolVersion).toBe("2025-03-26");
      expect((responses[0].result as Record<string, unknown>).capabilities).toEqual({ tools: {} });

      // 2. tools/list
      const listed = ((responses[1].result as Record<string, unknown>).tools as Array<{ name: string }>);
      expect(listed.map((t) => t.name)).toEqual(["echo_studio_tool", "dangerous_write_tool"]);

      // 3. tools/call authorized
      const callResult = responses[2].result as { isError: boolean; content: Array<{ text: string }> };
      expect(callResult.isError).toBe(false);
      expect(JSON.parse(callResult.content[0].text)).toMatchObject({
        source: "studio-bridge-test",
        message: "hello",
      });

      // 4. tools/call unauthorized
      const unauthCall = responses[3].result as { isError: boolean; content: Array<{ text: string }> };
      expect(unauthCall.isError).toBe(true);
      expect(unauthCall.content[0].text).toContain("not authorized");

      // 5. tools/call policy rejected (requiresApproval: true)
      const policyCall = responses[4].result as { isError: boolean; content: Array<{ text: string }> };
      expect(policyCall.isError).toBe(true);
      expect(policyCall.content[0].text).toContain("requires server approval");

      // Audit events emitted
      expect(events.map((e) => e.type)).toEqual([
        "tool.started",
        "tool.completed",
        "tool.failed",
        "tool.started",
        "tool.failed",
      ]);
      expect((events[2].payload as Record<string, unknown>).code).toBe("TOOL_UNAUTHORIZED");
      expect((events[4].payload as Record<string, unknown>).code).toBe("TOOL_POLICY_REJECTED");
    } finally {
      await bridge.close();
    }
  });

  it("injects Codex -c mcp_servers.studio.* config, passes bridge env via launchSecrets, emits tool events, and closes bridge after execution", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-mcp-bridge-test-"));
    try {
      const toolRuntime = new ToolRuntime();
      const tool = createTestTool({ id: "studio_status_tool", name: "studio_status_tool" });
      const agent = createCodexAgent(tmpDir, [tool.id]);

      let capturedSpec: WorkerSpec | undefined;
      let capturedInput: string | undefined;
      let capturedSecrets: WorkerLaunchSecrets | undefined;
      let capturedBridgeUrl: string | undefined;

      const fakeWorkerRuntime: WorkerRuntime = {
        async start(spec, _signal, input, launchSecrets): Promise<WorkerHandle> {
          capturedSpec = spec;
          capturedInput = input;
          capturedSecrets = launchSecrets;
          capturedBridgeUrl = launchSecrets?.environment?.[STUDIO_MCP_BRIDGE_URL_ENV];
          return { workerId: "w-1", runId: spec.runId };
        },
        async *stream(): AsyncIterable<WorkerEvent> {
          // Simulate Codex calling the MCP bridge while the worker is running
          const url = capturedSecrets!.environment![STUDIO_MCP_BRIDGE_URL_ENV];
          const token = capturedSecrets!.environment![STUDIO_MCP_BRIDGE_TOKEN_ENV];
          const res = await postLoopback(
            `${url}/tools/call`,
            { authorization: `Bearer ${token}` },
            { name: "studio_status_tool", arguments: { action: "status" } },
          );
          expect(res.status).toBe(200);
          yield {
            type: "stdout",
            data: `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } })}\n`,
          };
        },
        async wait(): Promise<WorkerResult> {
          return {
            code: 0,
            stdout: `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } })}\n`,
            stderr: "",
            reason: "completed",
          };
        },
        async cancel() {},
        async cleanup() {},
      };

      const executor = new CliAgentExecutor(fakeWorkerRuntime, {
        enabled: true,
        workerMode: "local",
        allowedExecutables: ["codex"],
        workspaceRoots: [tmpDir],
        maxOutputBytes: 1024 * 1024,
      });

      const events: AgentExecutionEvent[] = [];
      for await (const ev of executor.execute({
        agent,
        input: "sync knowledge",
        runId: "run-codex-mcp",
        nodeId: "node-stage8",
        toolRuntime,
        resolvedTools: [tool],
      })) {
        events.push(ev);
      }

      // Codex args contain -c mcp_servers.studio.* before "-" and NEVER contain the token
      expect(capturedSpec).toBeDefined();
      const argsJoined = capturedSpec!.args.join(" ");
      expect(argsJoined).toContain("mcp_servers.studio.command=");
      expect(argsJoined).toContain("mcp_servers.studio.args=");
      expect(argsJoined).toContain("mcp_servers.studio.env_vars=");
      expect(capturedSpec!.args[capturedSpec!.args.length - 1]).toBe("-");
      const token = capturedSecrets!.environment![STUDIO_MCP_BRIDGE_TOKEN_ENV];
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(argsJoined).not.toContain(token);

      // Prompt lists the available Studio MCP tools
      expect(capturedInput).toContain("AVAILABLE STUDIO MCP TOOLS");
      expect(capturedInput).toContain("studio_status_tool");

      // Events include tool.started and tool.completed
      expect(events.some((e) => e.type === "tool.started")).toBe(true);
      expect(events.some((e) => e.type === "tool.completed")).toBe(true);
      expect(events.some((e) => e.type === "agent.completed")).toBe(true);

      // Bridge server is closed after execution
      await expect(postLoopback(`${capturedBridgeUrl}/tools/list`)).rejects.toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("places Codex MCP config overrides before '-' or before resume sessionId", () => {
    const overrides = ["-c", 'mcp_servers.studio.command="node"'];
    expect(appendCodexMcpConfigArgs(["exec", "--skip-git-repo-check", "-"], overrides)).toEqual([
      "exec",
      "--skip-git-repo-check",
      "-c",
      'mcp_servers.studio.command="node"',
      "-",
    ]);
    expect(
      appendCodexMcpConfigArgs(["exec", "resume", "--skip-git-repo-check", "sess-123", "-"], overrides),
    ).toEqual([
      "exec",
      "resume",
      "--skip-git-repo-check",
      "-c",
      'mcp_servers.studio.command="node"',
      "sess-123",
      "-",
    ]);
  });
});

describe("velora_graphify_tool label support", () => {
  let tmpDir: string;
  let fakeBinDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velora-graphify-test-"));
    fakeBinDir = path.join(tmpDir, "bin");
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeGraphifyPath = path.join(fakeBinDir, "graphify");
    const logPath = path.join(tmpDir, "invocations.log");
    fs.writeFileSync(
      fakeGraphifyPath,
      [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
        'const cmd = process.argv[2];',
        'if (cmd === "update") {',
        '  process.stderr.write("[graphify] community set changed since labeling (10 saved labels, 12 communities now). Run `graphify label` to refresh names with the LLM.\\n");',
        '  process.stdout.write("Rebuilt graphify-out\\n");',
        '  process.exit(0);',
        '}',
        'if (cmd === "label") {',
        '  process.stdout.write("Labeled missing communities\\n");',
        '  process.exit(0);',
        '}',
        'process.stdout.write("ok\\n");',
      ].join("\n"),
      { mode: 0o755 },
    );
    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports labelsNeedRefresh when graphify update warns about stale community labels", () => {
    const res = executeVeloraGraphifyTool({ projectRoot: tmpDir }, { action: "update" });
    expect(res.ok).toBe(true);
    expect(res.labelsNeedRefresh).toBe(true);
    expect(String(res.labelWarning)).toContain("graphify label");
  });

  it("automatically runs graphify label --missing-only when update is called with refreshLabels: true", () => {
    const res = executeVeloraGraphifyTool(
      { projectRoot: tmpDir },
      { action: "update", refreshLabels: true },
    );
    expect(res.ok).toBe(true);
    expect(res.labelsRefreshed).toBe(true);
    expect(res.labelsNeedRefresh).toBeUndefined();
    expect(res.labelRefreshOutput).toBe("Labeled missing communities");

    const logLines = fs
      .readFileSync(path.join(tmpDir, "invocations.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(logLines).toHaveLength(2);
    expect(logLines[0][0]).toBe("update");
    expect(logLines[1]).toEqual(["label", fs.realpathSync(tmpDir), "--missing-only"]);
  });

  it("supports explicit label action with --missing-only by default and optional backend/model", () => {
    const res = executeVeloraGraphifyTool(
      { projectRoot: tmpDir },
      { action: "label", backend: "openai", model: "qwen3.5-4b" },
    );
    expect(res.ok).toBe(true);
    expect(res.action).toBe("label");

    const logLines = fs
      .readFileSync(path.join(tmpDir, "invocations.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(logLines).toEqual([
      ["label", fs.realpathSync(tmpDir), "--missing-only", "--backend=openai", "--model=qwen3.5-4b"],
    ]);
  });
});

describe("browser_qa_probe_tool loopback and auth verification", () => {
  it("probes loopback frontend/backend bypassing env proxy and verifies seeded dev login without leaking tokens", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velora-browser-probe-"));
    const fakeFrontend = http.createServer((_req, res) => {
      res.writeHead(302, { location: "/login" });
      res.end();
    });
    const fakeBackend = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/auth/login/") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
          if (parsed.phone_number === "+10000000001" && parsed.password === "devpass123") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ access: "secret-jwt-should-not-leak", refresh: "secret-refresh" }));
            return;
          }
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ detail: "Invalid credentials" }));
        });
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => fakeFrontend.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => fakeBackend.listen(0, "127.0.0.1", resolve));

    try {
      const fAddr = fakeFrontend.address();
      const bAddr = fakeBackend.address();
      if (!fAddr || typeof fAddr === "string" || !bAddr || typeof bAddr === "string") {
        throw new Error("Failed to bind fake loopback servers");
      }
      const result = await executeBrowserQaProbe(
        { projectRoot: tmpDir },
        {
          frontendUrl: `http://127.0.0.1:${fAddr.port}/delivery-plan`,
          backendUrl: `http://127.0.0.1:${bAddr.port}`,
        },
      );

      expect(result.readyForEndUserSession).toBe(true);
      expect(result.frontend).toMatchObject({ reachable: true, status: 302, location: "/login" });
      expect(result.backend).toMatchObject({ reachable: true, status: 200 });
      expect(result.auth).toMatchObject({
        checked: true,
        authenticated: true,
        status: 200,
        uiLoginPath: "/login",
        playwrightAuthHelper: "apps/web/e2e/helpers/auth.ts",
      });
      expect(String(result.authGuidance)).toContain("apps/web/e2e/helpers/auth.ts");
      expect(JSON.stringify(result)).not.toContain("secret-jwt-should-not-leak");
      expect(JSON.stringify(result)).not.toContain("secret-refresh");
    } finally {
      await new Promise<void>((resolve) => fakeFrontend.close(() => resolve()));
      await new Promise<void>((resolve) => fakeBackend.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("cliMcpBridge survives abrupt client disconnects during slow async tool calls without crashing", async () => {
    const slowTool: ToolRecord = {
      id: "slow_test_tool",
      name: "slow_test_tool",
      category: "function",
      description: "Slow tool for disconnect resilience test",
      enabled: true,
      impact: "read-only",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      configuration: {},
      metadata: {},
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    };

    let releaseTool!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const bridge = await startCliMcpBridge({
      runId: "run-disconnect",
      nodeId: "node-disconnect",
      agentId: "agent-disconnect",
      resolvedTools: [slowTool],
      toolRuntime: {
        execute: async () => {
          await toolStarted;
          return { ok: true };
        },
      },
    });

    try {
      const url = new URL("/tools/call", bridge.url);
      await new Promise<void>((resolve) => {
        const req = http.request({
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          agent: false,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bridge.token}`,
          },
        });
        req.on("error", () => resolve());
        req.write(JSON.stringify({ name: "slow_test_tool", arguments: {} }));
        req.end();
        setTimeout(() => {
          req.destroy();
          resolve();
        }, 40);
      });
      // Release tool AFTER client disconnected — must not throw or crash.
      releaseTool();
      await new Promise((r) => setTimeout(r, 40));

      // Bridge must still accept subsequent healthy requests.
      const listRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const listUrl = new URL("/tools/list", bridge.url);
        const req = http.request(
          {
            hostname: listUrl.hostname,
            port: listUrl.port,
            path: listUrl.pathname,
            method: "POST",
            agent: false,
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${bridge.token}`,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
          },
        );
        req.on("error", reject);
        req.write("{}");
        req.end();
      });
      expect(listRes.status).toBe(200);
    } finally {
      await bridge.close();
    }
  });
});
