import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildContainerArgs, type ContainerWorkerPolicy, type WorkerSpec } from "../../src/agents/runtime/workerRuntime";

const image = process.argv.slice(2).find((argument) => argument !== "--") || "multi-agent-cli-worker:local";
const dockerExecutable = process.env.CLI_WORKER_DOCKER_EXECUTABLE?.trim() || "docker";
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cli-worker-smoke-"));
const activeContainers = new Set<string>();

const policy: ContainerWorkerPolicy = {
  image,
  dockerExecutable,
  allowNetwork: false,
  memory: "1g",
  cpus: "1",
  pidsLimit: 128,
  user: "65534:65534",
};

type Check = {
  name: string;
  executable: string;
  args: string[];
  workspaceAccess?: WorkerSpec["workspaceAccess"];
  expectCode?: number;
  outputIncludes?: string;
};

function docker(args: string[], options: { quiet?: boolean } = {}) {
  const result = spawnSync(dockerExecutable, args, { encoding: "utf8", windowsHide: true });
  if (!options.quiet && result.stdout) process.stdout.write(result.stdout);
  if (!options.quiet && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  return result;
}

function assertRemoved(name: string) {
  const inspect = docker(["inspect", name], { quiet: true });
  if (inspect.status === 0) throw new Error(`Container ${name} was not removed after execution.`);
}

function runCheck(check: Check) {
  const name = `cli-worker-smoke-${randomUUID()}`;
  activeContainers.add(name);
  const spec: WorkerSpec = {
    runId: "smoke-run",
    nodeId: check.name,
    agentId: "smoke-agent",
    executable: check.executable,
    args: check.args,
    cwd: workspace,
    timeoutMs: 30_000,
    maxOutputBytes: 1024 * 1024,
    workspaceAccess: check.workspaceAccess ?? "read-only",
    network: false,
  };
  const result = docker(buildContainerArgs(spec, policy, name, []), { quiet: true });
  const expected = check.expectCode ?? 0;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== expected) {
    throw new Error(`${check.name} exited ${result.status}; expected ${expected}.\n${output}`);
  }
  if (check.outputIncludes && !output.includes(check.outputIncludes)) {
    throw new Error(`${check.name} output did not contain ${JSON.stringify(check.outputIncludes)}.\n${output}`);
  }
  assertRemoved(name);
  activeContainers.delete(name);
  console.log(`PASS ${check.name}`);
}

try {
  fs.writeFileSync(path.join(workspace, "input.txt"), "worker smoke input\n", "utf8");

  runCheck({ name: "codex-version", executable: "codex", args: ["--version"], outputIncludes: "codex-cli" });
  runCheck({ name: "codex-exec", executable: "codex", args: ["exec", "--help"], outputIncludes: "Usage" });
  runCheck({ name: "claude-version", executable: "claude", args: ["--version"], outputIncludes: "Claude Code" });
  runCheck({ name: "claude-print", executable: "claude", args: ["--help"], outputIncludes: "--print" });
  runCheck({
    name: "non-root-and-writable-home",
    executable: "bash",
    args: ["-c", [
      "test \"$(id -u)\" -ne 0",
      "test \"$HOME\" = /home/worker",
      "test \"$XDG_CONFIG_HOME\" = /home/worker/.config",
      "test \"$XDG_CACHE_HOME\" = /home/worker/.cache",
      "test \"$CODEX_HOME\" = /home/worker/.codex",
      "mkdir -p \"$XDG_CONFIG_HOME\" \"$XDG_CACHE_HOME\" \"$CODEX_HOME\"",
      "touch \"$HOME/home-write\" \"$XDG_CONFIG_HOME/config-write\" \"$XDG_CACHE_HOME/cache-write\" \"$CODEX_HOME/codex-write\"",
    ].join(" && ")],
  });
  runCheck({
    name: "read-only-root",
    executable: "bash",
    args: ["-c", "if touch /rootfs-write 2>/dev/null; then exit 1; fi"],
  });
  runCheck({
    name: "read-only-workspace",
    executable: "bash",
    args: ["-c", "test -r /workspace/input.txt && if touch /workspace/forbidden 2>/dev/null; then exit 1; fi"],
  });
  if (fs.existsSync(path.join(workspace, "forbidden"))) throw new Error("Read-only workspace was modified on the host.");

  runCheck({
    name: "read-write-workspace",
    executable: "bash",
    args: ["-c", "printf writable > /workspace/written.txt"],
    workspaceAccess: "read-write",
  });
  if (fs.readFileSync(path.join(workspace, "written.txt"), "utf8") !== "writable") {
    throw new Error("Read-write workspace output was not visible on the host.");
  }

  runCheck({
    name: "network-none",
    executable: "node",
    args: ["-e", "const os=require('os');const external=Object.entries(os.networkInterfaces()).flatMap(([name,items])=>(items||[]).filter(x=>!x.internal).map(x=>name));if(external.length){console.error(external);process.exit(1)}"],
  });
  runCheck({ name: "cleanup-after-failure", executable: "bash", args: ["-c", "exit 7"], expectCode: 7 });

  console.log(`Worker image smoke test passed for ${image}.`);
} finally {
  for (const name of activeContainers) docker(["rm", "--force", name], { quiet: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
