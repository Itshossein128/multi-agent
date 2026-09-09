"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultMemoryService = void 0;
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../contracts");
const access_1 = require("./access");
const embedding_1 = require("./embedding");
const hybridMemoryRetriever_1 = require("./hybridMemoryRetriever");
const memoryWritePolicy_1 = require("./memoryWritePolicy");
const optionalFields = ["subject", "structuredData", "situation", "action", "result", "lesson", "success", "title", "procedure", "trigger", "metadata", "confidence", "expiresAt"];
function retryKey(key) { return (0, node_crypto_1.createHash)("sha256").update(key, "utf8").digest("hex"); }
function fingerprint(memory) { return retryKey(JSON.stringify([memory.contentHash, memory.kind, memory.visibility, memory.supersedesMemoryId ?? null])); }
function identities(memory) { return memory.metadata?.[access_1.IDEMPOTENCY_METADATA_KEY] ?? []; }
function rejectReservedMetadata(metadata) {
    if (metadata && Object.prototype.hasOwnProperty.call(metadata, access_1.IDEMPOTENCY_METADATA_KEY))
        throw new contracts_1.MemoryValidationError("Reserved memory metadata field");
}
function validate(input) {
    if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 16000 || !["semantic", "episodic", "procedural"].includes(input.kind))
        throw new contracts_1.MemoryValidationError("Invalid memory content or kind");
    if (!input.source || !["user", "agent", "tool", "workflow", "system", "human_feedback"].includes(input.source.type))
        throw new contracts_1.MemoryValidationError("Invalid memory source");
    if (input.visibility !== undefined && !["private", "workflow", "project", "organization", "shared"].includes(input.visibility))
        throw new contracts_1.MemoryValidationError("Invalid memory visibility");
    for (const value of [input.importance, input.confidence])
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1))
            throw new contracts_1.MemoryValidationError("Memory scores must be between zero and one");
    if (input.expiresAt !== undefined && (typeof input.expiresAt !== "string" || !Number.isFinite(Date.parse(input.expiresAt))))
        throw new contracts_1.MemoryValidationError("Invalid memory expiration");
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !input.idempotencyKey || input.idempotencyKey.length > 512))
        throw new contracts_1.MemoryValidationError("Invalid memory idempotency key");
    for (const key of ["subject", "situation", "action", "result", "lesson", "title", "procedure", "trigger"])
        if (input[key] !== undefined && typeof input[key] !== "string")
            throw new contracts_1.MemoryValidationError("Invalid memory text field");
    for (const value of [input.metadata, input.structuredData])
        if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value)))
            throw new contracts_1.MemoryValidationError("Invalid memory metadata");
}
class DefaultMemoryService {
    store;
    options;
    retriever;
    policy;
    constructor(store, options = {}) {
        this.store = store;
        this.options = options;
        this.retriever = options.retriever ?? new hybridMemoryRetriever_1.HybridMemoryRetriever(store, options);
        this.policy = options.writePolicy ?? new memoryWritePolicy_1.DefaultMemoryWritePolicy();
        if (options.defaultTtlMs !== undefined && (!Number.isFinite(options.defaultTtlMs) || options.defaultTtlMs <= 0))
            throw new contracts_1.MemoryValidationError("Invalid default memory TTL");
    }
    now() { return (this.options.now ?? Date.now)(); }
    async embedding(content) {
        const embedding = await (0, embedding_1.embedSafely)(this.options.embeddingProvider, content, this.options.embeddingTimeoutMs ?? 1000);
        return { embedding, embeddingMetadata: embedding ? structuredClone(this.options.embeddingProvider.metadata) : undefined };
    }
    async authorized(store, id, access, write = false) {
        (0, access_1.requireAccess)(access);
        const memory = await store.get(access.tenantId, id);
        if (!memory || !(0, access_1.canAccessMemory)(memory, access, write))
            throw new contracts_1.MemoryAccessDeniedError();
        return memory;
    }
    /** Exact indexed identity queries; no namespace/table scans, including for expired retry records. */
    async identityMatches(store, memory, idempotency = false) {
        const statuses = idempotency ? ["active", "superseded", "archived"] : ["active"];
        const matches = [];
        for (const status of statuses) {
            const page = await store.search({ tenantId: memory.tenantId, namespaces: [memory.namespace], status,
                includeExpired: idempotency, limit: idempotency ? 1 : 100,
                ...(idempotency ? { idempotencyKey: memory.idempotencyKey } : { contentHash: memory.contentHash, kinds: [memory.kind] }) });
            for (const item of page.slice(0, idempotency ? 1 : 100))
                if (item.tenantId === memory.tenantId && (0, access_1.sameNamespace)(item.namespace, memory.namespace)
                    && (idempotency ? item.idempotencyKey === memory.idempotencyKey : item.contentHash === memory.contentHash))
                    matches.push(item);
            if (idempotency && memory.idempotencyKey) {
                const key = retryKey(memory.idempotencyKey);
                const aliases = await store.search({ tenantId: memory.tenantId, namespaces: [memory.namespace], status, includeExpired: true,
                    filters: { [access_1.IDEMPOTENCY_METADATA_KEY]: [{ key }] }, limit: 1 });
                for (const item of aliases.slice(0, 1))
                    if (item.tenantId === memory.tenantId && (0, access_1.sameNamespace)(item.namespace, memory.namespace) && identities(item).some(identity => identity.key === key) && !matches.some(match => match.id === item.id))
                        matches.push(item);
            }
        }
        return matches;
    }
    async remember(input, access) {
        (0, access_1.requireNamespaces)([input.namespace], access, true);
        validate(input);
        rejectReservedMetadata(input.metadata);
        const decision = await this.policy.shouldRemember({ ...input, explicit: true });
        if (!decision.remember)
            throw new contracts_1.MemoryValidationError(`Memory rejected: ${decision.reason}`);
        const now = this.now(), timestamp = new Date(now).toISOString();
        const memory = {
            id: (0, node_crypto_1.randomUUID)(), tenantId: access.tenantId, namespace: { ...input.namespace }, kind: input.kind,
            visibility: input.visibility ?? (input.namespace.scope === "agent" ? "private" : input.namespace.scope === "workflow" ? "workflow" : "shared"),
            content: input.content.trim(), importance: input.importance ?? decision.importance ?? .5,
            source: { ...input.source, ...(access.agentId !== undefined ? { agentId: access.agentId } : {}), ...(access.workflowId !== undefined ? { workflowId: access.workflowId } : {}) },
            status: "active", createdAt: timestamp, updatedAt: timestamp, version: 1, contentHash: (0, access_1.contentHash)(input.content),
            idempotencyKey: input.idempotencyKey, supersedesMemoryId: input.supersedesMemoryId,
        };
        for (const key of optionalFields)
            if (input[key] !== undefined)
                Object.assign(memory, { [key]: structuredClone(input[key]) });
        if (memory.idempotencyKey)
            memory.metadata = { ...memory.metadata, [access_1.IDEMPOTENCY_METADATA_KEY]: [{ key: retryKey(memory.idempotencyKey), fingerprint: fingerprint(memory) }] };
        if (!memory.expiresAt && this.options.defaultTtlMs)
            memory.expiresAt = new Date(now + this.options.defaultTtlMs).toISOString();
        if (!(0, access_1.canAccessMemory)(memory, access, true))
            throw new contracts_1.MemoryAccessDeniedError();
        Object.assign(memory, await this.embedding(memory.content));
        return this.store.transaction((0, access_1.namespaceKey)(access.tenantId, input.namespace), async (store) => {
            let duplicate;
            const retries = memory.idempotencyKey ? await this.identityMatches(store, memory, true) : [];
            for (const item of retries) {
                if (memory.idempotencyKey) {
                    if (!(0, access_1.canAccessMemory)(item, access, true))
                        throw new contracts_1.MemoryAccessDeniedError();
                    const identity = identities(item).find(identity => identity.key === retryKey(memory.idempotencyKey));
                    if ((identity?.fingerprint ?? fingerprint(item)) !== fingerprint(memory))
                        throw new contracts_1.MemoryConflictError("Idempotency key already used for another memory");
                    return { memory: (0, access_1.publicMemory)(item), action: "duplicate" };
                }
            }
            if (memory.expiresAt && Date.parse(memory.expiresAt) <= this.now())
                throw new contracts_1.MemoryValidationError("Memory expiration must be in the future");
            for (const item of await this.identityMatches(store, memory)) {
                if ((0, access_1.canAccessMemory)(item, access, true) && (0, access_1.isLive)(item, now) && item.kind === memory.kind && item.visibility === memory.visibility && item.contentHash === memory.contentHash
                    && (memory.visibility !== "private" || item.source.agentId === memory.source.agentId) && (memory.visibility !== "workflow" || item.source.workflowId === memory.source.workflowId))
                    duplicate = item;
            }
            if (duplicate && !input.supersedesMemoryId) {
                if (memory.idempotencyKey) {
                    const aliases = identities(duplicate);
                    if (aliases.length >= 128)
                        throw new contracts_1.MemoryConflictError("Memory retry identity capacity reached");
                    duplicate = { ...duplicate, metadata: { ...duplicate.metadata, [access_1.IDEMPOTENCY_METADATA_KEY]: [...aliases, { key: retryKey(memory.idempotencyKey), fingerprint: fingerprint(memory) }] }, version: duplicate.version + 1, updatedAt: timestamp };
                    await store.update(duplicate, duplicate.version - 1);
                }
                return { memory: (0, access_1.publicMemory)(duplicate), action: "duplicate" };
            }
            if (input.supersedesMemoryId) {
                const old = await this.authorized(store, input.supersedesMemoryId, access, true);
                if (!(0, access_1.sameNamespace)(old.namespace, memory.namespace) || old.kind !== memory.kind || !(0, access_1.isLive)(old, now))
                    throw new contracts_1.MemoryConflictError("Only active memory in the same namespace and kind can be superseded");
                await store.update({ ...old, status: "superseded", supersededByMemoryId: memory.id, updatedAt: timestamp, version: old.version + 1 }, old.version);
            }
            await store.insert(memory);
            return { memory: (0, access_1.publicMemory)(memory), action: "inserted" };
        });
    }
    async recall(query, access) { (0, access_1.requireNamespaces)(query.namespaces, access); return this.retriever.retrieve(query, access); }
    async get(id, access) {
        (0, access_1.requireAccess)(access);
        const memory = await this.store.get(access.tenantId, id);
        return memory && (0, access_1.canAccessMemory)(memory, access) && (!memory.expiresAt || Date.parse(memory.expiresAt) > this.now()) ? (0, access_1.publicMemory)(memory) : null;
    }
    async update(id, patch, access) {
        (0, access_1.requireAccess)(access);
        const allowed = new Set([...optionalFields, "content", "importance", "status", "expectedVersion"]);
        if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(key => !allowed.has(key)))
            throw new contracts_1.MemoryValidationError("Unknown or immutable memory update field");
        if (patch.expectedVersion !== undefined && (!Number.isInteger(patch.expectedVersion) || patch.expectedVersion < 1))
            throw new contracts_1.MemoryValidationError("Invalid expected memory version");
        rejectReservedMetadata(patch.metadata);
        const initial = await this.authorized(this.store, id, access, true);
        return this.store.transaction((0, access_1.namespaceKey)(access.tenantId, initial.namespace), async (store) => {
            const old = await this.authorized(store, id, access, true);
            if (patch.expectedVersion !== undefined && patch.expectedVersion !== old.version)
                throw new contracts_1.MemoryConflictError();
            const memory = { ...old };
            for (const key of [...optionalFields, "content", "importance", "status"])
                if (Object.prototype.hasOwnProperty.call(patch, key))
                    Object.assign(memory, { [key]: structuredClone(patch[key]) });
            if (identities(old).length)
                memory.metadata = { ...memory.metadata, [access_1.IDEMPOTENCY_METADATA_KEY]: structuredClone(identities(old)) };
            validate(memory);
            if (!["active", "superseded", "archived"].includes(memory.status) || (old.supersededByMemoryId && memory.status === "active"))
                throw new contracts_1.MemoryValidationError("Invalid memory status transition");
            const decision = await this.policy.shouldRemember({ ...memory, explicit: true });
            if (!decision.remember)
                throw new contracts_1.MemoryValidationError(`Memory rejected: ${decision.reason}`);
            memory.content = memory.content.trim();
            memory.contentHash = (0, access_1.contentHash)(memory.content);
            if (memory.contentHash !== old.contentHash)
                for (const other of await this.identityMatches(store, memory)) {
                    if (other.id !== memory.id && (0, access_1.canAccessMemory)(other, access, true) && (0, access_1.isLive)(other, this.now()) && other.kind === memory.kind && other.visibility === memory.visibility && other.contentHash === memory.contentHash)
                        throw new contracts_1.MemoryConflictError("An active memory already has this content");
                }
            if (memory.content !== old.content)
                Object.assign(memory, await this.embedding(memory.content));
            memory.version = old.version + 1;
            memory.updatedAt = new Date(this.now()).toISOString();
            await store.update(memory, old.version);
            return (0, access_1.publicMemory)(memory);
        });
    }
    async forget(id, access) {
        const initial = await this.authorized(this.store, id, access, true);
        await this.store.transaction((0, access_1.namespaceKey)(access.tenantId, initial.namespace), async (store) => { await this.authorized(store, id, access, true); await store.delete(access.tenantId, id); });
    }
    async list(query, access) {
        (0, access_1.requireNamespaces)(query.namespaces, access);
        const limit = (0, access_1.boundedInteger)(query.limit, 50, 500), offset = (0, access_1.boundedInteger)(query.offset, 0, Number.MAX_SAFE_INTEGER);
        if (!limit || !query.namespaces.length)
            return [];
        const memories = await this.store.search({ ...query, tenantId: access.tenantId, limit, offset, includeExpired: false });
        return memories.slice(0, limit).filter(m => (0, access_1.canAccessMemory)(m, access) && query.namespaces.some(n => (0, access_1.sameNamespace)(n, m.namespace)) && m.status === (query.status ?? "active") && (!m.expiresAt || Date.parse(m.expiresAt) > this.now()) && (!query.kinds || query.kinds.includes(m.kind)) && (0, access_1.matchesFilters)(m, query.filters)).map(access_1.publicMemory);
    }
}
exports.DefaultMemoryService = DefaultMemoryService;
//# sourceMappingURL=memoryService.js.map