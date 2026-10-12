import type { RequestPrincipal } from './principal';
import { requirePermission } from './authorization';

type CredentialResource = { configuration?: unknown; backend?: unknown };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Check both the current and proposed resource: clearing a binding is management too. */
export function requireCredentialMutationPermission(principal: RequestPrincipal, ...resources: Array<CredentialResource | null | undefined>): void {
  const bound = resources.some(resource => {
    const configuration = object(resource?.configuration), backend = object(resource?.backend);
    return configuration?.connection !== undefined || configuration?.server !== undefined || backend?.credentialAlias !== undefined;
  });
  if (bound) requirePermission({ permissions: principal.permissions ?? [] }, 'credentials.manage');
}
