import { mkdir } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

const DEFAULT_SEGMENT = "default";

function requireSafeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error(`${label} contains illegal path characters`);
  }
  return trimmed;
}

/** Resolve STUDIO_WORKSPACE_STORAGE_ROOT (absolute) or throw. */
export function getWorkspaceStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.STUDIO_WORKSPACE_STORAGE_ROOT?.trim();
  if (!raw) {
    throw new Error("STUDIO_WORKSPACE_STORAGE_ROOT is not configured");
  }
  const root = resolve(raw);
  if (!isAbsolute(root)) {
    throw new Error("STUDIO_WORKSPACE_STORAGE_ROOT must be an absolute path");
  }
  return root;
}

/**
 * Relative storage path: `{tenantId}/{projectId}/{workspaceId|default}/{repoId}/`
 */
export function workspaceRepoRelativePath(params: {
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  repoId: string;
}): string {
  const tenantId = requireSafeSegment(params.tenantId, "tenantId");
  const projectId = requireSafeSegment(params.projectId, "projectId");
  const workspaceKey = params.workspaceId
    ? requireSafeSegment(params.workspaceId, "workspaceId")
    : DEFAULT_SEGMENT;
  const repoId = requireSafeSegment(params.repoId, "repoId");
  return [tenantId, projectId, workspaceKey, repoId].join("/");
}

/** Absolute directory for a workspace repository working copy. */
export function resolveWorkspaceRepoPath(
  params: {
    tenantId: string;
    projectId: string;
    workspaceId?: string | null;
    repoId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = getWorkspaceStorageRoot(env);
  const relative = workspaceRepoRelativePath(params);
  const absolute = normalize(join(root, ...relative.split("/")));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    throw new Error("Resolved workspace path escapes STUDIO_WORKSPACE_STORAGE_ROOT");
  }
  return absolute;
}

/** Ensure the working-copy directory exists; returns the absolute path. */
export async function ensureWorkspaceRepoDir(
  params: {
    tenantId: string;
    projectId: string;
    workspaceId?: string | null;
    repoId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const absolute = resolveWorkspaceRepoPath(params, env);
  await mkdir(absolute, { recursive: true });
  return absolute;
}
