import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { PgPool } from "../../memory/infrastructure";

export type PrincipalKind = "user" | "service";

export type OrganizationDbClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };

export interface OrganizationScope {
  organizationId: string;
  principalKind: PrincipalKind;
  /** Which subsystem opened the scope (e.g. `trigger_outbox`, `routine`, `withOrganization`). */
  source: string;
  /** Set when the scope also owns a PostgreSQL transaction (RLS GUCs). */
  client?: OrganizationDbClient;
  /** Pool the scoped client belongs to, so stores never reuse a foreign client. */
  pool?: unknown;
}

export class OrganizationScopeError extends Error {
  readonly code = "ORGANIZATION_SCOPE_MISMATCH";
  constructor(message: string) {
    super(message);
    this.name = "OrganizationScopeError";
  }
}

export const organizationStorage = new AsyncLocalStorage<OrganizationScope | undefined>();

export function currentOrganizationScope(): OrganizationScope | undefined {
  return organizationStorage.getStore();
}

/**
 * True when a store may reuse the scoped client for this pool. Prevents a
 * store bound to a different pool from borrowing another scope's connection.
 */
export function scopedDbClient(pool: unknown): OrganizationDbClient | undefined {
  const scope = organizationStorage.getStore();
  if (!scope?.client || scope.pool !== pool) return undefined;
  return scope.client;
}

/**
 * Run organization-scoped work with SET LOCAL app.tenant_id / app.principal_kind.
 * Uses a dedicated transaction so GUCs restore on commit/rollback.
 * Reuses ambient transactions for the same organization via SAVEPOINT to prevent
 * connection leakage and nested-transaction aborts.
 */
export async function withOrganization<T>(
  pool: PgPool,
  organizationId: string,
  principalKind: PrincipalKind,
  fn: (client: OrganizationDbClient) => Promise<T>,
  options?: { source?: string },
): Promise<T> {
  if (!organizationId?.trim()) throw new Error("organizationId is required for withOrganization");
  if (principalKind !== "user" && principalKind !== "service") {
    throw new Error("principalKind must be 'user' or 'service'");
  }

  const normalizedOrgId = organizationId.trim();
  const source = options?.source ?? "withOrganization";
  const activeScope = currentOrganizationScope();
  if (activeScope?.client && activeScope.pool === pool) {
    if (activeScope.organizationId === normalizedOrgId) {
      const sp = `with_org_${randomUUID().replace(/-/g, "")}`;
      await activeScope.client.query(`SAVEPOINT ${sp}`);
      try {
        const result = await fn(activeScope.client);
        await activeScope.client.query(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        try {
          await activeScope.client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        } catch {
          /* preserve original error */
        }
        throw err;
      }
    } else {
      throw new OrganizationScopeError(
        `Cross-organization nested scope is forbidden (active: ${activeScope.organizationId}, requested: ${normalizedOrgId})`,
      );
    }
  }

  const client = await pool.connect();
  const scope: OrganizationScope = { organizationId: normalizedOrgId, principalKind, source, client, pool };
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [normalizedOrgId]);
    await client.query("SELECT set_config('app.principal_kind', $1, true)", [principalKind]);
    const result = await organizationStorage.run(
      scope,
      () => fn(client),
    );
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
    // Async descendants retain this scope object after the request returns.
    // Revoke the borrowed transaction client before returning it to the pool.
    scope.client = undefined;
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
