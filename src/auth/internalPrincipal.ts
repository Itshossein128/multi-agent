import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** Normalized principal used across web BFF and execution server. */
export type AuthenticatedPrincipal = {
  userId: string;
  principalKind?: "user" | "service";
  /** Server-derived only; never serialized into an assertion. */
  permissions?: import("../studio/contracts").OrganizationPermission[];
  /** Organization id (same value as organizationId; kept for store/API compatibility). */
  tenantId: string;
  /** Present on v2 assertions; mirrors tenantId. */
  organizationId?: string;
};

export type PrincipalAssertionInput = { principalKind?: "user" | "service" } & (
  | { userId: string; organizationId: string; tenantId?: string }
  | { userId: string; tenantId: string; organizationId?: string });

type AssertionPayload = {
  userId: string;
  organizationId: string;
  tenantId: string;
  exp: number;
  nonce: string;
  v: 2;
  principalKind: "user" | "service";
};

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

function normalizePrincipal(principal: PrincipalAssertionInput): { userId: string; organizationId: string; tenantId: string } {
  const organizationId = ("organizationId" in principal && principal.organizationId) || principal.tenantId;
  const tenantId = ("tenantId" in principal && principal.tenantId) || principal.organizationId;
  if (!principal.userId || !organizationId || !tenantId) {
    throw new Error("Internal principal secret and identity are required.");
  }
  if (organizationId !== tenantId) {
    throw new Error("organizationId and tenantId must refer to the same organization.");
  }
  return { userId: principal.userId, organizationId, tenantId };
}

export function createInternalPrincipalAssertion(
  principal: PrincipalAssertionInput,
  secret: string,
  now = Date.now(),
): string {
  if (!secret) throw new Error("Internal principal secret and identity are required.");
  const normalized = normalizePrincipal(principal);
  const payload: AssertionPayload = {
    ...normalized,
    principalKind: principal.principalKind ?? "user",
    exp: now + 60_000,
    nonce: randomUUID(),
    v: 2,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyInternalPrincipalAssertion(
  value: string | null,
  secret: string,
  now = Date.now(),
): AuthenticatedPrincipal | null {
  if (!value || !secret) return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return null;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as Partial<AssertionPayload> & {
      tenantId?: string;
      organizationId?: string;
    };
    if (typeof parsed.userId !== "string" || typeof parsed.nonce !== "string" || typeof parsed.exp !== "number") {
      return null;
    }
    if (parsed.exp <= now || !parsed.userId.trim() || !parsed.nonce.trim()) return null;
    if (parsed.principalKind !== undefined && parsed.principalKind !== "user" && parsed.principalKind !== "service") return null;
    const organizationId =
      typeof parsed.organizationId === "string" && parsed.organizationId
        ? parsed.organizationId
        : typeof parsed.tenantId === "string"
          ? parsed.tenantId
          : null;
    const tenantId =
      typeof parsed.tenantId === "string" && parsed.tenantId
        ? parsed.tenantId
        : organizationId;
    if (!organizationId || !tenantId || organizationId !== tenantId) return null;
    return { userId: parsed.userId, tenantId, organizationId, principalKind: parsed.principalKind ?? "user" };
  } catch {
    return null;
  }
}
