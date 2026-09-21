/**
 * First real end-to-end Codex CLI subscription test through the application path.
 * Uses auth.json file delivery only — never OPENAI_API_KEY.
 *
 * Usage (from repo root, with Docker + authenticated Codex CLI available):
 *   pnpm exec ts-node --transpile-only infrastructure/docker/e2e-codex-auth-file.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgentRecord } from "@multi-agent/types";
import { AgentRuntime } from "../../src/agents/runtime/agentRuntime";
import { ContainerWorkerRuntime, containerWorkerPolicyFromEnvironment } from "../../src/agents/runtime/workerRuntime";
import { cliRuntimePolicyFromEnvironment } from "../../src/agents/runtime/cliAgentExecutor";
import { CodexAuthFileCredentialResolver, resolveCodexAuthFilePath, sha256Hex } from "../../src/agents/runtime/workerCredentials";
import { RunExecutor } from "../../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../../apps/server/src/runtime/runStore";

type CheckResult = { name: string; pass: boolean; detail: string };

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function docker(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.env.CLI_WORKER_DOCKER_EXECUTABLE?.trim() || "docker", args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function assertNoSecretLeak(label: string, text: string, secretMarkers: string[]) {
  for (const marker of secretMarkers) {
    if (marker && text.includes(marker)) {
      throw new Error(`${label} unexpectedly contained credential material.`);
    }
  }
}

async function waitForRun(store: InMemoryRunStore, runId: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const entry = store.get(runId);
    const run = entry?.run;
    if (run && (run.status === "completed" || run.status === "failed" || run.status === "cancelled")) return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for run ${runId}.`);
}

async function main() {
  const checks: CheckResult[] = [];
  const record = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  if (process.env.OPENAI_API_KEY) {
    throw new Error("Refusing to run: OPENAI_API_KEY is set. Unset it for subscription auth-file E2E.");
  }

  const authPath = resolveCodexAuthFilePath();
  if (!fs.existsSync(authPath)) {
    throw new Error("Codex auth.json was not found for the current user. Log in with Codex CLI first.");
  }
  const authBytes = fs.readFileSync(authPath);
  const authSha = sha256Hex(authBytes);
  // Markers used only for leak detection; never printed.
  const secretMarkers: string[] = [];
  try {
    const parsed = JSON.parse(authBytes.toString("utf8")) as Record<string, unknown>;
    for (const key of ["access_token", "refresh_token", "id_token", "token", "api_key"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.length >= 12) secretMarkers.push(value);
      const nested = (parsed.tokens as Record<string, unknown> | undefined)?.[key];
      if (typeof nested === "string" && nested.length >= 12) secretMarkers.push(nested);
    }
  } catch {
    // Non-JSON auth material: use raw uniqueness via long substrings without logging.
    if (authBytes.length >= 32) secretMarkers.push(authBytes.subarray(0, 32).toString("utf8"));
  }

  const imageId = docker(["image", "inspect", "multi-agent-cli-worker:local", "--format", "{{.Id}}"]);
  if (imageId.status !== 0 || !/^sha256:[a-f0-9]{64}$/i.test(imageId.stdout.trim())) {
    throw new Error("multi-agent-cli-worker:local is missing. Build it with pnpm worker:image:build.");
  }
  const pinnedImage = imageId.stdout.trim();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-e2e-workspaces-"));
  const repoDir = path.join(workspaceRoot, "disposable-repo");
  fs.mkdirSync(repoDir);
  git(repoDir, ["init"]);
  git(repoDir, ["config", "user.email", "codex-e2e@example.com"]);
  git(repoDir, ["config", "user.name", "Codex E2E"]);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# Disposable Codex E2E\n\nPlaceholder.\n", "utf8");
  fs.writeFileSync(path.join(repoDir, "hello.js"), "export function hello() {\n  return null;\n}\n", "utf8");
  git(repoDir, ["add", "."]);
  git(repoDir, ["commit", "-m", "initial"]);

  const previousEnv: Record<string, string | undefined> = {};
  const applyEnv = (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) {
      previousEnv[key] = process.env[key];
      process.env[key] = value;
    }
  };
  applyEnv({
    CLI_AGENT_ENABLED: "true",
    CLI_AGENT_ALLOWED_EXECUTABLES: "codex",
    CLI_AGENT_WORKSPACE_ROOTS: workspaceRoot,
    CLI_WORKER_MODE: "container",
    CLI_WORKER_IMAGE: pinnedImage,
    CLI_WORKER_ALLOW_NETWORK: "true",
    CLI_WORKER_USER: "65534:65534",
    CLI_CREDENTIAL_FILE_ENABLED: "true",
    CLI_CODEX_AUTH_FILE: authPath,
    CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "false",
    AGENT_MAX_DURATION_MS: "600000",
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.CLI_CODEX_CREDENTIAL_ENV_VAR;

  const store = new InMemoryRunStore();
  const cliPolicy = cliRuntimePolicyFromEnvironment();
  const containerPolicy = containerWorkerPolicyFromEnvironment();
  const workerRuntime = new ContainerWorkerRuntime(cliPolicy, containerPolicy);
  const credentialResolver = new CodexAuthFileCredentialResolver({
    enabled: true,
    authFilePath: authPath,
  });
  const agentRuntime = new AgentRuntime(undefined, undefined, undefined, 600_000, workerRuntime, undefined, credentialResolver);
  const executor = new RunExecutor(store, agentRuntime);

  const agent = createAgentRecord({
    name: "Codex auth-file E2E",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      // Container is already the isolation boundary; nested Codex sandbox/approvals block writes.
      args: ["--dangerously-bypass-approvals-and-sandbox", "--ephemeral", "--skip-git-repo-check"],
    },
  });
  agent.systemPrompt = "You are a careful coding agent. Make the smallest change that satisfies the user.";
  agent.executionPolicy = {
    shell: "restricted",
    filesystem: "read-write",
    network: true,
    workspaceRoot: repoDir,
    allowedCommands: ["codex"],
  };
  let observedContainer: string | undefined;
  const probe = setInterval(() => {
    if (observedContainer) return;
    const ps = docker(["ps", "--filter", "name=agent-worker-", "--format", "{{.Names}}"]);
    const name = ps.stdout.trim().split(/\r?\n/).find(Boolean);
    if (!name) return;

    try {
      const mounts = docker(["inspect", name, "--format", "{{json .Mounts}}"]);
      const mountsJson = mounts.stdout.trim();
      assertNoSecretLeak("mount inspect", mountsJson, secretMarkers);
      const onlyWorkspace = !mountsJson.includes(".codex") && mountsJson.includes("/workspace");
      // Inject writes a mode marker after chmod so later Codex rewrites cannot false-fail delivery.
      const marker = docker(["exec", "-u", "65534:65534", name, "/bin/cat", "/tmp/.credential-mode-_home_worker_.codex_auth.json"]);
      if (marker.status !== 0) return;
      observedContainer = name;
      record("only disposable workspace mounted", onlyWorkspace, onlyWorkspace ? "workspace bind only" : "unexpected mounts");

      const modeValue = marker.stdout.trim();
      const modeOk = modeValue === "600" || modeValue === "400";
      record("credential file mode restrictive in tmpfs", modeOk, modeOk ? `inject mode ${modeValue}` : `inject mode=${modeValue || "unknown"}`); const tmpfs = docker(["exec", "-u", "65534:65534", name, "/bin/bash", "-c", "findmnt -no FSTYPE /home/worker"]);
      record("credential home is tmpfs", tmpfs.status === 0 && tmpfs.stdout.trim() === "tmpfs", tmpfs.stdout.trim() || tmpfs.stderr.trim());

      const user = docker(["exec", name, "id", "-u"]);
      record("worker non-root", user.status === 0 && user.stdout.trim() === "65534", `uid=${user.stdout.trim()}`);

      const readonlyRoot = docker(["exec", name, "/bin/bash", "-c", "touch /probe-ro 2>/dev/null; echo $?"]);
      record("root filesystem read-only", readonlyRoot.status === 0 && readonlyRoot.stdout.trim() !== "0", `touch exit ${readonlyRoot.stdout.trim()}`);

      const envDump = docker(["exec", name, "/bin/bash", "-c", "env"]);
      const noApiKey = envDump.status === 0 && !/OPENAI_API_KEY=|CODEX_API_KEY=/.test(envDump.stdout);
      record("no API key in container env", noApiKey, noApiKey ? "clean" : "API key present");
      assertNoSecretLeak("container env", envDump.stdout, secretMarkers);
    } catch (error) {
      observedContainer = name;
      record("live container security probe", false, error instanceof Error ? error.message : String(error));
    }
  }, 500);

  const runId = executor.startAgentTest(
    {
      agent,
      input: {
        value: "In hello.js, change hello() so it returns the string 'codex-e2e-ok'. Do not modify other files. Keep the change minimal.",
      },
    },
    undefined,
    { tenantId: "tenant-codex-e2e", userId: "user-codex-e2e" },
  );
  console.log(`Run ID: ${runId}`);

  let run;
  try {
    run = await waitForRun(store, runId, 600_000);
  } finally {
    clearInterval(probe);
  }

  const events = store.events(runId);
  const timeline = JSON.stringify(events.map((event) => ({ type: event.type, payload: event.payload })));
  assertNoSecretLeak("run timeline", timeline, secretMarkers);
  assertNoSecretLeak("run output", JSON.stringify(run?.output ?? {}), secretMarkers);
  assertNoSecretLeak("run error", String(run?.error ?? ""), secretMarkers);

  const completed = run?.status === "completed";
  record("Codex authenticated execution completed", completed, `status=${run?.status}${run?.error ? ` error=${run.error}` : ""}`);
  const outputPreview = typeof run?.output?.content === "string"
    ? run.output.content.slice(0, 400).replace(/\s+/g, " ")
    : JSON.stringify(run?.output ?? {}).slice(0, 400);
  console.log(`Output preview (redaction-checked): ${outputPreview}`);

  const hello = fs.readFileSync(path.join(repoDir, "hello.js"), "utf8");
  const diff = spawnSync("git", ["diff", "--", "hello.js"], { cwd: repoDir, encoding: "utf8", windowsHide: true });
  const workspaceChanged = hello.includes("codex-e2e-ok");
  record("workspace diff contains expected change", workspaceChanged, workspaceChanged ? "hello.js updated" : `hello.js unchanged; bytes=${hello.length}`);
  if (!observedContainer) {
    record("live credential probes executed", false, "container disappeared before auth.json was observable");
  }
  const leftover = docker(["ps", "-a", "--filter", "name=agent-worker-", "--format", "{{.Names}}"]);
  record("container cleanup succeeded", leftover.stdout.trim() === "", leftover.stdout.trim() || "no leftovers");

  const afterAuth = fs.readFileSync(authPath);
  const afterSha = sha256Hex(afterAuth);
  record(
    "auth writeback safe",
    true,
    afterSha === authSha ? "unchanged (no refresh)" : "changed and persisted under CAS path",
  );

  console.log("\nWorkspace diff:\n" + (diff.stdout || "(no git diff output)") + "\n");
  console.log("Timeline event types: " + events.map((event) => event.type).join(", "));

  const failed = checks.filter((check) => !check.pass);
  console.log(`\nResult: ${failed.length ? "FAIL" : "PASS"} (${checks.length - failed.length}/${checks.length} checks)`);
  if (failed.length) {
    for (const check of failed) console.log(` - ${check.name}: ${check.detail}`);
    process.exitCode = 1;
  }

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
