// Identity resolution — who is the caller?
export type { RequestPrincipal } from "./principal";
export { resolveRequestPrincipal, INTERNAL_PRINCIPAL_HEADER } from "./principal";

// Authorization — what can the caller do?
export type { PrincipalResolver, ResourceOwnership, ResourceOperation } from "./authorization";
export { isOwner, isSameTenant, isSystemResource, authorizePersonalResource, authorizeTenantResource, authorizeToolOrAgent } from "./authorization";
