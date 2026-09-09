"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresMemoryStore = void 0;
const contracts_1 = require("../contracts");
const storage_utils_1 = require("./storage-utils");
// Every field has an explicit column. JSONB is reserved for structured data, source and metadata.
const fields = {
    id: "id", tenantId: "tenant_id", kind: "kind", visibility: "visibility", content: "content", subject: "subject",
    structuredData: "structured_data", situation: "situation", action: "action", result: "result", lesson: "lesson", success: "success",
    title: "title", procedure: "procedure", trigger: "trigger", importance: "importance", confidence: "confidence", source: "source",
    status: "status", supersedesMemoryId: "supersedes_memory_id", supersededByMemoryId: "superseded_by_memory_id",
    createdAt: "created_at", updatedAt: "updated_at", expiresAt: "expires_at", embedding: "embedding", metadata: "metadata",
    idempotencyKey: "idempotency_key", contentHash: "content_hash", version: "version", lastAccessedAt: "last_accessed_at",
    accessCount: "access_count", reinforcementCount: "reinforcement_count",
};
const jsonFields = new Set(["structuredData", "source", "metadata"]);
const entries = Object.entries(fields);
const columns = [...entries.map(([, column]) => column), "namespace_scope", "namespace_id", "embedding_provider", "embedding_model", "embedding_dimensions", "embedding_version"];
function values(memory) {
    return [...entries.map(([key]) => memory[key] == null ? null : jsonFields.has(key) ? JSON.stringify(memory[key]) : memory[key]),
        memory.namespace.scope, memory.namespace.id, memory.embeddingMetadata?.provider ?? null, memory.embeddingMetadata?.model ?? null, memory.embeddingMetadata?.dimensions ?? null, memory.embeddingMetadata?.version ?? null];
}
function decode(row) {
    const memory = {};
    for (const [key, column] of entries)
        if (row[column] != null)
            memory[key] = row[column] instanceof Date ? row[column].toISOString() : row[column];
    memory.namespace = { scope: row.namespace_scope, id: row.namespace_id };
    if (row.embedding_provider != null)
        memory.embeddingMetadata = { provider: row.embedding_provider, model: row.embedding_model, dimensions: row.embedding_dimensions, version: row.embedding_version };
    return memory;
}
class PostgresMemoryStore {
    pool;
    options;
    client;
    active = true;
    constructor(pool, options = {}, client) {
        this.pool = pool;
        this.options = options;
        this.client = client;
    }
    async query(sql, parameters = []) {
        if (!this.active)
            throw new Error("Memory transaction is closed");
        try {
            return await (this.client ?? this.pool).query(sql, parameters);
        }
        catch (error) {
            if (error.code === "23505")
                throw new storage_utils_1.MemoryDuplicateError();
            throw error;
        }
    }
    async transaction(key, operation) {
        if (!this.active)
            throw new Error("Memory transaction is closed");
        if (!key)
            throw new contracts_1.MemoryValidationError("Memory transaction key is required");
        if (this.client)
            throw new contracts_1.MemoryValidationError("Nested PostgreSQL memory transactions are unsupported");
        const client = await this.pool.connect();
        const store = new PostgresMemoryStore(this.pool, this.options, client);
        try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
            const result = await operation(store);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            try {
                await client.query("ROLLBACK");
            }
            catch { /* Preserve the operation error. */ }
            throw error;
        }
        finally {
            store.active = false;
            client.release();
        }
    }
    async insert(memory) {
        (0, storage_utils_1.validateMemory)(memory);
        await this.query(`INSERT INTO studio_memories (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, values(memory));
    }
    async update(memory, expectedVersion) {
        (0, storage_utils_1.validateMemory)(memory);
        if (memory.version !== expectedVersion + 1)
            throw new storage_utils_1.MemoryVersionConflictError();
        const data = values(memory);
        const bind = (value) => { data.push(value); return `$${data.length}`; };
        const where = `tenant_id = ${bind(memory.tenantId)} AND id = ${bind(memory.id)} AND namespace_scope = ${bind(memory.namespace.scope)} AND namespace_id = ${bind(memory.namespace.id)} AND version = ${bind(expectedVersion)}`;
        const result = await this.query(`UPDATE studio_memories SET ${columns.map((c, i) => `"${c}" = $${i + 1}`).join(", ")} WHERE ${where}`, data);
        if (!result.rowCount)
            throw new storage_utils_1.MemoryVersionConflictError();
    }
    async get(tenantId, id) {
        (0, storage_utils_1.validateScope)(tenantId);
        const result = await this.query("SELECT * FROM studio_memories WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
        return result.rows.length ? decode(result.rows[0]) : null;
    }
    async delete(tenantId, id) {
        (0, storage_utils_1.validateScope)(tenantId);
        await this.query("DELETE FROM studio_memories WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
    }
    async search(query) {
        (0, storage_utils_1.validateScope)(query.tenantId, query.namespaces);
        const { limit, offset } = (0, storage_utils_1.bounds)(query);
        (0, storage_utils_1.validateEmbedding)(query.embedding, query.embeddingMetadata);
        if (!query.namespaces.length)
            return [];
        const parameters = [];
        const bind = (value) => { parameters.push(value); return `$${parameters.length}`; };
        const clauses = [`tenant_id = ${bind(query.tenantId)}`, `(${query.namespaces.map(n => `(namespace_scope = ${bind(n.scope)} AND namespace_id = ${bind(n.id)})`).join(" OR ")})`, `status = ${bind(query.status ?? "active")}`];
        if (!query.includeExpired)
            clauses.push("(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)");
        if (query.kinds)
            clauses.push(`kind = ANY(${bind(query.kinds)}::text[])`);
        if (query.filters) {
            // Nonempty containment must reference the indexed column directly. Keep
            // NULL metadata matching an empty object filter, as the test adapter does.
            const metadata = Object.keys(query.filters).length ? "metadata" : "COALESCE(metadata, '{}'::jsonb)";
            clauses.push(`${metadata} @> ${bind(JSON.stringify(query.filters))}::jsonb`);
        }
        if (query.contentHash !== undefined)
            clauses.push(`content_hash = ${bind(query.contentHash)}`);
        if (query.idempotencyKey !== undefined)
            clauses.push(`idempotency_key = ${bind(query.idempotencyKey)}`);
        if (query.subject !== undefined)
            clauses.push(`subject = ${bind(query.subject)}`);
        let order = "updated_at DESC, id ASC", prefix = "";
        if (query.embedding) {
            if (!this.options.vectorEnabled)
                throw new contracts_1.MemoryValidationError("Vector search requires the optional pgvector migration and vectorEnabled");
            const meta = query.embeddingMetadata;
            clauses.push("embedding_vector IS NOT NULL", `embedding_provider = ${bind(meta.provider)}`, `embedding_model = ${bind(meta.model)}`, `embedding_dimensions = ${bind(meta.dimensions)}`, `embedding_version = ${bind(meta.version)}`);
            order = `embedding_vector <=> ${bind(JSON.stringify(query.embedding))}::vector, ${order}`;
            // Materialization forces an exact scan over the filtered set, even if an ANN index exists.
            prefix = `WITH candidates AS MATERIALIZED (SELECT * FROM studio_memories WHERE ${clauses.join(" AND ")}) `;
        }
        else if (query.text)
            clauses.push(`strpos(lower(content), lower(${bind(query.text)})) > 0`);
        const sql = `${prefix}SELECT * FROM ${prefix ? "candidates" : `studio_memories WHERE ${clauses.join(" AND ")}`} ORDER BY ${order} LIMIT ${bind(limit)} OFFSET ${bind(offset)}`;
        return (await this.query(sql, parameters)).rows.map(decode);
    }
    async deleteNamespace(tenantId, namespace) {
        (0, storage_utils_1.validateScope)(tenantId, [namespace]);
        return (await this.query("DELETE FROM studio_memories WHERE tenant_id = $1 AND namespace_scope = $2 AND namespace_id = $3", [tenantId, namespace.scope, namespace.id])).rowCount ?? 0;
    }
    async deleteExpired(tenantId, namespace, before = new Date(), limit = 500) {
        (0, storage_utils_1.validateScope)(tenantId, [namespace]);
        return (await this.query(`WITH expired AS (SELECT tenant_id, id FROM studio_memories WHERE tenant_id = $1 AND namespace_scope = $2 AND namespace_id = $3 AND expires_at <= $4 ORDER BY expires_at, id LIMIT $5 FOR UPDATE SKIP LOCKED)
      DELETE FROM studio_memories m USING expired e WHERE m.tenant_id = e.tenant_id AND m.id = e.id`, [tenantId, namespace.scope, namespace.id, before, (0, storage_utils_1.bounds)({ limit }).limit])).rowCount ?? 0;
    }
}
exports.PostgresMemoryStore = PostgresMemoryStore;
//# sourceMappingURL=postgres-memory-store.js.map