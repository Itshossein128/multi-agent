import type {
  OrganizationMembershipRole,
  OrganizationPermission,
  StudioStore,
} from "../../../../src/studio/contracts";
import { permissionsForRole } from "./organizationPermissions";

export type PrincipalKind = "user" | "service";

export interface OrganizationContext {
  organizationId: string;
  userId: string;
  principalKind: PrincipalKind;
  role: OrganizationMembershipRole;
  permissions: OrganizationPermission[];
  membershipVersion: number;
  resolvedAt: number;
}

export class OrganizationContextDeniedError extends Error {
  constructor(message = "Organization access denied") {
    super(message);
    this.name = "OrganizationContextDeniedError";
  }
}

type CacheEntry = { context: OrganizationContext; expiresAt: number };

export interface OrganizationContextResolverOptions {
  ttlMs?: number;
  now?: () => number;
}

/**
 * Server-side OrganizationContext resolution (membership lookup + short TTL cache by version).
 */
export class OrganizationContextResolver {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly store: StudioStore,
    options: OrganizationContextResolverOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  private cacheKey(organizationId: string, userId: string): string {
    return `${organizationId}\0${userId}`;
  }

  invalidate(organizationId: string, userId: string): void {
    this.cache.delete(this.cacheKey(organizationId, userId));
  }

  async resolve(organizationId: string, userId: string): Promise<OrganizationContext> {
    if (!organizationId?.trim() || !userId?.trim()) {
      throw new OrganizationContextDeniedError("Organization access denied");
    }
    const key = this.cacheKey(organizationId, userId);
    const hit = this.cache.get(key);
    const now = this.now();
    const profile = await this.store.getOrganizationProfile({ userId, tenantId: organizationId });
    if (!profile || profile.status !== "active" || !await this.store.isOrganizationUserActive(userId)) {
      throw new OrganizationContextDeniedError("Organization access denied");
    }

    const membership = await this.store.getMembership(organizationId, userId);
    if (!membership || membership.status !== "active") {
      throw new OrganizationContextDeniedError("Organization access denied");
    }

    if (hit && hit.expiresAt > now && hit.context.membershipVersion === membership.version) {
      return hit.context;
    }
    const context: OrganizationContext = {
      organizationId,
      userId,
      principalKind: "user",
      role: membership.role,
      permissions: permissionsForRole(membership.role),
      membershipVersion: membership.version,
      resolvedAt: now,
    };
    this.cache.set(key, { context, expiresAt: now + this.ttlMs });
    return context;
  }

  async resolveBySlug(slug: string, userId: string): Promise<OrganizationContext & { slug: string }> {
    const profile = await this.store.getOrganizationBySlug(slug);
    if (!profile) throw new OrganizationContextDeniedError("Organization access denied");
    const context = await this.resolve(profile.id, userId);
    return { ...context, slug: profile.slug };
  }
}
