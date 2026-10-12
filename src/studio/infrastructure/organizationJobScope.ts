import { AsyncLocalStorage } from "node:async_hooks";
import type { PgPool } from "../../memory/infrastructure";
import {
  withOrganization,
  type OrganizationDbClient,
  type PrincipalKind,
} from "./withOrganization";

/**
 * Ambient organization context for background/out-of-request work.
 *
 * Every background item (trigger outbox event, routine tick, heartbeat,
 * durable memory job) executes inside exactly one organization scope that is
 * derived from the item's own `tenant_id` — never from process state. INV-7:
 * workers may claim across organizations but execute strictly within the
 * organization recorded on the item.
 */
export interface OrganizationScope {
  organizationId: string;
  principalKind: PrincipalKind;
  /** Which subsystem opened the scope (e.g. `trigger_outbox`, `routine`). */
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

const storage = new AsyncLocalStorage<OrganizationScope>();

export function currentOrganizationScope(): OrganizationScope | undefined {
  return storage.getStore();
}

export interface OrganizationScopeInput {
  organizationId: string;
  source: string;
  principalKind?: PrincipalKind;
}

/** Run `fn` with an ambient organization scope. Throws on empty organization id. */
export function runInOrganizationScope<T>(scope: OrganizationScopeInput, fn: () => Promise<T>): Promise<T> {
  const organizationId = scope.organizationId?.trim();
  if (!organizationId) throw new OrganizationScopeError("organizationId is required for an organization scope");
  const principalKind: PrincipalKind = scope.principalKind ?? "service";
  return storage.run({ organizationId, principalKind, source: scope.source }, fn);
}

/**
 * Per-item assertion: work claimed for organization X must observe exactly
 * organization X as its ambient scope. Fails closed when no scope is active.
 */
export function assertOrganizationScope(organizationId: string): void {
  const expected = organizationId?.trim();
  if (!expected) throw new OrganizationScopeError("organizationId is required for the organization scope assertion");
  const scope = storage.getStore();
  if (!scope) {
    throw new OrganizationScopeError(`No organization scope is active; expected ${expected}`);
  }
  if (scope.organizationId !== expected) {
    throw new OrganizationScopeError(
      `Organization scope mismatch: expected ${expected}, active ${scope.organizationId} (${scope.source})`,
    );
  }
}

/**
 * True when a store may reuse the scoped client for this pool. Prevents a
 * store bound to a different pool from borrowing another scope's connection.
 */
export function scopedDbClient(pool: unknown): OrganizationDbClient | undefined {
  const scope = storage.getStore();
  if (!scope?.client || scope.pool !== pool) return undefined;
  return scope.client;
}

export type OrganizationScopeRunner = <T>(
  scope: OrganizationScopeInput,
  fn: () => Promise<T>,
) => Promise<T>;

/** Default runner: ambient scope only (in-memory stores, unit tests). */
export const asyncLocalOrganizationScopeRunner: OrganizationScopeRunner = (scope, fn) =>
  runInOrganizationScope(scope, fn);

/**
 * PostgreSQL runner: opens a dedicated transaction with
 * `SET LOCAL app.tenant_id` / `app.principal_kind` (RLS prerequisites) and
 * exposes the same scope to store code so queries issued for the item run on
 * that connection.
 */
export function createPgOrganizationScopeRunner(pool: PgPool): OrganizationScopeRunner {
  return async <T>(scope: OrganizationScopeInput, fn: () => Promise<T>): Promise<T> => {
    const organizationId = scope.organizationId?.trim();
    if (!organizationId) throw new OrganizationScopeError("organizationId is required for an organization scope");
    const principalKind: PrincipalKind = scope.principalKind ?? "service";
    return withOrganization(pool, organizationId, principalKind, (client) =>
      storage.run(
        { organizationId, principalKind, source: scope.source, client, pool },
        () => fn(),
      ),
    );
  };
}
