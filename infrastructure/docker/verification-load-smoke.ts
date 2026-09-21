/**
 * Verification/load smoke harness for the software-development workflow.
 *
 * This file intentionally lives beside the deployment-owned Docker checks and
 * does not change runtime implementation. It has two explicit scenarios:
 *
 *   pnpm exec ts-node --transpile-only infrastructure/docker/verification-load-smoke.ts --scenario load
 *   pnpm exec ts-node --transpile-only infrastructure/docker/verification-load-smoke.ts --scenario docker --image IMAGE
 *   pnpm exec ts-node --transpile-only infrastructure/docker/verification-load-smoke.ts --scenario all
 *
 * Exit codes:
 *   0 - every selected scenario executed and passed
 *   1 - an executed check failed
 *   2 - a selected scenario was blocked by a missing deployment prerequisite
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  nowIso,
  type Run,
  type RunEvent,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { createRunsRouter } from "../../apps/server/src/api/runs";
import { RunExecutor } from "../../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../../apps/server/src/runtime/runStore";
import { compileWorkflow } from "../../apps/server/src/compiler/workflowCompiler";
import { validateWorkflow } from "../../apps/server/src/compiler/validation";

type Scenario = "load" | "docker" | "all";
type ResultStatus = "PASS" | "FAIL" | "BLOCKED";
type CheckResult = { name: string; status: ResultStatus; detail: string; durationMs: number };

type Options = {
  scenario: Scenario;
  image: string;
  dockerExecutable: string;
  subscribers: number;
  runs: number;
  events: number;
  graphNodes: number;
  maxMs: number;
};

const results: CheckResult[] = [];

function parsePositiveInt(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer in [${minimum}, ${maximum}], got ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument ${argument}.`);
    const equals = argument.indexOf("=");
    if (equals >= 0) values.set(argument.slice(2, equals), argument.slice(equals + 1));
    else values.set(argument.slice(2), argv[index + 1]?.startsWith("--") ? "true" : (argv[++index] ?? "true"));
  }

  const scenario = values.get("scenario") ?? "all";
  if (scenario !== "load" && scenario !== "docker" && scenario !== "all") {
    throw new Error(`--scenario must be load, docker, or all; got ${scenario}.`);
  }
  return {
    scenario,
    image: values.get("image") ?? process.env.CLI_WORKER_IMAGE ?? "multi-agent-cli-worker:local",
    dockerExecutable: values.get("docker") ?? process.env.CLI_WORKER_DOCKER_EXECUTABLE?.trim() ?? "docker",
    subscribers: parsePositiveInt(values.get("subscribers"), 32, 1, 500),
    runs: parsePositiveInt(values.get("runs"), 24, 1, 200),
    events: parsePositiveInt(values.get("events"), 200, 100, 5_000),
    graphNodes: parsePositiveInt(values.get("graph-nodes"), 80, 10, 100),
    maxMs: parsePositiveInt(values.get("max-ms"), 10_000, 100, 120_000),
  };
}

async function check(name: string, operation: () => Promise<string> | string): Promise<void> {
  const started = performance.now();
  try {
    const detail = await operation();
    const durationMs = Math.round(performance.now() - started);
    results.push({ name, status: "PASS", detail, durationMs });
    console.log(`PASS  ${name} (${durationMs}ms) - ${detail}`);
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, status: "FAIL", detail, durationMs });
    console.error(`FAIL  ${name} (${durationMs}ms) - ${detail}`);
  }
}

function blocked(name: string, detail: string): void {
  results.push({ name, status: "BLOCKED", detail, durationMs: 0 });
  console.error(`BLOCKED  ${name} - ${detail}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeRun(id: string, status: Run["status"] = "running"): Run {
  return { id, workflowId: "verification-load-workflow", status, startedAt: nowIso(), input: {}, metadata: {} };
}

function makeEvent(runId: string, type: string, payload: Record<string, unknown>): RunEvent {
  return { id: randomUUID(), runId, type: type as RunEvent["type"], timestamp: nowIso(), sequence: 0, payload };
}

function createLargeDag(nodeCount: number): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const output = createNode("output", { x: nodeCount, y: 0 });
  const agents = Array.from({ length: nodeCount - 2 }, (_, index) =>
    createNode("agent", { x: index + 1, y: 0 }, { agentId: "load-agent" }),
  );
  const nodes = [input, ...agents, output];
  return {
    ...createEmptyDefinition("verification-large-dag"),
    id: "verification-large-dag",
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => createEdge({ source: node.id, target: nodes[index + 1].id })),
  };
}

function createBoundedLoop(): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const condition = createNode("condition", { x: 1, y: 0 });
  condition.config = { branches: [{ key: "loop", label: "Loop" }, { key: "exit", label: "Exit" }] };
  const agent = createNode("agent", { x: 2, y: 0 }, { agentId: "load-agent" });
  const output = createNode("output", { x: 3, y: 0 });
  return {
    ...createEmptyDefinition("verification-bounded-loop"),
    id: "verification-bounded-loop",
    nodes: [input, condition, agent, output],
    edges: [
      createEdge({ source: input.id, target: condition.id }),
      createEdge({ source: condition.id, target: agent.id, kind: "conditional", branchKey: "loop" }),
      createEdge({ source: condition.id, target: output.id, kind: "conditional", branchKey: "exit" }),
      createEdge({ source: agent.id, target: condition.id }),
    ],
  };
}

function listenerCount(store: InMemoryRunStore, runId: string): number {
  const entry = store.get(runId) as (ReturnType<InMemoryRunStore["get"]> & { listeners?: Set<unknown> }) | undefined;
  return entry?.listeners?.size ?? 0;
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function runSseSubscriberCheck(options: Options): Promise<string> {
  const principal = { userId: "verification-user", tenantId: "verification-tenant" };
  const store = new InMemoryRunStore({ maxEventsPerRun: options.events + 20 });
  const executor = new RunExecutor(store, { execute: async function* () { /* no provider is used */ } });
  const router = createRunsRouter(executor, async () => null, undefined, () => principal);
  const runId = "sse-load-run";
  store.create(makeRun(runId), undefined, undefined, principal);
  store.append(runId, makeEvent(runId, "run.started", { scenario: "sse" }));

  const readers = Array.from({ length: options.subscribers }, async () => {
    const response = await router.app.fetch(new Request(`http://verification.test/${runId}/events`));
    assert(response.status === 200, `SSE response returned HTTP ${response.status}.`);
    return response.text();
  });
  await waitFor(() => listenerCount(store, runId) === options.subscribers, 5_000, "all SSE subscribers");

  store.append(runId, makeEvent(runId, "log", { phase: "load", value: "middle" }));
  store.update(runId, { status: "completed", completedAt: nowIso() });
  store.append(runId, makeEvent(runId, "run.completed", { scenario: "sse" }));
  const bodies = await Promise.all(readers);
  assert(bodies.every((body) => body.includes("event: run-event")), "At least one subscriber received no SSE event.");
  assert(bodies.every((body) => body.includes('"sequence":3')), "At least one subscriber missed the terminal event.");
  assert(listenerCount(store, runId) === 0, `SSE listeners leaked: ${listenerCount(store, runId)} remain.`);
  return `${options.subscribers} subscribers received the live event stream and all listeners were removed`;
}

