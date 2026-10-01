import { nowIso, uid } from "@multi-agent/types";
import type {
  StudioEntityStatusFilter,
  StudioProject,
  StudioStore,
  StudioTask,
  StudioWorkspace,
} from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { requireResource } from "./resource";
import { ensureTenantProjectWorkspaceDefaults } from "./tenantDefaults";

const NAME_MAX = 200;
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
    title: task.title,
    status: task.status,
    priority: task.priority,
    workspaceId: task.workspaceId ?? "",
    projectIds: task.projectIds ?? [],
  };
}

export class ProjectService {
  constructor(private readonly store: StudioStore) {}

  async list(principal: RequestPrincipal, statusQuery?: string): Promise<StudioProject[]> {
    await ensureTenantProjectWorkspaceDefaults(this.store, principal);
    return this.store.listProjects(principal, parseStatusFilter(statusQuery));
  }

  async get(id: string, principal: RequestPrincipal): Promise<StudioProject> {
    return requireResource(await this.store.getProject(id, principal), "Project");
  }

  async create(body: { name?: string; description?: string; settings?: Record<string, unknown> }, principal: RequestPrincipal): Promise<StudioProject> {
    const stamp = nowIso();
    return this.store.saveProject({
      id: uid("project"),
      tenantId: principal.tenantId,
      name: normalizeName(body.name),
      description: normalizeDescription(body.description),
      status: "active",
      settings: normalizeSettings(body.settings),
      createdAt: stamp,
      updatedAt: stamp,
      ownerId: principal.userId,
    }, principal);
  }

  async patch(id: string, body: { name?: string; description?: string; settings?: Record<string, unknown> }, principal: RequestPrincipal): Promise<StudioProject> {
    const existing = await this.get(id, principal);
    if (existing.status === "retired" && body.name !== undefined) {
      throw new ApiError(400, "Cannot rename a retired project");
    }
    return this.store.saveProject({
      ...existing,
      name: body.name !== undefined ? normalizeName(body.name) : existing.name,
      description: body.description !== undefined ? normalizeDescription(body.description) : existing.description,
      settings: body.settings !== undefined ? normalizeSettings(body.settings) : existing.settings,
      updatedAt: nowIso(),
    }, principal);
  }

  async retire(id: string, principal: RequestPrincipal): Promise<StudioProject> {
    const existing = await this.get(id, principal);
    if (existing.status === "retired") return existing;
    return this.store.saveProject({ ...existing, status: "retired", updatedAt: nowIso() }, principal);
  }

  async dashboard(id: string, principal: RequestPrincipal) {
    const project = await this.get(id, principal);
    const tasks = await this.store.listTasksByProject(id, principal);
    const workspaceIds = [...new Set(tasks.map((task) => task.workspaceId).filter(Boolean))] as string[];
    const relatedWorkspaces: StudioWorkspace[] = [];
    for (const workspaceId of workspaceIds) {
      const workspace = await this.store.getWorkspace(workspaceId, principal);
      if (workspace && workspace.status === "active") relatedWorkspaces.push(workspace);
    }
    return {
      project,
      tasks: tasks.map(taskSummary),
      relatedWorkspaces,
    };
  }
}

export class WorkspaceEntityService {
  constructor(private readonly store: StudioStore) {}

  async list(principal: RequestPrincipal, statusQuery?: string): Promise<StudioWorkspace[]> {
    await ensureTenantProjectWorkspaceDefaults(this.store, principal);
    return this.store.listWorkspaces(principal, parseStatusFilter(statusQuery));
  }

  async get(id: string, principal: RequestPrincipal): Promise<StudioWorkspace> {
    return requireResource(await this.store.getWorkspace(id, principal), "Workspace");
  }

  async create(body: { name?: string; description?: string; settings?: Record<string, unknown> }, principal: RequestPrincipal): Promise<StudioWorkspace> {
    const stamp = nowIso();
    return this.store.saveWorkspace({
      id: uid("workspace"),
      tenantId: principal.tenantId,
      name: normalizeName(body.name),
      description: normalizeDescription(body.description),
      status: "active",
      settings: normalizeSettings(body.settings),
      createdAt: stamp,
      updatedAt: stamp,
      ownerId: principal.userId,
    }, principal);
  }

  async patch(id: string, body: { name?: string; description?: string; settings?: Record<string, unknown> }, principal: RequestPrincipal): Promise<StudioWorkspace> {
    const existing = await this.get(id, principal);
    if (existing.status === "retired" && body.name !== undefined) {
      throw new ApiError(400, "Cannot rename a retired workspace");
    }
    return this.store.saveWorkspace({
      ...existing,
      name: body.name !== undefined ? normalizeName(body.name) : existing.name,
      description: body.description !== undefined ? normalizeDescription(body.description) : existing.description,
      settings: body.settings !== undefined ? normalizeSettings(body.settings) : existing.settings,
      updatedAt: nowIso(),
    }, principal);
  }

  async retire(id: string, principal: RequestPrincipal): Promise<StudioWorkspace> {
    const existing = await this.get(id, principal);
    if (existing.status === "retired") return existing;
    return this.store.saveWorkspace({ ...existing, status: "retired", updatedAt: nowIso() }, principal);
  }

  async dashboard(id: string, principal: RequestPrincipal) {
    const workspace = await this.get(id, principal);
    const tasks = await this.store.listTasksByWorkspace(id, principal);
    const projectIds = [...new Set(tasks.flatMap((task) => task.projectIds ?? []))];
    const relatedProjects: StudioProject[] = [];
    for (const projectId of projectIds) {
      const project = await this.store.getProject(projectId, principal);
      if (project && project.status === "active") relatedProjects.push(project);
    }
    return {
      workspace,
      tasks: tasks.map(taskSummary),
      relatedProjects,
    };
  }
}
