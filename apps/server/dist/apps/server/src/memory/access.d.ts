import type { MemoryAccessContext } from "../../../../src/memory/contracts";
export type MemoryAccessResolver = (request: Request) => Promise<MemoryAccessContext | null>;
export interface MemoryPrincipal extends MemoryAccessContext {
    token: string;
}
/** Tokens and grants are provisioned on the server; request IDs never create grants. */
export declare function createMemoryAccessResolver(principals: MemoryPrincipal[]): MemoryAccessResolver;
export declare function memoryAccessResolverFromEnvironment(): MemoryAccessResolver;
