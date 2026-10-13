import {
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
  type VerifyAssertionOptions,
} from "../../../../src/auth/internalPrincipal";
export type RequestPrincipal = AuthenticatedPrincipal;
export const INTERNAL_PRINCIPAL_HEADER = "X-Multi-Agent-Principal";
export function resolveRequestPrincipal(
  request: Request,
  secret = process.env.INTERNAL_PRINCIPAL_SECRET ?? "",
  now = Date.now(),
  options?: VerifyAssertionOptions,
): RequestPrincipal | null {
  return verifyInternalPrincipalAssertion(request.headers.get(INTERNAL_PRINCIPAL_HEADER), secret, now, options);
}
