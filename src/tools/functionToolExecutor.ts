import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { boundJsonValue, boundedBytesFromEnvironment } from "../runtime/boundedValue";
import {
  ContainerWorkerRuntime,
  LocalProcessWorkerRuntime,
  containerWorkerPolicyFromEnvironment,
  type WorkerRuntime,
  type WorkerResult,
} from "../agents/runtime/workerRuntime";
import type { CliRuntimePolicy, CliWorkerMode } from "../agents/runtime/cliAgentExecutor";
import type { ToolExecutionInput, ToolExecutor } from "./types";

/**
 * Function-category executor. The default behavior is a local data-only echo.
 * Process execution is an explicit, server-configured repository capability and
 * always goes through the WorkerRuntime boundary.
 */
export class FunctionToolExecutor implements ToolExecutor {
  constructor(private readonly workerRuntime?: WorkerRuntime) {}

  async execute({ tool, input, signal }: ToolExecutionInput): Promise<Record<string, unknown>> {
    const kind = String(tool.configuration.kind ?? "");
    if (kind === "reject-run") {
      throw new Error(String(tool.configuration.message || "Workflow rejected"));
    }
    if (kind === "repo-tests") {
      return runRepoTests(tool.configuration, input, signal, this.workerRuntime);
    }
    if (kind === "repo-checks") {
      return runRepoChecks(tool.configuration, signal, this.workerRuntime);
    }
    if (kind === "pisa-normalize-intake") return normalizePisaIntake(tool.configuration, input);
    if (kind === "pisa-package-evidence") return packagePisaEvidence(tool.configuration, input);
    return { ...tool.configuration, ...input };
  }
}

function normalizePisaIntake(configuration: Record<string, string | number | boolean>, input: Record<string, unknown>): Record<string, unknown> {
  const required = String(configuration.requiredInputs ?? "objective,acceptanceCriteria,repository,baseRef").split(",").map(item => item.trim()).filter(Boolean);
  const missingFields = required.filter(field => {
    const value = input[field];
    return value === undefined || value === null || (typeof value === "string" && !value.trim());
  });
  const branch = input.branch === "knowledge_only" ? "knowledge_only" : "implementation";
  return {
    contractVersion: String(configuration.contractVersion ?? "pisa.delivery.v1"),
    organization: String(configuration.organization ?? "PISA"),
    status: missingFields.length ? "needs_clarification" : "ready",
    branch,
    missingFields,
    request: input,
  };
}

function packagePisaEvidence(configuration: Record<string, string | number | boolean>, input: Record<string, unknown>): Record<string, unknown> {
  const source = parseObject(input);
  const missing: string[] = [];
  if (source.qaPass !== true) missing.push("qa_pass");
  if (source.securityPass !== true) missing.push("security_pass");
  if (source.traceableEvidence !== true) missing.push("traceable_delivery_evidence");
  return {
    artifactType: String(configuration.artifactType ?? "pisa.completion_evidence"),
    completionPolicy: String(configuration.completionPolicy ?? "No delivery is complete without independent verification evidence."),
    status: missing.length ? "blocked" : "complete",
    missingRequirements: missing,
    evidence: source,
  };
}

function parseObject(input: Record<string, unknown>): Record<string, unknown> {
  const raw = typeof input.content === "string"
    ? input.content
    : typeof input.value === "string" ? input.value : undefined;
  if (raw !== undefined) {
    try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>; } catch { /* preserve raw input below */ }
  }
  return input;
}

type RepoCheckName = "test" | "typecheck" | "build" | "lint" | "diff";

const REPO_CHECK_NAMES: ReadonlySet<RepoCheckName> = new Set([
  "test", "typecheck", "build", "lint", "diff",
]);

const REPO_CHECK_COMMANDS: Record<Exclude<RepoCheckName, "build">, { executable: "node" | "git"; args: string[]; display: string; workspaceAccess?: "read-only" }> = {
  test: {
    executable: "node",
    args: ["node_modules/jest/bin/jest.js", "--runInBand", "--detectOpenHandles", "--forceExit"],
    display: "node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles --forceExit",
  },
  typecheck: {
    executable: "node",
    args: ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"],
    display: "node node_modules/typescript/bin/tsc --noEmit --pretty false",
  },
  lint: {
    executable: "node",
    args: ["node_modules/eslint/bin/eslint.js", "."],
    display: "node node_modules/eslint/bin/eslint.js .",
  },
  diff: {
    executable: "git",
    args: ["diff", "--check", "--", "."],
    display: "git diff --check -- .",
  },
};

