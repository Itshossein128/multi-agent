import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  createResultEnvelope,
  createToolRecord,
  nowIso,
  type AgentRecord,
  type NodeContract,
  type ToolRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { randomUUID } from "node:crypto";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { createRunsRouter } from "../apps/server/src/api/runs";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const principal = async () => ({ userId: "contract-user", tenantId: "contract-tenant" });

/** Deterministic fake agent runtime — never calls a real provider. */
function fakeRuntime(respond: (agent: AgentRecord) => unknown) {
  return {
    async *execute(input: { agent: AgentRecord; nodeId: string; runId: string }) {
      yield {
        type: "agent.completed" as const,
        timestamp: nowIso(),
        agentId: input.agent.id,
        nodeId: input.nodeId,
        runId: input.runId,
        payload: { content: respond(input.agent) },
      };
    },
  };
}

function linearAgentWorkflow(contract?: NodeContract) {
  const agent = { ...createAgentRecord({ name: "Fake", model: "gpt-4o" }), id: "agent-contract" };
  const input = createNode("input", { x: 0, y: 0 });
  const agentNode = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
  if (contract) agentNode.contract = contract;
  const output = createNode("output", { x: 2, y: 0 });
  const workflow: WorkflowDefinition = {
    ...createEmptyDefinition("contracts"),
    nodes: [input, agentNode, output],
    edges: [createEdge({ source: input.id, target: agentNode.id }), createEdge({ source: agentNode.id, target: output.id })],
  };
  return { workflow, agent, agentNode };
}