async function runLoadScenario(options: Options): Promise<void> {
  const agent = { ...createAgentRecord({ name: "verification-agent" }), id: "load-agent" };

  await check("large graph validates and compiles", () => {
    const graph = createLargeDag(options.graphNodes);
    const issues = validateWorkflow(graph, [agent], { maxNodes: options.graphNodes, maxEdges: options.graphNodes + 1 });
    assert(!issues.some((issue) => issue.level === "error" || issue.severity === "error"), "Large DAG produced validation errors.");
    compileWorkflow(graph, [agent], { agentRunner: async () => ({ ok: true }) });
    return `${graph.nodes.length} nodes / ${graph.edges.length} edges`;
  });

  await check("bounded loop stops at the server-owned step budget", async () => {
    const graph = createBoundedLoop();
    const compiled = compileWorkflow(graph, [agent], {
      agentRunner: async () => ({ branch: "loop" }),
      guardrails: { maxWorkflowSteps: 32, maxConcurrentBranches: 2, maxNodeRetryAttempts: 1, maxNodeRetryBackoffMs: 0 },
    });
    let failure: unknown;
    try {
      await (compiled.graph as unknown as { invoke: (input: unknown, config?: unknown) => Promise<unknown> }).invoke(
        { input: { branch: "loop" }, output: {}, memory: {} },
        { recursionLimit: 100 },
      );
    } catch (error) {
      failure = error;
    }
    assert(failure, "Unbounded loop completed without a guardrail failure.");
    const message = failure instanceof Error ? failure.message : String(failure);
    assert(/step|recursion|limit/i.test(message), `Loop failed for an unexpected reason: ${message}`);
    return `loop terminated with bounded failure: ${message.slice(0, 120)}`;
  });

  await check("SSE subscribers do not leak under concurrent delivery", () => runSseSubscriberCheck(options));

  await check("event retention and payload bounds remain finite", () => {
    const store = new InMemoryRunStore({ maxEventsPerRun: 100, maxEventPayloadBytes: 1_024, maxRunPayloadBytes: 1_024 });
    const runId = "retention-run";
    store.create(makeRun(runId));
    for (let index = 0; index < options.events; index += 1) {
      store.append(runId, makeEvent(runId, "log", { index, blob: "x".repeat(8_000) }));
    }
    const terminal = store.append(runId, makeEvent(runId, "run.completed", { ok: true }));
    const events = store.events(runId);
    assert(events.length <= 102, `Retention exceeded the bounded event budget: ${events.length}.`);
    assert(events.some((event) => event.payload.eventLimitReached === true), "Retention marker was not emitted.");
    assert(terminal?.type === "run.completed", "Terminal event was not retained after event pressure.");
    assert(JSON.stringify(events).length < options.events * 2_000, "Bounded event payloads grew unexpectedly.");
    return `${events.length} retained events including a limit marker and terminal event`;
  });

  await check("concurrent run event load stays within smoke budget", () => {
    const started = performance.now();
    const store = new InMemoryRunStore({ maxEventsPerRun: options.events + 10 });
    for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
      const runId = `load-run-${runIndex}`;
      store.create(makeRun(runId));
      for (let eventIndex = 0; eventIndex < options.events; eventIndex += 1) {
        store.append(runId, makeEvent(runId, "log", { runIndex, eventIndex }));
      }
      store.update(runId, { status: "completed", completedAt: nowIso() });
      store.append(runId, makeEvent(runId, "run.completed", { runIndex }));
      assert(store.events(runId).length === options.events + 1, `Run ${runId} lost events under load.`);
    }
    const durationMs = Math.round(performance.now() - started);
    assert(durationMs <= options.maxMs, `Load took ${durationMs}ms, over the ${options.maxMs}ms smoke budget.`);
    return `${options.runs} runs x ${options.events} events completed in ${durationMs}ms`;
  });
}

