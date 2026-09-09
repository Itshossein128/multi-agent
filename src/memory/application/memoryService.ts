import { createHash, randomUUID } from "node:crypto";
import type { Memory, MemoryAccessContext, MemoryListQuery, MemoryRetrievalQuery, MemoryRetriever, MemoryService, MemoryStore, MemoryWritePolicy, MemoryWriteResult, RememberMemoryInput, UpdateMemoryInput } from "../contracts";
import { MemoryAccessDeniedError, MemoryConflictError, MemoryValidationError } from "../contracts";
import { boundedInteger, canAccessMemory, contentHash, IDEMPOTENCY_METADATA_KEY, isLive, matchesFilters, namespaceKey, publicMemory, requireAccess, requireNamespaces, sameNamespace } from "./access";
import { embedSafely } from "./embedding";
import { HybridMemoryRetriever, HybridMemoryRetrieverOptions } from "./hybridMemoryRetriever";
import { DefaultMemoryWritePolicy } from "./memoryWritePolicy";

export interface DefaultMemoryServiceOptions extends HybridMemoryRetrieverOptions {
  retriever?: MemoryRetriever; writePolicy?: MemoryWritePolicy; defaultTtlMs?: number;
}
const optionalFields = ["subject", "structuredData", "situation", "action", "result", "lesson", "success", "title", "procedure", "trigger", "metadata", "confidence", "expiresAt"] as const;
interface RetryIdentity { key: string; fingerprint: string }
function retryKey(key: string): string { return createHash("sha256").update(key, "utf8").digest("hex"); }
function fingerprint(memory: Memory): string { return retryKey(JSON.stringify([memory.contentHash, memory.kind, memory.visibility, memory.supersedesMemoryId ?? null])); }
function identities(memory: Memory): RetryIdentity[] { return (memory.metadata?.[IDEMPOTENCY_METADATA_KEY] as RetryIdentity[] | undefined) ?? []; }
function rejectReservedMetadata(metadata?: Record<string, unknown>): void {
  if (metadata && Object.prototype.hasOwnProperty.call(metadata, IDEMPOTENCY_METADATA_KEY)) throw new MemoryValidationError("Reserved memory metadata field");
}
function validate(input: RememberMemoryInput): void {
  if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 16000 || !["semantic", "episodic", "procedural"].includes(input.kind)) throw new MemoryValidationError("Invalid memory content or kind");
  if (!input.source || !["user", "agent", "tool", "workflow", "system", "human_feedback"].includes(input.source.type)) throw new MemoryValidationError("Invalid memory source");
  if (input.visibility !== undefined && !["private", "workflow", "project", "organization", "shared"].includes(input.visibility)) throw new MemoryValidationError("Invalid memory visibility");
  for (const value of [input.importance, input.confidence]) if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) throw new MemoryValidationError("Memory scores must be between zero and one");
  if (input.expiresAt !== undefined && (typeof input.expiresAt !== "string" || !Number.isFinite(Date.parse(input.expiresAt)))) throw new MemoryValidationError("Invalid memory expiration");
  if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !input.idempotencyKey || input.idempotencyKey.length > 512)) throw new MemoryValidationError("Invalid memory idempotency key");
  for (const key of ["subject", "situation", "action", "result", "lesson", "title", "procedure", "trigger"] as const) if (input[key] !== undefined && typeof input[key] !== "string") throw new MemoryValidationError("Invalid memory text field");
  for (const value of [input.metadata, input.structuredData]) if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new MemoryValidationError("Invalid memory metadata");
}
export class DefaultMemoryService implements MemoryService {
  private readonly retriever: MemoryRetriever;
  private readonly policy: MemoryWritePolicy;
  constructor(private readonly store: MemoryStore, private readonly options: DefaultMemoryServiceOptions = {}) {
    this.retriever = options.retriever ?? new HybridMemoryRetriever(store, options);
    this.policy = options.writePolicy ?? new DefaultMemoryWritePolicy();
    if (options.defaultTtlMs !== undefined && (!Number.isFinite(options.defaultTtlMs) || options.defaultTtlMs <= 0)) throw new MemoryValidationError("Invalid default memory TTL");
  }
  private now(): number { return (this.options.now ?? Date.now)(); }
  private async embedding(content: string): Promise<Pick<Memory, "embedding" | "embeddingMetadata">> {
    const embedding = await embedSafely(this.options.embeddingProvider, content, this.options.embeddingTimeoutMs ?? 1000);
    return { embedding, embeddingMetadata: embedding ? structuredClone(this.options.embeddingProvider!.metadata) : undefined };
  }
  private async authorized(store: MemoryStore, id: string, access: MemoryAccessContext, write = false): Promise<Memory> {
    requireAccess(access);
    const memory = await store.get(access.tenantId, id);
    if (!memory || !canAccessMemory(memory, access, write)) throw new MemoryAccessDeniedError();
    return memory;
  }
  /** Exact indexed identity queries; no namespace/table scans, including for expired retry records. */
  private async identityMatches(store: MemoryStore, memory: Memory, idempotency = false): Promise<Memory[]> {
    const statuses: Memory["status"][] = idempotency ? ["active", "superseded", "archived"] : ["active"];
    const matches: Memory[] = [];
    for (const status of statuses) {
      const page = await store.search({ tenantId: memory.tenantId, namespaces: [memory.namespace], status,
        includeExpired: idempotency, limit: idempotency ? 1 : 100,
        ...(idempotency ? { idempotencyKey: memory.idempotencyKey } : { contentHash: memory.contentHash, kinds: [memory.kind] }) });
      for (const item of page.slice(0, idempotency ? 1 : 100)) if (item.tenantId === memory.tenantId && sameNamespace(item.namespace, memory.namespace)
        && (idempotency ? item.idempotencyKey === memory.idempotencyKey : item.contentHash === memory.contentHash)) matches.push(item);
      if (idempotency && memory.idempotencyKey) {
        const key = retryKey(memory.idempotencyKey);
        const aliases = await store.search({ tenantId: memory.tenantId, namespaces: [memory.namespace], status, includeExpired: true,
          filters: { [IDEMPOTENCY_METADATA_KEY]: [{ key }] }, limit: 1 });
        for (const item of aliases.slice(0, 1)) if (item.tenantId === memory.tenantId && sameNamespace(item.namespace, memory.namespace) && identities(item).some(identity => identity.key === key) && !matches.some(match => match.id === item.id)) matches.push(item);
      }
    }
    return matches;
  }
  async remember(input: RememberMemoryInput, access: MemoryAccessContext): Promise<MemoryWriteResult> {
    requireNamespaces([input.namespace], access, true);
    validate(input);
    rejectReservedMetadata(input.metadata);
    const decision = await this.policy.shouldRemember({ ...input, explicit: true });
    if (!decision.remember) throw new MemoryValidationError(`Memory rejected: ${decision.reason}`);
    const now = this.now(), timestamp = new Date(now).toISOString();
    const memory: Memory = {
      id: randomUUID(), tenantId: access.tenantId, namespace: { ...input.namespace }, kind: input.kind,
      visibility: input.visibility ?? (input.namespace.scope === "agent" ? "private" : input.namespace.scope === "workflow" ? "workflow" : "shared"),
      content: input.content.trim(), importance: input.importance ?? decision.importance ?? .5,
      source: { ...input.source, ...(access.agentId !== undefined ? { agentId: access.agentId } : {}), ...(access.workflowId !== undefined ? { workflowId: access.workflowId } : {}) },
      status: "active", createdAt: timestamp, updatedAt: timestamp, version: 1, contentHash: contentHash(input.content),
      idempotencyKey: input.idempotencyKey, supersedesMemoryId: input.supersedesMemoryId,
    };
    for (const key of optionalFields) if (input[key] !== undefined) Object.assign(memory, { [key]: structuredClone(input[key]) });
    if (memory.idempotencyKey) memory.metadata = { ...memory.metadata, [IDEMPOTENCY_METADATA_KEY]: [{ key: retryKey(memory.idempotencyKey), fingerprint: fingerprint(memory) }] };
    if (!memory.expiresAt && this.options.defaultTtlMs) memory.expiresAt = new Date(now + this.options.defaultTtlMs).toISOString();
    if (!canAccessMemory(memory, access, true)) throw new MemoryAccessDeniedError();
    Object.assign(memory, await this.embedding(memory.content));
    return this.store.transaction(namespaceKey(access.tenantId, input.namespace), async store => {
      let duplicate: Memory | undefined;
      const retries = memory.idempotencyKey ? await this.identityMatches(store, memory, true) : [];
      for (const item of retries) {
        if (memory.idempotencyKey) {
          if (!canAccessMemory(item, access, true)) throw new MemoryAccessDeniedError();
          const identity = identities(item).find(identity => identity.key === retryKey(memory.idempotencyKey!));
          if ((identity?.fingerprint ?? fingerprint(item)) !== fingerprint(memory)) throw new MemoryConflictError("Idempotency key already used for another memory");
          return { memory: publicMemory(item), action: "duplicate" };
        }
      }
      if (memory.expiresAt && Date.parse(memory.expiresAt) <= this.now()) throw new MemoryValidationError("Memory expiration must be in the future");
      for (const item of await this.identityMatches(store, memory)) {
        if (canAccessMemory(item, access, true) && isLive(item, now) && item.kind === memory.kind && item.visibility === memory.visibility && item.contentHash === memory.contentHash
          && (memory.visibility !== "private" || item.source.agentId === memory.source.agentId) && (memory.visibility !== "workflow" || item.source.workflowId === memory.source.workflowId)) duplicate = item;
      }
      if (duplicate && !input.supersedesMemoryId) {
        if (memory.idempotencyKey) {
          const aliases = identities(duplicate);
          if (aliases.length >= 128) throw new MemoryConflictError("Memory retry identity capacity reached");
          duplicate = { ...duplicate, metadata: { ...duplicate.metadata, [IDEMPOTENCY_METADATA_KEY]: [...aliases, { key: retryKey(memory.idempotencyKey), fingerprint: fingerprint(memory) }] }, version: duplicate.version + 1, updatedAt: timestamp };
          await store.update(duplicate, duplicate.version - 1);
        }
        return { memory: publicMemory(duplicate), action: "duplicate" };
      }
      if (input.supersedesMemoryId) {
        const old = await this.authorized(store, input.supersedesMemoryId, access, true);
        if (!sameNamespace(old.namespace, memory.namespace) || old.kind !== memory.kind || !isLive(old, now)) throw new MemoryConflictError("Only active memory in the same namespace and kind can be superseded");
        await store.update({ ...old, status: "superseded", supersededByMemoryId: memory.id, updatedAt: timestamp, version: old.version + 1 }, old.version);
      }
      await store.insert(memory);
      return { memory: publicMemory(memory), action: "inserted" };
    });
  }
  async recall(query: MemoryRetrievalQuery, access: MemoryAccessContext) { requireNamespaces(query.namespaces, access); return this.retriever.retrieve(query, access); }
  async get(id: string, access: MemoryAccessContext): Promise<Memory | null> {
    requireAccess(access);
    const memory = await this.store.get(access.tenantId, id);
    return memory && canAccessMemory(memory, access) && (!memory.expiresAt || Date.parse(memory.expiresAt) > this.now()) ? publicMemory(memory) : null;
  }
  async update(id: string, patch: UpdateMemoryInput, access: MemoryAccessContext): Promise<Memory> {
    requireAccess(access);
    const allowed = new Set<string>([...optionalFields, "content", "importance", "status", "expectedVersion"]);
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(key => !allowed.has(key))) throw new MemoryValidationError("Unknown or immutable memory update field");
    if (patch.expectedVersion !== undefined && (!Number.isInteger(patch.expectedVersion) || patch.expectedVersion < 1)) throw new MemoryValidationError("Invalid expected memory version");
    rejectReservedMetadata(patch.metadata);
    const initial = await this.authorized(this.store, id, access, true);
    return this.store.transaction(namespaceKey(access.tenantId, initial.namespace), async store => {
      const old = await this.authorized(store, id, access, true);
      if (patch.expectedVersion !== undefined && patch.expectedVersion !== old.version) throw new MemoryConflictError();
      const memory = { ...old };
      for (const key of [...optionalFields, "content", "importance", "status"] as const) if (Object.prototype.hasOwnProperty.call(patch, key)) Object.assign(memory, { [key]: structuredClone(patch[key]) });
      if (identities(old).length) memory.metadata = { ...memory.metadata, [IDEMPOTENCY_METADATA_KEY]: structuredClone(identities(old)) };
      validate(memory);
      if (!["active", "superseded", "archived"].includes(memory.status) || (old.supersededByMemoryId && memory.status === "active")) throw new MemoryValidationError("Invalid memory status transition");
      const decision = await this.policy.shouldRemember({ ...memory, explicit: true });
      if (!decision.remember) throw new MemoryValidationError(`Memory rejected: ${decision.reason}`);
      memory.content = memory.content.trim();
      memory.contentHash = contentHash(memory.content);
      if (memory.contentHash !== old.contentHash) for (const other of await this.identityMatches(store, memory)) {
        if (other.id !== memory.id && canAccessMemory(other, access, true) && isLive(other, this.now()) && other.kind === memory.kind && other.visibility === memory.visibility && other.contentHash === memory.contentHash) throw new MemoryConflictError("An active memory already has this content");
      }
      if (memory.content !== old.content) Object.assign(memory, await this.embedding(memory.content));
      memory.version = old.version + 1; memory.updatedAt = new Date(this.now()).toISOString();
      await store.update(memory, old.version);
      return publicMemory(memory);
    });
  }
  async forget(id: string, access: MemoryAccessContext): Promise<void> {
    const initial = await this.authorized(this.store, id, access, true);
    await this.store.transaction(namespaceKey(access.tenantId, initial.namespace), async store => { await this.authorized(store, id, access, true); await store.delete(access.tenantId, id); });
  }
  async list(query: MemoryListQuery, access: MemoryAccessContext): Promise<Memory[]> {
    requireNamespaces(query.namespaces, access);
    const limit = boundedInteger(query.limit, 50, 500), offset = boundedInteger(query.offset, 0, Number.MAX_SAFE_INTEGER);
    if (!limit || !query.namespaces.length) return [];
    const memories = await this.store.search({ ...query, tenantId: access.tenantId, limit, offset, includeExpired: false });
    return memories.slice(0, limit).filter(m => canAccessMemory(m, access) && query.namespaces.some(n => sameNamespace(n, m.namespace)) && m.status === (query.status ?? "active") && (!m.expiresAt || Date.parse(m.expiresAt) > this.now()) && (!query.kinds || query.kinds.includes(m.kind)) && matchesFilters(m, query.filters)).map(publicMemory);
  }
}