describe("runtime boundary validation", () => {
  test("agent output violating the declared contract fails the run as a validation failure", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store, fakeRuntime(() => ({ ok: "yes-but-not-boolean" })));
    const { workflow, agent, agentNode } = linearAgentWorkflow({
      version: 1,
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });
    const runId = executor.start({ workflow, agents: [agent], input: {} }, undefined, await principal());
    await waitFor(() => store.get(runId)?.run.status === "failed");

    const run = store.get(runId)!.run;
    expect(run.result).toMatchObject({ status: "validation_failed" });
    expect(run.result?.error?.code).toBe("AGENT_OUTPUT_INVALID");
    expect(run.result?.error?.retryable).toBe(false);

    // Structured diagnostics: machine-readable code on the failed-node event.
    const failure = store.events(runId).find((event) => event.type === "node.failed" && event.nodeId === agentNode.id);
    expect(failure).toBeDefined();
    expect(failure!.payload.code).toBe("AGENT_OUTPUT_INVALID");
    expect(Array.isArray(failure!.payload.diagnostics)).toBe(true);
    expect((failure!.payload.diagnostics as { path: string }[])[0].path).toContain("$");
    // The invalid raw payload never appears in the failure diagnostics.
    expect(JSON.stringify({ payload: failure!.payload, result: run.result })).not.toContain("yes-but-not-boolean");
    // Validation failures are terminal — no retry loop for deterministic errors.
    expect(store.events(runId).some((event) => event.type === "node.retrying")).toBe(false);
  });

  test("valid structured agent results are preserved as node outcomes", async () => {
    const { workflow, agent, agentNode } = linearAgentWorkflow();
    const graph = compileWorkflow(workflow, [agent], {
      agentRunner: async () => ({
        status: "success",
        value: { ok: true },
        evidence: { source: "agent", producedAt: "2026-09-25T00:00:00.000Z", detail: "fixture" },
      }),
    });
    const state = (await graph.graph.invoke({ input: {} } as never)) as {
      nodeOutcomes?: Record<string, { status: string; evidence?: { source: string } }>;
      lastValue?: unknown;
      output?: unknown;
    };
    expect(state.nodeOutcomes?.[agentNode.id]).toMatchObject({ status: "success", evidence: { source: "agent" } });
    expect(state.lastValue).toEqual({ ok: true });
  });

  test("blocked results fail while needs-human results pause and resume safely", async () => {
    const blockedStore = new RunStore();
    const blockedExecutor = new RunExecutor(blockedStore, fakeRuntime(() => ({ status: "blocked" })));
    const blocked = linearAgentWorkflow();
    const blockedRunId = blockedExecutor.start({ workflow: blocked.workflow, agents: [blocked.agent], input: {} }, undefined, await principal());
    await waitFor(() => blockedStore.get(blockedRunId)?.run.status === "failed");
    expect(blockedStore.get(blockedRunId)!.run.result).toMatchObject({ status: "blocked", error: { code: "NODE_BLOCKED" } });

    const store = new RunStore();
    let providerCalls = 0;
    const executor = new RunExecutor(store, fakeRuntime(() => {
      providerCalls += 1;
      return { status: "needs_human", value: { approvedPayload: true }, needsHuman: { reason: "Review proposal" } };
    }));
    const { workflow, agent } = linearAgentWorkflow();
    const runId = executor.start({ workflow, agents: [agent], input: {} }, undefined, await principal());
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    expect(store.get(runId)!.run.result).toMatchObject({ status: "needs_human", needsHuman: { reason: "Review proposal" } });
    const [request] = store.listApprovals(runId);
    executor.resolveApproval(runId, request.id, { decision: "approved", response: "ok" });
    await waitFor(() => store.get(runId)?.run.status === "completed");
    expect(store.get(runId)!.run.result).toMatchObject({ status: "success" });
    expect(providerCalls).toBe(1);
  });

  test("a typed failure without an explicit route fails the run with its own error code", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(
      store,
      fakeRuntime(() => ({ status: "failed", error: { code: "TASK_REJECTED", message: "policy says no" } })),
    );
    const { workflow, agent } = linearAgentWorkflow();
    const runId = executor.start({ workflow, agents: [agent], input: {} }, undefined, await principal());
    await waitFor(() => store.get(runId)?.run.status === "failed");
    expect(store.get(runId)!.run.result).toMatchObject({
      status: "failed",
      error: { code: "TASK_REJECTED" },
    });
  });

  test("a typed failure with an explicit branch routes through the failure edge", async () => {
    const agent = { ...createAgentRecord({ name: "Failing", model: "gpt-4o" }), id: "agent-typed-fail" };
    const input = createNode("input", { x: 0, y: 0 });
    const agentNode = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
    const condition = createNode("condition", { x: 2, y: 0 });
    condition.config = { branches: [{ key: "pass", label: "Pass" }, { key: "fail", label: "Fail" }] };
    const failMarker = createNode("memory", { x: 3, y: -1 });
    failMarker.config = { memoryType: "short_term", mode: "write", key: "on_failure" };
    const passMarker = createNode("memory", { x: 3, y: 1 });
    passMarker.config = { memoryType: "short_term", mode: "write", key: "on_pass" };
    const output = createNode("output", { x: 4, y: 0 });
    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition("typed-failure"),
      nodes: [input, agentNode, condition, failMarker, passMarker, output],
      edges: [
        createEdge({ source: input.id, target: agentNode.id }),
        createEdge({ source: agentNode.id, target: condition.id }),
        createEdge({ source: condition.id, target: failMarker.id, kind: "conditional", branchKey: "fail" }),
        createEdge({ source: condition.id, target: passMarker.id, kind: "conditional", branchKey: "pass" }),
        createEdge({ source: failMarker.id, target: output.id }),
        createEdge({ source: passMarker.id, target: output.id }),
      ],
    };
    const graph = compileWorkflow(workflow, [agent], {
      agentRunner: async () => ({ status: "failed", branch: "fail", error: { code: "TYPED", message: "handled" } }),
    });
    const state = (await graph.graph.invoke({ input: {} } as never)) as { memory: Record<string, unknown> };
    expect(state.memory.on_failure).toBeDefined();
    expect(state.memory.on_pass).toBeUndefined();
  });
});

