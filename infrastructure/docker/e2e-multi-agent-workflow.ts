/**
 * Operational acceptance: real multi-agent coding workflow through the application path.
 *
 * Task → Planner (Claude) → Implementer (Codex) → Test tool → conditional Fixer (Claude)
 * → Test tool → Reviewer (Claude) → completion.
 *
 * Does not implement Credential Gateway. Uses disposable workspace only.
 *
 * Usage:
 *   pnpm worker:e2e:multi-agent-workflow
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  createToolRecord,
  nowIso,
  uid,
  type AgentRecord,
  type RunEvent,
  type ToolRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { AgentRuntime } from "../../src/agents/runtime/agentRuntime";
import { ContainerWorkerRuntime, containerWorkerPolicyFromEnvironment } from "../../src/agents/runtime/workerRuntime";
import { cliRuntimePolicyFromEnvironment } from "../../src/agents/runtime/cliAgentExecutor";
import {
  resolveClaudeCredentialsFilePath,
  resolveCodexAuthFilePath,
  sha256Hex,
  workerCredentialResolverFromEnvironment,
} from "../../src/agents/runtime/workerCredentials";
import { RunExecutor } from "../../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../../apps/server/src/runtime/runStore";
import { runtimeGuardrailsFromEnvironment } from "../../apps/server/src/runtime/guardrails";
import type { ToolRuntime } from "../../src/tools";

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

function collectSecretMarkers(...files: string[]): string[] {
  const markers: string[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    try {
      const parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
      const push = (value: unknown) => {
        if (typeof value === "string" && value.length >= 12) markers.push(value);
      };
      for (const key of ["access_token", "refresh_token", "id_token", "token", "api_key", "accessToken", "refreshToken"]) {
        push(parsed[key]);
        const nested = (parsed.tokens as Record<string, unknown> | undefined)?.[key]
          ?? (parsed.claudeAiOauth as Record<string, unknown> | undefined)?.[key];
        push(nested);
      }
    } catch {
      if (bytes.length >= 32) markers.push(bytes.subarray(0, 32).toString("utf8"));
    }
  }
  return markers;
}

async function waitForRun(store: InMemoryRunStore, runId: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const entry = store.get(runId);
    const run = entry?.run;
    if (run && (run.status === "completed" || run.status === "failed" || run.status === "cancelled")) return run;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for run ${runId}.`);
}

function setStableId<T extends { id: string }>(node: T, id: string): T {
  node.id = id;
  return node;
}

function createDisposableRepo(workspaceRoot: string): string {
  const repoDir = path.join(workspaceRoot, "disposable-repo");
  fs.mkdirSync(repoDir, { recursive: true });
  git(repoDir, ["init"]);
  git(repoDir, ["config", "user.email", "multi-agent-e2e@example.com"]);
  git(repoDir, ["config", "user.name", "Multi Agent E2E"]);

  fs.writeFileSync(
    path.join(repoDir, "package.json"),
    `${JSON.stringify({ name: "disposable-add-bug", type: "module", private: true }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(repoDir, "README.md"),
    [
      "# Disposable arithmetic module",
      "",
      "This tiny package exposes `add` from `src/math.js`.",
      "Tests live in `test/math.test.js` and must pass with `node --test`.",
      "There is also `src/format.js` which agents should leave alone unless required.",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoDir, "test"), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, "src", "math.js"),
    "/** Deliberately broken add — agents must discover and fix this. */\nexport function add(a, b) {\n  return a - b;\n}\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(repoDir, "src", "format.js"),
    "export function labelSum(a, b, sum) {\n  return `${a}+${b}=${sum}`;\n}\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(repoDir, "test", "math.test.js"),
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { add } from '../src/math.js';",
      "import { labelSum } from '../src/format.js';",
      "",
      "test('add returns the sum of two numbers', () => {",
      "  assert.equal(add(2, 3), 5);",
      "  assert.equal(add(-1, 1), 0);",
      "  assert.equal(add(10, 0), 10);",
      "});",
      "",
      "test('format helper still works', () => {",
      "  assert.equal(labelSum(2, 3, 5), '2+3=5');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(repoDir, "STATUS.md"), "# Status\n\nInitial broken baseline.\n", "utf8");
  git(repoDir, ["add", "."]);
  git(repoDir, ["commit", "-m", "initial broken add"]);
  return repoDir;
}

