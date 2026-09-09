import type { Memory, MemoryAccessContext, MemoryNamespace } from "../contracts";
export { MemoryAccessDeniedError as MemoryAccessError } from "../contracts";
export declare function requireAccess(access: MemoryAccessContext): void;
export declare function sameNamespace(a: MemoryNamespace, b: MemoryNamespace): boolean;
export declare function canUseNamespace(namespace: MemoryNamespace, access: MemoryAccessContext, write?: boolean): boolean;
export declare function requireNamespaces(namespaces: MemoryNamespace[], access: MemoryAccessContext, write?: boolean): void;
export declare function canAccessMemory(memory: Memory, access: MemoryAccessContext, write?: boolean): boolean;
export declare function namespaceKey(tenant: string, namespace: MemoryNamespace): string;
export declare function normalizeContent(content: string): string;
export declare function contentHash(content: string): string;
/** Reserved application identity state; never writable or exposed through public metadata. */
export declare const IDEMPOTENCY_METADATA_KEY = "__memory_idempotency";
export declare function publicMemory(memory: Memory): Memory;
export declare function isLive(memory: Memory, now: number): boolean;
export declare function matchesFilters(memory: Memory, filters?: Record<string, unknown>): boolean;
export declare function boundedInteger(value: number | undefined, fallback: number, maximum: number): number;