async function runRepoTests(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  injectedWorkerRuntime?: WorkerRuntime,
): Promise<Record<string, unknown>> {
  const settings = repoTestSettingsFromEnvironment();
  if (!settings.enabled) {
    throw new Error("repo-tests is disabled. Set TOOL_REPO_TESTS_ENABLED=true to enable it explicitly.");
  }

  const cwd = assertAllowedWorkspace(String(configuration.workspaceRoot ?? ""), settings.workspaceRoots);
  const relTest = String(configuration.testPath ?? "test");
  if (relTest.includes("\0") || path.isAbsolute(relTest) || relTest.split(/[\\/]/).includes("..")) {
    throw new Error("repo-tests testPath must be a relative path without parent segments.");
  }

  const runtime = injectedWorkerRuntime ?? createRepoTestWorkerRuntime(settings);
  const testRun = await runWorker(runtime, {
    runId: `tool-repo-tests-${randomUUID()}`,
    nodeId: "repo-tests",
    agentId: "tool-repo-tests",
    executable: settings.nodeExecutable,
    args: ["--test", relTest],
    cwd,
    timeoutMs: settings.timeoutMs,
    maxOutputBytes: settings.maxOutputBytes,
    workspaceAccess: "read-only",
    network: false,
  }, signal);

  if (testRun.reason !== "completed" && !(testRun.reason === "failed" && testRun.code !== 0)) {
    throw new Error(testRun.error || `repo-tests worker ended with reason ${testRun.reason}.`);
  }

  const diffRun = await runWorker(runtime, {
    runId: `tool-repo-tests-${randomUUID()}`,
    nodeId: "repo-diff",
    agentId: "tool-repo-tests",
    executable: settings.gitExecutable,
    args: ["diff", "--", "."],
    cwd,
    timeoutMs: settings.timeoutMs,
    maxOutputBytes: settings.maxOutputBytes,
    workspaceAccess: "read-only",
    network: false,
  }, signal);

  const output = {
    branch: testRun.code === 0 ? "pass" : "fail",
    status: testRun.code ?? 1,
    stdout: testRun.stdout,
    stderr: testRun.stderr,
    command: `${settings.nodeExecutable} --test ${relTest}`,
    diff: diffRun.stdout,
    diffError: diffRun.code === 0 ? undefined : diffRun.stderr || diffRun.error,
    prior: input,
  };
  return boundJsonValue(output, settings.maxOutputBytes) as Record<string, unknown>;
}

async function runRepoChecks(
  configuration: Record<string, string | number | boolean>,
  signal?: AbortSignal,
  injectedWorkerRuntime?: WorkerRuntime,
): Promise<Record<string, unknown>> {
  const settings = repoTestSettingsFromEnvironment();
  if (!settings.checksEnabled) {
    throw new Error("repo-checks is disabled. Set TOOL_REPO_CHECKS_ENABLED=true to enable it explicitly.");
  }

  const cwd = assertAllowedWorkspace(String(configuration.workspaceRoot ?? ""), settings.workspaceRoots);
  const checks = parseRepoChecks(configuration.checks);
  const runtime = injectedWorkerRuntime ?? createRepoTestWorkerRuntime(settings);
  const results: Record<string, unknown>[] = [];

  for (const check of checks) {
    const command = check === "build" ? packageManagerCommand(cwd, settings, configuration.packageManager) : REPO_CHECK_COMMANDS[check];
    const executable = check === "build" ? settings.packageManager : command.executable === "node" ? settings.nodeExecutable : settings.gitExecutable;
    const checkRun = await runWorker(runtime, {
      runId: `tool-repo-checks-${randomUUID()}`,
      nodeId: `repo-check-${check}`,
      agentId: "tool-repo-checks",
      executable,
      args: command.args,
      cwd,
      timeoutMs: settings.timeoutMs,
      maxOutputBytes: settings.maxOutputBytes,
      workspaceAccess: command.workspaceAccess ?? "read-only",
      network: false,
    }, signal);

    if (checkRun.reason !== "completed" && !(checkRun.reason === "failed" && checkRun.code !== 0)) {
      throw new Error(checkRun.error || `repo-checks worker ended with reason ${checkRun.reason}.`);
    }

    results.push({
      name: check,
      status: checkRun.code === 0 ? "pass" : "fail",
      exitCode: checkRun.code,
      command: command.display,
      stdout: checkRun.stdout,
      stderr: checkRun.stderr,
      ...(checkRun.error ? { error: checkRun.error } : {}),
    });
    signal?.throwIfAborted();
  }

  const failed = results.filter((result) => result.status === "fail").length;
  return boundJsonValue({
    branch: failed === 0 ? "pass" : "fail",
    status: failed === 0 ? 0 : 1,
    checks: results,
    failedChecks: failed,
  }, settings.maxOutputBytes) as Record<string, unknown>;
}

