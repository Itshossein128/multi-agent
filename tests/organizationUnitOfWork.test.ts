import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { InMemoryOrganizationStore, PostgresOrganizationStore, type OrganizationGoal } from "../apps/server/src/organization/organizationStore";
import { InMemoryOrganizationUnitOfWork, PostgresOrganizationUnitOfWork, type OrganizationUnitOfWork } from "../apps/server/src/organization/organizationUnitOfWork";
import type { StudioStore, StudioTask } from "../src/studio/contracts";

const principal = { userId: "alice", tenantId: "tenant-a" };
const stamp = new Date().toISOString();
const goal: OrganizationGoal = { id: "goal", tenantId: principal.tenantId, title: "Goal", description: "",
  status: "proposed", parentGoalId: null, projectId: "project", ownerAgentId: null, proposedByAgentId: null,
  createdBy: principal.userId, createdAt: stamp, updatedAt: stamp };

async function seed(studio: StudioStore): Promise<StudioTask> {
  await studio.saveProject({ id: "project", tenantId: principal.tenantId, ownerId: principal.userId, name: "Project",
    nameSource: "manual", description: "", status: "active", settings: {}, createdAt: stamp, updatedAt: stamp }, principal);
  return { id: "task", title: "Task", description: "", priority: "medium", status: "backlog", assignedAgent: null,
    dependencies: [], runId: null, output: null, retryCount: 0, paused: false, createdAt: stamp, updatedAt: stamp,
    tenantId: principal.tenantId, ownerId: principal.userId, projectId: "project", workspaceId: null };
}

describe("in-memory organization unit of work", () => {
  it.each([false, true])("commits or restores both stores (throw=%s)", async fail => {
    const studio = new InMemoryStudioStore();
    const organization = new InMemoryOrganizationStore();
    const task = await seed(studio);
    const operation = new InMemoryOrganizationUnitOfWork(studio, organization).run(async stores => {
      await stores.organization.saveGoal(goal);
      await stores.studio.saveTask(task, principal);
      if (fail) throw new Error("injected");
    });
    if (fail) await expect(operation).rejects.toThrow("injected"); else await operation;
    expect(await organization.goals(principal.tenantId)).toHaveLength(fail ? 0 : 1);
    expect(await studio.listTasks(principal)).toHaveLength(fail ? 0 : 1);
  });
});

(process.env.MEMORY_TEST_DATABASE_URL ? describe : describe.skip)("PostgreSQL organization unit of work", () => {
  let pool: Pool;
  let admin: Pool;
  let schema: string;
  let studio: PostgresStudioStore;
  let organization: PostgresOrganizationStore;
  let uow: OrganizationUnitOfWork;
  beforeEach(async () => {
    schema = `org_uow_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
    await runStudioMigrations(pool);
    studio = new PostgresStudioStore(pool);
    organization = new PostgresOrganizationStore(pool);
    uow = new PostgresOrganizationUnitOfWork(pool);
  });
  afterEach(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });
  it.each([false, true])("commits or rolls back both stores and releases client (throw=%s)", async fail => {
    const task = await seed(studio);
    const operation = uow.run(async stores => {
      await stores.organization.saveGoal(goal);
      await stores.studio.saveTask(task, principal);
      if (fail) throw new Error("injected");
    });
    if (fail) await expect(operation).rejects.toThrow("injected"); else await operation;
    expect(await organization.goals(principal.tenantId)).toHaveLength(fail ? 0 : 1);
    expect(await studio.listTasks(principal)).toHaveLength(fail ? 0 : 1);
    expect(pool.totalCount - pool.idleCount).toBe(0);
  });
  it("rejects reporting updates inside the shared transaction", async () => {
    await expect(uow.run(stores => stores.organization.saveReportingLine({ tenantId: principal.tenantId,
      agentId: "ceo", managerAgentId: null, role: "ceo" }))).rejects.toThrow("Reporting-line updates are not supported inside an organization unit of work");
    expect(pool.totalCount - pool.idleCount).toBe(0);
  });
});
