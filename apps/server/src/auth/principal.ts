import {
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
  type VerifyAssertionOptions,
} from "../../../../src/auth/internalPrincipal";
export type RequestPrincipal = AuthenticatedPrincipal;
export const INTERNAL_PRINCIPAL_HEADER = "X-Multi-Agent-Principal";
// Authentication is request-scoped: routers and memory access share one verified
// transport assertion. A new Request still goes through the replay guard.
const verifiedRequests = new WeakMap<Request, { assertion: string; secret: string }>();
export function resolveRequestPrincipal(
  request: Request,
  secret = process.env.INTERNAL_PRINCIPAL_SECRET ?? "",
  now = Date.now(),
  options?: VerifyAssertionOptions,
): RequestPrincipal | null {
  const assertion = request.headers.get(INTERNAL_PRINCIPAL_HEADER);
  const verified = verifiedRequests.get(request);
  const sameRequest = verified?.assertion === assertion && verified?.secret === secret;
  const principal = verifyInternalPrincipalAssertion(assertion, secret, now,
    sameRequest ? { ...options, checkReplay: false } : options);
  if (principal && assertion && options?.checkReplay !== false) {
    verifiedRequests.set(request, { assertion, secret });
  }
  return principal;
}
