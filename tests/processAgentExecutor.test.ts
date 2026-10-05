import type { AgentRecord } from "@multi-agent/types";
import {
  ProcessAgentExecutor,
  processRuntimePolicyFromEnvironment,
  validateProcessArgs,
  resolveProcessExecutable,
  type ProcessRuntimePolicy,
} from "../src/agents/runtime/processAgentExecutor";
import type { WorkerRuntime, WorkerSpec } from "../src/agents/runtime/workerRuntime";
import { AgentExecutionFailedError } from "../src/agents/runtime/errors";

describe("ProcessAgentExecutor", () => {
  const baseAgent: AgentRecord = {
    id: "agent-process-1",
    name: "Local Script Agent",
    description: "Runs an allowlisted local command",
    backend: {
      type: "process",
      command: process.execPath,
      args: ["--json"],
    },
    systemPrompt: "Process runner",
    tools: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const enabledPolicy: ProcessRuntimePolicy = {
    enabled: true,
    workerMode: "local",
    trustedHostAllowed: true,
    allowedCommands: [process.execPath, "/bin/echo"],
    allowedArgPatterns: [/^--json$/, /^--format=(json|yaml)$/, /^--verbose$/],
    workspaceRoots: [process.cwd()],
    maxOutputBytes: 1024 * 1024,
  };

  it("fails closed when process execution is disabled", async () => {
    const executor = new ProcessAgentExecutor(
      undefined,
      { ...enabledPolicy, enabled: false }
    );

    const input = {
      agent: baseAgent,
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(AgentExecutionFailedError);
  });

  it("fails closed when untrusted tenant attempts host execution", async () => {
    const executor = new ProcessAgentExecutor(
      undefined,
      { ...enabledPolicy, trustedHostAllowed: false, workerMode: "local" }
    );

    const input = {
      agent: baseAgent,
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/Multi-tenant execution requires container isolation or fails closed/);
  });

  it("rejects commands not on the server allowlist", async () => {
    const executor = new ProcessAgentExecutor(
      undefined,
      enabledPolicy
    );

    const input = {
      agent: {
        ...baseAgent,
        backend: { type: "process" as const, command: "unapproved-binary" },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/not on the server-approved allowlist/);
  });

  it("rejects arguments containing shell injection metacharacters", async () => {
    const executor = new ProcessAgentExecutor(undefined, enabledPolicy);

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          type: "process" as const,
          command: process.execPath,
          args: ["--format=json; rm -rf /"],
        },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/contains forbidden shell metacharacters/);
  });

  it("rejects restricted interpreter execution flags", async () => {
    const executor = new ProcessAgentExecutor(undefined, enabledPolicy);

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          type: "process" as const,
          command: process.execPath,
          args: ["-e", "process.exit(1)"],
        },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/is a restricted interpreter execution flag/);
  });

  it("enforces operator-configured argument patterns", async () => {
    const executor = new ProcessAgentExecutor(undefined, {
      ...enabledPolicy,
      allowedArgPatterns: [/^--format=(json|yaml)$/, /^--verbose$/],
    });

    const invalidInput = {
      agent: {
        ...baseAgent,
        backend: {
          type: "process" as const,
          command: process.execPath,
          args: ["--format=xml"],
        },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(invalidInput)) {}
    }).rejects.toThrow(/does not match server-approved argument patterns/);
  });

  it("fails closed when arguments are supplied but no argument patterns are configured", async () => {
    const executor = new ProcessAgentExecutor(undefined, {
      ...enabledPolicy,
      allowedArgPatterns: [],
    });

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          type: "process" as const,
          command: process.execPath,
          args: ["--any-arg"],
        },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/Process arguments are not permitted unless server-approved argument patterns are configured/);
  });

  it("fails closed when environment contains invalid regex patterns", () => {
    expect(() => {
      processRuntimePolicyFromEnvironment({
        PROCESS_AGENT_ALLOWED_ARG_PATTERNS: "[unclosed-bracket",
      });
    }).toThrow(/Invalid process argument regex pattern/);
  });

  it("executes allowlisted command through worker runtime", async () => {
    const mockWorkerRuntime: WorkerRuntime = {
      start: jest.fn().mockResolvedValue({ workerId: "worker-1", runId: "run-1" }),
      stream: jest.fn(),
      wait: jest.fn().mockResolvedValue({
        code: 0,
        stdout: "Command executed successfully",
        stderr: "",
        reason: "completed",
      }),
      cancel: jest.fn(),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };

    const executor = new ProcessAgentExecutor(mockWorkerRuntime, enabledPolicy);

    const input = {
      agent: baseAgent,
      input: { data: "sample" },
      runId: "run-1",
      nodeId: "node-1",
    };

    const events = [];
    for await (const event of executor.execute(input)) {
      events.push(event);
    }

    expect(mockWorkerRuntime.start).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--json"],
        runId: "run-1",
      }),
      undefined,
      expect.any(String)
    );
    expect(mockWorkerRuntime.cleanup).toHaveBeenCalledWith("worker-1");

    const completed = events.find((e) => e.type === "agent.completed");
    expect(completed).toBeDefined();
    expect((completed?.payload as any).content).toBe("Command executed successfully");
  });

  it("handles process execution failure and cleans up worker handle", async () => {
    const mockWorkerRuntime: WorkerRuntime = {
      start: jest.fn().mockResolvedValue({ workerId: "worker-2", runId: "run-2" }),
      stream: jest.fn(),
      wait: jest.fn().mockResolvedValue({
        code: 1,
        stdout: "",
        stderr: "Fatal script error",
        reason: "failed",
      }),
      cancel: jest.fn(),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };

    const executor = new ProcessAgentExecutor(mockWorkerRuntime, enabledPolicy);

    const input = {
      agent: baseAgent,
      input: "test",
      runId: "run-2",
      nodeId: "node-2",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/Fatal script error/);

    expect(mockWorkerRuntime.cleanup).toHaveBeenCalledWith("worker-2");
  });
});

