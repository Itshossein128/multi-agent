import type { PgPool } from "../../memory/infrastructure";
import {
  withOrganization,
  type OrganizationDbClient,
  type PrincipalKind,
  type OrganizationScope,
  OrganizationScopeError,
  organizationStorage,
  currentOrganizationScope,
  scopedDbClient,
} from "./withOrganization";

export type { OrganizationDbClient, PrincipalKind, OrganizationScope };
export { OrganizationScopeError, currentOrganizationScope, scopedDbClient };

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
  return organizationStorage.run({ organizationId, principalKind, source: scope.source }, fn);
}

/**
 * Per-item assertion: work claimed for organization X must observe exactly
 * organization X as its ambient scope. Fails closed when no scope is active.
 */
export function assertOrganizationScope(organizationId: string): void {
  const expected = organizationId?.trim();
  if (!expected) throw new OrganizationScopeError("organizationId is required for the organization scope assertion");
  const scope = organizationStorage.getStore();
  if (!scope) {
    throw new OrganizationScopeError(`No organization scope is active; expected ${expected}`);
  }
  if (scope.organizationId !== expected) {
    throw new OrganizationScopeError(
      `Organization scope mismatch: expected ${expected}, active ${scope.organizationId} (${scope.source})`,
    );
  }
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
    return withOrganization(pool, organizationId, principalKind, () => fn(), { source: scope.source });
  };
}
