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
  allowOwnershipBypass?: boolean;
};

export type PrincipalAssertionInput = { principalKind?: "user" | "service" } & (
  | { userId: string; organizationId: string; tenantId?: string }
  | { userId: string; tenantId: string; organizationId?: string });

type AssertionPayload = {
  userId: string;
  organizationId: string;
  exp: number;
  nonce: string;
  v: 2;
  principalKind: "user" | "service";
};

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

// Bounded in-memory store for seen nonces to prevent assertion replay attacks (T067 / T102 / D-3).
const seenNonces = new Map<string, number>();
const MAX_SEEN_NONCES = 10_000;

export function clearSeenNonces(): void {
  seenNonces.clear();
}

function checkAndRecordNonce(nonce: string, exp: number, now: number): boolean {
  if (seenNonces.size > MAX_SEEN_NONCES) {
    for (const [n, e] of seenNonces.entries()) {
      if (e <= now) seenNonces.delete(n);
    }
    if (seenNonces.size > MAX_SEEN_NONCES) {
      const keys = Array.from(seenNonces.keys()).slice(0, 1000);
      for (const k of keys) seenNonces.delete(k);
    }
  }

  const existingExp = seenNonces.get(nonce);
  if (existingExp !== undefined && existingExp > now) {
    return false;
  }
  seenNonces.set(nonce, exp);
  return true;
}

function normalizePrincipal(principal: PrincipalAssertionInput): { userId: string; organizationId: string } {
  const organizationId = ("organizationId" in principal && principal.organizationId) || principal.tenantId;
  if (!principal.userId?.trim() || !organizationId?.trim()) {
    throw new Error("Internal principal secret and identity are required.");
  }
  if ("organizationId" in principal && "tenantId" in principal && principal.organizationId && principal.tenantId) {
    if (principal.organizationId !== principal.tenantId) {
      throw new Error("organizationId and tenantId must refer to the same organization.");
    }
  }
  return { userId: principal.userId.trim(), organizationId: organizationId.trim() };
}

export function createInternalPrincipalAssertion(
  principal: PrincipalAssertionInput,
  secret: string,
  now = Date.now(),
): string {
  if (!secret) throw new Error("Internal principal secret and identity are required.");
  const normalized = normalizePrincipal(principal);
  const payload: AssertionPayload = {
    userId: normalized.userId,
    organizationId: normalized.organizationId,
    principalKind: principal.principalKind ?? "user",
    exp: now + 60_000,
    nonce: randomUUID(),
    v: 2,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export interface VerifyAssertionOptions {
  checkReplay?: boolean;
}

export function verifyInternalPrincipalAssertion(
  value: string | null,
  secret: string,
  now = Date.now(),
  options: VerifyAssertionOptions = {},
): AuthenticatedPrincipal | null {
  if (!value || !secret) return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return null;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as Partial<AssertionPayload>;
    // Strict v2 validation (T067 / T102 / D-3)
    if (parsed.v !== 2) return null;
    if (typeof parsed.organizationId !== "string" || !parsed.organizationId.trim()) return null;
    if (typeof parsed.userId !== "string" || !parsed.userId.trim()) return null;
    if (typeof parsed.nonce !== "string" || !parsed.nonce.trim()) return null;
    if (typeof parsed.exp !== "number" || parsed.exp <= now) return null;
    if (parsed.exp > now + 300_000) return null;
    if (parsed.principalKind !== undefined && parsed.principalKind !== "user" && parsed.principalKind !== "service") return null;

    const checkReplay = options.checkReplay ?? true;
    if (checkReplay && !checkAndRecordNonce(parsed.nonce, parsed.exp, now)) {
      return null;
    }

    const orgId = parsed.organizationId.trim();
    return {
      userId: parsed.userId.trim(),
      organizationId: orgId,
      tenantId: orgId,
      principalKind: parsed.principalKind ?? "user",
    };
  } catch {
    return null;
  }
}