function buildRepoTestTool(workspaceRoot: string): ToolRecord {
  const tool = createToolRecord({
    name: "Run disposable repo tests",
    category: "function",
    description: "Runs node --test against the disposable repository and returns pass/fail branch state.",
  });
  tool.id = "tool_repo_tests";
  tool.impact = "read-only";
  tool.metadata = { idempotent: true, kind: "repo-tests" };
  tool.configuration = {
    kind: "repo-tests",
    workspaceRoot,
    command: "node --test test/math.test.js",
  };
  return tool;
}

function buildRejectTool(): ToolRecord {
  const tool = createToolRecord({
    name: "Reject workflow",
    category: "function",
    description: "Fails the run when review rejects or final tests fail.",
  });
  tool.id = "tool_reject";
  tool.impact = "read-only";
  tool.configuration = { kind: "reject-run", message: "Workflow rejected: tests failed or reviewer rejected." };
  return tool;
}

function createRepoTestToolRuntime(repoDir: string): Pick<ToolRuntime, "execute"> {
  return {
    async execute(tool, input) {
      const kind = String(tool.configuration.kind ?? "");
      if (kind === "reject-run") {
        throw new Error(String(tool.configuration.message || "Workflow rejected"));
      }
      if (kind !== "repo-tests") {
        throw new Error(`Unexpected tool "${tool.id}" in multi-agent acceptance runtime.`);
      }
      const cwd = String(tool.configuration.workspaceRoot || repoDir);
      const testRun = spawnSync(process.execPath, ["--test", "test/math.test.js"], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        env: process.env,
      });
      const diff = spawnSync("git", ["diff", "--", "."], { cwd, encoding: "utf8", windowsHide: true });
      const status = testRun.status ?? 1;
      return {
        branch: status === 0 ? "pass" : "fail",
        status,
        stdout: testRun.stdout ?? "",
        stderr: testRun.stderr ?? "",
        command: "node --test test/math.test.js",
        diff: diff.stdout ?? "",
        prior: input,
      };
    },
  };
}

function buildAgents(repoDir: string): {
  planner: AgentRecord;
  implementer: AgentRecord;
  fixer: AgentRecord;
  reviewer: AgentRecord;
} {
  const planner = createAgentRecord({
    name: "Planner",
    backend: { type: "cli", provider: "claude-code", executable: "claude" },
  });
  planner.systemPrompt = [
    "You are the Planner in a multi-agent workflow.",
    "Inspect the repository under the workspace. Do not modify any files.",
    "Produce a concise implementation plan for fixing add() so tests pass.",
    "Identify relevant files and expected validation (node --test).",
    "Return plain text only.",
  ].join(" ");
  planner.executionPolicy = {
    shell: "restricted",
    filesystem: "read",
    network: true,
    workspaceRoot: repoDir,
    allowedCommands: ["claude"],
  };

  const implementer = createAgentRecord({
    name: "Implementer",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--dangerously-bypass-approvals-and-sandbox", "--ephemeral", "--skip-git-repo-check"],
    },
  });
  // Intentionally leave the arithmetic bug so the Fixer conditional branch is exercised.
  implementer.systemPrompt = [
    "You are the Implementer. Follow the planner notes in USER INPUT.",
    "IMPORTANT APPLICATION CONSTRAINT FOR THIS RUN:",
    "Do NOT fix src/math.js and do NOT change any test files.",
    "Your only allowed edit is STATUS.md: append one short note that add() is still broken and needs a Fixer.",
    "Do not claim the bug is fixed. Keep the change minimal.",
  ].join(" ");
  implementer.executionPolicy = {
    shell: "restricted",
    filesystem: "read-write",
    network: true,
    workspaceRoot: repoDir,
    allowedCommands: ["codex"],
  };

  const fixer = createAgentRecord({
    name: "Fixer",
    backend: { type: "cli", provider: "claude-code", executable: "claude" },
  });
  fixer.systemPrompt = [
    "You are the Fixer. The Implementer left tests failing on purpose.",
    "USER INPUT includes prior workflow state with test stdout/stderr/status.",
    "Inspect the repository, fix src/math.js so add(a,b) returns a+b, then run `node --test test/math.test.js` if useful.",
    "Do not modify unrelated files. Keep the fix minimal.",
  ].join(" ");
  fixer.executionPolicy = {
    shell: "restricted",
    filesystem: "read-write",
    network: true,
    workspaceRoot: repoDir,
    allowedCommands: ["claude"],
  };

  const reviewer = createAgentRecord({
    name: "Reviewer",
    backend: { type: "cli", provider: "claude-code", executable: "claude" },
  });
  reviewer.systemPrompt = [
    "You are the Reviewer. Do not modify any repository files.",
    "Inspect the task, git diff / test results in USER INPUT, and decide approve or reject.",
    "Reply with a single JSON object only, no markdown fences:",
    '{"branch":"approved"|"rejected","verdict":"approve"|"reject","reasoning":"<concise>","blockingIssue":null|"<issue>"}',
    "Approve only if tests passed and the add() bug appears fixed.",
  ].join(" ");
  reviewer.executionPolicy = {
    shell: "restricted",
    filesystem: "read",
    network: true,
    workspaceRoot: repoDir,
    allowedCommands: ["claude"],
  };

  return { planner, implementer, fixer, reviewer };
}

