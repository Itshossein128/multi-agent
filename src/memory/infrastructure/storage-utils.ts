import type { Memory, MemoryStoreQuery } from "../contracts";
import { MemoryConflictError, MemoryValidationError } from "../contracts";
import { isMemoryNamespace } from "@multi-agent/types";

export class MemoryVersionConflictError extends MemoryConflictError {
  constructor() { super("Memory version conflict or record not found"); this.name = "MemoryVersionConflictError"; }
}
export class MemoryDuplicateError extends MemoryConflictError {
  constructor() { super("Memory identity or idempotency key already exists"); this.name = "MemoryDuplicateError"; }
}
export const MAX_MEMORY_CANDIDATES = 500;
export function bounds(query: Pick<MemoryStoreQuery, "limit" | "offset">): { limit: number; offset: number } {
  if (!Number.isInteger(query.limit) || query.limit < 1 || !Number.isInteger(query.offset ?? 0) || (query.offset ?? 0) < 0) throw new MemoryValidationError("Invalid memory search bounds");
  return { limit: Math.min(query.limit, MAX_MEMORY_CANDIDATES), offset: query.offset ?? 0 };
}
export function validateEmbedding(vector?: number[], metadata?: Memory["embeddingMetadata"]): void {
  if (!vector) return;
  if (!metadata || vector.length !== metadata.dimensions || !vector.length || vector.some(v => !Number.isFinite(v)) || !vector.some(v => v !== 0)) throw new MemoryValidationError("Invalid memory embedding or metadata");
}
export function validateMemory(memory: Memory): void {
  validateScope(memory.tenantId, [memory.namespace]);
  if (!memory.id || !Number.isInteger(memory.version) || memory.version < 1) throw new MemoryValidationError("Invalid memory identity or version");
  validateEmbedding(memory.embedding, memory.embeddingMetadata);
}
export function validateScope(tenantId: string, namespaces: Memory["namespace"][] = []): void {
  if (typeof tenantId !== "string" || !tenantId.trim() || !Array.isArray(namespaces) || namespaces.some(n => !isMemoryNamespace(n))) throw new MemoryValidationError("Memory tenant and exact namespaces are required");
}
/** Matches JSONB containment for JSON objects/arrays and scalar values. */
export function contains(value: unknown, filter: unknown): boolean {
  if (Array.isArray(filter)) return Array.isArray(value) && filter.every(f => value.some(v => contains(v, f)));
  if (filter && typeof filter === "object") return !!value && typeof value === "object" && Object.entries(filter).every(([k, v]) => contains((value as Record<string, unknown>)[k], v));
  return value === filter;
}
export function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
}
