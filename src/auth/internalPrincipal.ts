import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
export type AuthenticatedPrincipal = { userId: string; tenantId: string };
type Assertion = AuthenticatedPrincipal & { exp: number; nonce: string };
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");
export function createInternalPrincipalAssertion(principal: AuthenticatedPrincipal, secret: string, now = Date.now()): string {
  if (!secret || !principal.userId || !principal.tenantId) throw new Error("Internal principal secret and identity are required.");
  const body = Buffer.from(JSON.stringify({ ...principal, exp: now + 60_000, nonce: randomUUID() })).toString("base64url"); return `${body}.${sign(body, secret)}`;
}
export function verifyInternalPrincipalAssertion(value: string | null, secret: string, now = Date.now()): AuthenticatedPrincipal | null {
  if (!value || !secret) return null; const [body, signature, extra] = value.split("."); if (!body || !signature || extra) return null;
  const expected = Buffer.from(sign(body, secret)), received = Buffer.from(signature); if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try { const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as Assertion; return typeof parsed.userId === "string" && typeof parsed.tenantId === "string" && typeof parsed.nonce === "string" && parsed.exp > now ? { userId: parsed.userId, tenantId: parsed.tenantId } : null; } catch { return null; }
}
