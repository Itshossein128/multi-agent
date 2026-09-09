import { createHash, timingSafeEqual } from "node:crypto";
import { isMemoryNamespace } from "@multi-agent/types";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";

export type MemoryAccessResolver = (request: Request) => Promise<MemoryAccessContext | null>;
export interface MemoryPrincipal extends MemoryAccessContext { token: string }
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Tokens and grants are provisioned on the server; request IDs never create grants. */
export function createMemoryAccessResolver(principals: MemoryPrincipal[]): MemoryAccessResolver {
  const configured = principals.map(({ token, ...access }) => {
    if (typeof token !== "string" || token.length < 24 || !access.principalId || !access.tenantId
      || !Array.isArray(access.readableNamespaces) || !Array.isArray(access.writableNamespaces)
      || access.readableNamespaces.length > 100 || access.writableNamespaces.length > 100
      || !access.readableNamespaces.every(isMemoryNamespace) || !access.writableNamespaces.every(isMemoryNamespace)) {
      throw new Error("Invalid server memory principal configuration.");
    }
    return { tokenHash: digest(token), access: structuredClone(access) };
  });
  return async (request) => {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return null;
    const hash = digest(authorization.slice(7));
    const match = configured.find((principal) => timingSafeEqual(principal.tokenHash, hash));
    return match ? structuredClone(match.access) : null;
  };
}

export function memoryAccessResolverFromEnvironment(): MemoryAccessResolver {
  const raw = process.env.MEMORY_PRINCIPALS;
  if (!raw) return async () => null;
  try {
    const principals: unknown = JSON.parse(raw);
    if (!Array.isArray(principals) || principals.length > 100) throw new Error();
    return createMemoryAccessResolver(principals as MemoryPrincipal[]);
  } catch { throw new Error("MEMORY_PRINCIPALS must contain valid server-owned principal/grant configuration."); }
}