function docker(args: string[], executable: string): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function runDockerScenario(options: Options): void {
  const daemon = docker(["info", "--format", "{{.ServerVersion}}"], options.dockerExecutable);
  if (daemon.error || daemon.status !== 0) {
    blocked("Docker deployment prerequisite", `Docker daemon is not reachable via ${options.dockerExecutable}: ${(daemon.error?.message ?? daemon.stderr).trim() || `exit ${daemon.status}`}`);
    return;
  }
  const image = docker(["image", "inspect", options.image], options.dockerExecutable);
  if (image.error || image.status !== 0) {
    blocked("Worker image deployment prerequisite", `Image ${options.image} is not present locally; build/pull the deployment image before running this scenario.`);
    return;
  }

  const smokeScript = `${__dirname}/smoke-worker-image.ts`;
  const tsNode = require.resolve("ts-node/dist/bin.js");
  const executed = spawnSync(process.execPath, [tsNode, "--transpile-only", smokeScript, options.image], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (executed.stdout) process.stdout.write(executed.stdout);
  if (executed.stderr) process.stderr.write(executed.stderr);
  if (executed.error || executed.status !== 0) {
    results.push({
      name: "Docker worker image smoke",
      status: "FAIL",
      detail: executed.error?.message ?? `worker smoke exited ${executed.status}`,
      durationMs: 0,
    });
    return;
  }
  results.push({ name: "Docker worker image smoke", status: "PASS", detail: `${options.image} executed the existing isolation checks`, durationMs: 0 });
  console.log(`PASS  Docker worker image smoke - ${options.image} executed the existing isolation checks`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  console.log(`Verification/load smoke harness: scenario=${options.scenario}`);
  console.log(`Deployment prerequisites are reported as BLOCKED and never counted as PASS.`);

  if (options.scenario === "load" || options.scenario === "all") await runLoadScenario(options);
  if (options.scenario === "docker" || options.scenario === "all") runDockerScenario(options);

  const failed = results.filter((result) => result.status === "FAIL");
  const blockedResults = results.filter((result) => result.status === "BLOCKED");
  console.log("\n========== VERIFICATION/LOAD SMOKE REPORT ==========");
  for (const result of results) console.log(`${result.status.padEnd(8)} ${result.name}: ${result.detail}`);
  console.log(`Executed=${results.length - blockedResults.length} Failed=${failed.length} Blocked=${blockedResults.length}`);
  console.log("====================================================");
  if (failed.length) process.exitCode = 1;
  else if (blockedResults.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`HARNESS ERROR - ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
