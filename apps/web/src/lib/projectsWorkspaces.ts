/**
 * Projects & Workspaces client helpers backed by Studio API on the execution server.
 */
import "server-only";

import { createInternalPrincipalAssertion, type AuthenticatedPrincipal } from "../../../../src/auth/internalPrincipal";

const API_URL = process.env.NEXT_PUBLIC_EXECUTION_API_URL ?? process.env.EXECUTION_API_URL ?? "http://localhost:4000";

export interface StudioProjectDto {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: "active" | "retired";
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
}

export type StudioWorkspaceDto = StudioProjectDto;

export interface TaskSummaryDto {
  id: string;
  title: string;
  status: string;
  priority: string;
  workspaceId: string;
  projectIds: string[];
}

export interface ProjectDashboardDto {
  project: StudioProjectDto;
  tasks: TaskSummaryDto[];
  relatedWorkspaces: StudioWorkspaceDto[];
}

export interface WorkspaceDashboardDto {
  workspace: StudioWorkspaceDto;
  tasks: TaskSummaryDto[];
  relatedProjects: StudioProjectDto[];
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
export function createProject(body: { name: string; description?: string }, principal: AuthenticatedPrincipal) {
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
export function createWorkspace(body: { name: string; description?: string }, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioWorkspaceDto>("/workspaces", { method: "POST", body: JSON.stringify(body) }, principal);
}
export function patchWorkspace(id: string, body: { name?: string; description?: string; settings?: Record<string, unknown> }, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioWorkspaceDto>(`/workspaces/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }, principal);
}
export function retireWorkspace(id: string, principal: AuthenticatedPrincipal) {
  return studioRequest<StudioWorkspaceDto>(`/workspaces/${encodeURIComponent(id)}/retire`, { method: "POST" }, principal);
}
