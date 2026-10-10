import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createAgentRecord } from "@multi-agent/types";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { PostgresOrganizationStore } from "../apps/server/src/organization/organizationStore";
import { PostgresOrganizationUnitOfWork } from "../apps/server/src/organization/organizationUnitOfWork";
import { createStudioRouter } from "../apps/server/src/api/studio";

const principal = { userId: "alice", tenantId: "tenant-a" };
const proposal = { title: "Reliability", brief: "Reduce failed runs", projectId: "project" };

(process.env.MEMORY_TEST_DATABASE_URL ? describe : describe.skip)("strategy atomicity on real PostgreSQL", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let studio: PostgresStudioStore;
  let organization: PostgresOrganizationStore;
  let app: ReturnType<typeof createStudioRouter>;
  beforeEach(async () => {
    schema = `org_strategy_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 3 });
    await runStudioMigrations(pool);
    studio = new PostgresStudioStore(pool);
    organization = new PostgresOrganizationStore(pool);
    const stamp = new Date().toISOString();
    for (const [id, caller, status] of [
      ["project", principal, "active"], ["retired", principal, "retired"],
      ["foreign", { userId: "bob", tenantId: "tenant-b" }, "active"],
    ] as const) {
      await studio.saveProject({ id, tenantId: caller.tenantId, ownerId: caller.userId, name: id, nameSource: "manual",
        description: "", status, settings: {}, createdAt: stamp, updatedAt: stamp }, caller);
    }
    await studio.saveAgent({ ...createAgentRecord({ name: "CEO" }), id: "ceo" }, principal);
    await organization.saveReportingLine({ tenantId: principal.tenantId, agentId: "ceo", managerAgentId: null, role: "ceo" });
    app = createStudioRouter(studio, () => principal, undefined, organization, undefined, new PostgresOrganizationUnitOfWork(pool));
  });
  afterEach(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });
  const request = (body: object) => app.request("/organization/strategy", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function counts() {
    const values = [];
    for (const table of ["studio_organization_goals", "studio_tasks", "studio_trigger_events"]) {
      const result = await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id=$1`, [principal.tenantId]);
      values.push(result.rows[0].count);
    }
    return values;
  }
  it.each([
    ["task insert", "studio_tasks", "BEFORE INSERT"],
    ["event insert", "studio_trigger_events", "BEFORE INSERT"],
    ["commit", "studio_tasks", "AFTER INSERT"],
  ])("rolls back goal, task and event on failure at %s", async (stage, table, timing) => {
    await pool.query(`CREATE FUNCTION inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$`);
    await pool.query(`CREATE ${stage === "commit" ? "CONSTRAINT " : ""}TRIGGER injected ${timing} ON ${table}
      ${stage === "commit" ? "DEFERRABLE INITIALLY DEFERRED" : ""} FOR EACH ROW EXECUTE FUNCTION inject_failure()`);
    const before = await counts();
    expect((await request(proposal)).status).toBeGreaterThanOrEqual(400);
    expect(await counts()).toEqual(before);
    expect(pool.totalCount - pool.idleCount).toBe(0);
    await pool.query(`DROP TRIGGER injected ON ${table}`);
    expect((await request(proposal)).status).toBe(201);
    expect(await counts()).toEqual([1, 1, 1]);
    expect(pool.waitingCount).toBe(0);
  });
  it.each([
    [undefined, 400], ["foreign", 404], ["missing", 404], ["retired", 409],
  ])("rejects project %s with %s and no writes", async (projectId, status) => {
    const before = await counts();
    expect((await request({ ...proposal, projectId })).status).toBe(status);
    expect(await counts()).toEqual(before);
  });
  it("commits exactly one proposed goal, assigned task and assignment event", async () => {
    const response = await request(proposal);
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.goal).toMatchObject({ status: "proposed", projectId: "project", ownerAgentId: "ceo" });
    expect(result.task).toMatchObject({ projectId: "project", assignedAgent: "ceo",
      metadata: { organizationGoalId: result.goal.id, strategyProposal: true } });
    expect(await counts()).toEqual([1, 1, 1]);
    expect(await organization.goals(principal.tenantId)).toMatchObject([result.goal]);
    expect(await studio.listTriggerEvents({ tenantId: principal.tenantId })).toMatchObject([{ eventType: "task_assignment", targetId: result.task.id }]);
    expect(pool.totalCount - pool.idleCount).toBe(0);
  });
});
