import { type AuthenticatedPrincipal } from "../../../../src/auth/internalPrincipal";
export type RequestPrincipal = AuthenticatedPrincipal;
export declare const INTERNAL_PRINCIPAL_HEADER = "X-Multi-Agent-Principal";
export declare function resolveRequestPrincipal(request: Request, secret?: string): RequestPrincipal | null;
export * from "./authorization";
