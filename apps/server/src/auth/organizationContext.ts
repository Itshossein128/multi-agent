import type {
  OrganizationMembershipRole,
  OrganizationPermission,
  StudioStore,
} from "../../../../src/studio/contracts";
import { permissionsForRole } from "./organizationPermissions";

export type PrincipalKind = "user" | "service";

export interface OrganizationServiceGrant {
  serviceId: string;
  permissions: OrganizationPermission[];
  status?: "active" | "revoked";
  allowOwnershipBypass?: boolean;
  role?: OrganizationMembershipRole;
  organizationId?: string;
}

export interface OrganizationContext {
  organizationId: string;
  userId: string;
  principalKind: PrincipalKind;
  role: OrganizationMembershipRole;
  permissions: OrganizationPermission[];
  membershipVersion: number;
  resolvedAt: number;
  allowOwnershipBypass?: boolean;
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

  async resolveService(organizationId: string, serviceId: string): Promise<OrganizationContext> {
    if (!organizationId?.trim() || !serviceId?.trim()) {
      throw new OrganizationContextDeniedError("Organization access denied");
    }
    const profile = await this.store.getOrganizationProfile({ userId: serviceId, tenantId: organizationId });
    if (!profile || profile.status !== "active") {
      throw new OrganizationContextDeniedError("Organization access denied");
    }

    const grants: OrganizationServiceGrant[] = Array.isArray((profile.config as any)?.serviceGrants)
      ? ((profile.config as any).serviceGrants as OrganizationServiceGrant[])
      : [];

    const grant = grants.find((g) => g.serviceId === serviceId);
    if (grant) {
      if (grant.organizationId && grant.organizationId !== organizationId) {
        throw new OrganizationContextDeniedError("Organization access denied");
      }
      if (grant.status === "revoked") {
        throw new OrganizationContextDeniedError("Organization access denied");
      }
      return {
        organizationId,
        userId: serviceId,
        principalKind: "service",
        role: grant.role ?? "viewer",
        permissions: grant.permissions,
        membershipVersion: 0,
        resolvedAt: this.now(),
        allowOwnershipBypass: grant.allowOwnershipBypass ?? false,
      };
    }

    const SYSTEM_SERVICES = new Set(["system-heartbeat", "system-trigger"]);
    if (SYSTEM_SERVICES.has(serviceId)) {
      return {
        organizationId,
        userId: serviceId,
        principalKind: "service",
        role: "admin",
        permissions: ["org.read", "resources.read", "resources.write", "runs.execute"],
        membershipVersion: 0,
        resolvedAt: this.now(),
        allowOwnershipBypass: true,
      };
    }

    throw new OrganizationContextDeniedError("Organization access denied");
  }
}
