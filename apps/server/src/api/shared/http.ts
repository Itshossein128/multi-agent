import { ConfigurationValidationError, ContractViolationError } from "@multi-agent/types";
import { ToolInputValidationError, ToolPolicyError } from "../../../../../src/tools/errors";
import { requirePermission, PermissionDeniedError } from "../../auth/authorization";
import { organizationRoutePermission, isOrganizationBootstrap } from "../../auth/organizationRoutePermissions";
import { OrganizationContextResolver, OrganizationContextDeniedError, type OrganizationContext } from "../../auth/organizationContext";
import { orgFeatureFlagsFromEnvironment } from "../../organization/orgFeatureFlags";
import { log } from "../../logging";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { resolveRequestPrincipal } from "../../auth/principal";
import type { RequestPrincipal } from "../../auth/principal";
import type { PrincipalResolver } from "../../auth/authorization";
import { withOrganization } from "../../../../../src/studio/infrastructure/withOrganization";


export interface PrincipalVariables {
  principal: RequestPrincipal;
  organizationContext?: OrganizationContext;
}

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    message: string,
    /** Optional structured details (e.g. validation issues) for API clients. */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function requirePrincipal(
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
): MiddlewareHandler<{ Variables: PrincipalVariables }> {
  return async (context, next) => {
    const principal = await resolvePrincipal(context.req.raw);
    if (!principal) return context.json({ error: "Authentication required." }, 401);
    context.set("principal", principal);
    await next();
  };
}

export function respondWithApiError(error: unknown, context: Context) {
  if (error instanceof ConfigurationValidationError || error instanceof ContractViolationError || error instanceof ToolInputValidationError || error instanceof ToolPolicyError) return context.json({ error: error.message }, 400);
  if (error instanceof PermissionDeniedError) return context.json({ error: "Permission denied", code: error.code }, 403);
  if (error instanceof ApiError && error.status < 500) {
    if (error.status === 404) return context.json({ error: "Not found" }, 404);
    return context.json(error.details !== undefined ? { error: error.message, details: error.details } : { error: error.message }, error.status);
  }
  if (isOwnershipError(error)) return context.json({ error: "Not found" }, 404);
  return context.json({ error: error instanceof ApiError && error.status === 503 ? "Service unavailable" : "Internal server error" }, error instanceof ApiError && error.status === 503 ? 503 : 500);
}

export function isOwnershipError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Access denied") || message.includes("Cannot modify another");
}

export function requireOrganizationContext(store: StudioStore, routePrefix = ""): MiddlewareHandler<{ Variables: PrincipalVariables }> {
  const contexts = new OrganizationContextResolver(store);
  const { membershipEnforcement } = orgFeatureFlagsFromEnvironment();
  return async (c, next) => {
    const principal = c.get("principal");
    if (!principal) return next(); // Global auth rejects unauthenticated requests before this gate.
    let path = c.req.path.replace(/^\/studio(?=\/)/, "").replace(/\/$/, "");
    if (routePrefix && !path.startsWith(routePrefix)) path = routePrefix + path;
    if (isOrganizationBootstrap(c.req.method, path)) {
      if (principal.principalKind === "service" || !await store.isOrganizationUserActive(principal.userId)) return c.json({ error: "Not found" }, 404);
      return next();
    }
    const organizationId = principal.organizationId ?? principal.tenantId;
    if (!organizationId || principal.tenantId !== organizationId) return c.json({ error: "Not found" }, 404);
    try {
      let context: OrganizationContext;
      if (principal.principalKind === "service") {
        context = await contexts.resolveService(organizationId, principal.userId);
      } else {
        context = await contexts.resolve(organizationId, principal.userId);
      }
      c.set("organizationContext", context);
      // Discard incoming permission hints and attach only server-derived permissions.
      c.set("principal", {
        ...principal,
        permissions: context.permissions,
        allowOwnershipBypass: context.allowOwnershipBypass,
      });
      requirePermission(context, organizationRoutePermission(c.req.method, path));
      if (!["GET", "HEAD"].includes(c.req.method) && /^\/tools(?:\/[^/]+)?$/.test(path)) {
        const body = await c.req.raw.clone().json().catch(() => null);
        if (body?.configuration) {
          const toolId = path.split("/")[2];
          const existing = toolId ? await store.getTool(toolId, principal) : null;
          if (body.configuration.connection || body.configuration.server || existing?.configuration.connection || existing?.configuration.server) requirePermission(context, "credentials.manage");
        }
      }
      if (!["GET", "HEAD"].includes(c.req.method) && /^\/agents(?:\/[^/]+)?$/.test(path)) {
        const body = await c.req.raw.clone().json().catch(() => null);
        if (body?.backend) {
          const agentId = path.split("/")[2];
          const existing = agentId ? await store.getAgent(agentId, principal) : null;
          if (body.backend.credentialAlias || (existing?.backend.type === "webhook" && existing.backend.credentialAlias)) requirePermission(context, "credentials.manage");
        }
      }
    } catch (error) {
      if (!(error instanceof OrganizationContextDeniedError) && !(error instanceof PermissionDeniedError)) throw error;
      if (membershipEnforcement === "enforce") {
        if (error instanceof PermissionDeniedError) return c.json({ error: "Permission denied", code: error.code }, 403);
        return c.json({ error: "Not found" }, 404);
      }
      log.warn("authz.would_deny", { organizationId, userId: principal.userId, method: c.req.method, path });
    }
    // Shadow evaluates policy for diagnostics only. Never serve with weaker checks,
    // regardless of current membership count, prior admission, or a process restart.
    if (membershipEnforcement === "shadow") return c.json({ error: "Organization enforcement required" }, 503);
    const orgContext = c.get("organizationContext");
    const isStream = path.endsWith("/events") || c.req.header("Accept") === "text/event-stream";
    const pool = (store as any).getPool?.() ?? (store as any).pool;
    if (pool && orgContext && !isStream) {
      return withOrganization(pool, orgContext.organizationId, orgContext.principalKind, async () => {
        await next();
      });
    }
    await next();
  };
}