function parseRepoChecks(value: string | number | boolean | undefined): RepoCheckName[] {
  const raw = String(value ?? "test,typecheck,diff")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!raw.length) throw new Error("repo-checks requires at least one check.");
  if (raw.length > REPO_CHECK_NAMES.size) throw new Error(`repo-checks supports at most ${REPO_CHECK_NAMES.size} checks.`);
  const checks: RepoCheckName[] = [];
  for (const item of raw) {
    if (!REPO_CHECK_NAMES.has(item as RepoCheckName)) {
      throw new Error(`Unsupported repo-checks check "${item}". Allowed checks: ${[...REPO_CHECK_NAMES].join(", ")}.`);
    }
    if (!checks.includes(item as RepoCheckName)) checks.push(item as RepoCheckName);
  }
  return checks;
}

async function runWorker(
  runtime: WorkerRuntime,
  spec: Parameters<WorkerRuntime["start"]>[0],
  signal?: AbortSignal,
): Promise<WorkerResult> {
  const handle = await runtime.start(spec, signal);
  try {
    return await runtime.wait(handle.workerId);
  } finally {
    await runtime.cleanup(handle.workerId);
  }
}

interface RepoTestSettings {
  enabled: boolean;
  checksEnabled: boolean;
  mode: CliWorkerMode;
  timeoutMs: number;
  maxOutputBytes: number;
  workspaceRoots: string[];
  nodeExecutable: string;
  gitExecutable: string;
  allowedExecutables: string[];
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
}

function repoTestSettingsFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): RepoTestSettings {
  const list = (value?: string) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const mode = env.TOOL_REPO_TESTS_WORKER_MODE?.trim() || "container";
  if (mode !== "local" && mode !== "container") {
    throw new Error(`Invalid TOOL_REPO_TESTS_WORKER_MODE "${mode}". Expected "local" or "container".`);
  }
  const roots = list(env.TOOL_REPO_TEST_WORKSPACE_ROOTS || env.CLI_AGENT_WORKSPACE_ROOTS).map((root) => path.resolve(root));
  const configuredExecutables = list(env.TOOL_REPO_TEST_ALLOWED_EXECUTABLES);
  const nodeExecutable = mode === "container" ? "node" : process.execPath;
  const packageManager = env.TOOL_REPO_PACKAGE_MANAGER?.trim() || "pnpm";
  if (!["pnpm", "npm", "yarn", "bun"].includes(packageManager)) throw new Error(`Unsupported TOOL_REPO_PACKAGE_MANAGER "${packageManager}".`);
  const allowedExecutables = [...new Set([...configuredExecutables, nodeExecutable, "git", packageManager])];
  const timeoutValue = Number(env.TOOL_REPO_TEST_TIMEOUT_MS ?? 30_000);

  return {
    enabled: env.TOOL_REPO_TESTS_ENABLED === "true",
    checksEnabled: env.TOOL_REPO_CHECKS_ENABLED === "true",
    mode,
    timeoutMs: Number.isInteger(timeoutValue) && timeoutValue >= 1_000 && timeoutValue <= 10 * 60_000 ? timeoutValue : 30_000,
    maxOutputBytes: boundedBytesFromEnvironment(env.TOOL_REPO_TEST_MAX_OUTPUT_BYTES, 256 * 1024),
    workspaceRoots: roots,
    nodeExecutable,
    gitExecutable: "git",
    allowedExecutables,
    packageManager: packageManager as RepoTestSettings["packageManager"],
  };
}

