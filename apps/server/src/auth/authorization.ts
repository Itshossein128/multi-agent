import type { RequestPrincipal } from "./principal";

export type PrincipalResolver = (request: Request) => RequestPrincipal | null | Promise<RequestPrincipal | null>;

export interface ResourceOwnership {
  ownerId?: string | null;
  tenantId?: string | null;
  isSystem?: boolean;
}

export type ResourceOperation = "read" | "write" | "delete" | "execute" | "cancel" | "resolve";

/**
 * Returns true if the principal is the explicit owner and matches the tenant.
 * Used for personal resources: Workflows, Runs, personal Tools/Agents.
 */
export function isOwner(
  principal: RequestPrincipal | null | undefined,
  resource: ResourceOwnership | null | undefined,
): boolean {
  if (!principal?.userId || !principal?.tenantId) return false;
  if (!resource?.ownerId || !resource?.tenantId) return false;
  return resource.tenantId === principal.tenantId && resource.ownerId === principal.userId;
}

/**
 * Returns true if the resource belongs to the principal's tenant.
 * Used for tenant-scoped resources: Tasks, shared Tools/Agents.
 */
export function isSameTenant(
  principal: RequestPrincipal | null | undefined,
  resource: ResourceOwnership | null | undefined,
): boolean {
  if (!principal?.tenantId) return false;
  if (!resource?.tenantId) return false;
  return resource.tenantId === principal.tenantId;
}

/**
 * Returns true if the resource is an explicitly designated global/system resource.
 */
export function isSystemResource(resource: ResourceOwnership | null | undefined): boolean {
  return resource?.isSystem === true;
}

/**
 * Authorize personal resources (Workflows, Runs, child events/approvals).
 * Must match both tenantId and ownerId. Legacy/ownerless records fail closed.
 */
export function authorizePersonalResource(
  principal: RequestPrincipal | null | undefined,
  resource: ResourceOwnership | null | undefined,
): boolean {
  return isOwner(principal, resource);
}

/**
 * Authorize tenant-scoped resources (Tasks).
 * Must match tenantId. Legacy/un-tenanted records fail closed.
 */
export function authorizeTenantResource(
  principal: RequestPrincipal | null | undefined,
  resource: ResourceOwnership | null | undefined,
): boolean {
  return isSameTenant(principal, resource);
}

/**
 * Authorize tools or agents, which may be personal, tenant-scoped, or global system resources.
 * - Global system resources: read and execute allowed for any authenticated principal; mutations denied.
 * - Personal resources (has ownerId): only owner in same tenant can read, execute, or mutate.
 * - Tenant-scoped resources (has tenantId, no ownerId): any user in tenant can read, execute, or mutate.
 * - Legacy / unowned: fail closed.
 */
export function authorizeToolOrAgent(
  principal: RequestPrincipal | null | undefined,
  resource: ResourceOwnership | null | undefined,
  operation: ResourceOperation,
): boolean {
  if (!principal?.userId || !principal?.tenantId || !resource) return false;
  if (isSystemResource(resource)) {
    // System resources can only be read or executed, never mutated or deleted by regular principals.
    return operation === "read" || operation === "execute";
  }
  if (resource.ownerId) {
    return isOwner(principal, resource);
  }
  if (resource.tenantId) {
    return isSameTenant(principal, resource);
  }
  // Legacy / unowned fails closed.
  return false;
}
