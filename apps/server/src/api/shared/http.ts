import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { resolveRequestPrincipal } from "../../auth/principal";
import type { RequestPrincipal } from "../../auth/principal";
import type { PrincipalResolver } from "../../auth/authorization";

export interface PrincipalVariables {
  principal: RequestPrincipal;
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
  if (error instanceof ApiError) {
    return context.json(error.details !== undefined ? { error: error.message, details: error.details } : { error: error.message }, error.status);
  }
  return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
}

export function isOwnershipError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Access denied") || message.includes("Cannot modify another");
}
