import { ContainerWorkerRuntime, LocalProcessWorkerRuntime, type WorkerSpec, buildContainerArgs, buildContainerCreateArgs, buildContainerExecArgs, buildWorkerEnv, CONTAINER_CLI_PATHS, CONTAINER_CREDENTIAL_HOLDER_SCRIPT, CONTAINER_HOME_INIT_SCRIPT } from "../../../src/agents/runtime/workerRuntime";
import type { CliRuntimePolicy } from "../../../src/agents/runtime/cliAgentExecutor";
import { uid } from "@multi-agent/types";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { sha256Hex } from "../../../src/agents/runtime/workerCredentials";

jest.setTimeout(15000);

describe("LocalProcessWorkerRuntime", () => {
  let policy: CliRuntimePolicy;
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "worker-test-"));
    policy = {
      enabled: true,
      workerMode: "local",
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

  test("does not spawn when the signal is already aborted", async () => {
    const spawnFn = jest.fn(mockSpawnFn("", "", 0));
    const runtime = new LocalProcessWorkerRuntime(policy, spawnFn as any);
    const controller = new AbortController();
    controller.abort();

    await expect(runtime.start(createSpec("node", []), controller.signal)).rejects.toThrow("Worker cancelled before starting");
    expect(spawnFn).not.toHaveBeenCalled();
  });

  test("cancels a child when the signal aborts during spawn", async () => {
    const controller = new AbortController();
    const spawnFn = jest.fn((command: string, args: string[], options: any) => {
      const child = mockSpawnFn("", "", 0, 10000)(command, args, options);
      jest.spyOn(child, "kill");
      controller.abort();
      return child;
    });
    const runtime = new LocalProcessWorkerRuntime(policy, spawnFn as any);

    const handle = await runtime.start(createSpec("node", []), controller.signal);
    const result = await runtime.wait(handle.workerId);

    expect(result.reason).toBe("cancelled");
    expect(spawnFn.mock.results[0].value.kill).toHaveBeenCalledWith("SIGTERM");
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

  test("rejects protected credentials from both the global allowlist and worker overrides", () => {
    const baseEnv = { PATH: "/usr/bin", OPENAI_API_KEY: "server-key" };
    const result = buildWorkerEnv(baseEnv, { OPENAI_API_KEY: "worker-key" }, ["OPENAI_API_KEY"]);

    expect(result.OPENAI_API_KEY).toBeUndefined();
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
    }, "worker-safe", ["OPENAI_API_KEY", "HOME"], ["OPENAI_API_KEY"]);

    expect(args).toEqual(expect.arrayContaining([
      "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true", "--pids-limit", "64",
      "--memory", "512m", "--cpus", "0.5", "--user", "65534:65534",
      "--env", "OPENAI_API_KEY", `registry.example/agent@sha256:${"a".repeat(64)}`,
    ]));
    expect(args.join(" ")).not.toContain("server-key");
    expect(args.join(" ")).toContain("readonly=true");
    expect(args).toEqual(expect.arrayContaining([
      "--tmpfs", `${CONTAINER_CLI_PATHS.home}:rw,noexec,nosuid,nodev,size=128m,mode=1777`,
      "--env", `HOME=${CONTAINER_CLI_PATHS.home}`,
      "--env", `XDG_CONFIG_HOME=${CONTAINER_CLI_PATHS.config}`,
      "--env", `XDG_CACHE_HOME=${CONTAINER_CLI_PATHS.cache}`,
      "--env", `CODEX_HOME=${CONTAINER_CLI_PATHS.codexHome}`,
      "--env", `CLAUDE_CONFIG_DIR=${CONTAINER_CLI_PATHS.claudeConfig}`,
      "--env", "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0",
      "--env", "CLAUDE_CODE_SKIP_PROMPT_HISTORY=1",
    ]));
    expect(args.slice(-7)).toEqual(["/bin/bash", "-c", CONTAINER_HOME_INIT_SCRIPT, "worker-init", "codex", "exec", "-"]);
    expect(args).toContain("--read-only");
    expect(args.filter((arg) => arg.startsWith("HOME="))).toEqual([`HOME=${CONTAINER_CLI_PATHS.home}`]);
    expect(args.filter((arg) => arg.startsWith("type=bind,"))).toEqual([
      expect.stringContaining("target=/workspace"),
    ]);
  });

  test("builds credential-holder create and exec args without host credential paths", () => {
    const spec = createSpec("codex", ["exec", "-"]);
    const policy = {
      image: `registry.example/agent@sha256:${"a".repeat(64)}`,
      dockerExecutable: "docker",
      allowNetwork: true,
      memory: "512m",
      cpus: "0.5",
      pidsLimit: 64,
      user: "65534:65534",
    };
    const createArgs = buildContainerCreateArgs({ ...spec, network: true }, policy, "worker-cred", [], []);
    expect(createArgs[0]).toBe("create");
    expect(createArgs).not.toContain("--rm");
    expect(createArgs.slice(-3)).toEqual(["/bin/bash", "-c", CONTAINER_CREDENTIAL_HOLDER_SCRIPT]);
    expect(createArgs.join(" ")).not.toContain("auth.json");
    expect(createArgs.join(" ")).not.toContain("USERPROFILE");
    expect(createArgs.join(" ")).toContain("CODEX_HOME=/home/worker/.codex");
    expect(createArgs.join(" ")).toContain("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0");
    expect(createArgs.filter((arg) => arg.startsWith("type=bind,"))).toEqual([
      expect.stringContaining("target=/workspace"),
    ]);
    expect(createArgs.filter((arg) => arg.startsWith("type=bind,")).join(" ")).not.toMatch(/\.codex|auth\.json|\.credentials\.json|\.claude\\/i);

    const execArgs = buildContainerExecArgs(spec, policy, "worker-cred", []);
    expect(execArgs.slice(0, 3)).toEqual(["exec", "--interactive", "-u"]);
    expect(execArgs).toContain("codex");
    expect(execArgs.join(" ")).not.toContain("auth.json");
    expect(execArgs.join(" ")).not.toMatch(/OPENAI_API_KEY=/);
    expect(execArgs).toEqual(expect.arrayContaining(["--env", "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0"]));
  });

  test("protected global allowlist entries cannot bypass the trusted container secret channel", () => {
    const args = buildContainerArgs(createSpec("codex", ["exec", "-"]), {
      image: `registry.example/agent@sha256:${"a".repeat(64)}`,
      dockerExecutable: "docker",
      allowNetwork: false,
      memory: "512m",
      cpus: "0.5",
      pidsLimit: 64,
      user: "65534:65534",
    }, "worker-safe", ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "SAFE_COLOR"]);

    expect(args).toEqual(expect.arrayContaining(["--env", "SAFE_COLOR"]));
    expect(args).not.toContain("OPENAI_API_KEY");
    expect(args).not.toContain("ANTHROPIC_API_KEY");
  });

  test("container Docker client receives protected values only through trusted launch secrets", async () => {
    const priorAllowed = process.env.WORKER_ALLOWED_ENV_KEYS;
    const priorSecret = process.env.OPENAI_API_KEY;
    const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const spawnFn = ((command: string, args: string[], options: any) => {
      spawned.push({ command, args, env: options.env });
      const listeners: Record<string, Array<(...values: any[]) => void>> = { close: [], error: [] };
      const streamListeners: Record<string, Array<(...values: any[]) => void>> = { data: [], close: [] };
      setTimeout(() => {
        streamListeners.close.forEach((fn) => fn());
        listeners.close.forEach((fn) => fn(0));
      }, 0);
      return {
        stdout: { on: (event: string, fn: (...values: any[]) => void) => streamListeners[event].push(fn) },
        stderr: { on: (event: string, fn: (...values: any[]) => void) => streamListeners[event].push(fn) },
        stdin: { write: jest.fn(), end: jest.fn() },
        on: (event: string, fn: (...values: any[]) => void) => listeners[event].push(fn),
        once: (event: string, fn: (...values: any[]) => void) => listeners[event].push(fn),
        kill: jest.fn(),
        pid: 123,
      } as any;
    }) as any;
    try {
      process.env.WORKER_ALLOWED_ENV_KEYS = "OPENAI_API_KEY,TERM";
      process.env.OPENAI_API_KEY = "untrusted-global-secret";
      const runtime = new ContainerWorkerRuntime(
        { ...policy, workerMode: "container", allowedExecutables: ["codex"] },
        {
          image: `registry.example/agent@sha256:${"a".repeat(64)}`,
          dockerExecutable: process.execPath,
          allowNetwork: false,
          memory: "512m",
          cpus: "0.5",
          pidsLimit: 64,
          user: "65534:65534",
        },
        spawnFn,
      );

      const uncredentialedSpec = createSpec("codex", ["--version"]);
      uncredentialedSpec.env = { PATH: "/workspace/fake-bin", HOME: "/workspace/fake-home", OPENAI_API_KEY: "worker-secret" };
      const uncredentialed = await runtime.start(uncredentialedSpec);
      await runtime.wait(uncredentialed.workerId);
      expect(spawned[0].command).toBe(fs.realpathSync(process.execPath));
      expect(spawned[0].args).not.toContain("OPENAI_API_KEY");
      expect(spawned[0].env.OPENAI_API_KEY).toBeUndefined();
      expect(spawned[0].env.PATH).not.toBe("/workspace/fake-bin");
      expect(spawned[0].env.HOME).not.toBe("/workspace/fake-home");

      const handle = await runtime.start(createSpec("codex", ["--version"]), undefined, undefined, {
        environment: { OPENAI_API_KEY: "trusted-launch-secret" },
      });
      await runtime.wait(handle.workerId);

      expect(spawned[1].args).toContain("OPENAI_API_KEY");
      expect(spawned[1].args.join(" ")).not.toContain("trusted-launch-secret");
      expect(spawned[1].env.OPENAI_API_KEY).toBe("trusted-launch-secret");
    } finally {
      if (priorAllowed === undefined) delete process.env.WORKER_ALLOWED_ENV_KEYS;
      else process.env.WORKER_ALLOWED_ENV_KEYS = priorAllowed;
      if (priorSecret === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorSecret;
    }
  });

  test("trusted launch secrets are separate, redacted across chunks, and never logged", async () => {
    const secret = "dummy-split-secret";
    let spawnedEnvironment: NodeJS.ProcessEnv | undefined;
    const spawnFn = ((command: string, args: string[], options: any) => {
      spawnedEnvironment = options.env;
      const listeners: Record<string, Array<(...values: any[]) => void>> = { close: [], error: [] };
      const stdout: Record<string, Array<(...values: any[]) => void>> = { data: [], close: [] };
      const stderr: Record<string, Array<(...values: any[]) => void>> = { data: [], close: [] };
      setTimeout(() => {
        stdout.data.forEach((fn) => fn(Buffer.from("before dummy-split-")));
        stdout.data.forEach((fn) => fn(Buffer.from("secret after")));
        stdout.close.forEach((fn) => fn());
        stderr.close.forEach((fn) => fn());
        listeners.close.forEach((fn) => fn(0));
      }, 0);
      return {
        stdout: { on: (event: string, fn: (...values: any[]) => void) => stdout[event].push(fn) },
        stderr: { on: (event: string, fn: (...values: any[]) => void) => stderr[event].push(fn) },
        stdin: { write: jest.fn(), end: jest.fn() },
        on: (event: string, fn: (...values: any[]) => void) => listeners[event].push(fn),
        kill: jest.fn(),
        pid: 123,
      } as any;
    }) as any;
    const log = jest.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const runtime = new LocalProcessWorkerRuntime(policy, spawnFn);
      const spec = createSpec("node", []);
      spec.env = { OPENAI_API_KEY: "untrusted-value" };
      const handle = await runtime.start(spec, undefined, undefined, { environment: { OPENAI_API_KEY: secret } });
      const result = await runtime.wait(handle.workerId);
      expect(spawnedEnvironment?.OPENAI_API_KEY).toBe(secret);
      expect(JSON.stringify(spec)).not.toContain(secret);
      expect(result.stdout).toBe("before [REDACTED] after");
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(log.mock.calls.flat().join(" ")).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });

  test("fixed container paths cannot be supplied as launch secrets", async () => {
    const runtime = new ContainerWorkerRuntime(
      { ...policy, workerMode: "container", allowedExecutables: ["codex"] },
      {
        image: `registry.example/agent@sha256:${"a".repeat(64)}`,
        dockerExecutable: process.execPath,
        allowNetwork: false,
        memory: "512m",
        cpus: "0.5",
        pidsLimit: 64,
        user: "65534:65534",
      },
      jest.fn() as any,
    );
    await expect(runtime.start(createSpec("codex", ["--version"]), undefined, undefined, {
      environment: { HOME: "/workspace" },
    })).rejects.toThrow(/unsupported environment name/);
  });

  test("rejects a disallowed inner executable before invoking Docker", async () => {
    const spawnFn = jest.fn();
    const containerPolicy = {
      image: `registry.example/agent@sha256:${"a".repeat(64)}`,
      dockerExecutable: process.execPath,
      allowNetwork: false,
      memory: "512m",
      cpus: "0.5",
      pidsLimit: 64,
      user: "65534:65534",
    };
    const runtime = new ContainerWorkerRuntime(
      { ...policy, workerMode: "container", allowedExecutables: ["codex"] },
      containerPolicy,
      spawnFn as any,
    );

    await expect(runtime.start(createSpec("sh", ["-c", "id"]))).rejects.toThrow(/not allowed by the server runtime/);
    expect(spawnFn).not.toHaveBeenCalled();
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
