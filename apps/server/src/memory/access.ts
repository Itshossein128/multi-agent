import { createHash, timingSafeEqual } from "node:crypto";
import { isMemoryNamespace, type MemoryNamespace } from "@multi-agent/types";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import type { RequestPrincipal } from "../auth/principal";

export type MemoryAccessResolver = (request: Request) => Promise<MemoryAccessContext | null>;
export interface MemoryPrincipal extends MemoryAccessContext { token: string }
const digest = (value: string) => createHash("sha256").update(value).digest();

export interface DeriveMemoryAccessOptions {
  agentId?: string;
  workflowId?: string;
  projectId?: string;
}

/**
 * Derive memory grants from OrganizationContext for user runs and requests (D-9, FR-107, T061).
 * Binds organization namespace IDs to the selected organization.
 */
export function deriveMemoryAccessFromPrincipal(
  principal: RequestPrincipal,
  options: DeriveMemoryAccessOptions = {},
): MemoryAccessContext {
  const tenantId = principal.tenantId;
  const principalId = principal.userId;
  const permissions = principal.permissions ?? [];

  const readableNamespaces: MemoryNamespace[] = [
    { scope: "user", id: principalId },
  ];
  const writableNamespaces: MemoryNamespace[] = [
    { scope: "user", id: principalId },
  ];

  if (options.agentId) {
    readableNamespaces.push({ scope: "agent", id: options.agentId });
    writableNamespaces.push({ scope: "agent", id: options.agentId });
  }

  if (options.projectId) {
    if (permissions.length === 0 || permissions.includes("resources.read")) {
      readableNamespaces.push({ scope: "project", id: options.projectId });
    }
    if (permissions.length === 0 || permissions.includes("resources.write")) {
      writableNamespaces.push({ scope: "project", id: options.projectId });
    }
  }

  if (options.workflowId) {
    readableNamespaces.push({ scope: "workflow", id: options.workflowId });
    writableNamespaces.push({ scope: "workflow", id: options.workflowId });
  }

  // Organization memory scope:
  // Read grant: any active member (has memory.org.read).
  // Write/forget grant: admin/owner (has memory.org.write).
  const orgNamespace: MemoryNamespace = { scope: "organization", id: tenantId };
  if (permissions.length === 0 || permissions.includes("memory.org.read")) {
    readableNamespaces.push(orgNamespace);
  }
  if (permissions.includes("memory.org.write")) {
    writableNamespaces.push(orgNamespace);
  }

  return {
    principalId,
    tenantId,
    agentId: options.agentId,
    workflowId: options.workflowId,
    readableNamespaces,
    writableNamespaces,
  };
}

/** Tokens and grants are provisioned on the server; request IDs never create grants. */
export function createMemoryAccessResolver(
  principals: MemoryPrincipal[],
  resolvePrincipal?: (request: Request) => RequestPrincipal | null,
): MemoryAccessResolver {
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
    if (authorization?.startsWith("Bearer ")) {
      const hash = digest(authorization.slice(7));
      const match = configured.find((principal) => timingSafeEqual(principal.tokenHash, hash));
      return match ? structuredClone(match.access) : null;
    }
    if (resolvePrincipal) {
      const principal = resolvePrincipal(request);
      if (principal) {
        return deriveMemoryAccessFromPrincipal(principal);
      }
    }
    return null;
  };
}

export function memoryAccessResolverFromEnvironment(
  resolvePrincipal?: (request: Request) => RequestPrincipal | null,
): MemoryAccessResolver {
  const raw = process.env.MEMORY_PRINCIPALS;
  if (!raw) {
    if (resolvePrincipal) {
      return async (request) => {
        const principal = resolvePrincipal(request);
        return principal ? deriveMemoryAccessFromPrincipal(principal) : null;
      };
    }
    return async () => null;
  }
  try {
    const principals: unknown = JSON.parse(raw);
    if (!Array.isArray(principals) || principals.length > 100) throw new Error();
    return createMemoryAccessResolver(principals as MemoryPrincipal[], resolvePrincipal);
  } catch { throw new Error("MEMORY_PRINCIPALS must contain valid server-owned principal/grant configuration."); }
}
