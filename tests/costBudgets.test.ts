import { InMemoryBudgetStore } from "../apps/server/src/budgets/budgetStore";
import { RunBudgetController } from "../apps/server/src/budgets/runBudgetController";
import { BudgetedAgentRuntime } from "../apps/server/src/budgets/budgetedAgentRuntime";
import { InMemoryRunStore } from "../apps/server/src/runtime/store/inMemoryRunStore";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { createAgentRecord, nowIso } from "@multi-agent/types";
import type { AgentRuntime } from "../src/agents/runtime";

describe("cost budgets", () => {
  it("reserves company and agent budgets across runs and emits threshold alerts", async () => {
    const store = new InMemoryBudgetStore();
    await store.setBudget({ tenantId: "t", scope: "company", scopeId: "t", limitUsd: 2, thresholdPercent: 50 });
    await store.setBudget({ tenantId: "t", scope: "agent", scopeId: "a", limitUsd: 1, thresholdPercent: 50 });
    const scopes = [{ scope: "company" as const, scopeId: "t" }, { scope: "agent" as const, scopeId: "a" }];
    expect(await store.reserve("r1", "t", scopes, 0.75)).toBe(true);
    expect(await store.reserve("r2", "t", scopes, 0.75)).toBe(false);
    await store.settle("r1", 0.75);
    expect((await store.list("t")).find(row => row.scope === "agent")?.spentUsd).toBe(0.75);
    expect((await store.alerts("t")).some(alert => alert.scope === "agent" && alert.level === "threshold")).toBe(true);
    expect(await store.reserve("r3", "t", scopes, 0.3)).toBe(false);
  });

  it("shows a fresh monthly balance before the next reservation arrives", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-30T23:00:00Z"));
    try {
      const store = new InMemoryBudgetStore();
      await store.setBudget({ tenantId: "tenant", scope: "company", scopeId: "tenant", limitUsd: 2, thresholdPercent: 80 });
      await store.reserve("september", "tenant", [{ scope: "company", scopeId: "tenant" }], 1);
      await store.settle("september", 0.5);
      jest.setSystemTime(new Date("2026-10-01T01:00:00Z"));
      expect((await store.list("tenant"))[0]).toMatchObject({ spentUsd: 0, reservedUsd: 0, periodStart: "2026-10-01T00:00:00.000Z" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses configured usage rates and conservative reservation for unknown usage", async () => {
    const original = process.env.MODEL_PRICING_USD_PER_MILLION_JSON;
    try {
      process.env.MODEL_PRICING_USD_PER_MILLION_JSON = JSON.stringify({ "test:model": { input: 2, output: 4 } });
      const store = new InMemoryBudgetStore();
      const controller = new RunBudgetController(store);
      controller.record("run-1", { type: "llm.completed", timestamp: new Date().toISOString(), payload: { provider: "test", model: "model", usage: { input_tokens: 1000, output_tokens: 500 } } });
      expect((await controller.settle("run-1")).cost).toBeCloseTo(0.004);
      expect((await controller.settle("run-2")).estimated).toBe(true);
    } finally {
      if (original === undefined) delete process.env.MODEL_PRICING_USD_PER_MILLION_JSON;
      else process.env.MODEL_PRICING_USD_PER_MILLION_JSON = original;
    }
  });

  it("denies an invocation before provider execution when company cap is exhausted", async () => {
    const budgets = new InMemoryBudgetStore();
    await budgets.setBudget({ tenantId: "tenant", scope: "company", scopeId: "tenant", limitUsd: 0.5, thresholdPercent: 80 });
    const runs = new InMemoryRunStore();
    runs.create({ id: "run-budget", workflowId: "workflow", status: "running", startedAt: nowIso(), metadata: {}, ownerId: "alice", tenantId: "tenant" });
    let invoked = false;
    const runtime: Pick<AgentRuntime, "execute"> = { async *execute() { invoked = true; yield { type: "agent.completed", timestamp: nowIso() }; } };
    const guarded = new BudgetedAgentRuntime(runtime, new RunBudgetController(budgets), runs);
    const agent = createAgentRecord({ name: "Budgeted" });
    const consume = async () => { for await (const _event of guarded.execute({ agent, input: {}, runId: "run-budget", nodeId: "node" })) { /* consume */ } };
    await expect(consume()).rejects.toThrow("BUDGET_EXCEEDED");
    expect(invoked).toBe(false);
  });

  it("applies a linked task's project cap before calling the provider", async () => {
    const budgets = new InMemoryBudgetStore();
    await budgets.setBudget({ tenantId: "tenant", scope: "project", scopeId: "project-a", limitUsd: 0.5, thresholdPercent: 80 });
    const studio = new InMemoryStudioStore();
    await studio.saveTask({
      id: "task-project-budget", title: "Project task", description: "", priority: "medium", status: "todo",
      assignedAgent: null, createdAt: nowIso(), dependencies: [], output: null, retryCount: 0, paused: false,
      workspaceId: "workspace-a", projectIds: ["project-a"],
    }, { userId: "alice", tenantId: "tenant" });
    const runs = new InMemoryRunStore();
    runs.create({ id: "run-project-budget", workflowId: "workflow", taskId: "task-project-budget", status: "running", startedAt: nowIso(), metadata: {}, ownerId: "alice", tenantId: "tenant" });
    let invoked = false;
    const runtime: Pick<AgentRuntime, "execute"> = { async *execute() { invoked = true; yield { type: "agent.completed", timestamp: nowIso() }; } };
    const guarded = new BudgetedAgentRuntime(runtime, new RunBudgetController(budgets), runs, studio);
    const consume = async () => { for await (const _event of guarded.execute({ agent: createAgentRecord({ name: "Budgeted" }), input: {}, runId: "run-project-budget", nodeId: "node" })) { /* consume */ } };
    await expect(consume()).rejects.toThrow("BUDGET_EXCEEDED");
    expect(invoked).toBe(false);
  });

  it("settles reported model usage and records it on the run", async () => {
    const original = process.env.MODEL_PRICING_USD_PER_MILLION_JSON;
    try {
      process.env.MODEL_PRICING_USD_PER_MILLION_JSON = JSON.stringify({ "test:model": { input: 2, output: 4 } });
      const budgets = new InMemoryBudgetStore();
      await budgets.setBudget({ tenantId: "tenant", scope: "company", scopeId: "tenant", limitUsd: 2, thresholdPercent: 80 });
      const runs = new InMemoryRunStore();
      runs.create({ id: "run-metered", workflowId: "workflow", status: "running", startedAt: nowIso(), metadata: {}, ownerId: "alice", tenantId: "tenant" });
      const runtime: Pick<AgentRuntime, "execute"> = { async *execute() {
        yield { type: "agent.started", timestamp: nowIso() };
        yield { type: "llm.completed", timestamp: nowIso(), payload: { provider: "test", model: "model", usage: { input_tokens: 1000, output_tokens: 500 } } };
        yield { type: "agent.completed", timestamp: nowIso() };
      } };
      const guarded = new BudgetedAgentRuntime(runtime, new RunBudgetController(budgets), runs);
      for await (const _event of guarded.execute({ agent: createAgentRecord({ name: "Metered" }), input: {}, runId: "run-metered", nodeId: "node" })) { /* consume */ }
      expect((await budgets.list("tenant"))[0].spentUsd).toBeCloseTo(0.004);
      expect(Number(runs.get("run-metered")?.run.metadata.cost)).toBeCloseTo(0.004);
      expect(runs.get("run-metered")?.run.metadata.totalTokens).toBe(1500);
    } finally {
      if (original === undefined) delete process.env.MODEL_PRICING_USD_PER_MILLION_JSON;
      else process.env.MODEL_PRICING_USD_PER_MILLION_JSON = original;
    }
  });

  it("reconciles an unfinished reservation after a terminal run is recovered", async () => {
    const store = new InMemoryBudgetStore();
    await store.setBudget({ tenantId: "tenant", scope: "company", scopeId: "tenant", limitUsd: 2, thresholdPercent: 80 });
    await store.reserve("run-crashed:invocation", "tenant", [{ scope: "company", scopeId: "tenant" }], 1);
    const controller = new RunBudgetController(store);
    await controller.recover(await store.openReservations(), runId => runId === "run-crashed");
    expect((await store.list("tenant"))[0]).toMatchObject({ spentUsd: 1, reservedUsd: 0 });
  });
});
