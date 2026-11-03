import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  SandboxExecutionBarrier,
  SandboxedWorkerRuntime,
  applyOsProcessIsolation,
  applySandboxWorkerBarrier,
} from "../src/security";
import type { WorkerSpec } from "../src/agents/runtime/workerRuntime";

describe("T053 OS isolation boundary for 009 CLI processes", () => {
  const sandboxRoot = path.resolve(process.cwd(), "workspaces/building-management-sandbox");
  const outsideProbe = path.join(os.tmpdir(), `os-isolation-probe-${process.pid}.txt`);

  beforeAll(() => {
    fs.mkdirSync(sandboxRoot, { recursive: true });
    if (fs.existsSync(outsideProbe)) fs.unlinkSync(outsideProbe);
  });

  afterAll(() => {
    if (fs.existsSync(outsideProbe)) fs.unlinkSync(outsideProbe);
  });

  test("applyOsProcessIsolation injects Node permission write jail for node executables", () => {
    const barrier = new SandboxExecutionBarrier(sandboxRoot, []);
    const isolated = applyOsProcessIsolation({
      runId: "run-os",
      nodeId: "node-cli",
      agentId: "agent-gap-engineer",
      executable: process.execPath,
      args: ["-e", "console.log(1)"],
      cwd: sandboxRoot,
      timeoutMs: 5_000,
      maxOutputBytes: 64_000,
    }, barrier);

    expect(isolated.args[0]).toBe("--permission");
    expect(isolated.args).toContain(`--allow-fs-write=${barrier.canonicalSandboxRoot}`);
    expect(isolated.args).toContain("--allow-fs-read=*");
  });

  test("real Node subprocess cannot write outside the sandbox under the OS jail", () => {
    const barrier = new SandboxExecutionBarrier(sandboxRoot, []);
    const confined = applySandboxWorkerBarrier({
      runId: "run-os-write",
      nodeId: "node-cli",
      agentId: "agent-gap-engineer",
      executable: process.execPath,
      args: [
        "-e",
        `require("fs").writeFileSync(${JSON.stringify(outsideProbe)}, "escaped");`,
      ],
      cwd: sandboxRoot,
      timeoutMs: 10_000,
      maxOutputBytes: 64_000,
    }, barrier);

    const result = spawnSync(confined.executable, confined.args, {
      cwd: confined.cwd,
      encoding: "utf8",
      env: process.env,
    });

    expect(fs.existsSync(outsideProbe)).toBe(false);
    expect(result.status).not.toBe(0);
    const combined = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
    expect(combined).toMatch(/ERR_ACCESS_DENIED|AccessDenied|permission/i);
  });

  test("SandboxedWorkerRuntime applies OS jail args before delegating start", async () => {
    const barrier = new SandboxExecutionBarrier(sandboxRoot, []);
    let observed: WorkerSpec | undefined;
    const inner = {
      start: async (spec: WorkerSpec) => {
        observed = spec;
        return { workerId: "worker-os", runId: spec.runId };
      },
      stream: async function* () {},
      wait: async () => ({ code: 0, stdout: "", stderr: "", reason: "completed" as const }),
      cancel: async () => {},
      cleanup: async () => {},
    };
    const runtime = new SandboxedWorkerRuntime(inner, barrier);

    await runtime.start({
      runId: "run-os-runtime",
      nodeId: "node-cli",
      agentId: "agent-gap-engineer",
      executable: process.execPath,
      args: ["-e", "console.log(1)"],
      cwd: sandboxRoot,
      timeoutMs: 10_000,
      maxOutputBytes: 64_000,
    });

    expect(observed?.args?.[0]).toBe("--permission");
    expect(observed?.args).toContain(`--allow-fs-write=${barrier.canonicalSandboxRoot}`);
    expect(observed?.cwd).toBe(path.resolve(sandboxRoot));
  });
});
