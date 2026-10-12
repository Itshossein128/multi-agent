import type {
  ApiCredentialRequest,
  ApiProviderCredentialResolver,
} from "../../../../src/security/providerCredentials";
import { OrganizationAccessRevokedError } from "./runOrganizationAccess";

export interface RunAccessCheckInput {
  runId: string;
  tenantId?: string;
}

export type RunAccessChecker = (input: RunAccessCheckInput) => Promise<void>;

/**
 * Credential-lease checkpoint (D-5): a lease may only be issued when the run
 * still exists, its initiator still has organization access, and the requested
 * tenant equals the run's organization. Installed once at composition time so
 * every broker lease issued during agent execution passes through it.
 */
export class RunAccessCheckpoint {
  private checker?: RunAccessChecker;

  install(checker: RunAccessChecker): void {
    this.checker = checker;
  }

  uninstall(): void {
    this.checker = undefined;
  }

  async assert(input: RunAccessCheckInput): Promise<void> {
    if (!this.checker) return;
    await this.checker(input);
  }
}

/** Wrap the API credential resolver so no lease is issued outside the checkpoint. */
export function checkpointedApiCredentials(
  base: ApiProviderCredentialResolver,
  checkpoint: RunAccessCheckpoint,
): ApiProviderCredentialResolver {
  return {
    async resolve(request: ApiCredentialRequest): Promise<string | undefined> {
      await checkpoint.assert({ runId: request.runId, tenantId: request.tenantId });
      return base.resolve(request);
    },
  };
}

/** Fail closed when the run is unknown or belongs to another organization. */
export function assertRunAccessTenant(runTenantId: string | undefined, requestedTenantId: string | undefined): void {
  if (!requestedTenantId) return;
  if (!runTenantId || runTenantId !== requestedTenantId) {
    throw new OrganizationAccessRevokedError(
      "run_not_found",
      `credential tenant ${requestedTenantId} does not match run organization ${runTenantId ?? "unknown"}`,
    );
  }
}
