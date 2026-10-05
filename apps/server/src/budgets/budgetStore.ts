import type { PgPool } from "../../../../src/memory/infrastructure";

export type BudgetScope = "company" | "agent" | "project";
export interface BudgetRecord {
  tenantId: string;
  scope: BudgetScope;
  scopeId: string;
  limitUsd: number;
  thresholdPercent: number;
  spentUsd: number;
  reservedUsd: number;
  periodStart: string;
  periodEnd: string;
}
export interface BudgetAlert { tenantId: string; scope: BudgetScope; scopeId: string; level: "threshold" | "limit"; createdAt: string; spentUsd: number; limitUsd: number }
export interface BudgetStore {
  list(tenantId: string): Promise<BudgetRecord[]>;
  setBudget(input: Pick<BudgetRecord, "tenantId" | "scope" | "scopeId" | "limitUsd" | "thresholdPercent">): Promise<BudgetRecord>;
  reserve(runId: string, tenantId: string, scopeKeys: { scope: BudgetScope; scopeId: string }[], amountUsd: number): Promise<boolean>;
  settle(runId: string, actualUsd: number): Promise<void>;
  alerts(tenantId: string): Promise<BudgetAlert[]>;
  openReservations(): Promise<string[]>;
}

function month(): { start: string; end: string } {
  const now = new Date();
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() };
}
function key(tenantId: string, scope: BudgetScope, scopeId: string) { return `${tenantId}:${scope}:${scopeId}`; }
function currentPeriodView(row: BudgetRecord): BudgetRecord {
  const period = month();
  return row.periodStart !== period.start && row.reservedUsd === 0
    ? { ...row, spentUsd: 0, periodStart: period.start, periodEnd: period.end }
    : row;
}

export class InMemoryBudgetStore implements BudgetStore {
  private readonly records = new Map<string, BudgetRecord>();
  private readonly reservations = new Map<string, { keys: string[]; amount: number }>();
  private readonly notifications: BudgetAlert[] = [];
  async list(tenantId: string) { return [...this.records.values()].filter(row => row.tenantId === tenantId).map(row => structuredClone(currentPeriodView(row))); }
  async setBudget(input: Pick<BudgetRecord, "tenantId" | "scope" | "scopeId" | "limitUsd" | "thresholdPercent">) {
    const id = key(input.tenantId, input.scope, input.scopeId);
    const prior = this.records.get(id);
    const period = month();
    const retain = prior?.periodStart === period.start || Boolean(prior?.reservedUsd);
    const record: BudgetRecord = { ...input, spentUsd: retain ? prior?.spentUsd ?? 0 : 0, reservedUsd: retain ? prior?.reservedUsd ?? 0 : 0, periodStart: retain ? prior?.periodStart ?? period.start : period.start, periodEnd: retain ? prior?.periodEnd ?? period.end : period.end };
    this.records.set(id, record); return structuredClone(record);
  }
  async reserve(runId: string, tenantId: string, scopeKeys: { scope: BudgetScope; scopeId: string }[], amountUsd: number) {
    if (this.reservations.has(runId)) return true;
    const keys = scopeKeys.map(scope => key(tenantId, scope.scope, scope.scopeId)).filter(id => this.records.has(id));
    if (keys.length === 0) return true;
    if (keys.some(id => { const row = this.records.get(id)!; if (row.periodStart !== month().start && row.reservedUsd === 0) { const period = month(); row.spentUsd = 0; row.periodStart = period.start; row.periodEnd = period.end; } return row.spentUsd + row.reservedUsd + amountUsd > row.limitUsd; })) return false;
    for (const id of keys) this.records.get(id)!.reservedUsd += amountUsd;
    this.reservations.set(runId, { keys, amount: amountUsd }); return true;
  }
  async settle(runId: string, actualUsd: number) {
    const reservation = this.reservations.get(runId); if (!reservation) return;
    this.reservations.delete(runId);
    for (const id of reservation.keys) {
      const row = this.records.get(id)!;
      const before = row.spentUsd;
      row.reservedUsd = Math.max(0, row.reservedUsd - reservation.amount);
      row.spentUsd += actualUsd;
      for (const [level, fraction] of [["threshold", row.thresholdPercent / 100], ["limit", 1]] as const) {
        if (before < row.limitUsd * fraction && row.spentUsd >= row.limitUsd * fraction) this.notifications.push({ tenantId: row.tenantId, scope: row.scope, scopeId: row.scopeId, level, createdAt: new Date().toISOString(), spentUsd: row.spentUsd, limitUsd: row.limitUsd });
      }
    }
  }
  async alerts(tenantId: string) { return this.notifications.filter(row => row.tenantId === tenantId).map(row => structuredClone(row)); }
  async openReservations() { return [...this.reservations.keys()]; }
}

function decode(row: Record<string, unknown>): BudgetRecord {
  return { tenantId: String(row.tenant_id), scope: row.scope as BudgetScope, scopeId: String(row.scope_id), limitUsd: Number(row.limit_usd), thresholdPercent: Number(row.threshold_percent), spentUsd: Number(row.spent_usd), reservedUsd: Number(row.reserved_usd), periodStart: new Date(row.period_start as string).toISOString(), periodEnd: new Date(row.period_end as string).toISOString() };
}

