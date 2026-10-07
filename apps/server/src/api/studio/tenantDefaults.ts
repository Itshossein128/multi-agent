import type { RequestPrincipal } from "../../auth/principal";
import type { StudioStore } from "../../../../../src/studio/contracts";

export interface TenantProjectDefault {
  projectId: string;
}

/**
 * Resolve an existing active project for the tenant without creating peer
 * "Default Project" / "Default Workspace" entities (hierarchy 006).
 * Returns null when the tenant has no active projects yet.
 */
export async function findActiveTenantProjectId(
  store: StudioStore,
  principal: RequestPrincipal,
): Promise<string | null> {
  const activeProjects = await store.listProjects(principal, "active");
  return activeProjects[0]?.id ?? null;
}

/**
 * @deprecated Prefer findActiveTenantProjectId. Kept as a thin wrapper for
 * call sites that previously ensured peer defaults; no longer creates entities.
 */
export async function ensureTenantProjectWorkspaceDefaults(
  store: StudioStore,
  principal: RequestPrincipal,
): Promise<TenantProjectDefault> {
  const projectId = await findActiveTenantProjectId(store, principal);
  if (!projectId) {
    throw new Error(
      "No active project in this organization; create a project before continuing",
    );
  }
  return { projectId };
}
