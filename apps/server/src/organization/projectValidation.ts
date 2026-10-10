import type { StudioStore, StudioProject } from "../../../../src/studio/contracts";
import type { RequestPrincipal } from "../auth/principal";
import { ApiError } from "../api/shared/http";

export async function requireActiveProject(
  studio: StudioStore,
  projectId: unknown,
  principal: RequestPrincipal,
): Promise<StudioProject> {
  if (typeof projectId !== "string" || !projectId.trim()) throw new ApiError(400, "projectId is required");
  const project = await studio.getProject(projectId, principal);
  if (!project) throw new ApiError(404, "Project not found");
  if (project.status !== "active") throw new ApiError(409, "Project is retired");
  return project;
}
