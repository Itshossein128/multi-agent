import type { BudgetStore, BudgetScope } from "./budgetStore";
import type { AgentExecutionEvent } from "../../../../src/agents/runtime";

interface Rate { input: number; output: number }
function rates(): Record<string, Rate> {
  try {
    const parsed = JSON.parse(process.env.MODEL_PRICING_USD_PER_MILLION_JSON ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, Rate> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const rate = value as Partial<Rate>;
      if (Number.isFinite(rate?.input) && Number.isFinite(rate?.output) && rate.input! >= 0 && rate.output! >= 0) result[key] = { input: rate.input!, output: rate.output! };
    }
    return result;
  } catch { return {}; }
}
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }
function tokens(usage: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) if (number(usage[key]) > 0) return number(usage[key]);
  return 0;
}

/** Charges actual token usage when a rate is configured; otherwise charges the full reservation conservatively. */
export class RunBudgetController {
  private readonly usage = new Map<string, { cost: number; known: boolean; unknown: boolean; input: number; output: number }>();
  private readonly trackedReservations = new Set<string>();
  private readonly enforcedReservations = new Set<string>();
  readonly reservationUsd: number;
  constructor(private readonly store: BudgetStore) {
    const value = Number(process.env.BUDGET_RUN_RESERVATION_USD ?? 1);
    this.reservationUsd = Number.isFinite(value) && value > 0 && value <= 1000 ? value : 1;
  }
  async admitInvocation(reservationId: string, tenantId: string, agentId: string, projectIds: string[]): Promise<boolean> {
    const scopeKeys: { scope: BudgetScope; scopeId: string }[] = [
      { scope: "company", scopeId: tenantId }, { scope: "agent", scopeId: agentId },
      ...projectIds.map(scopeId => ({ scope: "project" as const, scopeId })),
    ];
    const selected = [...new Map(scopeKeys.map(item => [`${item.scope}:${item.scopeId}`, item])).values()];
    const admitted = await this.store.reserve(reservationId, tenantId, selected, this.reservationUsd);
    if (admitted) {
      this.trackedReservations.add(reservationId);
      try {
        const configured = await this.store.list(tenantId);
        const enforced = selected.some(scope => configured.some(budget => budget.scope === scope.scope && budget.scopeId === scope.scopeId));
        if (enforced) this.enforcedReservations.add(reservationId);
      } catch (error) {
        this.trackedReservations.delete(reservationId);
        await this.store.settle(reservationId, 0);
        throw error;
      }
    }
    return admitted;
  }
  async recover(reservations: string[], isTerminal: (runId: string) => boolean | Promise<boolean>): Promise<void> {
    for (const reservationId of reservations) {
      const runId = reservationId.split(":", 1)[0];
      if (await isTerminal(runId)) await this.store.settle(reservationId, this.reservationUsd);
    }
  }
  record(runId: string, event: AgentExecutionEvent): void {
    if (event.type !== "llm.completed") return;
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
    const input = tokens(usage, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens");
    const output = tokens(usage, "output_tokens", "outputTokens", "completion_tokens", "completionTokens");
    const rate = rates()[`${String(payload.provider ?? "").toLowerCase()}:${String(payload.model ?? "")}`];
    const previous = this.usage.get(runId) ?? { cost: 0, known: false, unknown: false, input: 0, output: 0 };
    this.usage.set(runId, { cost: previous.cost + (rate ? (input * rate.input + output * rate.output) / 1_000_000 : 0), known: previous.known || Boolean(rate && (input || output)), unknown: previous.unknown || !rate || !(input || output), input: previous.input + input, output: previous.output + output });
  }
  async settle(runId: string, overrideCost?: number): Promise<{ cost: number; input: number; output: number; estimated: boolean }> {
    const usage = this.usage.get(runId);
    this.usage.delete(runId);
    const tracked = this.trackedReservations.delete(runId);
    const enforced = this.enforcedReservations.delete(runId);
    const cost = overrideCost ?? (usage?.known && !usage.unknown ? usage.cost : enforced ? Math.max(this.reservationUsd, usage?.cost ?? 0) : usage?.cost ?? 0);
    if (tracked) await this.store.settle(runId, cost);
    return { cost, input: usage?.input ?? 0, output: usage?.output ?? 0, estimated: !usage?.known || usage.unknown };
  }
}