describe("server-authoritative validation", () => {
  test("run input is validated against the workflow input contract server-side", async () => {
    const input = createNode("input", { x: 0, y: 0 });
    input.contract = {
      version: 1,
      inputSchema: { type: "object", properties: { objective: { type: "string" } }, required: ["objective"] },
    };
    const output = createNode("output", { x: 1, y: 0 });
    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition("run-input"),
      nodes: [input, output],
      edges: [createEdge({ source: input.id, target: output.id })],
    };

    const store = new RunStore();
    const executor = new RunExecutor(store, fakeRuntime(() => ({})));
    const { app } = createRunsRouter(executor, undefined, undefined, principal);

    // Valid input runs.
    const ok = await app.request("http://localhost/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, agents: [], input: { objective: "do the thing" } }),
    });
    expect(ok.status).toBe(202);
    const { runId } = await ok.json() as { runId: string };
    await waitFor(() => store.get(runId)?.run.status === "completed");

    // Invalid input is rejected with a machine-readable code — a client cannot
    // bypass this by skipping its own validation.
    const bad = await app.request("http://localhost/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, agents: [], input: { unexpected: true } }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("INPUT_CONTRACT_VIOLATION");
    expect(store.list()).toHaveLength(1);
  });

  test("workflow save enforces contracts and branch routes server-side", async () => {
    const store = new InMemoryStudioStore();
    const app = createStudioRouter(store, principal);
    // Fresh node objects per definition — never share mutable fixtures.
    const base = (id: string): WorkflowDefinition => {
      const input = createNode("input", { x: 0, y: 0 });
      const output = createNode("output", { x: 1, y: 0 });
      return {
        ...createEmptyDefinition("save-check"),
        id,
        nodes: [input, output],
        edges: [createEdge({ source: input.id, target: output.id })],
      };
    };

    // Valid contract saves.
    const validId = "wf-valid-contract";
    const valid = base(validId);
    valid.nodes[0].contract = { version: 1, inputSchema: { type: "object" } };
    const saved = await app.request(`http://localhost/workflows/${validId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid),
    });
    expect(saved.status).toBe(200);

    // Unenforceable schema keywords are rejected with structured issues.
    const badId = "wf-bad-contract";
    const bad = base(badId);
  bad.nodes[0].contract = { version: 1, inputSchema: { type: "object", unknownKeyword: true } };
    const rejectedSchema = await app.request(`http://localhost/workflows/${badId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bad),
    });
    expect(rejectedSchema.status).toBe(400);
    const schemaBody = await rejectedSchema.json() as { error: string; details?: { issues?: { code: string }[] } };
    expect(schemaBody.error).toContain("UNSUPPORTED_SCHEMA_KEYWORD");
    expect(schemaBody.details?.issues?.some((issue) => issue.code === "UNSUPPORTED_SCHEMA_KEYWORD")).toBe(true);

    // A future contract version is rejected (fail closed against unknowns).
    const futureId = "wf-future-contract";
    const future = base(futureId);
    future.nodes[0].contract = { version: 99 };
    const rejectedVersion = await app.request(`http://localhost/workflows/${futureId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(future),
    });
    expect(rejectedVersion.status).toBe(400);
    expect(await rejectedVersion.text()).toContain("UNSUPPORTED_CONTRACT_VERSION");

    // An unknown/error route that names no declared branch is rejected.
    const routeId = "wf-bad-route";
    const route = base(routeId);
    const condition = createNode("condition", { x: 2, y: 0 });
    condition.config = { branches: [{ key: "yes", label: "Yes" }], unknownRoute: "not-declared" };
    const routeInput = route.nodes[0];
    const routeOutput = route.nodes[1];
    route.nodes = [routeInput, condition, routeOutput];
    route.edges = [
      createEdge({ source: routeInput.id, target: condition.id }),
      createEdge({ source: condition.id, target: routeOutput.id, kind: "conditional", branchKey: "yes" }),
    ];
    const rejectedRoute = await app.request(`http://localhost/workflows/${routeId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(route),
    });
    expect(rejectedRoute.status).toBe(400);
    expect(await rejectedRoute.text()).toContain("INVALID_UNKNOWN_ROUTE");

    // Draft-completeness issues (no output node) remain saveable drafts.
    const draftId = "wf-draft";
    const draft = base(draftId);
    draft.nodes = [draft.nodes[0]];
    draft.edges = [];
    const draftResponse = await app.request(`http://localhost/workflows/${draftId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    });
    expect(draftResponse.status).toBe(200);
  });
});

describe("persistence, migration, and retry safety", () => {
  test("legacy workflows without contracts remain fully compatible", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store, fakeRuntime(() => ({ done: true })));
    const { workflow, agent } = linearAgentWorkflow();
    expect(validateWorkflow(workflow, [agent]).filter((issue) => issue.level === "error")).toEqual([]);
    const runId = executor.start({ workflow, agents: [agent], input: { request: "go" } }, undefined, await principal());
    await waitFor(() => store.get(runId)?.run.status === "completed");
    const run = store.get(runId)!.run;
    expect(run.result).toMatchObject({ status: "success" });
    expect(run.output).toEqual({ done: true });
  });

  test("run snapshots and retries retain contract metadata", async () => {
    const store = new RunStore();
    let failFirst = true;
    const runtime = {
      async *execute(input: { agent: AgentRecord; nodeId: string; runId: string }) {
        if (failFirst) {
          failFirst = false;
          yield { type: "agent.failed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: "transient" } };
          return;
        }
        yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: { ok: true } } };
      },
    };
    const executor = new RunExecutor(store, runtime);
    const { workflow, agent, agentNode } = linearAgentWorkflow({
      version: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      maxPayloadBytes: 4096,
      captureEvidence: true,
    });

    const firstRunId = executor.start({ workflow, agents: [agent], input: {} }, undefined, await principal());
    await waitFor(() => store.get(firstRunId)?.run.status === "failed");
    const snapshot = store.getWorkflowSnapshot(firstRunId);
    expect(snapshot?.nodes.find((node) => node.id === agentNode.id)?.contract).toEqual(workflow.nodes.find((node) => node.id === agentNode.id)?.contract);

    const retriedRunId = executor.retry(firstRunId);
    await waitFor(() => store.get(retriedRunId)?.run.status === "completed");
    const retriedSnapshot = store.getWorkflowSnapshot(retriedRunId);
    expect(retriedSnapshot?.nodes.find((node) => node.id === agentNode.id)?.contract).toMatchObject({
      version: 1,
      maxPayloadBytes: 4096,
      captureEvidence: true,
    });
    expect(store.get(retriedRunId)!.run.result).toMatchObject({ status: "success" });
  });

  test("workflow save/load round-trips contract metadata", async () => {
    const store = new InMemoryStudioStore();
    const { workflow, agent } = linearAgentWorkflow({ version: 1, outputSchema: { type: "object" } });
    const p = await principal();
    await store.saveWorkflow({ ...workflow, ownerId: p.userId, tenantId: p.tenantId }, p);
    const loaded = await store.getWorkflow(workflow.id, p);
    expect(loaded?.nodes.find((node) => node.type === "agent")?.contract).toEqual({ version: 1, outputSchema: { type: "object" } });
    void agent;
  });

  test("unsafe retries are rejected before any side effect can execute", async () => {
    const store = new RunStore();
    let toolExecutions = 0;
    const toolRuntime = {
      execute: async () => {
        toolExecutions += 1;
        return { done: true };
      },
    };
    const executor = new RunExecutor(store, fakeRuntime(() => ({})), undefined, undefined, undefined, toolRuntime);
    const tool: ToolRecord = {
      ...createToolRecord({ name: "writer", category: "function" }),
      id: "tool-writer",
      impact: "write",
      metadata: { idempotent: true },
    };
    const input = createNode("input", { x: 0, y: 0 });
    const toolNode = createNode("tool", { x: 1, y: 0 }, { toolId: tool.id });
    toolNode.retryPolicy = { maxAttempts: 3, backoffMs: 0 };
    const output = createNode("output", { x: 2, y: 0 });
    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition("unsafe-retry"),
      nodes: [input, toolNode, output],
      edges: [createEdge({ source: input.id, target: toolNode.id }), createEdge({ source: toolNode.id, target: output.id })],
    };
    expect(() => executor.start({ workflow, agents: [], tools: [tool], input: {} })).toThrow(/UNSAFE_NODE_RETRY/);
    // No run is created and the side-effecting tool never executes.
    expect(store.list()).toHaveLength(0);
    expect(toolExecutions).toBe(0);
  });

  test("explicitly idempotent read-only tools may retry without duplicating effects", async () => {
    const store = new RunStore();
    let attempts = 0;
    const toolRuntime = {
      execute: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return { done: true };
      },
    };
    const executor = new RunExecutor(store, fakeRuntime(() => ({})), undefined, undefined, undefined, toolRuntime);
    const tool: ToolRecord = {
      ...createToolRecord({ name: "reader", category: "function" }),
      id: "tool-reader",
      impact: "read-only",
      metadata: { idempotent: true },
    };
    const input = createNode("input", { x: 0, y: 0 });
    const toolNode = createNode("tool", { x: 1, y: 0 }, { toolId: tool.id });
    toolNode.retryPolicy = { maxAttempts: 2, backoffMs: 0 };
    const output = createNode("output", { x: 2, y: 0 });
    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition("safe-retry"),
      nodes: [input, toolNode, output],
      edges: [createEdge({ source: input.id, target: toolNode.id }), createEdge({ source: toolNode.id, target: output.id })],
    };
    const runId = executor.start({ workflow, agents: [], tools: [tool], input: {} }, undefined, await principal());
    await waitFor(() => store.get(runId)?.run.status === "completed");
    expect(attempts).toBe(2);
  });

  test("approval pauses persist a needs-human result and completion overwrites it with success", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store, fakeRuntime(() => ({})));
    const input = createNode("input", { x: 0, y: 0 });
    const approval = createNode("approval", { x: 1, y: 0 });
    const output = createNode("output", { x: 2, y: 0 });
    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition("needs-human"),
      nodes: [input, approval, output],
      edges: [createEdge({ source: input.id, target: approval.id }), createEdge({ source: approval.id, target: output.id })],
    };
    const runId = executor.start({ workflow, agents: [], input: {} }, undefined, await principal());
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    expect(store.get(runId)!.run.result).toMatchObject({
      status: "needs_human",
      needsHuman: { reason: "Approve to continue?" },
      error: { code: "AWAITING_APPROVAL" },
    });

    const [request] = store.listApprovals(runId);
    executor.resolveApproval(runId, request.id, { decision: "approved", response: "ok" });
    await waitFor(() => store.get(runId)?.run.status === "completed");
    expect(store.get(runId)!.run.result).toMatchObject({ status: "success" });
  });
});

describe("Postgres persistence of contract metadata and results", () => {
  const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
  (databaseUrl ? test : test.skip)("round-trips run result and workflow contract snapshots across hydrate", async () => {
    const { Pool } = require("pg");
    const { runStudioMigrations } = await import("../src/studio/infrastructure/migrate");
    const { PostgresRunStore } = await import("../apps/server/src/runtime/runStore");
    const schema = `contract_test_${randomUUID().replace(/-/g, "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 4 });
    try {
      await runStudioMigrations(pool);
      const { workflow, agent, agentNode } = linearAgentWorkflow({ version: 1, outputSchema: { type: "object" } });
      const p = await principal();
      const first = new PostgresRunStore(pool);
      first.create(
        { id: "pg-contract-run", workflowId: workflow.id, status: "completed", startedAt: nowIso(), metadata: {}, ownerId: p.userId, tenantId: p.tenantId },
        undefined,
        { workflow, agents: [agent] },
        p,
      );
      first.update("pg-contract-run", {
        result: createResultEnvelope("blocked", { error: { code: "PG_BLOCKED", message: "persisted outcome", retryable: false } }),
      });
      await first.flush();

      // Restart recovery path: a fresh store hydrates purely from Postgres.
      const second = new PostgresRunStore(pool);
      await second.hydrate();
      const entry = second.get("pg-contract-run");
      expect(entry?.run.result).toMatchObject({ status: "blocked", error: { code: "PG_BLOCKED" } });
      expect(entry?.workflowSnapshot?.nodes.find((node) => node.id === agentNode.id)?.contract).toEqual({
        version: 1,
        outputSchema: { type: "object" },
      });
    } finally {
      await pool.end();
      const cleanup = new Pool({ connectionString: databaseUrl });
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    }
  });
});
