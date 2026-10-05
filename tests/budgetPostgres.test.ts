import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { PostgresBudgetStore } from "../apps/server/src/budgets/budgetStore";
import { PostgresOrganizationStore } from "../apps/server/src/organization/organizationStore";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("PostgreSQL budget admission", () => {
  let admin: Pool; let pool: Pool; let schema: string;
  beforeAll(async () => {
    schema = `budget_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 8 });
    await runStudioMigrations(pool);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });
  it("admits only one concurrent reservation and settles idempotently", async () => {
    const store = new PostgresBudgetStore(pool);
    await store.setBudget({ tenantId: "tenant-a", scope: "company", scopeId: "tenant-a", limitUsd: 1.5, thresholdPercent: 50 });
    const scopes = [{ scope: "company" as const, scopeId: "tenant-a" }];
    const admissions = await Promise.all([store.reserve("r-a", "tenant-a", scopes, 1), store.reserve("r-b", "tenant-a", scopes, 1)]);
    expect([...admissions].sort()).toEqual([false, true]);
    const winner = admissions[0] ? "r-a" : "r-b";
    await store.settle(winner, 1);
    await store.settle(winner, 1);
    const [budget] = await store.list("tenant-a");
    expect(budget.spentUsd).toBe(1);
    expect(budget.reservedUsd).toBe(0);
    expect((await store.alerts("tenant-a")).filter(alert => alert.level === "threshold")).toHaveLength(1);
  });
  it("persists tenant-scoped reporting lines and goals", async () => {
    const store = new PostgresOrganizationStore(pool);
    await store.saveReportingLine({ tenantId: "tenant-a", agentId: "ceo", managerAgentId: null, role: "ceo" });
    await expect(store.saveReportingLine({ tenantId: "tenant-a", agentId: "ceo-2", managerAgentId: null, role: "ceo" })).rejects.toThrow("already has a CEO");
    await store.saveReportingLine({ tenantId: "tenant-a", agentId: "a", managerAgentId: "ceo", role: "manager" });
    await store.saveReportingLine({ tenantId: "tenant-a", agentId: "b", managerAgentId: "ceo", role: "manager" });
    const cycleRace = await Promise.allSettled([
      store.saveReportingLine({ tenantId: "tenant-a", agentId: "a", managerAgentId: "b", role: "manager" }),
      store.saveReportingLine({ tenantId: "tenant-a", agentId: "b", managerAgentId: "a", role: "manager" }),
    ]);
    expect(cycleRace.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await store.saveGoal({ id: "goal-one", tenantId: "tenant-a", title: "Ship", description: "", status: "active", parentGoalId: null, projectId: null, ownerAgentId: "ceo", proposedByAgentId: null, createdBy: "alice", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    expect((await store.goals("tenant-a")).map(goal => goal.id)).toContain("goal-one");
    expect(await store.goals("tenant-b")).toEqual([]);
  });
});
