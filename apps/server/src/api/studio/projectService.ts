import { nowIso, uid } from "@multi-agent/types";
import type {
  ProjectRepository,
  StudioEntityStatusFilter,
  StudioProject,
  StudioStore,
  StudioTask,
  StudioWorkspace,
  WorkspaceRepositoryMembership,
} from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { requireResource } from "./resource";
import { ensureWorkspaceRepoDurableState } from "./workspaceRepoStateService";
import {
  refreshWorkspaceRepoInventory,
  syncWorkspaceRepoWorkingCopy,
} from "./workspaceWorkingCopyService";

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

function normalizeName(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "name must be a string");
  const name = value.trim();
  if (!name) throw new ApiError(400, "name is required");
  if (name.length > NAME_MAX) throw new ApiError(400, `name must be at most ${NAME_MAX} characters`);
  return name;
}

function normalizeDescription(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ApiError(400, "description must be a string");
  if (value.length > DESCRIPTION_MAX) throw new ApiError(400, `description must be at most ${DESCRIPTION_MAX} characters`);
  return value;
}

function normalizeSettings(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "settings must be an object");
  return value as Record<string, unknown>;
}

function parseStatusFilter(raw: string | undefined): StudioEntityStatusFilter {
  if (!raw || raw === "active") return "active";
  if (raw === "retired" || raw === "all") return raw;
  throw new ApiError(400, "status must be one of: active, retired, all");
}

function taskSummary(task: StudioTask) {
  return {
    id: task.id,
    tenantId: task.tenantId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    workspaceId: task.workspaceId ?? null,
    projectId: task.projectId,
  };
}

export function truncateDerivedName(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "Untitled";
  return trimmed.length > NAME_MAX ? trimmed.slice(0, NAME_MAX) : trimmed;
}

