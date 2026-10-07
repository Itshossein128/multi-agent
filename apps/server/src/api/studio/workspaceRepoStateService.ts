import { nowIso } from "@multi-agent/types";
import type {
  StudioStore,
  WorkspaceRepoAvailability,
  WorkspaceRepositoryState,
} from "../../../../../src/studio/contracts";
import {
  ensureWorkspaceRepoDir,
  workspaceRepoRelativePath,
} from "../../../../../src/studio/infrastructure/workspace-storage";

/**
 * Ensure durable workspace-repo metadata (and on-disk dir when storage root is set).
 * Missing STUDIO_WORKSPACE_STORAGE_ROOT must not break list/create APIs.
 */
export async function ensureWorkspaceRepoDurableState(
  store: StudioStore,
  params: {
    tenantId: string;
    projectId: string;
    workspaceId: string | null;
    projectRepositoryId: string;
    branch: string;
    availability?: WorkspaceRepoAvailability;
  },
): Promise<WorkspaceRepositoryState> {
  const storagePath = workspaceRepoRelativePath({
    tenantId: params.tenantId,
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    repoId: params.projectRepositoryId,
  });

  try {
    await ensureWorkspaceRepoDir({
      tenantId: params.tenantId,
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      repoId: params.projectRepositoryId,
    });
  } catch {
    // Storage root unset or path errors — still persist relative metadata.
  }

  const existing = (
    await store.listWorkspaceRepoStates({
      tenantId: params.tenantId,
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      projectRepositoryId: params.projectRepositoryId,
    })
  )[0];

  return store.saveWorkspaceRepoState({
    tenantId: params.tenantId,
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    projectRepositoryId: params.projectRepositoryId,
    branch: params.branch,
    storagePath,
    hasUncommittedChanges: existing?.hasUncommittedChanges ?? false,
    availability: params.availability ?? existing?.availability ?? "ready",
    updatedAt: nowIso(),
  });
}

/** Mark a workspace repo working copy dirty (uncommitted local changes). */
export async function markWorkspaceRepoDirty(
  store: StudioStore,
  params: {
    tenantId: string;
    projectId: string;
    workspaceId: string | null;
    projectRepositoryId: string;
    branch: string;
    dirty?: boolean;
    availability?: WorkspaceRepoAvailability;
  },
): Promise<WorkspaceRepositoryState> {
  const base = await ensureWorkspaceRepoDurableState(store, params);
  return store.saveWorkspaceRepoState({
    ...base,
    hasUncommittedChanges: params.dirty !== false,
    availability: params.availability ?? base.availability,
    updatedAt: nowIso(),
  });
}
