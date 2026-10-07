import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { nowIso } from "@multi-agent/types";
import type {
  ProjectRepository,
  StudioStore,
  WorkspaceRepoAvailability,
  WorkspaceRepositoryState,
} from "../../../../../src/studio/contracts";
import {
  ensureWorkspaceRepoDir,
  getWorkspaceStorageRoot,
  resolveWorkspaceRepoPath,
} from "../../../../../src/studio/infrastructure/workspace-storage";
import { ensureWorkspaceRepoDurableState, markWorkspaceRepoDirty } from "./workspaceRepoStateService";

const execFileAsync = promisify(execFile);

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || Boolean(process.env.JEST_WORKER_ID);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
}

function classifyGitError(error: unknown): WorkspaceRepoAvailability {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("not found")
    || lower.includes("could not find remote")
    || lower.includes("pathspec")
    || lower.includes("did not match any file")
    || lower.includes("unknown revision")
    || lower.includes("invalid reference")
  ) {
    return "branch_missing";
  }
  return "unavailable";
}

export async function listChangedFiles(absoluteRepoPath: string): Promise<string[]> {
  if (!(await pathExists(join(absoluteRepoPath, ".git")))) return [];
  try {
    const { stdout } = await runGit(absoluteRepoPath, ["status", "--porcelain", "-uall"]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function probeWorkingCopyDirty(absoluteRepoPath: string): Promise<boolean> {
  const files = await listChangedFiles(absoluteRepoPath);
  return files.length > 0;
}

/**
 * Clone/fetch + checkout into STUDIO_WORKSPACE_STORAGE_ROOT and update repo-state metadata.
 * Missing storage root or git failures update availability without discarding files.
 */
export async function syncWorkspaceRepoWorkingCopy(
  store: StudioStore,
  params: {
    tenantId: string;
    projectId: string;
    workspaceId: string | null;
    repository: ProjectRepository;
    branch: string;
  },
): Promise<WorkspaceRepositoryState> {
  const base = await ensureWorkspaceRepoDurableState(store, {
    tenantId: params.tenantId,
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    projectRepositoryId: params.repository.id,
    branch: params.branch,
  });

  let absolutePath: string;
  try {
    absolutePath = await ensureWorkspaceRepoDir({
      tenantId: params.tenantId,
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      repoId: params.repository.id,
    });
  } catch {
    return store.saveWorkspaceRepoState({
      ...base,
      availability: "unavailable",
      updatedAt: nowIso(),
    });
  }

  if (isTestEnv()) {
    await mkdir(absolutePath, { recursive: true });
    return store.saveWorkspaceRepoState({
      ...base,
      branch: params.branch,
      availability: "ready",
      hasUncommittedChanges: false,
      updatedAt: nowIso(),
    });
  }

  const source = params.repository.source.trim();
  const branch = params.branch.trim() || params.repository.defaultBranch;
  let availability: WorkspaceRepoAvailability = "ready";

  try {
    const gitDir = join(absolutePath, ".git");
    if (!(await pathExists(gitDir))) {
      await runGit(absolutePath, ["clone", "--branch", branch, "--single-branch", source, "."]);
    } else {
      try {
        await runGit(absolutePath, ["remote", "set-url", "origin", source]);
      } catch {
        // ignore if origin missing; fetch may still work via configured remotes
      }
      await runGit(absolutePath, ["fetch", "--prune", "origin"]);
      try {
        await runGit(absolutePath, ["checkout", branch]);
      } catch {
        await runGit(absolutePath, ["checkout", "-B", branch, `origin/${branch}`]);
      }
    }
  } catch (error) {
    availability = classifyGitError(error);
  }

  const dirty = availability === "ready" ? await probeWorkingCopyDirty(absolutePath) : base.hasUncommittedChanges;

  return store.saveWorkspaceRepoState({
    ...base,
    branch,
    availability,
    hasUncommittedChanges: dirty,
    updatedAt: nowIso(),
  });
}

/** Ensure every membership (or default-workspace project repo) has a durable copy + availability. */
export async function syncTaskWorkspaceWorkingCopies(
  store: StudioStore,
  params: {
    tenantId: string;
    projectId: string;
    workspaceId: string | null;
    principal?: { tenantId: string; userId: string };
  },
): Promise<{ states: WorkspaceRepositoryState[]; primaryPath: string | null }> {
  let storageConfigured = true;
  try {
    getWorkspaceStorageRoot();
  } catch {
    storageConfigured = false;
  }

  const principal = params.principal;
  const activeRepos = (await store.listProjectRepositories(params.projectId, principal))
    .filter((repo) => repo.status === "active");

  let memberships: Array<{ projectRepositoryId: string; branch: string }> = [];
  if (params.workspaceId) {
    const wsRepos = await store.listWorkspaceRepositories(params.workspaceId, principal);
    memberships = wsRepos.map((m) => ({
      projectRepositoryId: m.projectRepositoryId,
      branch: m.branch,
    }));
  } else {
    memberships = activeRepos.map((repo) => ({
      projectRepositoryId: repo.id,
      branch: repo.defaultBranch,
    }));
  }

  const byId = new Map(activeRepos.map((repo) => [repo.id, repo]));
  const states: WorkspaceRepositoryState[] = [];
  let primaryPath: string | null = null;

  for (const membership of memberships) {
    const repository = byId.get(membership.projectRepositoryId);
    if (!repository) continue;

    if (!storageConfigured) {
      states.push(
        await ensureWorkspaceRepoDurableState(store, {
          tenantId: params.tenantId,
          projectId: params.projectId,
          workspaceId: params.workspaceId,
          projectRepositoryId: repository.id,
          branch: membership.branch,
          availability: "unavailable",
        }),
      );
      continue;
    }

    const state = await syncWorkspaceRepoWorkingCopy(store, {
      tenantId: params.tenantId,
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      repository,
      branch: membership.branch,
    });
    states.push(state);
    if (!primaryPath && state.availability === "ready") {
      try {
        primaryPath = resolveWorkspaceRepoPath({
          tenantId: params.tenantId,
          projectId: params.projectId,
          workspaceId: params.workspaceId,
          repoId: repository.id,
        });
      } catch {
        primaryPath = null;
      }
    }
  }

  return { states, primaryPath };
}

/** Refresh dirty flag + changed-file list for dashboard display. */
export async function refreshWorkspaceRepoInventory(
  store: StudioStore,
  params: {
    tenantId: string;
    projectId: string;
    workspaceId: string | null;
    projectRepositoryId: string;
    branch: string;
  },
): Promise<{ state: WorkspaceRepositoryState; changedFiles: string[] }> {
  let absolutePath: string | null = null;
  try {
    absolutePath = resolveWorkspaceRepoPath({
      tenantId: params.tenantId,
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      repoId: params.projectRepositoryId,
    });
  } catch {
    const state = await ensureWorkspaceRepoDurableState(store, {
      ...params,
      availability: "unavailable",
    });
    return { state, changedFiles: [] };
  }

  const changedFiles = await listChangedFiles(absolutePath);
  const dirty = changedFiles.length > 0;
  const state = await markWorkspaceRepoDirty(store, {
    ...params,
    dirty,
  });
  return { state, changedFiles };
}

function listCliWorkspaceRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CLI_AGENT_WORKSPACE_ROOTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const absolute = resolve(candidate);
  const absoluteRoot = resolve(root);
  const rootWithSep = absoluteRoot.endsWith(sep) ? absoluteRoot : absoluteRoot + sep;
  return absolute === absoluteRoot || absolute.startsWith(rootWithSep);
}

function safePathSegment(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("..") || /[/\\:\0]/.test(trimmed)) return fallback;
  return trimmed;
}

/**
 * Resolve an absolute cwd for task/agent execution.
 * Prefers a synced repo working copy; otherwise creates a task-scoped directory
 * under STUDIO_WORKSPACE_STORAGE_ROOT or CLI_AGENT_WORKSPACE_ROOTS so CLI agents
 * always have a valid workspaceRoot (FR-019 isolation).
 */
export async function resolveTaskExecutionWorkspaceRoot(params: {
  tenantId: string;
  projectId: string;
  workspaceId: string | null;
  preferredPath?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const env = params.env ?? process.env;
  const allowedRoots = listCliWorkspaceRoots(env);

  const candidates: string[] = [];
  if (params.preferredPath && isAbsolute(params.preferredPath)) {
    candidates.push(resolve(params.preferredPath));
  }

  try {
    const storagePath = await ensureWorkspaceRepoDir({
      tenantId: params.tenantId,
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      repoId: "_workspace",
    }, env);
    candidates.push(storagePath);
  } catch {
    // Storage root unset — fall through to CLI roots.
  }

  if (allowedRoots.length > 0) {
    const relative = [
      safePathSegment(params.tenantId, "tenant"),
      safePathSegment(params.projectId, "project"),
      params.workspaceId ? safePathSegment(params.workspaceId, "workspace") : "default",
      "_workspace",
    ];
    candidates.push(normalize(join(allowedRoots[0], ...relative)));
  }

  for (const candidate of candidates) {
    if (allowedRoots.length > 0 && !allowedRoots.some((root) => isPathInsideRoot(candidate, root))) {
      continue;
    }
    try {
      await mkdir(candidate, { recursive: true });
      return candidate;
    } catch {
      // try next candidate
    }
  }

  // Last resort when allowlist is empty (dev): still provide an absolute dir if we have any candidate.
  if (allowedRoots.length === 0) {
    for (const candidate of candidates) {
      try {
        await mkdir(candidate, { recursive: true });
        return candidate;
      } catch {
        // continue
      }
    }
  }

  return null;
}