function createRepoTestWorkerRuntime(settings: RepoTestSettings): WorkerRuntime {
  const policy: CliRuntimePolicy = {
    enabled: settings.enabled || settings.checksEnabled,
    workerMode: settings.mode,
    allowedExecutables: settings.allowedExecutables,
    workspaceRoots: settings.workspaceRoots,
    maxOutputBytes: settings.maxOutputBytes,
  };
  if (settings.mode === "container") {
    return new ContainerWorkerRuntime(policy, containerWorkerPolicyFromEnvironment({
      ...process.env,
      CLI_WORKER_IMAGE: process.env.TOOL_WORKER_IMAGE || process.env.CLI_WORKER_IMAGE,
      CLI_WORKER_DOCKER_EXECUTABLE: process.env.TOOL_WORKER_DOCKER_EXECUTABLE || process.env.CLI_WORKER_DOCKER_EXECUTABLE,
    }));
  }
  return new LocalProcessWorkerRuntime(policy);
}

function packageManagerCommand(cwd: string, settings: RepoTestSettings, requested: string | number | boolean | undefined) {
  const packageManager = String(requested ?? settings.packageManager).trim();
  if (packageManager !== settings.packageManager) throw new Error(`repo-checks packageManager must match server policy "${settings.packageManager}".`);
  const manifestPath = path.join(cwd, "package.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Package-manager build requires package.json at workspace root.");
  let manifest: { packageManager?: unknown };
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { packageManager?: unknown }; } catch { throw new Error("Workspace package.json is invalid."); }
  if (typeof manifest.packageManager === "string" && !manifest.packageManager.toLowerCase().startsWith(`${packageManager}@`)) throw new Error(`Workspace packageManager conflicts with server policy "${packageManager}".`);
  const lockfiles: Record<RepoTestSettings["packageManager"], string> = { pnpm: "pnpm-lock.yaml", npm: "package-lock.json", yarn: "yarn.lock", bun: "bun.lockb" };
  const otherLock = Object.entries(lockfiles).find(([manager, file]) => manager !== packageManager && fs.existsSync(path.join(cwd, file)));
  if (otherLock) throw new Error(`Workspace contains ${otherLock[1]} but server policy selects ${packageManager}.`);
  return { executable: packageManager, args: ["run", "build"], display: `${packageManager} run build`, workspaceAccess: "read-write" as const };
}

export function assertAllowedWorkspace(workspaceRoot: string, configuredRoots?: ReadonlyArray<string>): string {
  if (!workspaceRoot.trim()) throw new Error("repo-tests tool requires configuration.workspaceRoot.");
  const resolvedInput = path.resolve(workspaceRoot);
  if (!path.isAbsolute(resolvedInput) || /[\r\n\0]/.test(resolvedInput)) {
    throw new Error("repo-tests workspaceRoot must be an absolute path.");
  }
  if (!fs.existsSync(resolvedInput) || !fs.statSync(resolvedInput).isDirectory()) {
    throw new Error("repo-tests workspaceRoot does not exist.");
  }

  const roots = configuredRoots ?? (process.env.TOOL_REPO_TEST_WORKSPACE_ROOTS || process.env.CLI_AGENT_WORKSPACE_ROOTS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  if (!roots.length) throw new Error("repo-tests requires TOOL_REPO_TEST_WORKSPACE_ROOTS to be configured.");

  let resolvedWorkspace: string;
  try {
    resolvedWorkspace = fs.realpathSync(resolvedInput);
  } catch {
    throw new Error("repo-tests workspaceRoot could not be resolved.");
  }
  const allowed = roots.some((root) => {
    try {
      const resolvedRoot = fs.realpathSync(root);
      const relative = path.relative(resolvedRoot, resolvedWorkspace);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    } catch {
      return false;
    }
  });
  if (!allowed) throw new Error("repo-tests workspaceRoot is outside configured workspace roots.");
  return resolvedWorkspace;
}
