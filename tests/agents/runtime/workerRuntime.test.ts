import { LocalProcessWorkerRuntime, type WorkerSpec, buildContainerArgs, buildWorkerEnv } from "../../../src/agents/runtime/workerRuntime";
import type { CliRuntimePolicy } from "../../../src/agents/runtime/cliAgentExecutor";
import { uid } from "@multi-agent/types";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

jest.setTimeout(15000);

describe("LocalProcessWorkerRuntime", () => {
  let policy: CliRuntimePolicy;
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "worker-test-"));
    policy = {
      enabled: true,
      allowedExecutables: ["node"],
      workspaceRoots: [workspaceRoot],
      maxOutputBytes: 1024 * 1024,
    };
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function createSpec(executable: string, args: string[], cwd: string = workspaceRoot): WorkerSpec {
    return {
      runId: uid("run"),
      nodeId: "node-1",
      agentId: "agent-1",
      executable,
      args,
      cwd,
      timeoutMs: 5000,
      maxOutputBytes: policy.maxOutputBytes,
    };
  }

  function mockSpawnFn(mockStdout: string, mockStderr: string, mockCode: number | null, sleepMs = 0) {
    return (command: string, args: string[], options: any) => {
      const listeners: Record<string, any[]> = {
        close: [],
        error: []
      };
      let killed = false;
      let timer: NodeJS.Timeout | undefined;
      const stdoutListeners: Record<string, any[]> = { data: [], close: [] };
      const stderrListeners: Record<string, any[]> = { data: [], close: [] };

      const emit = (map: Record<string, any[]>, event: string, ...args: any[]) => {
        if (!killed) map[event]?.forEach(fn => fn(...args));
      };

      timer = setTimeout(() => {
        if (!killed) {
          if (mockStdout) emit(stdoutListeners, "data", Buffer.from(mockStdout));
          if (mockStderr) emit(stderrListeners, "data", Buffer.from(mockStderr));
          emit(stdoutListeners, "close");
          emit(stderrListeners, "close");
          emit(listeners, "close", mockCode);
        }
      }, sleepMs);

      return {
        stdout: { on: (e: string, fn: any) => stdoutListeners[e].push(fn) },
        stderr: { on: (e: string, fn: any) => stderrListeners[e].push(fn) },
        on: (e: string, fn: any) => listeners[e].push(fn),
        kill: (signal: string) => {
          killed = true;
          clearTimeout(timer);
          // A killed child still closes its stdio and emits child.close.
          setTimeout(() => {
            stdoutListeners.close.forEach(fn => fn());
            stderrListeners.close.forEach(fn => fn());
            listeners["close"]?.forEach(fn => fn(null));
          }, 10);
        },
        pid: 12345
      } as any;
    };
  }

  test("starts process, reads stdout, and exits successfully", async () => {
    const spawnFn = mockSpawnFn("hello world", "", 0);
    const runtime = new LocalProcessWorkerRuntime(policy, spawnFn as any);

    const spec = createSpec("node", ["-e", "console.log('hello world')"]);
    const handle = await runtime.start(spec);

    const result = await runtime.wait(handle.workerId);
    expect(result.reason).toBe("completed");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hello world");
    expect(result.stderr).toBe("");

    await runtime.cleanup(handle.workerId);
  });

  test("captures stderr and exits with error code (reason: failed)", async () => {
    const spawnFn = mockSpawnFn("", "some error", 1);
    const runtime = new LocalProcessWorkerRuntime(policy, spawnFn as any);

    const spec = createSpec("node", ["-e", "console.error('some error'); process.exit(1)"]);
    const handle = await runtime.start(spec);

    const result = await runtime.wait(handle.workerId);
    expect(result.reason).toBe("failed");
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("some error");

    await runtime.cleanup(handle.workerId);
  });

  test("handles timeout by killing process (reason: timeout)", async () => {
    const spawnFn = mockSpawnFn("running", "", 0, 10000);
    const runtime = new LocalProcessWorkerRuntime(policy, spawnFn as any);

    const spec = createSpec("node", ["-e", "setTimeout(() => {}, 10000)"]);
    spec.timeoutMs = 50; // Fast timeout for test
    const handle = await runtime.start(spec);

    const result = await runtime.wait(handle.workerId);
    expect(result.reason).toBe("timeout");
    expect(result.error).toContain("timed out");

    await runtime.cleanup(handle.workerId);
  });

  test("handles cancellation via AbortSignal", async () => {
    const spawnFn = mockSpawnFn("running", "", 0, 10000);
    const runtime = new LocalProcessWorkerRuntime(policy, spawnFn as any);

    const spec = createSpec("node", ["-e", "setTimeout(() => {}, 10000)"]);
    const controller = new AbortController();

    const handle = await runtime.start(spec, controller.signal);

    setTimeout(() => controller.abort(), 10);

    const result = await runtime.wait(handle.workerId);
    expect(result.reason).toBe("cancelled");

    await runtime.cleanup(handle.workerId);
  });

  test("enforces maxOutputBytes limit and sets reason to output_limit", async () => {
    const spawnFn = mockSpawnFn("this is way too long", "", 0, 10);
    const runtime = new LocalProcessWorkerRuntime(policy, spawnFn as any);

    policy.maxOutputBytes = 10;
    const spec = createSpec("node", ["-e", "console.log('this is way too long')"]);
    const handle = await runtime.start(spec);

    const result = await runtime.wait(handle.workerId);

    expect(result.reason).toBe("output_limit");
    expect(result.error).toContain("exceeded the 10-byte");

    await runtime.cleanup(handle.workerId);
  });

  test("rejects executables not in allowlist", async () => {
    const runtime = new LocalProcessWorkerRuntime(policy);
    const spec = createSpec("python", ["-c", "print('hello')"]);
    await expect(runtime.start(spec)).rejects.toThrow("not allowed by the server runtime");
  });

  test("rejects workspace outside allowed roots (absolute but outside)", async () => {
    const runtime = new LocalProcessWorkerRuntime(policy);
    const badWorkspace = path.join(os.tmpdir(), "some-other-dir");
    const spec = createSpec("node", ["-e", "console.log('hello')"], badWorkspace);
    await expect(runtime.start(spec)).rejects.toThrow("does not exist"); // or not allowed
  });

  test("rejects sibling directory traversal prefix attacks", async () => {
    const runtime = new LocalProcessWorkerRuntime(policy);
    const siblingDir = workspaceRoot + "-sibling";
    fs.mkdirSync(siblingDir);
    try {
      const spec = createSpec("node", ["-e", "console.log('hello')"], siblingDir);
      await expect(runtime.start(spec)).rejects.toThrow("not allowed by the server runtime");
    } finally {
      fs.rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  test("rejects symlink escape", async () => {
    const runtime = new LocalProcessWorkerRuntime(policy);
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-test-ext-"));
    const symlink = path.join(workspaceRoot, "escape");
    fs.symlinkSync(externalDir, symlink, "dir");

    try {
      const spec = createSpec("node", ["-e", "console.log('hello')"], symlink);
      await expect(runtime.start(spec)).rejects.toThrow("not allowed by the server runtime");
    } finally {
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  });

  test("buildWorkerEnv correctly strips restricted envs and allows overrides safely", () => {
    const baseEnv = {
      PATH: "/usr/bin",
      NODE_ENV: "production",
      CLI_AGENT_ENABLED: "true",
      OPENAI_API_KEY: "secret1",
      AUTH_SECRET: "secret2",
      DATABASE_URL: "postgres://...",
      SOME_PAT: "pat123"
    };

    const workerOverrides = {
      PATH: "/custom/path",
      NODE_ENV: "test",
      CLI_AGENT_ENABLED: "false", // Should be ignored
      OPENAI_API_KEY: "my_key", // Should be ignored
      NEW_VAR: "value"
    };

    const result = buildWorkerEnv(baseEnv, workerOverrides, ["NEW_VAR"]);

    expect(result).toEqual({
      PATH: "/custom/path",
      NODE_ENV: "test",
      NEW_VAR: "value"
    });

    expect(result.CLI_AGENT_ENABLED).toBeUndefined();
    expect(result.OPENAI_API_KEY).toBeUndefined();
    expect(result.AUTH_SECRET).toBeUndefined();
    expect(result.DATABASE_URL).toBeUndefined();
    expect(result.SOME_PAT).toBeUndefined();
  });

  test("allows explicitly approved provider credentials from the server environment but never worker overrides", () => {
    const baseEnv = { PATH: "/usr/bin", OPENAI_API_KEY: "server-key" };
    const result = buildWorkerEnv(baseEnv, { OPENAI_API_KEY: "worker-key" }, ["OPENAI_API_KEY"]);

    expect(result.OPENAI_API_KEY).toBe("server-key");
  });

  test("builds a fail-closed hardened container command", () => {
    const spec = { ...createSpec("codex", ["exec", "-"]), workspaceAccess: "read-only" as const, network: true };
    const args = buildContainerArgs(spec, {
      image: `registry.example/agent@sha256:${"a".repeat(64)}`,
      dockerExecutable: "docker",
      allowNetwork: false,
      memory: "512m",
      cpus: "0.5",
      pidsLimit: 64,
      user: "65534:65534",
    }, "worker-safe", ["OPENAI_API_KEY"]);

    expect(args).toEqual(expect.arrayContaining([
      "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true", "--pids-limit", "64",
      "--memory", "512m", "--cpus", "0.5", "--user", "65534:65534",
      "--env", "OPENAI_API_KEY", `registry.example/agent@sha256:${"a".repeat(64)}`, "codex", "exec", "-",
    ]));
    expect(args.join(" ")).not.toContain("server-key");
    expect(args.join(" ")).toContain("readonly=true");
  });

  test("[Integration] node child process runs harmlessly", async () => {
    // Tests that the default node spawn actually works for real process lifecycle.
    const runtime = new LocalProcessWorkerRuntime(policy);
    const spec = createSpec("node", ["-e", "console.log('integration test ok')"]);
    const handle = await runtime.start(spec);

    const result = await runtime.wait(handle.workerId);
    expect(result.reason).toBe("completed");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("integration test ok");

    await runtime.cleanup(handle.workerId);
  });
});
