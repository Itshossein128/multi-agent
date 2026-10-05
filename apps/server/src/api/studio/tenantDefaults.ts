import { nowIso, uid } from "@multi-agent/types";
import type { RequestPrincipal } from "../../auth/principal";
import type { StudioStore } from "../../../../../src/studio/contracts";

export interface TenantDefaults {
  workspaceId: string;
  projectId: string;
}

/** Ensure the tenant has at least one active workspace and project; return their ids. */
export async function ensureTenantProjectWorkspaceDefaults(
  store: StudioStore,
  principal: RequestPrincipal,
): Promise<TenantDefaults> {
  const [activeWorkspaces, activeProjects] = await Promise.all([
    store.listWorkspaces(principal, "active"),
    store.listProjects(principal, "active"),
  ]);

  let workspaceId = activeWorkspaces[0]?.id;
  if (!workspaceId) {
    const stamp = nowIso();
    const created = await store.saveWorkspace({
      id: uid("workspace"),
      tenantId: principal.tenantId,
      name: "Default Workspace",
      description: "",
      status: "active",
      settings: {},
      createdAt: stamp,
      updatedAt: stamp,
      ownerId: principal.userId,
    }, principal);
    workspaceId = created.id;
  }

  let projectId = activeProjects[0]?.id;
  if (!projectId) {
    const stamp = nowIso();
    const created = await store.saveProject({
      id: uid("project"),
      tenantId: principal.tenantId,
      name: "Default Project",
      description: "",
      status: "active",
      settings: {},
      createdAt: stamp,
      updatedAt: stamp,
      ownerId: principal.userId,
    }, principal);
    projectId = created.id;
  }

  return { workspaceId, projectId };
}
