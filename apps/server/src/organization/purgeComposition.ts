import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { workspaceStorageRoots } from "../../../../src/studio/infrastructure/workspace-storage";
import { OrganizationPurgeWorker, type OrganizationPurgeDependencies } from "./organizationPurgeWorker";

/** Shared by the real server and its composed lifecycle integration tests. */
export function createOrganizationPurgeWorker(
  deps: Omit<OrganizationPurgeDependencies, "memoryStore" | "workspaceStorageRoot" | "workspaceCleanup"> & {
    memory: { purgeTenantMemories(tenantId: string): Promise<void> };
  },
  env: Readonly<Record<string, string | undefined>> = process.env,
): OrganizationPurgeWorker {
  const roots = workspaceStorageRoots({ ...env });
  return new OrganizationPurgeWorker({ ...deps,
    memoryStore: { deleteTenantMemories: tenantId => deps.memory.purgeTenantMemories(tenantId) },
    workspaceCleanup: async tenantId => {
      if (!tenantId || /[\\/\0]/.test(tenantId) || tenantId === "." || tenantId === "..") throw new Error("Invalid organization workspace segment");
      for (const configured of roots) {
        const root = resolve(configured), tenantRoot = resolve(root, tenantId);
        if (dirname(tenantRoot) !== root) throw new Error("Invalid organization workspace path");
        await rm(tenantRoot, { recursive: true, force: true });
      }
    },
  });
}
