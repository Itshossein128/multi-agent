"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryMemoryStore = void 0;
const storage_utils_1 = require("./storage-utils");
const contracts_1 = require("../contracts");
/** Test adapter: all public operations share a mutex, including writes outside transactions. */
class InMemoryMemoryStore {
    now;
    transactional;
    records = new Map();
    tail = Promise.resolve();
    active = true;
    constructor(now = () => new Date(), transactional = false) {
        this.now = now;
        this.transactional = transactional;
    }
    async run(operation) {
        if (!this.active)
            throw new Error("Memory transaction is closed");
        if (this.transactional)
            return operation();
        const previous = this.tail;
        let release;
        this.tail = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
    async transaction(_key, operation) {
        if (!_key || this.transactional)
            throw new contracts_1.MemoryValidationError("A nonempty key and non-nested memory transaction are required");
        return this.run(async () => {
            const child = new InMemoryMemoryStore(this.now, true);
            child.records = structuredClone(this.records);
            try {
                const result = await operation(child);
                this.records = child.records;
                return result;
            }
            finally {
                child.active = false;
            }
        });
    }
    key(tenant, id) { return JSON.stringify([tenant, id]); }
    unique(memory) {
        for (const item of this.records.values())
            if (item.id !== memory.id && memory.idempotencyKey !== undefined && item.tenantId === memory.tenantId && item.namespace.scope === memory.namespace.scope && item.namespace.id === memory.namespace.id && item.idempotencyKey === memory.idempotencyKey)
                throw new storage_utils_1.MemoryDuplicateError();
    }
    async insert(memory) {
        return this.run(() => { (0, storage_utils_1.validateMemory)(memory); const key = this.key(memory.tenantId, memory.id); if (this.records.has(key))
            throw new storage_utils_1.MemoryDuplicateError(); this.unique(memory); this.records.set(key, structuredClone(memory)); });
    }
    async update(memory, expectedVersion) {
        return this.run(() => {
            (0, storage_utils_1.validateMemory)(memory);
            const key = this.key(memory.tenantId, memory.id), old = this.records.get(key);
            if (!old || old.version !== expectedVersion || memory.version !== expectedVersion + 1 || old.namespace.scope !== memory.namespace.scope || old.namespace.id !== memory.namespace.id)
                throw new storage_utils_1.MemoryVersionConflictError();
            this.unique(memory);
            this.records.set(key, structuredClone(memory));
        });
    }
    async get(tenantId, id) { (0, storage_utils_1.validateScope)(tenantId); return this.run(() => structuredClone(this.records.get(this.key(tenantId, id)) ?? null)); }
    async delete(tenantId, id) { (0, storage_utils_1.validateScope)(tenantId); return this.run(() => { this.records.delete(this.key(tenantId, id)); }); }
    async search(query) {
        (0, storage_utils_1.validateScope)(query.tenantId, query.namespaces);
        return this.run(() => {
            const { limit, offset } = (0, storage_utils_1.bounds)(query);
            (0, storage_utils_1.validateEmbedding)(query.embedding, query.embeddingMetadata);
            const time = this.now().getTime();
            const rows = [...this.records.values()].filter(m => m.tenantId === query.tenantId && query.namespaces.some(n => n.scope === m.namespace.scope && n.id === m.namespace.id)
                && (query.contentHash === undefined || m.contentHash === query.contentHash) && (query.idempotencyKey === undefined || m.idempotencyKey === query.idempotencyKey) && (query.subject === undefined || m.subject === query.subject)
                && (!query.kinds || query.kinds.includes(m.kind)) && m.status === (query.status ?? "active")
                && (query.includeExpired || !m.expiresAt || Date.parse(m.expiresAt) > time) && (!query.filters || (0, storage_utils_1.contains)(m.metadata ?? {}, query.filters))
                && (!query.embedding ? !query.text || m.content.toLowerCase().includes(query.text.toLowerCase()) : !!m.embedding && m.embeddingMetadata?.provider === query.embeddingMetadata?.provider && m.embeddingMetadata?.model === query.embeddingMetadata?.model && m.embeddingMetadata?.version === query.embeddingMetadata?.version && m.embeddingMetadata?.dimensions === query.embeddingMetadata?.dimensions));
            rows.sort((a, b) => (query.embedding ? (0, storage_utils_1.cosine)(query.embedding, b.embedding) - (0, storage_utils_1.cosine)(query.embedding, a.embedding) : 0) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
            return structuredClone(rows.slice(offset, offset + limit));
        });
    }
    async deleteNamespace(tenantId, namespace) {
        (0, storage_utils_1.validateScope)(tenantId, [namespace]);
        return this.run(() => { let count = 0; for (const [key, m] of this.records)
            if (m.tenantId === tenantId && m.namespace.scope === namespace.scope && m.namespace.id === namespace.id) {
                this.records.delete(key);
                count++;
            } return count; });
    }
    async deleteExpired(tenantId, namespace, before = this.now(), limit = 500) {
        (0, storage_utils_1.validateScope)(tenantId, [namespace]);
        return this.run(() => { const batch = (0, storage_utils_1.bounds)({ limit }).limit; let count = 0; for (const [key, m] of this.records)
            if (count < batch && m.tenantId === tenantId && m.namespace.scope === namespace.scope && m.namespace.id === namespace.id && m.expiresAt && Date.parse(m.expiresAt) <= before.getTime()) {
                this.records.delete(key);
                count++;
            } return count; });
    }
}
exports.InMemoryMemoryStore = InMemoryMemoryStore;
//# sourceMappingURL=in-memory-memory-store.js.map