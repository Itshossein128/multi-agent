import type { PgPool } from "../../memory/infrastructure";

export type PrincipalKind = "user" | "service";

export type OrganizationDbClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * Run organization-scoped work with SET LOCAL app.tenant_id / app.principal_kind.
 * Uses a dedicated transaction so GUCs restore on commit/rollback.
 */
export async function withOrganization<T>(
  pool: PgPool,
  organizationId: string,
  principalKind: PrincipalKind,
  fn: (client: OrganizationDbClient) => Promise<T>,
): Promise<T> {
  if (!organizationId?.trim()) throw new Error("organizationId is required for withOrganization");
  if (principalKind !== "user" && principalKind !== "service") {
    throw new Error("principalKind must be 'user' or 'service'");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [organizationId]);
    await client.query("SELECT set_config('app.principal_kind', $1, true)", [principalKind]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* preserve original */
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Read current GUCs (for tests). */
export async function readOrganizationGucs(client: OrganizationDbClient): Promise<{
  tenantId: string | null;
  principalKind: string | null;
}> {
  const result = await client.query(
    `SELECT current_setting('app.tenant_id', true) AS tenant_id,
            current_setting('app.principal_kind', true) AS principal_kind`,
  );
  const row = result.rows[0] ?? {};
  return {
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
    principalKind: row.principal_kind ? String(row.principal_kind) : null,
  };
}