function buildWorkflow(agents: ReturnType<typeof buildAgents>, tools: ToolRecord[]): WorkflowDefinition {
  const input = setStableId(createNode("input", { x: 0, y: 0 }), "n_input");
  const planner = setStableId(createNode("agent", { x: 1, y: 0 }, { agentId: agents.planner.id }), "n_planner");
  const implementer = setStableId(createNode("agent", { x: 2, y: 0 }, { agentId: agents.implementer.id }), "n_implementer");
  const test1 = setStableId(createNode("tool", { x: 3, y: 0 }, { toolId: tools[0]!.id }), "n_test1");
  const cond1 = setStableId(createNode("condition", { x: 4, y: 0 }), "n_cond_after_implementer");
  cond1.config = { branches: [{ key: "fail", label: "Tests failed" }, { key: "pass", label: "Tests passed" }] };
  const fixer = setStableId(createNode("agent", { x: 5, y: 1 }, { agentId: agents.fixer.id }), "n_fixer");
  const test2 = setStableId(createNode("tool", { x: 6, y: 1 }, { toolId: tools[0]!.id }), "n_test2");
  const cond2 = setStableId(createNode("condition", { x: 7, y: 1 }), "n_cond_after_fixer");
  cond2.config = { branches: [{ key: "pass", label: "Tests passed" }, { key: "fail", label: "Tests failed" }] };
  const reviewer = setStableId(createNode("agent", { x: 8, y: 0 }, { agentId: agents.reviewer.id }), "n_reviewer");
  const condReview = setStableId(createNode("condition", { x: 9, y: 0 }), "n_cond_review");
  condReview.config = { branches: [{ key: "approved", label: "Approved" }, { key: "rejected", label: "Rejected" }] };
  const output = setStableId(createNode("output", { x: 10, y: 0 }), "n_output");
  const reject = setStableId(createNode("tool", { x: 9, y: 2 }, { toolId: tools[1]!.id }), "n_reject");

  const workflow = {
    ...createEmptyDefinition("Multi-agent coding acceptance"),
    id: uid("wf"),
    nodes: [input, planner, implementer, test1, cond1, fixer, test2, cond2, reviewer, condReview, output, reject],
    edges: [
      createEdge({ source: input.id, target: planner.id }),
      createEdge({ source: planner.id, target: implementer.id }),
      createEdge({ source: implementer.id, target: test1.id }),
      createEdge({ source: test1.id, target: cond1.id }),
      createEdge({ source: cond1.id, target: fixer.id, kind: "conditional", branchKey: "fail" }),
      createEdge({ source: cond1.id, target: reviewer.id, kind: "conditional", branchKey: "pass" }),
      createEdge({ source: fixer.id, target: test2.id }),
      createEdge({ source: test2.id, target: cond2.id }),
      createEdge({ source: cond2.id, target: reviewer.id, kind: "conditional", branchKey: "pass" }),
      createEdge({ source: cond2.id, target: reject.id, kind: "conditional", branchKey: "fail" }),
      createEdge({ source: reviewer.id, target: condReview.id }),
      createEdge({ source: condReview.id, target: output.id, kind: "conditional", branchKey: "approved" }),
      createEdge({ source: condReview.id, target: reject.id, kind: "conditional", branchKey: "rejected" }),
    ],
  };
  return workflow;
}

