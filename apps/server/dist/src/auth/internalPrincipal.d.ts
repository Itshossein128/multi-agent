export type AuthenticatedPrincipal = {
    userId: string;
    tenantId: string;
};
export declare function createInternalPrincipalAssertion(principal: AuthenticatedPrincipal, secret: string, now?: number): string;
export declare function verifyInternalPrincipalAssertion(value: string | null, secret: string, now?: number): AuthenticatedPrincipal | null;
