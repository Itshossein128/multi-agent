"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOwner = isOwner;
exports.isSameTenant = isSameTenant;
exports.isSystemResource = isSystemResource;
exports.authorizePersonalResource = authorizePersonalResource;
exports.authorizeTenantResource = authorizeTenantResource;
exports.authorizeToolOrAgent = authorizeToolOrAgent;
/**
 * Returns true if the principal is the explicit owner and matches the tenant.
 * Used for personal resources: Workflows, Runs, personal Tools/Agents.
 */
function isOwner(principal, resource) {
    if (!principal?.userId || !principal?.tenantId)
        return false;
    if (!resource?.ownerId || !resource?.tenantId)
        return false;
    return resource.tenantId === principal.tenantId && resource.ownerId === principal.userId;
}
/**
 * Returns true if the resource belongs to the principal's tenant.
 * Used for tenant-scoped resources: Tasks, shared Tools/Agents.
 */
function isSameTenant(principal, resource) {
    if (!principal?.tenantId)
        return false;
    if (!resource?.tenantId)
        return false;
    return resource.tenantId === principal.tenantId;
}
/**
 * Returns true if the resource is an explicitly designated global/system resource.
 */
function isSystemResource(resource) {
    return resource?.isSystem === true;
}
/**
 * Authorize personal resources (Workflows, Runs, child events/approvals).
 * Must match both tenantId and ownerId. Legacy/ownerless records fail closed.
 */
function authorizePersonalResource(principal, resource) {
    return isOwner(principal, resource);
}
/**
 * Authorize tenant-scoped resources (Tasks).
 * Must match tenantId. Legacy/un-tenanted records fail closed.
 */
function authorizeTenantResource(principal, resource) {
    return isSameTenant(principal, resource);
}
/**
 * Authorize tools or agents, which may be personal, tenant-scoped, or global system resources.
 * - Global system resources: read and execute allowed for any authenticated principal; mutations denied.
 * - Personal resources (has ownerId): only owner in same tenant can read, execute, or mutate.
 * - Tenant-scoped resources (has tenantId, no ownerId): any user in tenant can read, execute, or mutate.
 * - Legacy / unowned: fail closed.
 */
function authorizeToolOrAgent(principal, resource, operation) {
    if (!principal?.userId || !principal?.tenantId || !resource)
        return false;
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
//# sourceMappingURL=authorization.js.map