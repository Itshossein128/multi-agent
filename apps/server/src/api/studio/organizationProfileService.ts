import { nowIso } from "@multi-agent/types";
import type { OrganizationProfile, StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";

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
  if (value.length > DESCRIPTION_MAX) {
    throw new ApiError(400, `description must be at most ${DESCRIPTION_MAX} characters`);
  }
  return value;
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "config must be an object");
  }
  return value as Record<string, unknown>;
}

export class OrganizationProfileService {
  constructor(private readonly store: StudioStore) {}

  async getCurrent(principal: RequestPrincipal): Promise<OrganizationProfile> {
    const profile = await this.store.getOrganizationProfile(principal);
    if (!profile) throw new ApiError(404, "Organization not found");
    return profile;
  }

  async create(
    body: { name?: unknown; description?: unknown; config?: unknown },
    principal: RequestPrincipal,
  ): Promise<OrganizationProfile> {
    const existing = await this.store.getOrganizationProfile(principal);
    if (existing) throw new ApiError(409, "Organization already exists for this tenant");

    const stamp = nowIso();
    try {
      return await this.store.createOrganizationProfile(
        {
          id: principal.tenantId,
          name: normalizeName(body.name),
          description: normalizeDescription(body.description),
          config: normalizeConfig(body.config),
          ownerId: principal.userId,
          createdAt: stamp,
          updatedAt: stamp,
        },
        principal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists")) {
        throw new ApiError(409, "Organization already exists for this tenant");
      }
      throw error;
    }
  }
}
