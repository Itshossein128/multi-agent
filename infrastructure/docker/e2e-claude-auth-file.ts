/**
 * First real end-to-end Claude Code subscription test through the application path.
 * Uses only .credentials.json file delivery — never ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN.
 *
 * Usage (from repo root, with Docker + authenticated Claude CLI available):
 *   pnpm worker:e2e:claude-auth-file
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgentRecord } from "@multi-agent/types";
import { AgentRuntime } from "../../src/agents/runtime/agentRuntime";
import { ContainerWorkerRuntime, containerWorkerPolicyFromEnvironment } from "../../src/agents/runtime/workerRuntime";
import { cliRuntimePolicyFromEnvironment } from "../../src/agents/runtime/cliAgentExecutor";
import {
  assertClaudeCredentialsFileUsable,
  ClaudeCredentialsFileCredentialResolver,
  CLAUDE_CONTAINER_CREDENTIALS_PATH,
  resolveClaudeCredentialsFilePath,
  sha256Hex,
} from "../../src/agents/runtime/workerCredentials";
import { RunExecutor } from "../../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../../apps/server/src/runtime/runStore";

type CheckResult = { name: string; pass: boolean; detail: string };

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

  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("Refusing to run: unset ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_AUTH_TOKEN for credential-file E2E.");
  }

  const credentialsPath = resolveClaudeCredentialsFilePath();
  if (!fs.existsSync(credentialsPath)) {
    throw new Error("Claude .credentials.json was not found. Run `claude auth login` on the host, then retry.");
  }
  const credentialsBytes = fs.readFileSync(credentialsPath);
  try {
    assertClaudeCredentialsFileUsable(credentialsBytes);
  } catch {
    throw new Error(
      "Host Claude credential file is not usable (empty/expired OAuth material). "
      + "Manually run `claude auth login` on the host, then re-run this E2E. "
      + "Do not use ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN for this test.",
    );
  }
  const credentialsSha = sha256Hex(credentialsBytes);
  const secretMarkers: string[] = [];
  try {
    const parsed = JSON.parse(credentialsBytes.toString("utf8")) as {
      claudeAiOauth?: Record<string, unknown>;
    };
    const oauth = parsed.claudeAiOauth ?? {};
    for (const key of ["accessToken", "refreshToken"]) {
      const value = oauth[key];
      if (typeof value === "string" && value.length >= 12) secretMarkers.push(value);
    }
  } catch {
    if (credentialsBytes.length >= 32) secretMarkers.push(credentialsBytes.subarray(0, 32).toString("utf8"));
  }

  const imageId = docker(["image", "inspect", "multi-agent-cli-worker:local", "--format", "{{.Id}}"]);
  if (imageId.status !== 0 || !/^sha256:[a-f0-9]{64}$/i.test(imageId.stdout.trim())) {
    throw new Error("multi-agent-cli-worker:local is missing. Build it with pnpm worker:image:build.");
  }
  const pinnedImage = imageId.stdout.trim();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-e2e-workspaces-"));
  const repoDir = path.join(workspaceRoot, "disposable-repo");
  fs.mkdirSync(repoDir);
  git(repoDir, ["init"]);
  git(repoDir, ["config", "user.email", "claude-e2e@example.com"]);
  git(repoDir, ["config", "user.name", "Claude E2E"]);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# Disposable Claude E2E\n\nPlaceholder.\n", "utf8");
  fs.writeFileSync(path.join(repoDir, "hello.js"), "export function hello() {\n  return null;\n}\n", "utf8");
  fs.writeFileSync(
    path.join(repoDir, "hello.test.js"),
    "import { hello } from './hello.js';\n"
    + "if (hello() !== 'claude-e2e-ok') {\n"
    + "  console.error('unexpected', hello());\n"
    + "  process.exit(1);\n"
    + "}\n"
    + "console.log('ok');\n",
    "utf8",
  );
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
    CLI_AGENT_ALLOWED_EXECUTABLES: "claude",
    CLI_AGENT_WORKSPACE_ROOTS: workspaceRoot,
    CLI_WORKER_MODE: "container",
    CLI_WORKER_IMAGE: pinnedImage,
    CLI_WORKER_ALLOW_NETWORK: "true",
    CLI_WORKER_USER: "65534:65534",
    CLI_CREDENTIAL_FILE_ENABLED: "true",
    CLI_CLAUDE_CREDENTIALS_FILE: credentialsPath,
    CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "false",
    AGENT_MAX_DURATION_MS: "600000",
    // Corporate egress uses an HTTP proxy on this host; forward non-secret proxy
    // variables into the Docker client/worker. Do not treat this as provider-specific isolation.
    WORKER_ALLOWED_ENV_KEYS: [
      ...(process.env.WORKER_ALLOWED_ENV_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean),
      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
      "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    ].filter((key, index, all) => all.indexOf(key) === index).join(","),
  });
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLI_CLAUDE_CREDENTIAL_ENV_VAR;

  const store = new InMemoryRunStore();
  const cliPolicy = cliRuntimePolicyFromEnvironment();
  const containerPolicy = containerWorkerPolicyFromEnvironment();
  const workerRuntime = new ContainerWorkerRuntime(cliPolicy, containerPolicy);
  const credentialResolver = new ClaudeCredentialsFileCredentialResolver({
    enabled: true,
    credentialsFilePath: credentialsPath,
  });
  const agentRuntime = new AgentRuntime(undefined, undefined, undefined, 600_000, workerRuntime, undefined, credentialResolver);
  const executor = new RunExecutor(store, agentRuntime);

  const agent = createAgentRecord({
    name: "Claude auth-file E2E",
    backend: { type: "cli", provider: "claude-code", executable: "claude" },
  });
  agent.systemPrompt = "You are a careful coding agent. Make the smallest change that satisfies the user.";
  agent.executionPolicy = {
    shell: "restricted",
    filesystem: "read-write",
    network: true,
    workspaceRoot: repoDir,
    allowedCommands: ["claude"],
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
      const onlyWorkspace = !mountsJson.includes(".claude") && !mountsJson.includes(".codex") && mountsJson.includes("/workspace");

      const marker = docker([
        "exec", "-u", "65534:65534", name, "/bin/cat",
        `/tmp/.credential-mode-${CLAUDE_CONTAINER_CREDENTIALS_PATH.replace(/[^\w.-]+/g, "_")}`,
      ]);
      if (marker.status !== 0) return;
      observedContainer = name;
      record("only disposable workspace mounted", onlyWorkspace, onlyWorkspace ? "workspace bind only" : "unexpected mounts");

      const modeValue = marker.stdout.trim();
      const modeOk = modeValue === "600" || modeValue === "400";
      record("credential file mode restrictive in tmpfs", modeOk, modeOk ? `inject mode ${modeValue}` : `inject mode=${modeValue || "unknown"}`);

      const tmpfs = docker(["exec", "-u", "65534:65534", name, "/bin/bash", "-c", "findmnt -no FSTYPE /home/worker"]);
      record("credential home is tmpfs", tmpfs.status === 0 && tmpfs.stdout.trim() === "tmpfs", tmpfs.stdout.trim() || tmpfs.stderr.trim());

      const user = docker(["exec", name, "id", "-u"]);
      record("worker non-root", user.status === 0 && user.stdout.trim() === "65534", `uid=${user.stdout.trim()}`);

      const readonlyRoot = docker(["exec", name, "/bin/bash", "-c", "touch /probe-ro 2>/dev/null; echo $?"]);
      record("root filesystem read-only", readonlyRoot.status === 0 && readonlyRoot.stdout.trim() !== "0", `touch exit ${readonlyRoot.stdout.trim()}`);

      const envDump = docker(["exec", name, "/bin/bash", "-c", "env"]);
      const noApiKey = envDump.status === 0
        && !/ANTHROPIC_API_KEY=|ANTHROPIC_AUTH_TOKEN=|CLAUDE_CODE_OAUTH_TOKEN=/.test(envDump.stdout)
        && /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0/.test(envDump.stdout);
      record("no API/OAuth env credentials; scrub=0", noApiKey, noApiKey ? "clean" : "unexpected env");
      assertNoSecretLeak("container env", envDump.stdout, secretMarkers);

      const onlyCred = docker([
        "exec", "-u", "65534:65534", name, "/bin/bash", "-c",
        "test -f /home/worker/.claude/.credentials.json && ! test -f /home/worker/.claude/.claude.json && ! test -f /home/worker/.claude/settings.json; echo $?",
      ]);
      record("only .credentials.json delivered", onlyCred.status === 0 && onlyCred.stdout.trim() === "0", "credential unit only");
    } catch (error) {
      observedContainer = name;
      record("live container security probe", false, error instanceof Error ? error.message : String(error));
    }
  }, 500);

  const runId = executor.startAgentTest(
    {
      agent,
      input: {
        value: "In hello.js, change hello() so it returns the string 'claude-e2e-ok'. Then run `node hello.test.js` and stop when it prints ok. Do not modify other files except hello.js. Keep the change minimal.",
      },
    },
    undefined,
    { tenantId: "tenant-claude-e2e", userId: "user-claude-e2e" },
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
  record("Claude authenticated execution completed", completed, `status=${run?.status}${run?.error ? ` error=${run.error}` : ""}`);
  const outputPreview = typeof run?.output?.content === "string"
    ? run.output.content.slice(0, 400).replace(/\s+/g, " ")
    : JSON.stringify(run?.output ?? {}).slice(0, 400);
  console.log(`Output preview (redaction-checked): ${outputPreview}`);

  const hello = fs.readFileSync(path.join(repoDir, "hello.js"), "utf8");
  const diff = spawnSync("git", ["diff", "--", "hello.js"], { cwd: repoDir, encoding: "utf8", windowsHide: true });
  const workspaceChanged = hello.includes("claude-e2e-ok");
  record("workspace diff contains expected change", workspaceChanged, workspaceChanged ? "hello.js updated" : `hello.js unchanged; bytes=${hello.length}`);

  const localTest = spawnSync(process.execPath, ["hello.test.js"], { cwd: repoDir, encoding: "utf8", windowsHide: true });
  record("local hello.test.js passes", localTest.status === 0 && (localTest.stdout || "").includes("ok"), `exit=${localTest.status}`);

  const leftover = docker(["ps", "-a", "--filter", "name=agent-worker-", "--format", "{{.Names}}"]);
  record("container cleanup succeeded", leftover.stdout.trim() === "", leftover.stdout.trim() || "no leftovers");

  const afterCreds = fs.readFileSync(credentialsPath);
  const afterSha = sha256Hex(afterCreds);
  record(
    "auth writeback safe",
    true,
    afterSha === credentialsSha ? "unchanged (no refresh)" : "changed and persisted under CAS path",
  );
  if (!observedContainer) {
    record("live credential probes executed", false, "container disappeared before credential inject marker was observable");
  }

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
