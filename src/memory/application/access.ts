import { createHash } from "node:crypto";
import type { Memory, MemoryAccessContext, MemoryNamespace } from "../contracts";
import { MemoryAccessDeniedError, MemoryValidationError } from "../contracts";
import { isMemoryNamespace } from "@multi-agent/types";

export { MemoryAccessDeniedError as MemoryAccessError } from "../contracts";
export function requireAccess(access: MemoryAccessContext): void {
  if (!access || typeof access.principalId !== "string" || !access.principalId.trim() || typeof access.tenantId !== "string" || !access.tenantId.trim() || !Array.isArray(access.readableNamespaces) || !Array.isArray(access.writableNamespaces)) throw new MemoryAccessDeniedError();
}
export function sameNamespace(a: MemoryNamespace, b: MemoryNamespace): boolean { return a.scope === b.scope && a.id === b.id; }
export function canUseNamespace(namespace: MemoryNamespace, access: MemoryAccessContext, write = false): boolean {
  requireAccess(access);
  return isMemoryNamespace(namespace) && (write ? access.writableNamespaces : access.readableNamespaces).some(n => isMemoryNamespace(n) && sameNamespace(n, namespace))
    && !(namespace.scope === "agent" && access.agentId !== undefined && namespace.id !== access.agentId)
    && !(namespace.scope === "workflow" && access.workflowId !== undefined && namespace.id !== access.workflowId);
}
export function requireNamespaces(namespaces: MemoryNamespace[], access: MemoryAccessContext, write = false): void {
  requireAccess(access);
  if (!Array.isArray(namespaces) || namespaces.some(n => !canUseNamespace(n, access, write))) throw new MemoryAccessDeniedError();
}
export function canAccessMemory(memory: Memory, access: MemoryAccessContext, write = false): boolean {
  return memory.tenantId === access.tenantId && canUseNamespace(memory.namespace, access, write)
    && !(memory.visibility === "private" && access.agentId !== undefined && (memory.namespace.scope === "agent" ? memory.namespace.id : memory.source.agentId) !== access.agentId)
    && !(memory.visibility === "workflow" && access.workflowId !== undefined && (memory.namespace.scope === "workflow" ? memory.namespace.id : memory.source.workflowId) !== access.workflowId);
}
export function namespaceKey(tenant: string, namespace: MemoryNamespace): string { return JSON.stringify([tenant, namespace.scope, namespace.id]); }
export function normalizeContent(content: string): string { return content.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, ""); }
export function contentHash(content: string): string { return createHash("sha256").update(normalizeContent(content), "utf8").digest("hex"); }
/** Reserved application identity state; never writable or exposed through public metadata. */
export const IDEMPOTENCY_METADATA_KEY = "__memory_idempotency";
export function publicMemory(memory: Memory): Memory {
  const { embedding: _embedding, embeddingMetadata: _embeddingMetadata, ...rest } = memory;
  const result = structuredClone(rest);
  if (result.metadata) {
    delete result.metadata[IDEMPOTENCY_METADATA_KEY];
    if (!Object.keys(result.metadata).length) delete result.metadata;
  }
  return result;
}
export function isLive(memory: Memory, now: number): boolean { return memory.status === "active" && (!memory.expiresAt || Date.parse(memory.expiresAt) > now); }
export function matchesFilters(memory: Memory, filters?: Record<string, unknown>): boolean {
  const contains = (value: unknown, filter: unknown): boolean => {
    if (Array.isArray(filter)) return Array.isArray(value) && filter.every(f => value.some(v => contains(v, f)));
    if (filter && typeof filter === "object") return !!value && typeof value === "object" && Object.entries(filter).every(([key, f]) => Object.prototype.hasOwnProperty.call(value, key) && contains((value as Record<string, unknown>)[key], f));
    return value === filter;
  };
  return !filters || contains(memory.metadata ?? {}, filters);
}
export function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new MemoryValidationError("Invalid memory limit");
  return Math.min(maximum, Math.floor(value));
}