export class PostgresBudgetStore implements BudgetStore {
  constructor(private readonly pool: PgPool) {}
  async list(tenantId: string) {
    const result = await this.pool.query("SELECT * FROM studio_budgets WHERE tenant_id=$1 ORDER BY scope,scope_id", [tenantId]);
    return result.rows.map(row => currentPeriodView(decode(row)));
  }
  async setBudget(input: Pick<BudgetRecord, "tenantId" | "scope" | "scopeId" | "limitUsd" | "thresholdPercent">) {
    const period = month();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`budget-tenant:${input.tenantId}`]);
      const result = await client.query(
      `INSERT INTO studio_budgets (tenant_id,scope,scope_id,limit_usd,threshold_percent,period_start,period_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id,scope,scope_id) DO UPDATE SET limit_usd=EXCLUDED.limit_usd,threshold_percent=EXCLUDED.threshold_percent,
         spent_usd=CASE WHEN studio_budgets.period_start=EXCLUDED.period_start OR studio_budgets.reserved_usd>0 THEN studio_budgets.spent_usd ELSE 0 END,
         reserved_usd=studio_budgets.reserved_usd,
         period_start=CASE WHEN studio_budgets.reserved_usd>0 THEN studio_budgets.period_start ELSE EXCLUDED.period_start END,
         period_end=CASE WHEN studio_budgets.reserved_usd>0 THEN studio_budgets.period_end ELSE EXCLUDED.period_end END RETURNING *`,
      [input.tenantId,input.scope,input.scopeId,input.limitUsd,input.thresholdPercent,period.start,period.end],
    );
      await client.query("COMMIT");
      return decode(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async reserve(runId: string, tenantId: string, scopeKeys: { scope: BudgetScope; scopeId: string }[], amountUsd: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`budget:${runId}`]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`budget-tenant:${tenantId}`]);
      const existing = await client.query("SELECT run_id FROM studio_budget_reservations WHERE run_id=$1", [runId]);
      if (existing.rows.length) { await client.query("COMMIT"); return true; }
      const period = month();
      const sorted = [...scopeKeys].sort((a,b) => `${a.scope}:${a.scopeId}`.localeCompare(`${b.scope}:${b.scopeId}`));
      const selected: { scope: BudgetScope; scopeId: string }[] = [];
      for (const scope of sorted) {
        const result = await client.query("SELECT * FROM studio_budgets WHERE tenant_id=$1 AND scope=$2 AND scope_id=$3 FOR UPDATE", [tenantId,scope.scope,scope.scopeId]);
        if (!result.rows.length) continue;
        const row = decode(result.rows[0]);
        if (row.periodStart !== period.start && row.reservedUsd === 0) await client.query("UPDATE studio_budgets SET spent_usd=0,period_start=$4,period_end=$5 WHERE tenant_id=$1 AND scope=$2 AND scope_id=$3", [tenantId,scope.scope,scope.scopeId,period.start,period.end]);
        const admitted = await client.query(
          `UPDATE studio_budgets SET reserved_usd=reserved_usd+$4::numeric
           WHERE tenant_id=$1 AND scope=$2 AND scope_id=$3 AND spent_usd+reserved_usd+$4::numeric<=limit_usd RETURNING 1`,
          [tenantId,scope.scope,scope.scopeId,amountUsd],
        );
        if (!admitted.rows.length) { await client.query("ROLLBACK"); return false; }
        selected.push(scope);
      }
      if (selected.length === 0) { await client.query("COMMIT"); return true; }
      await client.query("INSERT INTO studio_budget_reservations (run_id,tenant_id,amount_usd,scopes) VALUES ($1,$2,$3,$4::jsonb)", [runId,tenantId,amountUsd,JSON.stringify(selected)]);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async settle(runId: string, actualUsd: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM studio_budget_reservations WHERE run_id=$1 FOR UPDATE", [runId]);
      if (!result.rows.length || result.rows[0].settled_at) { await client.query("COMMIT"); return; }
      const reservation = result.rows[0];
      const scopes = reservation.scopes as { scope: BudgetScope; scopeId: string }[];
      for (const scope of scopes) {
        const update = await client.query(
          `UPDATE studio_budgets SET reserved_usd=GREATEST(0,reserved_usd-$4),spent_usd=spent_usd+$5
           WHERE tenant_id=$1 AND scope=$2 AND scope_id=$3 RETURNING *`,
          [reservation.tenant_id,scope.scope,scope.scopeId,reservation.amount_usd,actualUsd],
        );
        if (!update.rows[0]) continue;
        const row = decode(update.rows[0]);
        const before = row.spentUsd - actualUsd;
        for (const [level, fraction] of [["threshold", row.thresholdPercent / 100], ["limit", 1]] as const) {
          if (before < row.limitUsd * fraction && row.spentUsd >= row.limitUsd * fraction) await client.query(
            "INSERT INTO studio_budget_alerts (tenant_id,scope,scope_id,level,spent_usd,limit_usd) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
            [row.tenantId,row.scope,row.scopeId,level,row.spentUsd,row.limitUsd],
          );
        }
      }
      await client.query("UPDATE studio_budget_reservations SET settled_at=now(),actual_usd=$2 WHERE run_id=$1", [runId,actualUsd]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async alerts(tenantId: string): Promise<BudgetAlert[]> {
    const result = await this.pool.query("SELECT * FROM studio_budget_alerts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100", [tenantId]);
    return result.rows.map(row => ({ tenantId: String(row.tenant_id), scope: row.scope as BudgetScope, scopeId: String(row.scope_id), level: row.level as BudgetAlert["level"], createdAt: new Date(row.created_at as string).toISOString(), spentUsd: Number(row.spent_usd), limitUsd: Number(row.limit_usd) }));
  }
  async openReservations() {
    const result = await this.pool.query("SELECT run_id FROM studio_budget_reservations WHERE settled_at IS NULL", []);
    return result.rows.map(row => String(row.run_id));
  }
}
