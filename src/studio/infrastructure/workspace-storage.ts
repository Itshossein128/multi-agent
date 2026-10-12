import { mkdir } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

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

/** Thrown when a workspace path cannot be proven to belong to an organization. */
export class WorkspacePathOrganizationError extends Error {
  readonly code = "WORKSPACE_ORGANIZATION_MISMATCH";
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathOrganizationError";
  }
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const absolute = resolve(candidate);
  const absoluteRoot = resolve(root);
  const rootWithSep = absoluteRoot.endsWith(sep) ? absoluteRoot : absoluteRoot + sep;
  return absolute === absoluteRoot || absolute.startsWith(rootWithSep);
}

/** Configured workspace roots: the storage root plus optional CLI agent roots. */
export function workspaceStorageRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = [];
  try {
    roots.push(getWorkspaceStorageRoot(env));
  } catch {
    // storage root not configured
  }
  for (const entry of (env.CLI_AGENT_WORKSPACE_ROOTS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
    roots.push(resolve(entry));
  }
  return roots;
}

/**
 * T-11 / US3: a workspace path may only be used for the organization whose
 * prefix it carries (`{root}/{organizationId}/…`). Rejects traversal, foreign
 * organization prefixes and paths outside every configured root.
 */
export function assertWorkspacePathBelongsToOrganization(
  absolutePath: string,
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const organization = organizationId.trim();
  if (!organization) throw new WorkspacePathOrganizationError("organizationId is required for workspace path validation");
  const candidate = resolve(absolutePath);
  const roots = workspaceStorageRoots(env);
  const containing = roots.find((root) => isPathInsideRoot(candidate, root));
  if (!containing) {
    throw new WorkspacePathOrganizationError(`Workspace path escapes the configured workspace roots: ${candidate}`);
  }
  const relativePath = relative(containing, candidate);
  const [segment] = relativePath.split(sep).filter(Boolean);
  if (segment !== organization) {
    throw new WorkspacePathOrganizationError(
      `Workspace path belongs to organization "${segment ?? "unknown"}" instead of "${organization}"`,
    );
  }
}

/** True when the path is proven to live under the organization's prefix. */
export function workspacePathBelongsToOrganization(
  absolutePath: string,
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    assertWorkspacePathBelongsToOrganization(absolutePath, organizationId, env);
    return true;
  } catch {
    return false;
  }
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
