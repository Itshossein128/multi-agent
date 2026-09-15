import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createToolRecord, type ToolRecord } from "@multi-agent/types";
import { createToolsRouter } from "../apps/server/src/api/tools";
import { FunctionToolExecutor, assertAllowedWorkspace } from "../src/tools/functionToolExecutor";
import { ToolRuntime } from "../src/tools/toolRuntime";
import { HttpToolExecutor } from "../src/tools/httpToolExecutor";

function json(response: Response) { return response.json(); }

const testPrincipal = { userId: "test-user", tenantId: "test-tenant" };

describe("POST /tools/test", () => {
  const app = createToolsRouter(undefined, undefined, async () => testPrincipal);

  test("executes the function category as a safe local echo", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Echo" }), configuration: { greeting: "hi" } };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: { name: "world" } }) });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ output: { greeting: "hi", name: "world" } });
  });

  test("normalizes PISA intake and reports missing fields without throwing", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "PISA intake" }), configuration: { kind: "pisa-normalize-intake", contractVersion: "pisa.delivery.v1", requiredInputs: "objective,repository" } };
    const output = await new FunctionToolExecutor().execute({ tool, input: { objective: "ship" } });
    expect(output).toMatchObject({ status: "needs_clarification", branch: "implementation", missingFields: ["repository"] });
  });

  test("packages PISA evidence as blocked unless every independent gate passes", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "PISA evidence" }), configuration: { kind: "pisa-package-evidence", artifactType: "pisa.completion_evidence" } };
    const output = await new FunctionToolExecutor().execute({ tool, input: { qaPass: true, securityPass: false, traceableEvidence: true } });
    expect(output).toMatchObject({ status: "blocked", missingRequirements: ["security_pass"] });
  });

  test("packages JSON emitted by an agent when the runtime wraps it as value", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "PISA evidence" }), configuration: { kind: "pisa-package-evidence" } };
    const output = await new FunctionToolExecutor().execute({
      tool,
      input: { value: JSON.stringify({ qaPass: true, securityPass: true, traceableEvidence: true }) },
    });
    expect(output).toMatchObject({ status: "complete", missingRequirements: [] });
  });

  test("executes a configured HTTP endpoint without accepting an input-controlled destination", async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ result: "ok" }), { status: 200 }));
    const runtime = new ToolRuntime(1_000, true, { create: (category) => category === "http" ? new HttpToolExecutor(fetchImpl) : { execute: jest.fn() } });
    const app = createToolsRouter(runtime, undefined, async () => testPrincipal);
    const tool: ToolRecord = { ...createToolRecord({ name: "Lookup", category: "http" }), configuration: { url: "https://service.test/lookup", method: "POST" }, impact: "external" };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: { query: "status", url: "https://attacker.test" } }) });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ output: { status: 200, body: { result: "ok" } } });
    expect(fetchImpl).toHaveBeenCalledWith(new URL("https://service.test/lookup"), expect.objectContaining({ method: "POST" }));
  });

  test("fails closed for real database tools when the credential gateway is disabled", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Database", category: "database" }), configuration: { connection: "main" } };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: {} }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/credential gateway|query/i);
  });

  test("rejects tool configuration carrying credentials", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Leaky" }), configuration: { apiKey: "sk-abcdefghijklmnop" } };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: {} }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/Credentials/);
  });

  test("rejects a disabled tool", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Off" }), enabled: false };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: {} }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/disabled/);
  });

  test("does not allow side-effecting HTTP tools without server approval", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Mutate", category: "http" }), configuration: { url: "https://service.test/items", method: "POST" }, impact: "external" };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: {} }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/requires server approval/);
  });

  test("runs repo-tests only through the configured worker and never forwards server environment", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tests-worker-"));
    const previous = {
      enabled: process.env.TOOL_REPO_TESTS_ENABLED,
      roots: process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS,
      mode: process.env.TOOL_REPO_TESTS_WORKER_MODE,
    };
    process.env.TOOL_REPO_TESTS_ENABLED = "true";
    process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS = workspace;
    process.env.TOOL_REPO_TESTS_WORKER_MODE = "local";
    const results = [
      { code: 0, stdout: "tests passed", stderr: "", reason: "completed" as const },
      { code: 0, stdout: "diff output", stderr: "", reason: "completed" as const },
    ];
    const workerRuntime = {
      start: jest.fn(async (spec: { executable: string; args: string[]; cwd: string; env?: Record<string, string> }) => {
        expect(spec.cwd).toBe(workspace);
        expect(spec.env).toBeUndefined();
        return { workerId: `worker-${results.length}`, runId: "tool-run" };
      }),
      wait: jest.fn(async () => results.shift()!),
      cleanup: jest.fn(async () => undefined),
    } as any;

    try {
      const tool = { ...createToolRecord({ name: "Repository tests" }), configuration: { kind: "repo-tests", workspaceRoot: workspace, testPath: "test.js" } };
      const output = await new FunctionToolExecutor(workerRuntime).execute({ tool, input: { request: "check" } });
      expect(output).toMatchObject({ branch: "pass", stdout: "tests passed", diff: "diff output" });
      expect(workerRuntime.start).toHaveBeenCalledTimes(2);
      expect(workerRuntime.start.mock.calls[0][0]).toMatchObject({ executable: process.execPath, args: ["--test", "test.js"], workspaceAccess: "read-only", network: false });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      if (previous.enabled === undefined) delete process.env.TOOL_REPO_TESTS_ENABLED; else process.env.TOOL_REPO_TESTS_ENABLED = previous.enabled;
      if (previous.roots === undefined) delete process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS; else process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS = previous.roots;
      if (previous.mode === undefined) delete process.env.TOOL_REPO_TESTS_WORKER_MODE; else process.env.TOOL_REPO_TESTS_WORKER_MODE = previous.mode;
    }
  });

  test("executes a real repo-test worker with bounded local policy", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tests-real-worker-"));
    const previous = {
      enabled: process.env.TOOL_REPO_TESTS_ENABLED,
      roots: process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS,
      mode: process.env.TOOL_REPO_TESTS_WORKER_MODE,
      timeout: process.env.TOOL_REPO_TEST_TIMEOUT_MS,
      output: process.env.TOOL_REPO_TEST_MAX_OUTPUT_BYTES,
    };
    process.env.TOOL_REPO_TESTS_ENABLED = "true";
    process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS = workspace;
    process.env.TOOL_REPO_TESTS_WORKER_MODE = "local";
    process.env.TOOL_REPO_TEST_TIMEOUT_MS = "10000";
    process.env.TOOL_REPO_TEST_MAX_OUTPUT_BYTES = "65536";
    fs.writeFileSync(path.join(workspace, "test.js"), "const test = require('node:test'); test('worker runs', () => {});\n", "utf8");

    try {
      const tool = { ...createToolRecord({ name: "Repository tests" }), configuration: { kind: "repo-tests", workspaceRoot: workspace, testPath: "test.js" } };
      const output = await new FunctionToolExecutor().execute({ tool, input: {} });
      expect(output.branch).toBe("pass");
      expect(output.command).toContain("--test test.js");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      for (const [key, value] of Object.entries({
        TOOL_REPO_TESTS_ENABLED: previous.enabled,
        TOOL_REPO_TEST_WORKSPACE_ROOTS: previous.roots,
        TOOL_REPO_TESTS_WORKER_MODE: previous.mode,
        TOOL_REPO_TEST_TIMEOUT_MS: previous.timeout,
        TOOL_REPO_TEST_MAX_OUTPUT_BYTES: previous.output,
      })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  test("runs only server-owned repository checks and returns per-check results", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "repo-checks-worker-"));
    const previous = {
      enabled: process.env.TOOL_REPO_CHECKS_ENABLED,
      roots: process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS,
      mode: process.env.TOOL_REPO_TESTS_WORKER_MODE,
    };
    process.env.TOOL_REPO_CHECKS_ENABLED = "true";
    process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS = workspace;
    process.env.TOOL_REPO_TESTS_WORKER_MODE = "local";
    const results = [
      { code: 0, stdout: "tests passed", stderr: "", reason: "completed" as const },
      { code: 1, stdout: "type error", stderr: "", reason: "failed" as const },
      { code: 0, stdout: "clean", stderr: "", reason: "completed" as const },
    ];
    const workerRuntime = {
      start: jest.fn(async (spec: { executable: string; args: string[]; cwd: string; env?: Record<string, string> }) => {
        expect(spec.cwd).toBe(workspace);
        expect(spec.env).toBeUndefined();
        return { workerId: `worker-${results.length}`, runId: "tool-run" };
      }),
      wait: jest.fn(async () => results.shift()!),
      cleanup: jest.fn(async () => undefined),
    } as any;

    try {
      const tool = {
        ...createToolRecord({ name: "Repository checks" }),
        configuration: { kind: "repo-checks", workspaceRoot: workspace, checks: "test,typecheck,diff" },
      };
      const output = await new FunctionToolExecutor(workerRuntime).execute({ tool, input: { arbitraryCommand: "rm -rf /" } });
      expect(output).toMatchObject({ branch: "fail", status: 1, failedChecks: 1 });
      expect(output.checks).toEqual([
        expect.objectContaining({ name: "test", status: "pass", exitCode: 0 }),
        expect.objectContaining({ name: "typecheck", status: "fail", exitCode: 1 }),
        expect.objectContaining({ name: "diff", status: "pass", exitCode: 0 }),
      ]);
      expect(workerRuntime.start).toHaveBeenCalledTimes(3);
      expect(workerRuntime.start.mock.calls.map((call: any[]) => call[0].args)).toEqual([
        ["node_modules/jest/bin/jest.js", "--runInBand", "--detectOpenHandles", "--forceExit"],
        ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"],
        ["diff", "--check", "--", "."],
      ]);
      expect(workerRuntime.start.mock.calls.every((call: any[]) => call[0].workspaceAccess === "read-only" && call[0].network === false)).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      if (previous.enabled === undefined) delete process.env.TOOL_REPO_CHECKS_ENABLED; else process.env.TOOL_REPO_CHECKS_ENABLED = previous.enabled;
      if (previous.roots === undefined) delete process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS; else process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS = previous.roots;
      if (previous.mode === undefined) delete process.env.TOOL_REPO_TESTS_WORKER_MODE; else process.env.TOOL_REPO_TESTS_WORKER_MODE = previous.mode;
    }
  });

  test("rejects arbitrary repository check commands", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "repo-checks-invalid-"));
    const previous = {
      enabled: process.env.TOOL_REPO_CHECKS_ENABLED,
      roots: process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS,
    };
    process.env.TOOL_REPO_CHECKS_ENABLED = "true";
    process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS = workspace;
    try {
      const tool = {
        ...createToolRecord({ name: "Repository checks" }),
        configuration: { kind: "repo-checks", workspaceRoot: workspace, checks: "node -e exploit" },
      };
      await expect(new FunctionToolExecutor({} as any).execute({ tool, input: {} })).rejects.toThrow(/Unsupported repo-checks check/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      if (previous.enabled === undefined) delete process.env.TOOL_REPO_CHECKS_ENABLED; else process.env.TOOL_REPO_CHECKS_ENABLED = previous.enabled;
      if (previous.roots === undefined) delete process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS; else process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS = previous.roots;
    }
  });

  test("uses the server-selected package manager for real builds", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "repo-build-worker-"));
    const previous = {
      enabled: process.env.TOOL_REPO_CHECKS_ENABLED,
      roots: process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS,
      mode: process.env.TOOL_REPO_TESTS_WORKER_MODE,
      manager: process.env.TOOL_REPO_PACKAGE_MANAGER,
    };
    process.env.TOOL_REPO_CHECKS_ENABLED = "true";
    process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS = workspace;
    process.env.TOOL_REPO_TESTS_WORKER_MODE = "local";
    process.env.TOOL_REPO_PACKAGE_MANAGER = "pnpm";
    fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }), "utf8");
    const workerRuntime = {
      start: jest.fn(async () => ({ workerId: "build-worker", runId: "tool-run" })),
      wait: jest.fn(async () => ({ code: 0, stdout: "built", stderr: "", reason: "completed" as const })),
      cleanup: jest.fn(async () => undefined),
    } as any;
    try {
      const tool = { ...createToolRecord({ name: "Repository build" }), configuration: { kind: "repo-checks", workspaceRoot: workspace, checks: "build", packageManager: "pnpm" } };
      const output = await new FunctionToolExecutor(workerRuntime).execute({ tool, input: {} });
      expect(output.branch).toBe("pass");
      expect(workerRuntime.start.mock.calls[0][0]).toMatchObject({ executable: "pnpm", args: ["run", "build"], workspaceAccess: "read-write", network: false });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      for (const [key, value] of Object.entries({ TOOL_REPO_CHECKS_ENABLED: previous.enabled, TOOL_REPO_TEST_WORKSPACE_ROOTS: previous.roots, TOOL_REPO_TESTS_WORKER_MODE: previous.mode, TOOL_REPO_PACKAGE_MANAGER: previous.manager })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  test("rejects repo-test workspace symlink escapes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tests-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tests-outside-"));
    const link = path.join(root, "linked-workspace");
    try {
      fs.symlinkSync(outside, link, "dir");
      expect(() => assertAllowedWorkspace(link, [root])).toThrow(/outside configured workspace roots/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
