/**
 * Projects & Workspaces client helpers backed by Studio API on the execution server.
 */
import "server-only";

import { createInternalPrincipalAssertion, type AuthenticatedPrincipal } from "../../../../src/auth/internalPrincipal";

const API_URL = process.env.NEXT_PUBLIC_EXECUTION_API_URL ?? process.env.EXECUTION_API_URL ?? "http://localhost:4000";

export type StudioNameSource = "placeholder" | "derived" | "manual";

export interface OrganizationProfileDto {
  id: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudioProjectDto {
  id: string;
  tenantId: string;
  name: string;
  nameSource?: StudioNameSource;
  description: string;
  status: "active" | "retired";
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  usesDefaultWorkspace?: boolean;
}

export interface StudioWorkspaceDto {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  nameSource?: StudioNameSource;
  description: string;
  status: "active" | "retired";
  settings: Record<string, unknown>;
  settingsOverrides?: Record<string, unknown>;
  effectiveSettings?: Record<string, unknown>;
  overriddenKeys?: string[];
  createdAt: string;
  updatedAt: string;
  ownerId: string;
}

export interface TaskSummaryDto {
  id: string;
  title: string;
  status: string;
  priority: string;
  workspaceId: string | null;
  projectId: string;
}

export interface ProjectRepositoryDto {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  source: string;
  defaultBranch: string;
  status: "active" | "unavailable" | "removed";
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRepositoryMembershipDto {
  workspaceId: string;
  projectRepositoryId: string;
  branch: string;
  availability?: "ready" | "unavailable" | "branch_missing";
  hasUncommittedChanges?: boolean;
}

export interface ProjectDashboardDto {
  project: StudioProjectDto;
  usesDefaultWorkspace?: boolean;
  workspaces?: StudioWorkspaceDto[];
  repositories?: ProjectRepositoryDto[];
  tasks: TaskSummaryDto[];
  relatedWorkspaces: StudioWorkspaceDto[];
}

export interface WorkspaceDashboardDto {
  workspace: StudioWorkspaceDto;
  project?: StudioProjectDto;
  repositories?: WorkspaceRepositoryMembershipDto[];
  tasks: TaskSummaryDto[];
  relatedProjects: StudioProjectDto[];
}

export interface WorkspaceCreateResultDto {
  workspace: StudioWorkspaceDto;
  materializedDefault?: StudioWorkspaceDto;
}

export class StudioEntityError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = "StudioEntityError";
  }
}

