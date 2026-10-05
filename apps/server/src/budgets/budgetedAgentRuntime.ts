import { randomUUID } from "node:crypto";
import type { AgentRuntime, AgentExecutionEvent, AgentExecutionInput } from "../../../../src/agents/runtime";
import type { StudioStore } from "../../../../src/studio/contracts";
import type { RunStoreContract } from "../runtime/runStore";
import { RunBudgetController } from "./runBudgetController";

/** Single admission boundary for every agent invocation, including tests, tasks, routines, and webhooks. */
export class BudgetedAgentRuntime implements Pick<AgentRuntime, "execute"> {
  constructor(
    private readonly inner: Pick<AgentRuntime, "execute">,
    private readonly budgets: RunBudgetController,
    private readonly runs: RunStoreContract,
    private readonly studio?: StudioStore,
  ) {}

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    const entry = this.runs.get(input.runId);
    const tenantId = input.credentialPrincipal?.tenantId ?? entry?.run.tenantId;
    if (!tenantId) { yield* this.inner.execute(input); return; }
    const principal = entry?.run.ownerId ? { userId: entry.run.ownerId, tenantId } : undefined;
    const task = entry?.run.taskId && principal ? await this.studio?.getTask(entry.run.taskId, principal) : null;
    const projectIds = task?.projectIds ?? [];
    const reservationId = `${input.runId}:${randomUUID()}`;
    const admitted = await this.budgets.admitInvocation(reservationId, tenantId, input.agent.id, projectIds);
    if (!admitted) throw new Error("BUDGET_EXCEEDED: company, agent, or project budget has reached its cap");
    let started = false;
    try {
      for await (const event of this.inner.execute(input)) {
        if (event.type === "agent.started" || event.type === "llm.started") started = true;
        this.budgets.record(reservationId, event);
        yield event;
      }
    } finally {
      const usage = await this.budgets.settle(reservationId, started ? undefined : 0);
      const current = this.runs.get(input.runId)?.run;
      if (current && started) {
        const previous = current.metadata ?? {};
        const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
        this.runs.update(input.runId, { metadata: {
          ...previous,
          cost: numeric(previous.cost) + usage.cost,
          promptTokens: numeric(previous.promptTokens) + usage.input,
          completionTokens: numeric(previous.completionTokens) + usage.output,
          totalTokens: numeric(previous.totalTokens) + usage.input + usage.output,
          costEstimated: previous.costEstimated === true || usage.estimated,
        } });
      }
    }
  }
}