describe("validateProcessArgs", () => {
  it("fails closed when args are provided but allowedPatterns is empty", () => {
    expect(() => validateProcessArgs(["--flag"], [])).toThrow(
      "Process arguments are not permitted unless server-approved argument patterns are configured."
    );
  });

  it("permits empty args when allowedPatterns is empty", () => {
    expect(() => validateProcessArgs([], [])).not.toThrow();
  });

  it("enforces full-string matching against approved patterns", () => {
    // Pattern without ^...$ anchor must still only match the full argument
    const pattern = /json/;
    expect(() => validateProcessArgs(["json"], [pattern])).not.toThrow();
    expect(() => validateProcessArgs(["json; malicious_cmd"], [pattern])).toThrow(
      /forbidden shell metacharacters/
    );
    expect(() => validateProcessArgs(["json-extra"], [pattern])).toThrow(
      /does not match server-approved argument patterns/
    );
  });

  it("handles global (/g) flag statelessly without toggling match results", () => {
    const pattern = /^[a-z]+$/g;
    // Calling multiple times in succession should never fail due to lastIndex
    expect(() => validateProcessArgs(["hello"], [pattern])).not.toThrow();
    expect(() => validateProcessArgs(["world"], [pattern])).not.toThrow();
    expect(() => validateProcessArgs(["test"], [pattern])).not.toThrow();
  });
});

describe("resolveProcessExecutable", () => {
  it("rejects non-existent executables in local mode without bare-command fallback", () => {
    expect(() =>
      resolveProcessExecutable("non-existent-binary-xyz", ["non-existent-binary-xyz"], "local")
    ).toThrow(/is not on the server-approved allowlist/);
  });

  it("resolves canonical executable path for real host binary", () => {
    const resolved = resolveProcessExecutable(process.execPath, [process.execPath], "local");
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe("string");
  });

  it("blocks basename spoofing when realpath does not match allowlisted executable", () => {
    // If only /bin/echo is allowlisted, another binary cannot pass just because of matching basename
    expect(() =>
      resolveProcessExecutable(process.execPath, ["/bin/echo"], "local")
    ).toThrow(/is not on the server-approved allowlist/);
  });

  it("allows matching command by basename in container mode", () => {
    const resolved = resolveProcessExecutable("python3", ["/usr/bin/python3"], "container");
    expect(resolved).toBe("python3");
  });
});
