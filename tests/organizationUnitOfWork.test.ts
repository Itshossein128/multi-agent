import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { InMemoryOrganizationStore, PostgresOrganizationStore, type OrganizationGoal, type OrganizationStore } from "../apps/server/src/organization/organizationStore";
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
  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])("preserves a concurrent commit (other transaction=%s, rollback=%s)", async (transactional, rollback) => {
    const studio = new InMemoryStudioStore();
    const organization = new InMemoryOrganizationStore();
    const task = await seed(studio);
    const uow = new InMemoryOrganizationUnitOfWork(studio, organization);
    let resume!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const failing = uow.run(async stores => {
      await stores.organization.saveGoal({ ...goal, id: "failed-goal" });
      await stores.studio.saveTask({ ...task, id: "failed-task" }, principal);
      entered();
      await paused;
      if (rollback) throw new Error("injected overlapping failure");
    });
    const outcome = rollback ? expect(failing).rejects.toThrow("injected overlapping failure") : failing;
    await started;
    const write = async (stores: { studio: StudioStore; organization: OrganizationStore }) => {
      await stores.organization.saveGoal({ ...goal, id: "committed-goal" });
      await stores.studio.saveTask({ ...task, id: "committed-task" }, principal);
    };
    try {
      if (transactional) await new InMemoryOrganizationUnitOfWork(studio, organization).run(write);
      else await write({ studio, organization });
    } finally { resume(); }
    await outcome;
    expect((await organization.goals(principal.tenantId)).map(row => row.id).sort()).toEqual(rollback ? ["committed-goal"] : ["committed-goal", "failed-goal"]);
    expect((await studio.listTasks(principal)).map(row => row.id).sort()).toEqual(rollback ? ["committed-task"] : ["committed-task", "failed-task"]);
  });

  it("does not expose uncommitted goal or task writes", async () => {
    const studio = new InMemoryStudioStore();
    const organization = new InMemoryOrganizationStore();
    const task = await seed(studio);
    await new InMemoryOrganizationUnitOfWork(studio, organization).run(async stores => {
      await stores.organization.saveGoal(goal);
      await stores.studio.saveTask(task, principal);
      expect(await organization.goals(principal.tenantId)).toEqual([]);
      expect(await studio.listTasks(principal)).toEqual([]);
    });
    expect(await organization.goals(principal.tenantId)).toEqual([goal]);
    expect(await studio.listTasks(principal)).toMatchObject([task]);
    expect(await studio.listTasks(principal)).toHaveLength(1);
  });

  it.each(["studio", "organization"] as const)("rejects a %s write conflict without committing either store", async conflict => {
    const studio = new InMemoryStudioStore();
    const organization = new InMemoryOrganizationStore();
    const task = await seed(studio);
    await expect(new InMemoryOrganizationUnitOfWork(studio, organization).run(async stores => {
      await stores.organization.saveGoal(goal);
      await stores.studio.saveTask(task, principal);
      if (conflict === "studio") await studio.saveTask({ ...task, title: "Concurrent task" }, principal);
      else await organization.saveGoal({ ...goal, title: "Concurrent goal" });
    })).rejects.toThrow("In-memory transaction conflict");
    expect(await organization.goals(principal.tenantId)).toEqual(conflict === "organization" ? [{ ...goal, title: "Concurrent goal" }] : []);
    const tasks = await studio.listTasks(principal);
    expect(tasks).toHaveLength(conflict === "studio" ? 1 : 0);
    if (conflict === "studio") expect(tasks[0]).toMatchObject({ ...task, title: "Concurrent task" });
    await new InMemoryOrganizationUnitOfWork(studio, organization).run(async stores => {
      await stores.organization.saveGoal({ ...goal, id: "retry-goal" });
      await stores.studio.saveTask({ ...task, id: "retry-task" }, principal);
    });
    expect((await organization.goals(principal.tenantId)).some(row => row.id === "retry-goal")).toBe(true);
    expect((await studio.listTasks(principal)).some(row => row.id === "retry-task")).toBe(true);
  });

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