async function studioRequest<T>(
  path: string,
  init?: RequestInit,
  principal?: AuthenticatedPrincipal | null,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const secret = process.env.INTERNAL_PRINCIPAL_SECRET;
  if (principal && secret) {
    headers.set("X-Multi-Agent-Principal", createInternalPrincipalAssertion(principal, secret));
  }
  const response = await fetch(`${API_URL}/studio${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new StudioEntityError(body.error ?? body.message ?? `Studio request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

export function listProjects(principal: AuthenticatedPrincipal, status = "active") {
  return studioRequest<StudioProjectDto[]>(`/projects?status=${encodeURIComponent(status)}`, undefined, principal);
}
export function getProject(id: string, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioProjectDto>(`/projects/${encodeURIComponent(id)}`, undefined, principal);
}
export function getProjectDashboard(id: string, principal: AuthenticatedPrincipal) {
  return studioRequest<ProjectDashboardDto>(`/projects/${encodeURIComponent(id)}/dashboard`, undefined, principal);
}
export function getOrganizationCurrent(principal: AuthenticatedPrincipal) {
  return studioRequest<OrganizationProfileDto>("/organizations/current", undefined, principal);
}
export function createOrganization(
  body: { name: string; description?: string; config?: Record<string, unknown> },
  principal: AuthenticatedPrincipal,
) {
  return studioRequest<OrganizationProfileDto>("/organizations", { method: "POST", body: JSON.stringify(body) }, principal);
}

export function createProject(body: { name?: string; description?: string }, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioProjectDto>("/projects", { method: "POST", body: JSON.stringify(body) }, principal);
}
export function patchProject(id: string, body: { name?: string; description?: string; settings?: Record<string, unknown> }, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioProjectDto>(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }, principal);
}
export function retireProject(id: string, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioProjectDto>(`/projects/${encodeURIComponent(id)}/retire`, { method: "POST" }, principal);
}

export function listWorkspaces(principal: AuthenticatedPrincipal, status = "active") {
  return studioRequest<StudioWorkspaceDto[]>(`/workspaces?status=${encodeURIComponent(status)}`, undefined, principal);
}
export function getWorkspace(id: string, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioWorkspaceDto>(`/workspaces/${encodeURIComponent(id)}`, undefined, principal);
}
export function getWorkspaceDashboard(id: string, principal: AuthenticatedPrincipal) {
  return studioRequest<WorkspaceDashboardDto>(`/workspaces/${encodeURIComponent(id)}/dashboard`, undefined, principal);
}
export function listProjectWorkspaces(projectId: string, principal: AuthenticatedPrincipal, status = "active") {
  return studioRequest<StudioWorkspaceDto[]>(
    `/projects/${encodeURIComponent(projectId)}/workspaces?status=${encodeURIComponent(status)}`,
    undefined,
    principal,
  );
}
export function createProjectWorkspace(
  projectId: string,
  body: {
    name?: string;
    description?: string;
    settingsOverrides?: Record<string, unknown>;
    repositories?: Array<{ projectRepositoryId: string; branch?: string }>;
  },
  principal: AuthenticatedPrincipal,
) {
  return studioRequest<WorkspaceCreateResultDto>(
    `/projects/${encodeURIComponent(projectId)}/workspaces`,
    { method: "POST", body: JSON.stringify(body) },
    principal,
  );
}
export function createWorkspace(
  body: { name?: string; description?: string; projectId: string; settingsOverrides?: Record<string, unknown> },
  principal: AuthenticatedPrincipal,
) {
  return studioRequest<StudioWorkspaceDto>("/workspaces", { method: "POST", body: JSON.stringify(body) }, principal);
}
export function patchWorkspace(
  id: string,
  body: {
    name?: string;
    description?: string;
    settings?: Record<string, unknown>;
    settingsOverrides?: Record<string, unknown>;
    clearOverrideKeys?: string[];
  },
  principal: AuthenticatedPrincipal,
) {
  return studioRequest<StudioWorkspaceDto>(`/workspaces/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }, principal);
}
export function retireWorkspace(id: string, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioWorkspaceDto>(`/workspaces/${encodeURIComponent(id)}/retire`, { method: "POST" }, principal);
}

export function listProjectRepositories(projectId: string, principal: AuthenticatedPrincipal) {
  return studioRequest<ProjectRepositoryDto[]>(
    `/projects/${encodeURIComponent(projectId)}/repositories`,
    undefined,
    principal,
  );
}
export function attachProjectRepository(
  projectId: string,
  body: { name: string; source: string; defaultBranch: string },
  principal: AuthenticatedPrincipal,
) {
  return studioRequest<ProjectRepositoryDto>(
    `/projects/${encodeURIComponent(projectId)}/repositories`,
    { method: "POST", body: JSON.stringify(body) },
    principal,
  );
}
export function removeProjectRepository(
  projectId: string,
  repoId: string,
  principal: AuthenticatedPrincipal,
  confirmDiscardChanges = false,
) {
  return studioRequest<void>(
    `/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ confirmDiscardChanges }),
    },
    principal,
  );
}
export function putWorkspaceRepositories(
  workspaceId: string,
  repositories: Array<{ projectRepositoryId: string; branch?: string }>,
  principal: AuthenticatedPrincipal,
) {
  return studioRequest<WorkspaceRepositoryMembershipDto[]>(
    `/workspaces/${encodeURIComponent(workspaceId)}/repositories`,
    { method: "PUT", body: JSON.stringify({ repositories }) },
    principal,
  );
}
