import { Hono } from "hono";
import { BrokerError, brokerErrorMessage, type BrokerErrorCode } from "./contract";
import type { CredentialBrokerService } from "./service";

/**
 * Broker HTTP surface.
 *
 * Endpoints:
 *   POST /v1/leases
 *   POST /v1/leases/:leaseId/consume
 *   POST /v1/leases/:leaseId/revoke
 *   GET  /v1/health
 *   GET  /v1/audit/leases
 *
 * Security rules enforced here:
 * - Service-to-service authentication on every route except /v1/health.
 * - Credentials are never accepted via query parameters; requests with
 *   credential-ish query keys are rejected outright (SSRF/leak hygiene).
 * - Request bodies are never logged. Errors are generic, machine-readable
 *   codes; internal failures collapse to internal_error.
 * - mTLS is terminated by the Node server (see server.ts); this layer
 *   additionally enforces a rotatable bearer service token so that transport
 *   identity alone is not sufficient.
 */

export interface ServiceIdentity {
  name: string;
  /** Operations this identity may perform. Deny-by-default: empty = nothing. */
  scopes: ReadonlySet<string>;
}

export type Scope = "leases:issue" | "leases:consume" | "leases:revoke" | "audit:read";

export interface BrokerServiceAuth {
  /** Returns the identity for a bearer token, or null when unknown/invalid. */
  identify(token: string | undefined): ServiceIdentity | null;
}

/** Rotatable static-token auth. Tokens are compared in constant time. */
export class StaticServiceAuth implements BrokerServiceAuth {
  private readonly entries: Array<{ token: string; identity: ServiceIdentity }>;

  constructor(entries: ReadonlyArray<{ token: string; name: string; scopes: Scope[] }>) {
    this.entries = entries.map((entry) => ({ token: entry.token, identity: { name: entry.name, scopes: new Set(entry.scopes) } }));
  }

  identify(token: string | undefined): ServiceIdentity | null {
    if (!token) return null;
    let matched: ServiceIdentity | null = null;
    for (const entry of this.entries) {
      if (timingSafeEqual(entry.token, token)) matched = entry.identity;
    }
    return matched;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const FORBIDDEN_QUERY_KEYS = /(token|secret|key|password|credential|authorization|conn(ection)?|api)/i;

const MAX_BODY_BYTES = 16 * 1024;

export interface BrokerAppOptions {
  service: CredentialBrokerService;
  auth: BrokerServiceAuth;
}

export function createBrokerApp(options: BrokerAppOptions): Hono {
  const app = new Hono();

  // Reject credentials in query parameters on every route.
  app.use("*", async (c, next) => {
    for (const key of new URL(c.req.url).searchParams.keys()) {
      if (FORBIDDEN_QUERY_KEYS.test(key)) {
        return jsonError(c, "invalid_request", 400);
      }
    }
    await next();
  });

  // Service authentication + scope authorization (health is intentionally open
  // but discloses nothing beyond liveness).
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/v1/health") return next();
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const identity = options.auth.identify(token);
    if (!identity) return jsonError(c, "unauthenticated", 401);

    const scope = path === "/v1/audit/leases"
      ? "audit:read" as Scope
      : c.req.method === "POST" && path === "/v1/leases"
        ? "leases:issue" as Scope
        : c.req.method === "POST" && path.endsWith("/consume")
          ? "leases:consume" as Scope
          : c.req.method === "POST" && path.endsWith("/revoke")
            ? "leases:revoke" as Scope
            : undefined;
    if (scope && !identity.scopes.has(scope)) return jsonError(c, "forbidden", 403);
    if (!scope && path !== "/v1/health") return jsonError(c, "forbidden", 403);
    await next();
  });

  app.post("/v1/leases", async (c) => {
    const body = await readJson(c.req.raw);
    if (body === undefined) return jsonError(c, "invalid_request", 400);
    const idempotencyKey = normalizeIdempotencyKey(c.req.header("Idempotency-Key"));
    try {
      const lease = await options.service.issue(body, idempotencyKey);
      return c.json({ lease }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/v1/leases/:leaseId/consume", async (c) => {
    const body = await readJson(c.req.raw);
    if (body === undefined) return jsonError(c, "invalid_request", 400);
    if (typeof (body as Record<string, unknown>).leaseId !== "string") {
      (body as Record<string, unknown>).leaseId = c.req.param("leaseId");
    }
    if ((body as Record<string, unknown>).leaseId !== c.req.param("leaseId")) {
      return jsonError(c, "invalid_request", 400);
    }
    try {
      const secret = await options.service.consume(body);
      return c.json({ secret }, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/v1/leases/:leaseId/revoke", async (c) => {
    const body = await readJson(c.req.raw);
    if (body === undefined) return jsonError(c, "invalid_request", 400);
    if (typeof (body as Record<string, unknown>).leaseId !== "string") {
      (body as Record<string, unknown>).leaseId = c.req.param("leaseId");
    }
    if ((body as Record<string, unknown>).leaseId !== c.req.param("leaseId")) {
      return jsonError(c, "invalid_request", 400);
    }
    try {
      const result = await options.service.revoke(body);
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get("/v1/health", async (c) => {
    const health = await options.service.health();
    return c.json(health, 200);
  });

  app.get("/v1/audit/leases", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const query = {
      ...(params.get("tenantId") ? { tenantId: params.get("tenantId")! } : {}),
      ...(params.get("runId") ? { runId: params.get("runId")! } : {}),
      ...(params.get("limit") ? { limit: Number(params.get("limit")) } : {}),
    };
    try {
      const events = await options.service.queryAudit(query);
      return c.json({ events }, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.notFound((c) => jsonError(c, "invalid_request", 404));

  return app;
}

type ErrorResponder = { json: (data: unknown, status?: number) => Response };

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) return undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return undefined;
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) return undefined;
  return value;
}

function failure(c: ErrorResponder, error: unknown): Response {
  if (error instanceof BrokerError) return jsonError(c, error.code, error.status);
  // Unknown errors never leak internals.
  return jsonError(c, "internal_error", 500);
}

function jsonError(c: ErrorResponder, code: BrokerErrorCode, status: number): Response {
  return c.json({ error: { code, message: brokerErrorMessage(code) } }, status);
}
