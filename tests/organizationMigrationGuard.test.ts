import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
const migration018 = readFileSync(
  resolve(__dirname, "../infrastructure/studio/migrations/018_organization_foundation.sql"),
  "utf8",
);

(databaseUrl ? describe : describe.skip)("organization migration 018 guard", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `org_guard_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("aborts when legacy tenant data exists before memberships table", async () => {
    // Apply through 017 only by running full migrate then dropping 018+ ledger + memberships simulation:
    // Instead: create minimal pre-018 schema with a legacy org row and no memberships table.
    await pool.query(`
      CREATE TABLE studio_organizations (
        id text PRIMARY KEY,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        owner_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE studio_projects (
        id text PRIMARY KEY,
        tenant_id text,
        name text NOT NULL DEFAULT 'p',
        description text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'active',
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        owner_id text NOT NULL DEFAULT 'u'
      );
      CREATE TABLE studio_tasks (id text PRIMARY KEY, tenant_id text);
      CREATE TABLE studio_runs (id text PRIMARY KEY, tenant_id text);
      CREATE TABLE studio_workflows (id text PRIMARY KEY, tenant_id text);
      CREATE TABLE studio_agents (id text PRIMARY KEY, tenant_id text, is_system boolean DEFAULT false);
      CREATE TABLE studio_tools (id text PRIMARY KEY, tenant_id text, is_system boolean DEFAULT false);
      CREATE TABLE studio_users (id text PRIMARY KEY, tenant_id text);
      INSERT INTO studio_organizations (id, name, owner_id) VALUES ('legacy-org', 'Legacy', 'u1');
    `);

    await expect(pool.query(migration018)).rejects.toThrow(/refused|legacy/i);
  });

  it("succeeds on empty data via full studio migration chain", async () => {
    const applied = await runStudioMigrations(pool);
    expect(applied).toEqual(expect.arrayContaining([
      "018_organization_foundation.sql",
      "019_tenant_constraints.sql",
      "020_rls_prerequisites.sql",
    ]));
    const memberships = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'studio_organization_memberships'`,
    );
    expect(memberships.rows).toHaveLength(1);
  });
});
