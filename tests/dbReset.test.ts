import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { CONFIRM_FLAG, countRows, resetApplicationData } from "../scripts/db-reset";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)("db reset operator command", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let storageRoot: string;

  beforeEach(async () => {
    schema = `db_reset_${randomUUID().replace(/-/g, "")}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
    storageRoot = mkdtempSync(join(tmpdir(), "studio-ws-"));
    mkdirSync(join(storageRoot, "tenant-a"), { recursive: true });
    writeFileSync(join(storageRoot, "tenant-a", "file.txt"), "x");
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("refuses without confirmation flag and leaves rows intact", async () => {
    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, tenant_id, status)
       VALUES ('u1', 'u1@example.com', 'hash', NULL, 'active')`,
    );
    await expect(
      resetApplicationData(pool, {
        confirm: false,
        skipRunningCheck: true,
        workspaceStorageRoot: storageRoot,
      }),
    ).rejects.toThrow(CONFIRM_FLAG);
    expect(await countRows(pool, "studio_users")).toBe(1);
    expect(existsSync(join(storageRoot, "tenant-a", "file.txt"))).toBe(true);
  });

  it("with confirmation truncates data tables, keeps migration ledger, clears workspace files", async () => {
    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, tenant_id, status)
       VALUES ('u1', 'u1@example.com', 'hash', NULL, 'active')`,
    );
    const ledgerBefore = await countRows(pool, "studio_migrations");
    expect(ledgerBefore).toBeGreaterThan(0);

    const result = await resetApplicationData(pool, {
      confirm: true,
      skipRunningCheck: true,
      workspaceStorageRoot: storageRoot,
    });
    expect(result.truncated.length).toBeGreaterThan(0);
    expect(await countRows(pool, "studio_users")).toBe(0);
    expect(await countRows(pool, "studio_migrations")).toBe(ledgerBefore);
    expect(readdirSync(storageRoot)).toEqual([]);
  });

  it("also removes durable LangGraph checkpoint data while keeping its migration ledger", async () => {
    await pool.query("INSERT INTO studio_deleted_organizations (id) VALUES ('old-deleted-org')");
    for (const table of ['checkpoints', 'checkpoint_blobs', 'checkpoint_writes', 'checkpoint_migrations']) {
      await pool.query(`CREATE TABLE ${table} (id text PRIMARY KEY)`);
      await pool.query(`INSERT INTO ${table} VALUES ('old')`);
    }
    await resetApplicationData(pool, { confirm: true, skipRunningCheck: true });
    for (const table of ['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']) {
      expect(await countRows(pool, table)).toBe(0);
    }
    expect(await countRows(pool, 'checkpoint_migrations')).toBe(1);
    expect(await countRows(pool, 'studio_deleted_organizations')).toBe(0);
  });
});