export function uniquifyName(base: string, taken: Iterable<string>): string {
  const occupied = new Set(
    [...taken].map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  const normalized = truncateDerivedName(base);
  if (!occupied.has(normalized.toLowerCase())) return normalized;
  let n = 2;
  for (;;) {
    const suffix = ` (${n})`;
    const maxBase = Math.max(1, NAME_MAX - suffix.length);
    const candidate = `${normalized.slice(0, maxBase)}${suffix}`;
    if (!occupied.has(candidate.toLowerCase())) return candidate;
    n += 1;
  }
}

export async function maybeDeriveProjectNameFromTask(
  store: StudioStore,
  projectId: string,
  taskTitle: string,
  principal: RequestPrincipal,
): Promise<void> {
  const current = await store.getProject(projectId, principal);
  if (!current || current.nameSource !== "placeholder") return;
  const peers = await store.listProjects(principal, "all");
  const taken = peers.filter((p) => p.id !== projectId).map((p) => p.name);
  const name = uniquifyName(taskTitle, taken);
  await store.claimPlaceholderProjectName(projectId, name, principal);
}

export async function maybeDeriveWorkspaceNameFromTask(
  store: StudioStore,
  workspaceId: string,
  taskTitle: string,
  principal: RequestPrincipal,
): Promise<void> {
  const current = await store.getWorkspace(workspaceId, principal);
  if (!current || current.nameSource !== "placeholder") return;
  const peers = await store.listWorkspacesByProject(current.projectId, principal, "all");
  const taken = peers.filter((w) => w.id !== workspaceId).map((w) => w.name);
  const name = uniquifyName(taskTitle, taken);
  await store.claimPlaceholderWorkspaceName(workspaceId, name, principal);
}

async function withUsesDefaultWorkspace(
  store: StudioStore,
  project: StudioProject,
  principal: RequestPrincipal,
): Promise<StudioProject> {
  const workspaces = await store.listWorkspacesByProject(project.id, principal, "active");
  return { ...project, usesDefaultWorkspace: workspaces.length === 0 };
}

async function withEffectiveSettings(
  store: StudioStore,
  workspace: StudioWorkspace,
  principal: RequestPrincipal,
): Promise<StudioWorkspace> {
  const project = await store.getProject(workspace.projectId, principal);
  const projectSettings = project?.settings ?? {};
  const settingsOverrides = workspace.settingsOverrides ?? {};
  return {
    ...workspace,
    settingsOverrides,
    overriddenKeys: Object.keys(settingsOverrides),
    effectiveSettings: { ...projectSettings, ...settingsOverrides },
  };
}

type WorkspaceCreateBody = {
  name?: string;
  description?: string;
  settings?: Record<string, unknown>;
  settingsOverrides?: Record<string, unknown>;
  repositories?: Array<{ projectRepositoryId: string; branch?: string }>;
};

async function applyWorkspaceMembership(
  store: StudioStore,
  workspace: StudioWorkspace,
  repos: ProjectRepository[],
  principal: RequestPrincipal,
): Promise<WorkspaceRepositoryMembership[]> {
  const stamp = nowIso();
  const memberships: WorkspaceRepositoryMembership[] = repos.map((repo) => ({
    workspaceId: workspace.id,
    projectRepositoryId: repo.id,
    branch: repo.defaultBranch,
    createdAt: stamp,
    updatedAt: stamp,
  }));
  const saved = await store.replaceWorkspaceRepositories(workspace.id, memberships, principal);
  for (const membership of saved) {
    const repo = repos.find((entry) => entry.id === membership.projectRepositoryId);
    if (repo) {
      try {
        await syncWorkspaceRepoWorkingCopy(store, {
          tenantId: workspace.tenantId,
          projectId: workspace.projectId,
          workspaceId: workspace.id,
          repository: { ...repo, defaultBranch: membership.branch },
          branch: membership.branch,
        });
        continue;
      } catch {
        // Fall through to metadata-only ensure.
      }
    }
    await ensureWorkspaceRepoDurableState(store, {
      tenantId: workspace.tenantId,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      projectRepositoryId: membership.projectRepositoryId,
      branch: membership.branch,
    });
  }
  return saved;
}

async function resolveInitialRepos(
  store: StudioStore,
  projectId: string,
  body: WorkspaceCreateBody,
  principal: RequestPrincipal,
): Promise<ProjectRepository[]> {
  const projectRepos = (await store.listProjectRepositories(projectId, principal))
    .filter((repo) => repo.status === "active");

  if (body.repositories !== undefined) {
    if (!Array.isArray(body.repositories) || body.repositories.length < 1) {
      throw new ApiError(400, "repositories must contain at least one entry");
    }
    const byId = new Map(projectRepos.map((repo) => [repo.id, repo]));
    const selected: ProjectRepository[] = [];
    for (const entry of body.repositories) {
      if (!entry || typeof entry !== "object") throw new ApiError(400, "repositories entries must be objects");
      const repoId = typeof entry.projectRepositoryId === "string" ? entry.projectRepositoryId.trim() : "";
      if (!repoId) throw new ApiError(400, "projectRepositoryId is required");
      const repo = byId.get(repoId);
      if (!repo) throw new ApiError(400, `Repository "${repoId}" is not an active repository of this project`);
      const branch = typeof entry.branch === "string" && entry.branch.trim()
        ? entry.branch.trim()
        : repo.defaultBranch;
      selected.push({ ...repo, defaultBranch: branch });
    }
    return selected;
  }

  if (projectRepos.length < 1) {
    throw new ApiError(400, "A workspace requires at least one project repository; attach a repository first");
  }
  return projectRepos;
}

async function persistWorkspaceRecord(
  store: StudioStore,
  project: StudioProject,
  body: WorkspaceCreateBody,
  principal: RequestPrincipal,
  options?: { forceName?: string; forceNameSource?: StudioWorkspace["nameSource"]; forceOverrides?: Record<string, unknown> },
): Promise<StudioWorkspace> {
  const stamp = nowIso();
  const rawName = options?.forceName !== undefined
    ? options.forceName
    : typeof body.name === "string" ? body.name.trim() : "";
  const name = rawName ? normalizeName(rawName) : "Untitled workspace";
  const nameSource = options?.forceNameSource
    ?? (rawName ? "manual" as const : "placeholder" as const);
  const settingsOverrides = options?.forceOverrides
    ?? normalizeSettings(body.settingsOverrides ?? body.settings);
  const overriddenKeys = Object.keys(settingsOverrides);
  return store.saveWorkspace({
    id: uid("workspace"),
    tenantId: principal.tenantId,
    projectId: project.id,
    name,
    nameSource,
    description: normalizeDescription(body.description),
    status: "active",
    settings: {},
    settingsOverrides,
    effectiveSettings: { ...project.settings, ...settingsOverrides },
    overriddenKeys,
    createdAt: stamp,
    updatedAt: stamp,
    ownerId: principal.userId,
  }, principal);
}

export class ProjectService {
  constructor(private readonly store: StudioStore) {}

  async list(principal: RequestPrincipal, statusQuery?: string): Promise<StudioProject[]> {
    const projects = await this.store.listProjects(principal, parseStatusFilter(statusQuery));
    return Promise.all(projects.map((project) => withUsesDefaultWorkspace(this.store, project, principal)));
  }

  async get(id: string, principal: RequestPrincipal): Promise<StudioProject> {
    const project = requireResource(await this.store.getProject(id, principal), "Project");
    return withUsesDefaultWorkspace(this.store, project, principal);
  }

  async create(body: { name?: string; description?: string; settings?: Record<string, unknown> }, principal: RequestPrincipal): Promise<StudioProject> {
    const stamp = nowIso();
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    const name = rawName ? normalizeName(rawName) : "Untitled project";
    const nameSource = rawName ? "manual" as const : "placeholder" as const;
    const saved = await this.store.saveProject({
      id: uid("project"),
      tenantId: principal.tenantId,
      name,
      nameSource,
      description: normalizeDescription(body.description),
      status: "active",
      settings: normalizeSettings(body.settings),
      createdAt: stamp,
      updatedAt: stamp,
      ownerId: principal.userId,
    }, principal);
    return { ...saved, usesDefaultWorkspace: true };
  }

  async patch(id: string, body: { name?: string; description?: string; settings?: Record<string, unknown> }, principal: RequestPrincipal): Promise<StudioProject> {
    const existing = await this.get(id, principal);
    if (existing.status === "retired" && body.name !== undefined) {
      throw new ApiError(400, "Cannot rename a retired project");
    }
    const nextName = body.name !== undefined ? normalizeName(body.name) : existing.name;
    const saved = await this.store.saveProject({
      ...existing,
      name: nextName,
      nameSource: body.name !== undefined ? "manual" : existing.nameSource,
      description: body.description !== undefined ? normalizeDescription(body.description) : existing.description,
      settings: body.settings !== undefined ? normalizeSettings(body.settings) : existing.settings,
      updatedAt: nowIso(),
    }, principal);
    return withUsesDefaultWorkspace(this.store, saved, principal);
  }

  async retire(id: string, principal: RequestPrincipal): Promise<StudioProject> {
    const existing = await this.get(id, principal);
    if (existing.status === "retired") return existing;
    const saved = await this.store.saveProject({ ...existing, status: "retired", updatedAt: nowIso() }, principal);
    return withUsesDefaultWorkspace(this.store, saved, principal);
  }

  async listWorkspaces(
    projectId: string,
    principal: RequestPrincipal,
    statusQuery?: string,
  ): Promise<StudioWorkspace[]> {
    await this.get(projectId, principal);
    const workspaces = await this.store.listWorkspacesByProject(
      projectId,
      principal,
      parseStatusFilter(statusQuery),
    );
    return Promise.all(workspaces.map((workspace) => withEffectiveSettings(this.store, workspace, principal)));
  }

  async createWorkspace(
    projectId: string,
    body: WorkspaceCreateBody,
    principal: RequestPrincipal,
  ): Promise<{ workspace: StudioWorkspace; materializedDefault?: StudioWorkspace }> {
    const project = requireResource(await this.store.getProject(projectId, principal), "Project");
    if (project.status !== "active") {
      throw new ApiError(400, "Cannot create a workspace under a retired project");
    }

    const initialRepos = await resolveInitialRepos(this.store, projectId, body, principal);

    return this.store.transaction(async (tx) => {
      const active = await tx.listWorkspacesByProject(projectId, principal, "active");
      let materializedDefault: StudioWorkspace | undefined;

      if (active.length === 0) {
        const defaultWorkspace = await persistWorkspaceRecord(tx, project, {}, principal, {
          forceName: "Default",
          forceNameSource: "manual",
          forceOverrides: {},
        });
        const allRepos = (await tx.listProjectRepositories(projectId, principal))
          .filter((repo) => repo.status === "active");
        await applyWorkspaceMembership(tx, defaultWorkspace, allRepos, principal);

        const projectTasks = await tx.listTasksByProject(projectId, principal);
        for (const task of projectTasks) {
          if (task.workspaceId === null || task.workspaceId === undefined) {
            await tx.saveTask({
              ...task,
              workspaceId: defaultWorkspace.id,
              updatedAt: nowIso(),
            }, principal);
          }
        }

        await tx.rekeyWorkspaceRepoStates({
          tenantId: principal.tenantId,
          projectId,
          fromWorkspaceId: null,
          toWorkspaceId: defaultWorkspace.id,
        });

        materializedDefault = await withEffectiveSettings(tx, defaultWorkspace, principal);
      }

      const workspace = await persistWorkspaceRecord(tx, project, body, principal);
      const membershipRepos = body.repositories !== undefined
        ? initialRepos
        : (await tx.listProjectRepositories(projectId, principal)).filter((repo) => repo.status === "active");
      if (membershipRepos.length < 1) {
        throw new ApiError(400, "A workspace requires at least one project repository");
      }
      await applyWorkspaceMembership(tx, workspace, membershipRepos, principal);
      const withSettings = await withEffectiveSettings(tx, workspace, principal);
      return materializedDefault
        ? { workspace: withSettings, materializedDefault }
        : { workspace: withSettings };
    });
  }

  async listRepositories(projectId: string, principal: RequestPrincipal): Promise<ProjectRepository[]> {
    await this.get(projectId, principal);
    return this.store.listProjectRepositories(projectId, principal);
  }

  async attachRepository(
    projectId: string,
    body: { name?: string; source?: string; defaultBranch?: string },
    principal: RequestPrincipal,
  ): Promise<ProjectRepository> {
    const project = await this.get(projectId, principal);
    if (project.status !== "active") {
      throw new ApiError(400, "Cannot attach a repository to a retired project");
    }
    const name = normalizeName(body.name);
    const source = typeof body.source === "string" ? body.source.trim() : "";
    if (!source) throw new ApiError(400, "source is required");
    const defaultBranch = typeof body.defaultBranch === "string" ? body.defaultBranch.trim() : "";
    if (!defaultBranch) throw new ApiError(400, "defaultBranch is required");

    const stamp = nowIso();
    const saved = await this.store.saveProjectRepository({
      id: uid("repo"),
      tenantId: principal.tenantId,
      projectId,
      name,
      source,
      defaultBranch,
      status: "active",
      createdAt: stamp,
      updatedAt: stamp,
    }, principal);

    const activeWorkspaces = await this.store.listWorkspacesByProject(projectId, principal, "active");
    if (activeWorkspaces.length === 0) {
      await ensureWorkspaceRepoDurableState(this.store, {
        tenantId: principal.tenantId,
        projectId,
        workspaceId: null,
        projectRepositoryId: saved.id,
        branch: saved.defaultBranch,
      });
    }

    return saved;
  }

  async removeRepository(
    projectId: string,
    repoId: string,
    body: { confirmDiscardChanges?: boolean } | undefined,
    principal: RequestPrincipal,
  ): Promise<void> {
    await this.get(projectId, principal);
    const repo = requireResource(await this.store.getProjectRepository(repoId, principal), "Repository");
    if (repo.projectId !== projectId) {
      throw new ApiError(404, "Repository not found");
    }

    const states = await this.store.listWorkspaceRepoStates({
      tenantId: principal.tenantId,
      projectId,
      projectRepositoryId: repoId,
    });
    const dirty = states.some((state) => state.hasUncommittedChanges);
    if (dirty && body?.confirmDiscardChanges !== true) {
      throw new ApiError(409, "Unsaved changes present; confirmation required", {
        code: "CONFIRM_DISCARD_REQUIRED",
      });
    }

    const workspaces = await this.store.listWorkspacesByProject(projectId, principal, "all");
    for (const workspace of workspaces) {
      const memberships = await this.store.listWorkspaceRepositories(workspace.id, principal);
      const next = memberships.filter((m) => m.projectRepositoryId !== repoId);
      if (next.length !== memberships.length) {
        if (next.length < 1 && workspace.status === "active") {
          throw new ApiError(
            409,
            `Cannot remove repository: workspace "${workspace.name}" would have no repositories left`,
          );
        }
        await this.store.replaceWorkspaceRepositories(workspace.id, next, principal);
      }
    }

    await this.store.deleteProjectRepository(repoId, principal);
  }

  async dashboard(id: string, principal: RequestPrincipal) {
    const project = await this.get(id, principal);
    const tasks = await this.store.listTasksByProject(id, principal);
    const workspaces = await this.store.listWorkspacesByProject(id, principal, "active");
    const repositories = await this.store.listProjectRepositories(id, principal);
    const workspacesWithSettings = await Promise.all(
      workspaces.map((workspace) => withEffectiveSettings(this.store, workspace, principal)),
    );
    return {
      project,
      usesDefaultWorkspace: project.usesDefaultWorkspace === true,
      workspaces: workspacesWithSettings,
      repositories,
      tasks: tasks.map(taskSummary),
      relatedWorkspaces: workspacesWithSettings,
    };
  }
}

export class WorkspaceEntityService {
  constructor(private readonly store: StudioStore) {}

  async list(principal: RequestPrincipal, statusQuery?: string): Promise<StudioWorkspace[]> {
    const workspaces = await this.store.listWorkspaces(principal, parseStatusFilter(statusQuery));
    return Promise.all(workspaces.map((workspace) => withEffectiveSettings(this.store, workspace, principal)));
  }

  async get(id: string, principal: RequestPrincipal): Promise<StudioWorkspace> {
    const workspace = requireResource(await this.store.getWorkspace(id, principal), "Workspace");
    return withEffectiveSettings(this.store, workspace, principal);
  }

  async create(
    body: WorkspaceCreateBody & { projectId?: string },
    principal: RequestPrincipal,
  ): Promise<StudioWorkspace> {
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new ApiError(400, "projectId is required");
    const projects = new ProjectService(this.store);
    const result = await projects.createWorkspace(projectId, body, principal);
    return result.workspace;
  }

  async patch(id: string, body: {
    name?: string;
    description?: string;
    settings?: Record<string, unknown>;
    settingsOverrides?: Record<string, unknown>;
    clearOverrideKeys?: string[];
  }, principal: RequestPrincipal): Promise<StudioWorkspace> {
    const existing = await this.get(id, principal);
    if (existing.status === "retired" && body.name !== undefined) {
      throw new ApiError(400, "Cannot rename a retired workspace");
    }

    let settingsOverrides = { ...(existing.settingsOverrides ?? {}) };
    if (body.settingsOverrides !== undefined) {
      const merged = normalizeSettings(body.settingsOverrides);
      settingsOverrides = { ...settingsOverrides, ...merged };
    } else if (body.settings !== undefined) {
      settingsOverrides = normalizeSettings(body.settings);
    }
    if (Array.isArray(body.clearOverrideKeys)) {
      for (const key of body.clearOverrideKeys) {
        if (typeof key === "string" && key) delete settingsOverrides[key];
      }
    }

    const project = requireResource(await this.store.getProject(existing.projectId, principal), "Project");
    const saved = await this.store.saveWorkspace({
      ...existing,
      name: body.name !== undefined ? normalizeName(body.name) : existing.name,
      nameSource: body.name !== undefined ? "manual" : existing.nameSource,
      description: body.description !== undefined ? normalizeDescription(body.description) : existing.description,
      settingsOverrides,
      overriddenKeys: Object.keys(settingsOverrides),
      effectiveSettings: { ...project.settings, ...settingsOverrides },
      updatedAt: nowIso(),
    }, principal);
    return withEffectiveSettings(this.store, saved, principal);
  }

  async retire(id: string, principal: RequestPrincipal): Promise<StudioWorkspace> {
    const existing = await this.get(id, principal);
    if (existing.status === "retired") return existing;

    const active = await this.store.listWorkspacesByProject(existing.projectId, principal, "active");
    if (active.length <= 1) {
      const assigned = await this.store.listTasksByWorkspace(id, principal);
      if (assigned.length > 0) {
        throw new ApiError(409, "Cannot retire the last active workspace while tasks remain assigned to it", {
          code: "LAST_WORKSPACE_HAS_TASKS",
        });
      }
    }

    const saved = await this.store.saveWorkspace({ ...existing, status: "retired", updatedAt: nowIso() }, principal);
    return withEffectiveSettings(this.store, saved, principal);
  }

  async putRepositories(
    id: string,
    body: { repositories?: Array<{ projectRepositoryId: string; branch?: string }> },
    principal: RequestPrincipal,
  ): Promise<Array<WorkspaceRepositoryMembership & {
    availability?: string;
    hasUncommittedChanges?: boolean;
  }>> {
    const workspace = await this.get(id, principal);
    if (workspace.status !== "active") {
      throw new ApiError(400, "Cannot update repositories on a retired workspace");
    }
    if (!Array.isArray(body.repositories) || body.repositories.length < 1) {
      throw new ApiError(400, "repositories must contain at least one entry");
    }

    const projectRepos = await this.store.listProjectRepositories(workspace.projectId, principal);
    const byId = new Map(projectRepos.map((repo) => [repo.id, repo]));
    const stamp = nowIso();
    const memberships: WorkspaceRepositoryMembership[] = [];
    for (const entry of body.repositories) {
      if (!entry || typeof entry !== "object") throw new ApiError(400, "repositories entries must be objects");
      const repoId = typeof entry.projectRepositoryId === "string" ? entry.projectRepositoryId.trim() : "";
      if (!repoId) throw new ApiError(400, "projectRepositoryId is required");
      const repo = byId.get(repoId);
      if (!repo || repo.status === "removed") {
        throw new ApiError(400, `Repository "${repoId}" is not attached to this project`);
      }
      const branch = typeof entry.branch === "string" && entry.branch.trim()
        ? entry.branch.trim()
        : repo.defaultBranch;
      memberships.push({
        workspaceId: workspace.id,
        projectRepositoryId: repoId,
        branch,
        createdAt: stamp,
        updatedAt: stamp,
      });
    }

    const saved = await this.store.replaceWorkspaceRepositories(workspace.id, memberships, principal);
    const enriched = [];
    for (const membership of saved) {
      const repo = byId.get(membership.projectRepositoryId);
      let state;
      if (repo) {
        try {
          state = await syncWorkspaceRepoWorkingCopy(this.store, {
            tenantId: workspace.tenantId,
            projectId: workspace.projectId,
            workspaceId: workspace.id,
            repository: repo,
            branch: membership.branch,
          });
        } catch {
          state = await ensureWorkspaceRepoDurableState(this.store, {
            tenantId: workspace.tenantId,
            projectId: workspace.projectId,
            workspaceId: workspace.id,
            projectRepositoryId: membership.projectRepositoryId,
            branch: membership.branch,
          });
        }
      } else {
        state = await ensureWorkspaceRepoDurableState(this.store, {
          tenantId: workspace.tenantId,
          projectId: workspace.projectId,
          workspaceId: workspace.id,
          projectRepositoryId: membership.projectRepositoryId,
          branch: membership.branch,
        });
      }
      enriched.push({
        ...membership,
        availability: state.availability,
        hasUncommittedChanges: state.hasUncommittedChanges,
      });
    }
    return enriched;
  }

  async dashboard(id: string, principal: RequestPrincipal) {
    const workspace = await this.get(id, principal);
    const tasks = await this.store.listTasksByWorkspace(id, principal);
    const project = requireResource(await this.store.getProject(workspace.projectId, principal), "Project");
    const memberships = await this.store.listWorkspaceRepositories(id, principal);
    const repositories = [];
    for (const membership of memberships) {
      const inventory = await refreshWorkspaceRepoInventory(this.store, {
        tenantId: principal.tenantId,
        projectId: workspace.projectId,
        workspaceId: id,
        projectRepositoryId: membership.projectRepositoryId,
        branch: membership.branch,
      });
      repositories.push({
        ...membership,
        availability: inventory.state.availability,
        hasUncommittedChanges: inventory.state.hasUncommittedChanges,
        changedFiles: inventory.changedFiles,
      });
    }

    return {
      workspace,
      project,
      repositories,
      tasks: tasks.map(taskSummary),
      relatedProjects: [project],
    };
  }
}
