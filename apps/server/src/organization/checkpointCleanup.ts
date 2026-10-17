import type { PgPool } from "../../../../src/memory/infrastructure";

/** The saver creates its tables after Studio migrations, using its own DB login. */
export async function prepareOrganizationCheckpoints(pool: PgPool, schema = "public"): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error("Invalid checkpoint schema");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${schema}:checkpoint-cleanup-setup`]);
    for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) {
      await client.query(`GRANT SELECT(thread_id), DELETE ON "${schema}".${table} TO studio_worker`);
      const existing = await client.query("SELECT 1 FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname='studio_checkpoint_fence'", [`${schema}.${table}`]);
      if (!existing.rows.length) {
        await client.query(`CREATE TRIGGER studio_checkpoint_fence BEFORE INSERT OR UPDATE ON "${schema}".${table} FOR EACH ROW EXECUTE FUNCTION "${schema}".studio_fence_checkpoint_write()`);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
