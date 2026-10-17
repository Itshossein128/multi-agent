import { nowIso } from "@multi-agent/types";
import { randomUUID } from "crypto";
import type { OrganizationProfile, StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { orgFeatureFlagsFromEnvironment } from "../../organization/orgFeatureFlags";
import { OrganizationCleanupUnavailableError, OrganizationPurgeWorker } from "../../organization/organizationPurgeWorker";
import { withOrganization } from "../../../../../src/studio/infrastructure/withOrganization";

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;
const SLUG_MAX = 80;

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

function normalizeSlug(value: unknown, name: string, orgId: string): string {
  if (value === undefined || value === null || value === "") {
    const fromName = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX);
    return fromName || orgId.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, SLUG_MAX) || "org";
  }
  if (typeof value !== "string") throw new ApiError(400, "slug must be a string");
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > SLUG_MAX) {
    throw new ApiError(400, "slug must be lowercase URL-safe (a-z, 0-9, hyphen) and at most 80 characters");
  }
  return slug;
}

export class OrganizationProfileService {
  private readonly purgeWorker: OrganizationPurgeWorker;

  constructor(
    private readonly store: StudioStore,
    purgeWorker?: OrganizationPurgeWorker,
  ) {
    this.purgeWorker = purgeWorker ?? new OrganizationPurgeWorker({ studioStore: store });
  }

  async getCurrent(principal: RequestPrincipal): Promise<OrganizationProfile> {
    const profile = await this.store.getOrganizationProfile(principal);
    if (!profile) throw new ApiError(404, "Organization not found");
    return profile;
  }

  async updateCurrent(
    body: { name?: unknown; description?: unknown; config?: unknown; slug?: unknown },
    principal: RequestPrincipal,
  ): Promise<OrganizationProfile> {
    if (!principal.userId) throw new ApiError(401, "Unauthorized");
    if (!principal.tenantId?.trim()) throw new ApiError(400, "Organization tenantId is required");

    const updates: {
      name?: string;
      description?: string;
      config?: Record<string, unknown>;
      slug?: string;
    } = {};

    if (body.name !== undefined) {
      updates.name = normalizeName(body.name);
    }
    if (body.description !== undefined) {
      updates.description = normalizeDescription(body.description);
    }
    if (body.config !== undefined) {
      updates.config = normalizeConfig(body.config);
    }
    if (body.slug !== undefined) {
      if (typeof body.slug !== "string") throw new ApiError(400, "slug must be a string");
      const slug = body.slug.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > SLUG_MAX) {
        throw new ApiError(400, "slug must be lowercase URL-safe (a-z, 0-9, hyphen) and at most 80 characters");
      }
      updates.slug = slug;
    }

    try {
      return await this.store.updateOrganizationProfile(updates, principal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        throw new ApiError(404, "Organization not found");
      }
      if (
        message.includes("slug already in use") ||
        message.includes("studio_organizations_slug") ||
        message.toLowerCase().includes("duplicate key")
      ) {
        throw new ApiError(409, "Organization slug already in use");
      }
      if (message.includes("slug must be lowercase")) {
        throw new ApiError(400, message);
      }
      throw error;
    }
  }

  async deleteCurrent(
    body: { name?: unknown; confirmationName?: unknown },
    principal: RequestPrincipal,
  ) {
    const { deletionEnabled } = orgFeatureFlagsFromEnvironment();
    if (!deletionEnabled) {
      throw new ApiError(403, "Organization deletion is disabled");
    }
    // Deletion deliberately has no enclosing request transaction: the deleting
    // marker must commit even when cleanup fails. Scope the confirmation read
    // separately so FORCE RLS can see the already-authorized organization.
    const pool = (this.store as any).getPool?.();
    const profile = pool
      ? await withOrganization(pool, principal.tenantId, principal.principalKind === "service" ? "service" : "user", () => this.getCurrent(principal))
      : await this.getCurrent(principal);
    const confirmation =
      typeof body.confirmationName === "string"
        ? body.confirmationName.trim()
        : typeof body.name === "string"
        ? body.name.trim()
        : "";
    if (confirmation !== profile.name) {
      throw new ApiError(400, "Organization name confirmation mismatch");
    }
    try {
      return await this.purgeWorker.purgeOrganization(profile.id);
    } catch (error) {
      if (error instanceof OrganizationCleanupUnavailableError) throw new ApiError(503, "Organization cleanup is not configured");
      const pending = pool
        ? await withOrganization(pool, principal.tenantId, "service", () => this.store.getOrganizationProfile(principal))
        : await this.store.getOrganizationProfile(principal);
      if (pending?.status === "deleting") return { status: "pending" as const, organizationId: profile.id };
      throw error;
    }
  }

  async listMine(principal: RequestPrincipal): Promise<OrganizationProfile[]> {
    return this.store.listOrganizationsForUser(principal.userId);
  }

  async listMembers(principal: RequestPrincipal) {
    const profile = await this.getCurrent(principal);
    return this.store.listMemberships(profile.id);
  }

  /**
   * Create an organization for the caller.
   * - If the principal already has a tenantId that matches an existing org → 409
   * - Otherwise uses principal.tenantId as the organization id (caller/BFF allocates UUID)
   *   and atomically creates owner membership + audit + last-organization pointer.
   */
  async create(
    body: { name?: unknown; description?: unknown; config?: unknown; slug?: unknown },
    principal: RequestPrincipal,
  ): Promise<OrganizationProfile> {
    if (!principal.userId) throw new ApiError(401, "Unauthorized");
    if (!principal.tenantId?.trim()) {
      throw new ApiError(400, "organization id (tenantId) is required to create an organization");
    }

    const existing = await this.store.getOrganizationProfile(principal);
    if (existing) throw new ApiError(409, "Organization already exists for this tenant");

    const name = normalizeName(body.name);
    const stamp = nowIso();
    const orgId = principal.tenantId;
    try {
      return await this.store.createOrganizationProfile(
        {
          id: orgId,
          name,
          description: normalizeDescription(body.description),
          config: normalizeConfig(body.config),
          ownerId: principal.userId,
          status: "active",
          slug: normalizeSlug(body.slug, name, orgId),
          createdBy: principal.userId,
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
      if (message.includes("studio_organizations_slug") || message.toLowerCase().includes("duplicate key")) {
        throw new ApiError(409, "Organization slug already in use");
      }
      throw error;
    }
  }

  /** Allocate a fresh organization id for bootstrap create (used by web BFF when user has no tenant). */
  static allocateOrganizationId(): string {
    return randomUUID();
  }
}
