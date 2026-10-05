import type { Memory, MemoryNamespace, MemoryStore, MemoryStoreQuery } from "../contracts";
import { bounds, contains, cosine, MemoryDuplicateError, MemoryVersionConflictError, validateEmbedding, validateMemory, validateScope } from "./storage-utils";
import { MemoryValidationError } from "../contracts";

/** Test adapter: all public operations share a mutex, including writes outside transactions. */
export class InMemoryMemoryStore implements MemoryStore {
  private records = new Map<string, Memory>();
  private tail: Promise<void> = Promise.resolve();
  private active = true;
  constructor(private readonly now: () => Date = () => new Date(), private readonly transactional = false) {}
  private async run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (!this.active) throw new Error("Memory transaction is closed");
    if (this.transactional) return operation();
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
  async transaction<T>(_key: string, operation: (store: MemoryStore) => Promise<T>): Promise<T> {
    if (!_key || this.transactional) throw new MemoryValidationError("A nonempty key and non-nested memory transaction are required");
    return this.run(async () => {
      const child = new InMemoryMemoryStore(this.now, true);
      child.records = structuredClone(this.records);
      try { const result = await operation(child); this.records = child.records; return result; }
      finally { child.active = false; }
    });
  }
  private key(tenant: string, id: string): string { return JSON.stringify([tenant, id]); }
  private unique(memory: Memory): void {
    for (const item of this.records.values()) if (item.id !== memory.id && memory.idempotencyKey !== undefined && item.tenantId === memory.tenantId && item.namespace.scope === memory.namespace.scope && item.namespace.id === memory.namespace.id && item.idempotencyKey === memory.idempotencyKey) throw new MemoryDuplicateError();
  }
  async insert(memory: Memory): Promise<void> {
    return this.run(() => { validateMemory(memory); const key = this.key(memory.tenantId, memory.id); if (this.records.has(key)) throw new MemoryDuplicateError(); this.unique(memory); this.records.set(key, structuredClone(memory)); });
  }
  async update(memory: Memory, expectedVersion: number): Promise<void> {
    return this.run(() => {
      validateMemory(memory);
      const key = this.key(memory.tenantId, memory.id), old = this.records.get(key);
      if (!old || old.version !== expectedVersion || memory.version !== expectedVersion + 1 || old.namespace.scope !== memory.namespace.scope || old.namespace.id !== memory.namespace.id) throw new MemoryVersionConflictError();
      this.unique(memory); this.records.set(key, structuredClone(memory));
    });
  }
  async get(tenantId: string, id: string): Promise<Memory | null> { validateScope(tenantId); return this.run(() => structuredClone(this.records.get(this.key(tenantId, id)) ?? null)); }
  async delete(tenantId: string, id: string): Promise<void> { validateScope(tenantId); return this.run(() => { this.records.delete(this.key(tenantId, id)); }); }
  async search(query: MemoryStoreQuery): Promise<Memory[]> {
    validateScope(query.tenantId, query.namespaces);
    return this.run(() => {
      const { limit, offset } = bounds(query); validateEmbedding(query.embedding, query.embeddingMetadata);
      const time = this.now().getTime();
      const rows = [...this.records.values()].filter(m => m.tenantId === query.tenantId && query.namespaces.some(n => n.scope === m.namespace.scope && n.id === m.namespace.id)
        && (query.contentHash === undefined || m.contentHash === query.contentHash) && (query.idempotencyKey === undefined || m.idempotencyKey === query.idempotencyKey) && (query.subject === undefined || m.subject === query.subject)
        && (!query.kinds || query.kinds.includes(m.kind)) && m.status === (query.status ?? "active")
        && (query.includeExpired || !m.expiresAt || Date.parse(m.expiresAt) > time) && (!query.filters || contains(m.metadata ?? {}, query.filters))
        && (!query.embedding ? !query.text || m.content.toLowerCase().includes(query.text.toLowerCase()) : !!m.embedding && m.embeddingMetadata?.provider === query.embeddingMetadata?.provider && m.embeddingMetadata?.model === query.embeddingMetadata?.model && m.embeddingMetadata?.version === query.embeddingMetadata?.version && m.embeddingMetadata?.dimensions === query.embeddingMetadata?.dimensions));
      rows.sort((a, b) => (query.embedding ? cosine(query.embedding, b.embedding!) - cosine(query.embedding, a.embedding!) : 0) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
      return structuredClone(rows.slice(offset, offset + limit));
    });
  }
  async listNamespaces(limit = 1000): Promise<Array<{ tenantId: string; namespace: MemoryNamespace }>> {
    return this.run(() => {
      const seen = new Set<string>();
      const result: Array<{ tenantId: string; namespace: MemoryNamespace }> = [];
      for (const memory of this.records.values()) {
        const key = JSON.stringify([memory.tenantId, memory.namespace.scope, memory.namespace.id]);
        if (seen.has(key)) continue;
        seen.add(key); result.push({ tenantId: memory.tenantId, namespace: { ...memory.namespace } });
        if (result.length >= limit) break;
      }
      return result;
    });
  }
  async deleteNamespace(tenantId: string, namespace: MemoryNamespace): Promise<number> {
    validateScope(tenantId, [namespace]);
    return this.run(() => { let count = 0; for (const [key, m] of this.records) if (m.tenantId === tenantId && m.namespace.scope === namespace.scope && m.namespace.id === namespace.id) { this.records.delete(key); count++; } return count; });
  }
  async deleteExpired(tenantId: string, namespace: MemoryNamespace, before = this.now(), limit = 500): Promise<number> {
    validateScope(tenantId, [namespace]);
    return this.run(() => { const batch = bounds({ limit }).limit; let count = 0; for (const [key, m] of this.records) if (count < batch && m.tenantId === tenantId && m.namespace.scope === namespace.scope && m.namespace.id === namespace.id && m.expiresAt && Date.parse(m.expiresAt) <= before.getTime()) { this.records.delete(key); count++; } return count; });
  }
}