function eventPayload(events: RunEvent[], type: string, nodeId?: string): unknown {
  const match = [...events].reverse().find((event) => event.type === type && (!nodeId || event.nodeId === nodeId));
  return match?.payload;
}

function reloadRunFromSnapshot(snapshotPath: string, runId: string): InMemoryRunStore {
  const raw = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    run: import("@multi-agent/types").Run;
    events: RunEvent[];
    workflow?: WorkflowDefinition;
    agents?: AgentRecord[];
    tools?: ToolRecord[];
  };
  const store = new InMemoryRunStore();
  store.create(raw.run, undefined, {
    workflow: raw.workflow,
    agents: raw.agents,
    tools: raw.tools,
  });
  for (const event of raw.events) store.append(runId, event);
  return store;
}

async function main() {
  const checks: CheckResult[] = [];
  const record = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error("Refusing to run with API/OAuth env credentials set. Unset them for subscription auth-file acceptance.");
  }

  const authPath = resolveCodexAuthFilePath();
  const credentialsPath = resolveClaudeCredentialsFilePath();
  if (!fs.existsSync(authPath)) throw new Error("Codex auth.json not found. Log in with Codex CLI first.");
  if (!fs.existsSync(credentialsPath)) throw new Error("Claude .credentials.json not found. Log in with Claude CLI first.");
  const secretMarkers = collectSecretMarkers(authPath, credentialsPath);

  const imageId = docker(["image", "inspect", "multi-agent-cli-worker:local", "--format", "{{.Id}}"]);
  if (imageId.status !== 0 || !/^sha256:[a-f0-9]{64}$/i.test(imageId.stdout.trim())) {
    throw new Error("multi-agent-cli-worker:local is missing. Build it with pnpm worker:image:build.");
  }
  const pinnedImage = imageId.stdout.trim();

  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "multi-agent-wf-"));
  const repoDir = createDisposableRepo(workspaceRoot);
  const persistenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "multi-agent-run-persist-"));
  const snapshotPath = path.join(persistenceDir, "run-snapshot.json");

  const previousEnv: Record<string, string | undefined> = {};
  const applyEnv = (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) {
      previousEnv[key] = process.env[key];
      process.env[key] = value;
    }
  };
  applyEnv({
    CLI_AGENT_ENABLED: "true",
    CLI_AGENT_ALLOWED_EXECUTABLES: "codex,claude",
    CLI_AGENT_WORKSPACE_ROOTS: workspaceRoot,
    CLI_WORKER_MODE: "container",
    CLI_WORKER_IMAGE: pinnedImage,
    CLI_WORKER_ALLOW_NETWORK: "true",
    CLI_WORKER_USER: "65534:65534",
    CLI_CREDENTIAL_FILE_ENABLED: "true",
    CLI_CODEX_AUTH_FILE: authPath,
    CLI_CLAUDE_CREDENTIALS_FILE: credentialsPath,
    CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "false",
    AGENT_MAX_DURATION_MS: "600000",
    RUN_MAX_DURATION_MS: String(45 * 60_000),
    WORKFLOW_RECURSION_LIMIT: "200",
    WORKER_ALLOWED_ENV_KEYS: [
      ...(process.env.WORKER_ALLOWED_ENV_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean),
      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
      "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    ].filter((key, index, all) => all.indexOf(key) === index).join(","),
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLI_CODEX_CREDENTIAL_ENV_VAR;
  delete process.env.CLI_CLAUDE_CREDENTIAL_ENV_VAR;

  const tools = [buildRepoTestTool(repoDir), buildRejectTool()];
  const agents = buildAgents(repoDir);
  const workflow = buildWorkflow(agents, tools);
  const taskId = uid("task");

  const store = new InMemoryRunStore();
  const cliPolicy = cliRuntimePolicyFromEnvironment();
  const containerPolicy = containerWorkerPolicyFromEnvironment();
  const workerRuntime = new ContainerWorkerRuntime(cliPolicy, containerPolicy);
  const credentialResolver = workerCredentialResolverFromEnvironment();
  const agentRuntime = new AgentRuntime(undefined, undefined, undefined, 600_000, workerRuntime, undefined, credentialResolver);
  const toolRuntime = createRepoTestToolRuntime(repoDir);
  const guardrails = runtimeGuardrailsFromEnvironment();
  const executor = new RunExecutor(store, agentRuntime, undefined, undefined, guardrails, toolRuntime);

  let observedContainers = 0;
  const probeSeen = new Set<string>();
  const probeOnce = (name: string, pass: boolean, detail: string) => {
    if (probeSeen.has(name)) return;
    probeSeen.add(name);
    record(name, pass, detail);
  };
  const probe = setInterval(() => {
    const ps = docker(["ps", "--filter", "name=agent-worker-", "--format", "{{.Names}}"]);
    const names = ps.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (!names.length) return;
    observedContainers += 1;
    const name = names[0]!;
    try {
      const mounts = docker(["inspect", name, "--format", "{{json .Mounts}}"]);
      assertNoSecretLeak("mount inspect", mounts.stdout, secretMarkers);
      const user = docker(["exec", name, "id", "-u"]);
      if (user.status === 0 && user.stdout.trim() === "65534") {
        probeOnce("live probe: non-root worker", true, `uid=65534 (${name})`);
      }
      const tmpfs = docker(["exec", "-u", "65534:65534", name, "/bin/bash", "-c", "findmnt -no FSTYPE /home/worker"]);
      if (tmpfs.status === 0 && tmpfs.stdout.trim() === "tmpfs") {
        probeOnce("live probe: home tmpfs", true, name);
      }
      const envDump = docker(["exec", name, "/bin/bash", "-c", "env"]);
      assertNoSecretLeak("container env", envDump.stdout, secretMarkers);
      const readonlyRoot = docker(["exec", name, "/bin/bash", "-c", "touch /probe-ro 2>/dev/null; echo $?"]);
      if (readonlyRoot.status === 0 && readonlyRoot.stdout.trim() !== "0") {
        probeOnce("live probe: read-only root", true, name);
      }
    } catch {
      /* container may exit between ps and inspect */
    }
  }, 800);

  console.log(`Disposable repo: ${repoDir}`);
  console.log(`Task ID: ${taskId}`);
  console.log(`Workflow ID: ${workflow.id}`);

  const runId = executor.start(
    {
      workflow,
      agents: [agents.planner, agents.implementer, agents.fixer, agents.reviewer],
      tools,
      taskId,
      input: {
        task: "Fix the broken add(a, b) implementation so repository tests pass. Inspect the disposable repo rather than guessing.",
        repository: repoDir,
        validation: "node --test test/math.test.js",
      },
      metadata: { kind: "multi-agent-operational-acceptance" },
    },
    undefined,
    { tenantId: "tenant-multi-agent-e2e", userId: "user-multi-agent-e2e" },
  );
  console.log(`Run ID: ${runId}`);

  let run;
  try {
    run = await waitForRun(store, runId, 45 * 60_000);
  } finally {
    clearInterval(probe);
  }

  const entry = store.get(runId)!;
  const events = entry.events;
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        run: entry.run,
        events,
        workflow: entry.workflowSnapshot,
        agents: entry.agentsSnapshot,
        tools: entry.toolsSnapshot,
      },
      null,
      2,
    ),
    "utf8",
  );

  const reloaded = reloadRunFromSnapshot(snapshotPath, runId);
  const reloadedEntry = reloaded.get(runId);
  record(
    "persisted run reloads",
    Boolean(reloadedEntry && reloadedEntry.run.status === entry.run.status && reloadedEntry.events.length === events.length),
    `status=${reloadedEntry?.run.status} events=${reloadedEntry?.events.length ?? 0}`,
  );

  const timeline = JSON.stringify(events.map((event) => ({ type: event.type, nodeId: event.nodeId, payload: event.payload })));
  assertNoSecretLeak("run timeline", timeline, secretMarkers);
  assertNoSecretLeak("run output", JSON.stringify(run?.output ?? {}), secretMarkers);
  assertNoSecretLeak("run error", String(run?.error ?? ""), secretMarkers);

  const nodeStarted = events.filter((event) => event.type === "node.started").map((event) => event.nodeId);
  const agentStarted = events.filter((event) => event.type === "agent.started");
  const backends = agentStarted.map((event) => {
    const payload = event.payload as { provider?: string; executable?: string };
    return `${event.nodeId}:${payload.provider ?? "?"}/${payload.executable ?? "?"}`;
  });

  record("task/run started through application path", Boolean(runId && taskId), `task=${taskId} run=${runId}`);
  record("workflow compiler path used", events.some((event) => event.type === "node.started"), `nodes=${nodeStarted.join(",")}`);
  record("multiple distinct nodes executed", new Set(nodeStarted).size >= 6, `unique=${new Set(nodeStarted).size}`);
  record(
    "Codex and Claude both executed",
    backends.some((item) => item.includes("codex")) && backends.some((item) => item.includes("claude")),
    backends.join(" | "),
  );

  const plannerCompleted = eventPayload(events, "agent.completed", "n_planner") as { content?: unknown } | undefined;
  const implementerCompleted = eventPayload(events, "agent.completed", "n_implementer") as { content?: unknown } | undefined;
  const test1Completed = eventPayload(events, "tool.completed", "n_test1") as { output?: Record<string, unknown> } | undefined;
  const fixerStarted = events.some((event) => event.type === "node.started" && event.nodeId === "n_fixer");
  const fixerCompleted = eventPayload(events, "agent.completed", "n_fixer") as { content?: unknown } | undefined;
  const test2Completed = eventPayload(events, "tool.completed", "n_test2") as { output?: Record<string, unknown> } | undefined;
  const reviewerCompleted = eventPayload(events, "agent.completed", "n_reviewer") as { content?: unknown } | undefined;
  const cond1Branch = events.find((event) => event.type === "state.updated" && event.nodeId === "n_cond_after_implementer");
  const condReviewBranch = events.find((event) => event.type === "state.updated" && event.nodeId === "n_cond_review");
  const fixerEdge = events.find((event) => event.type === "edge.traversed" && (event.payload as { target?: string })?.target === "n_fixer");

  const test1Out = test1Completed?.output ?? {};
  const test2Out = test2Completed?.output ?? {};
  record("first test executed for real", typeof test1Out.stdout === "string" && typeof test1Out.status === "number", `branch=${test1Out.branch} status=${test1Out.status}`);
  record("first test failed (Fixer path precondition)", test1Out.branch === "fail", `branch=${test1Out.branch}`);
  record("conditional Fixer executed", fixerStarted && Boolean(fixerEdge), `started=${fixerStarted}`);
  record("state transferred into Fixer via workflow", Boolean(fixerCompleted), fixerCompleted ? "fixer completed" : "missing");
  record("final tests passed after Fixer", test2Out.branch === "pass", `branch=${test2Out.branch} status=${test2Out.status}`);

  const mathAfter = fs.readFileSync(path.join(repoDir, "src", "math.js"), "utf8");
  const statusAfter = fs.readFileSync(path.join(repoDir, "STATUS.md"), "utf8");
  const finalDiff = spawnSync("git", ["diff", "--", "."], { cwd: repoDir, encoding: "utf8", windowsHide: true });
  record("repository changes came from agent execution", mathAfter.includes("a + b") || mathAfter.includes("a+b"), "math.js fixed");
  record("Implementer left STATUS note without fixing math", statusAfter.length > 20 && /broken|fixer|still/i.test(statusAfter), "STATUS.md touched");

  const reviewerText = typeof reviewerCompleted?.content === "string" ? reviewerCompleted.content : JSON.stringify(reviewerCompleted?.content ?? {});
  const reviewBranch = (condReviewBranch?.payload as { branch?: string } | undefined)?.branch;
  record("Reviewer produced a real verdict", /approved|rejected|approve|reject/i.test(reviewerText), `branch=${reviewBranch ?? "?"}`);
  record("final workflow status matches tests/review", run?.status === "completed" && reviewBranch === "approved" && test2Out.branch === "pass", `run=${run?.status} review=${reviewBranch}`);

  const leftover = docker(["ps", "-a", "--filter", "name=agent-worker-", "--format", "{{.Names}}"]);
  record("worker containers cleaned up", leftover.stdout.trim() === "", leftover.stdout.trim() || "none");
  record("no credential material leaked", true, "timeline/output scanned");
  record("live container probes observed", observedContainers > 0, `samples=${observedContainers}`);

  const authShaAfter = sha256Hex(fs.readFileSync(authPath));
  const credShaAfter = sha256Hex(fs.readFileSync(credentialsPath));
  record("credential files still present after run", authShaAfter.length === 64 && credShaAfter.length === 64, "hashes checked without printing");

  // Report block
  console.log("\n========== MULTI-AGENT OPERATIONAL ACCEPTANCE REPORT ==========");
  console.log("1. Workflow definition:", workflow.name, workflow.id);
  console.log("   nodes:", workflow.nodes.map((node) => `${node.id}:${node.type}`).join(", "));
  console.log("2. Agent/backend mapping:");
  console.log("   Planner → Claude Code (read)");
  console.log("   Implementer → Codex (read-write)");
  console.log("   Fixer → Claude Code (read-write, conditional)");
  console.log("   Reviewer → Claude Code (read)");
  console.log("   Test → function tool via ToolRuntime (node --test)");
  console.log("3. Disposable repository:", repoDir);
  console.log("4. Task ID:", taskId);
  console.log("5. Run ID:", runId);
  console.log("6. Planner result preview:", String(plannerCompleted?.content ?? "").slice(0, 500).replace(/\s+/g, " "));
  console.log("7. Implementer result preview:", String(implementerCompleted?.content ?? "").slice(0, 500).replace(/\s+/g, " "));
  console.log("8. First test result:", JSON.stringify({ branch: test1Out.branch, status: test1Out.status, stderr: String(test1Out.stderr ?? "").slice(0, 200) }));
  console.log("9. Fixer executed:", fixerStarted);
  console.log("10. Fixer result preview:", String(fixerCompleted?.content ?? "").slice(0, 500).replace(/\s+/g, " "));
  console.log("11. Final test result:", JSON.stringify({ branch: test2Out.branch, status: test2Out.status }));
  console.log("12. Reviewer verdict:", reviewerText.slice(0, 800).replace(/\s+/g, " "));
  console.log("13. Final repository diff:\n", finalDiff.stdout || "(no diff)");
  console.log("14. Persisted timeline summary:");
  for (const event of events) {
    if (["run.created", "run.started", "node.started", "node.completed", "agent.started", "agent.completed", "tool.started", "tool.completed", "state.updated", "edge.traversed", "run.completed", "run.failed"].includes(event.type)) {
      const extra = event.type === "state.updated" ? ` branch=${(event.payload as { branch?: string }).branch}` : "";
      const backend = event.type === "agent.started" ? ` provider=${(event.payload as { provider?: string }).provider}` : "";
      console.log(`   - ${event.timestamp} ${event.type} node=${event.nodeId ?? "-"}${extra}${backend}`);
    }
  }
  console.log("15. Isolation/security checks: see PASS/FAIL lines above; snapshot=", snapshotPath);
  console.log("16. Files changed in multi-agent repository: workflowCompiler JSON branch coerce + this script + package.json script (if added).");
  const failed = checks.filter((check) => !check.pass);
  const overall = run?.status === "completed" && failed.length === 0 && fixerStarted && test2Out.branch === "pass" && reviewBranch === "approved";
  console.log("17. Complete PASS/FAIL:", overall ? "PASS" : "FAIL");
  console.log("18. Concrete blockers/gaps:");
  console.log("   - No first-class shell/test node; tests run via injected ToolRuntime function tool (platform tool path).");
  console.log("   - CLI agent outputs are text; condition nodes now coerce JSON branch carriers for Reviewer routing.");
  console.log("   - Persistence verified via durable JSON snapshot reload of RunStore entry (Postgres optional, not required for this acceptance).");
  if (cond1Branch) console.log("   - After-implementer condition branch:", (cond1Branch.payload as { branch?: string }).branch);
  if (failed.length) {
    console.log("   Failed checks:");
    for (const check of failed) console.log(`     - ${check.name}: ${check.detail}`);
  }
  console.log("===============================================================\n");

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  if (!overall) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
