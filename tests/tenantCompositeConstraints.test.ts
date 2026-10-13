import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)("Tenant Composite Constraints (T086 / F6)", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `tenant_fk_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  async function seedOrgsAndProjects() {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const projA = randomUUID();
    const projB = randomUUID();
    const wsA = randomUUID();
    const wsB = randomUUID();

    // Seed orgs
    await pool.query(
      `INSERT INTO studio_organizations (id, name, description, config, owner_id, status, slug)
       VALUES ($1, 'Org A', '', '{}'::jsonb, $2, 'active', $3),
              ($4, 'Org B', '', '{}'::jsonb, $5, 'active', $6)`,
      [orgA, userA, `org-a-${orgA.slice(0, 8)}`, orgB, userB, `org-b-${orgB.slice(0, 8)}`],
    );

    // Seed projects
    await pool.query(
      `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, owner_id)
       VALUES ($1, $2, 'Proj A', '', 'active', '{}'::jsonb, $3),
              ($4, $5, 'Proj B', '', 'active', '{}'::jsonb, $6)`,
      [projA, orgA, userA, projB, orgB, userB],
    );

    // Seed workspaces
    await pool.query(
      `INSERT INTO studio_workspaces (id, tenant_id, project_id, name, description, status, settings, owner_id)
       VALUES ($1, $2, $3, 'WS A', '', 'active', '{}'::jsonb, $4),
              ($5, $6, $7, 'WS B', '', 'active', '{}'::jsonb, $8)`,
      [wsA, orgA, projA, userA, wsB, orgB, projB, userB],
    );

    return { orgA, orgB, userA, userB, projA, projB, wsA, wsB };
  }

  it("permits nullable project association on organization goals", async () => {
    const { orgA, userA } = await seedOrgsAndProjects();
    const goalId = randomUUID();

    await pool.query(
      `INSERT INTO studio_organization_goals (id, tenant_id, title, status, project_id, created_by)
       VALUES ($1, $2, 'Goal without project', 'active', NULL, $3)`,
      [goalId, orgA, userA],
    );

    const res = await pool.query(
      `SELECT * FROM studio_organization_goals WHERE id = $1`,
      [goalId],
    );
    expect(res.rows[0].project_id).toBeNull();
  });

  it("permits valid project association matching tenant on organization goals", async () => {
    const { orgA, userA, projA } = await seedOrgsAndProjects();
    const goalId = randomUUID();

    await pool.query(
      `INSERT INTO studio_organization_goals (id, tenant_id, title, status, project_id, created_by)
       VALUES ($1, $2, 'Goal with project', 'active', $3, $4)`,
      [goalId, orgA, projA, userA],
    );

    const res = await pool.query(
      `SELECT * FROM studio_organization_goals WHERE id = $1`,
      [goalId],
    );
    expect(res.rows[0].project_id).toBe(projA);
  });

  it("rejects cross-org project on organization goals", async () => {
    const { orgA, userA, projB } = await seedOrgsAndProjects();
    const goalId = randomUUID();

    await expect(
      pool.query(
        `INSERT INTO studio_organization_goals (id, tenant_id, title, status, project_id, created_by)
         VALUES ($1, $2, 'Cross-org goal', 'active', $3, $4)`,
        [goalId, orgA, projB, userA],
      ),
    ).rejects.toThrow(/foreign key|constraint|studio_organization_goals_project_tenant_fk/i);
  });

  it("rejects cross-org parent goal on organization goals", async () => {
    const { orgA, orgB, userA, userB } = await seedOrgsAndProjects();
    const parentGoalB = randomUUID();
    const childGoalA = randomUUID();

    await pool.query(
      `INSERT INTO studio_organization_goals (id, tenant_id, title, status, project_id, created_by)
       VALUES ($1, $2, 'Org B Parent', 'active', NULL, $3)`,
      [parentGoalB, orgB, userB],
    );

    await expect(
      pool.query(
        `INSERT INTO studio_organization_goals (id, tenant_id, title, status, parent_goal_id, project_id, created_by)
         VALUES ($1, $2, 'Org A Child', 'active', $3, NULL, $4)`,
        [childGoalA, orgA, parentGoalB, userA],
      ),
    ).rejects.toThrow(/foreign key|constraint|studio_organization_goals_parent_tenant_fk/i);
  });

  it("rejects cross-org project on project repository", async () => {
    const { orgA, projB } = await seedOrgsAndProjects();
    const repoId = randomUUID();

    await expect(
      pool.query(
        `INSERT INTO studio_project_repositories (id, tenant_id, project_id, name, source, default_branch)
         VALUES ($1, $2, $3, 'repo1', 'github.com/foo/bar', 'main')`,
        [repoId, orgA, projB],
      ),
    ).rejects.toThrow(/foreign key|constraint|studio_project_repositories_project_tenant_fk/i);
  });

  it("rejects cross-org workspace on workspace repository", async () => {
    const { orgA, orgB, projA, wsB } = await seedOrgsAndProjects();
    const repoA = randomUUID();

    // Insert valid repo in orgA
    await pool.query(
      `INSERT INTO studio_project_repositories (id, tenant_id, project_id, name, source, default_branch)
       VALUES ($1, $2, $3, 'repo-a', 'source', 'main')`,
      [repoA, orgA, projA],
    );

    // Try linking orgA repo to wsB (which belongs to orgB) under orgA
    await expect(
      pool.query(
        `INSERT INTO studio_workspace_repositories (tenant_id, workspace_id, project_repository_id, branch)
         VALUES ($1, $2, $3, 'main')`,
        [orgA, wsB, repoA],
      ),
    ).rejects.toThrow(/foreign key|constraint|studio_workspace_repositories_workspace_tenant_fk/i);
  });

  it("rejects cross-org project repository on workspace repository", async () => {
    const { orgA, orgB, projB, wsA } = await seedOrgsAndProjects();
    const repoB = randomUUID();

    // Insert valid repo in orgB
    await pool.query(
      `INSERT INTO studio_project_repositories (id, tenant_id, project_id, name, source, default_branch)
       VALUES ($1, $2, $3, 'repo-b', 'source', 'main')`,
      [repoB, orgB, projB],
    );

    // Try linking orgB repo to wsA (orgA) under orgA
    await expect(
      pool.query(
        `INSERT INTO studio_workspace_repositories (tenant_id, workspace_id, project_repository_id, branch)
         VALUES ($1, $2, $3, 'main')`,
        [orgA, wsA, repoB],
      ),
    ).rejects.toThrow(/foreign key|constraint|studio_workspace_repositories_project_repo_tenant_fk/i);
  });
});
