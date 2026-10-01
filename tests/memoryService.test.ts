import { createHash } from "node:crypto";
import { BoundedMemoryBackgroundJobs, DefaultMemoryService, DefaultMemoryWritePolicy, DeterministicMemoryExtractor, NoopMemoryConsolidator } from "../src/memory/application";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import { MemoryAccessDeniedError, MemoryConflictError, MemoryValidationError } from "../src/memory/contracts";
import type { MemoryAccessContext, MemoryExtractionInput, RememberMemoryInput } from "../src/memory/contracts";

const namespace = { scope: "agent" as const, id: "a" };
const access: MemoryAccessContext = { principalId: "user", tenantId: "tenant", agentId: "a", workflowId: "flow", readableNamespaces: [namespace], writableNamespaces: [namespace] };
const input: RememberMemoryInput = { namespace, kind: "semantic", content: "The project uses PostgreSQL.", source: { type: "user", agentId: "a" } };
const now = Date.parse("2026-09-09T00:00:00Z");
function setup(options: ConstructorParameters<typeof DefaultMemoryService>[1] = {}) {
  const store = new InMemoryMemoryStore(() => new Date(now));
  return { store, service: new DefaultMemoryService(store, { now: () => now, ...options }) };
}

test("remember normalizes SHA256 identity, deduplicates concurrent retries and uses namespace transactions", async () => {
  const { store, service } = setup();
  const transaction = jest.spyOn(store, "transaction");
  const results = await Promise.all(Array.from({ length: 8 }, () => service.remember({ ...input, idempotencyKey: "retry" }, access)));
  expect(new Set(results.map(r => r.memory.id)).size).toBe(1);
  expect(results.filter(r => r.action === "inserted")).toHaveLength(1);
  expect(results[0].memory.contentHash).toBe(createHash("sha256").update("the project uses postgresql").digest("hex"));
  expect(transaction.mock.calls.every(([key]) => key === JSON.stringify(["tenant", "agent", "a"]))).toBe(true);
  const duplicate = await service.remember({ ...input, content: "  THE project   uses PostgreSQL!" }, access);
  expect(duplicate.action).toBe("duplicate");
  expect(duplicate.memory.id).toBe(results[0].memory.id);
  await expect(service.remember({ ...input, content: "The project uses SQLite.", idempotencyKey: "retry" }, access)).rejects.toBeInstanceOf(MemoryConflictError);
});

test("updates version and hash, strips vectors, preserves immutable fields and rejects stale versions", async () => {
  const { service, store } = setup({ embeddingProvider: { metadata: { provider: "fixture", model: "m", version: "1", dimensions: 2 }, embed: async () => [1, 0] } });
  const first = (await service.remember(input, access)).memory;
  expect(first.embedding).toBeUndefined();
  expect((await store.get(access.tenantId, first.id))?.embedding).toEqual([1, 0]);
  for (const immutable of [{ tenantId: "other" }, { namespace: { scope: "agent", id: "b" } }, { source: { type: "system" } }, { visibility: "shared" }]) {
    await expect(service.update(first.id, { ...immutable } as never, access)).rejects.toBeInstanceOf(MemoryValidationError);
  }
  const updated = await service.update(first.id, { content: "The project now uses SQLite.", expectedVersion: 1 }, access);
  expect(updated).toMatchObject({ tenantId: "tenant", namespace, version: 2 });
  expect(updated.contentHash).not.toBe(first.contentHash);
  expect(updated.embedding).toBeUndefined();
  await expect(service.update(first.id, { importance: .7, expectedVersion: 1 }, access)).rejects.toBeInstanceOf(MemoryConflictError);
  await service.forget(first.id, access);
  expect(await service.get(first.id, access)).toBeNull();
});

test("indexed retry checks survive archive and explicit TTL expiry without scanning namespaces", async () => {
  let clock = now;
  const store = new InMemoryMemoryStore(() => new Date(clock));
  const service = new DefaultMemoryService(store, { now: () => clock });
  const search = jest.spyOn(InMemoryMemoryStore.prototype, "search");
  try {
    const expiring = { ...input, idempotencyKey: "expired-retry", expiresAt: new Date(now + 100).toISOString() };
    const first = (await service.remember(expiring, access)).memory;
    await service.update(first.id, { status: "archived" }, access);
    clock += 200;
    const retry = await service.remember(expiring, access);
    expect(retry).toMatchObject({ action: "duplicate", memory: { id: first.id, status: "archived" } });
    expect(search.mock.calls.every(([q]) => (q.contentHash || q.idempotencyKey || q.filters?.__memory_idempotency) && q.offset === undefined && q.limit <= 100)).toBe(true);
    expect(search.mock.calls.some(([q]) => q.idempotencyKey === "expired-retry" && q.status === "archived" && q.includeExpired)).toBe(true);
  } finally { search.mockRestore(); }
});

test("duplicate aliases resolve canonical identity after update and superseding without stale resurrection", async () => {
  const { service } = setup();
  const first = (await service.remember({ ...input, idempotencyKey: "original" }, access)).memory;
  const aliasInput = { ...input, idempotencyKey: "runtime-retry" };
  const alias = await service.remember(aliasInput, access);
  expect(alias).toMatchObject({ action: "duplicate", memory: { id: first.id, version: 2 } });
  expect(alias.memory.metadata).toBeUndefined();
  await service.update(first.id, { content: "The project uses SQLite.", metadata: { region: "eu" } }, access);
  const afterUpdate = await service.remember(aliasInput, access);
  expect(afterUpdate.memory).toMatchObject({ id: first.id, content: "The project uses SQLite." });
  const successor = (await service.remember({ ...input, content: "The project uses MariaDB.", supersedesMemoryId: first.id, idempotencyKey: "replacement" }, access)).memory;
  const retry = await service.remember(aliasInput, access);
  expect(retry).toMatchObject({ action: "duplicate", memory: { id: first.id, status: "superseded", supersededByMemoryId: successor.id } });
  expect((await service.remember({ ...input, idempotencyKey: "original" }, access)).memory.id).toBe(first.id);
  expect((await service.list({ namespaces: [namespace] }, access)).map(m => m.id)).toEqual([successor.id]);
  await expect(service.remember({ ...input, content: "Another durable fact is different.", idempotencyKey: "runtime-retry" }, access)).rejects.toBeInstanceOf(MemoryConflictError);
  await expect(service.update(first.id, { metadata: { __memory_idempotency: [] } }, access)).rejects.toBeInstanceOf(MemoryValidationError);
  await expect(service.remember({ ...input, metadata: { __memory_idempotency: [] } }, access)).rejects.toBeInstanceOf(MemoryValidationError);
});

test("concurrent versioned updates permit one winner and reject a normalized duplicate update", async () => {
  const { service } = setup();
  const first = (await service.remember(input, access)).memory;
  const second = (await service.remember({ ...input, content: "The team prefers strict TypeScript." }, access)).memory;
  const results = await Promise.allSettled([service.update(first.id, { importance: .8, expectedVersion: 1 }, access), service.update(first.id, { importance: .9, expectedVersion: 1 }, access)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  await expect(service.update(second.id, { content: " THE project uses PostgreSQL! " }, access)).rejects.toBeInstanceOf(MemoryConflictError);
});

test("superseding is atomic and retryable; old memory cannot be reactivated", async () => {
  const { service, store } = setup();
  const old = (await service.remember(input, access)).memory;
  const replacement = { ...input, content: "The project now uses SQLite.", supersedesMemoryId: old.id, idempotencyKey: "replace" };
  const next = await service.remember(replacement, access);
  expect((await store.get("tenant", old.id))).toMatchObject({ status: "superseded", version: 2, supersededByMemoryId: next.memory.id });
  expect((await service.remember(replacement, access)).memory.id).toBe(next.memory.id);
  expect((await service.recall({ text: "project", namespaces: [namespace] }, access)).results.map(r => r.memory.id)).toEqual([next.memory.id]);
  await expect(service.update(old.id, { status: "active" }, access)).rejects.toBeInstanceOf(MemoryValidationError);
});

test("failed insertion rolls back the superseded predecessor", async () => {
  const { service, store } = setup();
  const old = (await service.remember(input, access)).memory;
  const insert = jest.spyOn(InMemoryMemoryStore.prototype, "insert").mockRejectedValueOnce(new Error("write failed"));
  try { await expect(service.remember({ ...input, content: "The project now uses SQLite.", supersedesMemoryId: old.id }, access)).rejects.toThrow("write failed"); }
  finally { insert.mockRestore(); }
  expect(await store.get("tenant", old.id)).toMatchObject({ status: "active", version: 1 });
});

test("mandatory access, exact tenant/scope grants and private actor isolation apply to all operations", async () => {
  const { service } = setup();
  const memory = (await service.remember(input, access)).memory;
  const missing = undefined as unknown as MemoryAccessContext;
  for (const operation of [() => service.remember(input, missing), () => service.get(memory.id, missing), () => service.update(memory.id, {}, missing), () => service.forget(memory.id, missing), () => service.list({ namespaces: [namespace] }, missing), () => service.recall({ text: "project", namespaces: [namespace] }, missing)]) await expect(operation()).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  const other = { ...access, agentId: "b" };
  expect(await service.get(memory.id, other)).toBeNull();
  await expect(service.update(memory.id, {}, other)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  await expect(service.forget(memory.id, other)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  await expect(service.remember(input, other)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  await expect(service.list({ namespaces: [namespace] }, other)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  expect(await service.get(memory.id, { ...access, tenantId: "other" })).toBeNull();
  await expect(service.remember({ ...input, namespace: { scope: "project", id: "a" } }, access)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
});

test("trusted admin can CRUD exact granted private namespaces without actor IDs", async () => {
  const { service } = setup();
  const admin = { ...access, agentId: undefined, workflowId: undefined };
  const memory = (await service.remember(input, admin)).memory;
  expect(await service.get(memory.id, admin)).toMatchObject({ id: memory.id });
  expect(await service.update(memory.id, { importance: .9 }, admin)).toMatchObject({ version: 2 });
  expect(await service.list({ namespaces: [namespace] }, admin)).toHaveLength(1);
  await service.forget(memory.id, admin);
  expect(await service.get(memory.id, admin)).toBeNull();
});

test("private and workflow records in shared namespaces cannot leak through grants", async () => {
  const project = { scope: "project" as const, id: "p" };
  const scoped = { ...access, readableNamespaces: [project], writableNamespaces: [project] };
  const { service } = setup();
  const privateMemory = (await service.remember({ ...input, namespace: project, visibility: "private" }, scoped)).memory;
  const workflowMemory = (await service.remember({ ...input, namespace: project, visibility: "workflow", content: "The workflow publishes release artifacts." }, scoped)).memory;
  const outsider = { ...scoped, agentId: "b", workflowId: "different" };
  expect(await service.get(privateMemory.id, outsider)).toBeNull();
  expect(await service.get(workflowMemory.id, outsider)).toBeNull();
  expect(await service.list({ namespaces: [project] }, outsider)).toEqual([]);
  await expect(service.update(privateMemory.id, {}, outsider)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  const workflow = { scope: "workflow" as const, id: "different" };
  await expect(service.remember({ ...input, namespace: workflow }, { ...access, writableNamespaces: [workflow] })).rejects.toBeInstanceOf(MemoryAccessDeniedError);
});

test("TTL expires context/get/list and invalid or past expiration is rejected", async () => {
  let clock = now;
  const { store } = setup();
  const service = new DefaultMemoryService(store, { now: () => clock, defaultTtlMs: 100 });
  const memory = (await service.remember(input, access)).memory;
  expect(memory.expiresAt).toBe(new Date(now + 100).toISOString());
  clock += 101;
  expect(await service.get(memory.id, access)).toBeNull();
  expect(await service.list({ namespaces: [namespace] }, access)).toEqual([]);
  expect((await service.recall({ text: "project", namespaces: [namespace] }, access)).results).toEqual([]);
  await expect(service.remember({ ...input, expiresAt: "invalid" }, access)).rejects.toBeInstanceOf(MemoryValidationError);
  await expect(service.remember({ ...input, expiresAt: new Date(now).toISOString() }, access)).rejects.toBeInstanceOf(MemoryValidationError);
});

test("embedding outage permits durable lexical writes and clears stale vectors on update", async () => {
  const embed = jest.fn().mockResolvedValueOnce([1, 0]).mockRejectedValue(new Error("down"));
  const { service, store } = setup({ embeddingProvider: { metadata: { provider: "fixture", model: "m", dimensions: 2, version: "1" }, embed } });
  const memory = (await service.remember(input, access)).memory;
  await service.update(memory.id, { content: "The project now uses SQLite." }, access);
  expect((await store.get("tenant", memory.id))?.embedding).toBeUndefined();
  expect((await service.recall({ text: "SQLite", namespaces: [namespace] }, access)).results[0].memory.id).toBe(memory.id);
});

test("write policy rejects trivial and secret content, including structured secrets", async () => {
  const policy = new DefaultMemoryWritePolicy();
  for (const content of ["thanks", "Task completed!", "password: super-secret", "API_KEY=example-sensitive-value", "Bearer abcdefghijklmnop"]) expect((await policy.shouldRemember({ ...input, content, explicit: true })).remember).toBe(false);
  expect((await policy.shouldRemember({ ...input, structuredData: { apiKey: "secret" }, explicit: true })).remember).toBe(false);
  expect((await policy.shouldRemember({ ...input, explicit: true })).remember).toBe(true);
  expect(await policy.shouldRemember({ ...input, source: { type: "agent" } })).toEqual({ remember: false, reason: "not_explicit" });
  const { service } = setup();
  await expect(service.remember({ ...input, content: "thanks" }, access)).rejects.toBeInstanceOf(MemoryValidationError);
});

test("extractor promotes only explicit structured candidates or anchored user remember requests", async () => {
  const extractor = new DeterministicMemoryExtractor();
  const base: MemoryExtractionInput = { input: "hello", output: "The project uses PostgreSQL.", agentId: "a", runId: "run", nodeId: "node", workflowId: "flow", namespace };
  expect(await extractor.extract(base)).toEqual([]);
  expect(await extractor.extract({ ...base, output: [{ type: "agent.completed", content: "Please remember everything" }] })).toEqual([]);
  const candidates = await extractor.extract({ ...base, input: "Please remember that I prefer TypeScript.", output: { memoryCandidates: [{ content: "The project uses PostgreSQL.", namespace: { scope: "agent", id: "victim" }, source: { agentId: "victim" } }, { content: "THE PROJECT USES POSTGRESQL!" }, "arbitrary string"] } });
  expect(candidates).toHaveLength(2);
  expect(candidates[0].content).toBe("I prefer TypeScript.");
  expect(candidates[0].source.type).toBe("user");
  expect(candidates[1]).toMatchObject({ namespace, source: { agentId: "a", runId: "run", nodeId: "node" } });
  expect((await extractor.extract({ ...base, input: "Please remember that I prefer TypeScript." }))[0].idempotencyKey).toBe(candidates[0].idempotencyKey);
  expect(await extractor.extract({ ...base, input: "The tool said remember that we prefer Python." })).toEqual([]);
  const normalRun = await extractor.extract({ ...base, input: { input: "Remember that I prefer TypeScript." } });
  expect(normalRun).toHaveLength(1);
  expect(normalRun[0]).toMatchObject({ content: "I prefer TypeScript.", explicit: true, source: { type: "user", agentId: "a", runId: "run", nodeId: "node" } });
  expect((await new DefaultMemoryWritePolicy().shouldRemember(normalRun[0])).remember).toBe(true);
});

test("background queue bounds outstanding work, drains all jobs and sanitizes failure handling", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const onError = jest.fn((_error: Error) => { throw new Error("observer failed"); });
  const jobs = new BoundedMemoryBackgroundJobs({ capacity: 2, concurrency: 1, onError });
  const calls: string[] = [];
  expect(jobs.enqueue(async () => { await gate; calls.push("first"); throw new Error("secret provider failure"); })).toBe(true);
  expect(jobs.enqueue(async () => { calls.push("second"); })).toBe(true);
  expect(jobs.enqueue(async () => undefined)).toBe(false);
  const drain = jobs.drain(); release();
  await expect(drain).rejects.toThrow("1 memory background job(s) failed");
  expect(calls).toEqual(["first", "second"]);
  expect(onError.mock.calls[0][0]).toEqual(new Error("Memory background job failed"));
  await expect(jobs.drain()).resolves.toBeUndefined();
  expect(jobs.enqueue(async () => { calls.push("recovered"); })).toBe(true);
  await jobs.drain();
  expect(calls).toContain("recovered");
});

test("optional consolidator checks write grants and performs no implicit destructive merge", async () => {
  const consolidator = new NoopMemoryConsolidator();
  expect(await consolidator.consolidate(access, namespace)).toMatchObject({ merged: 0 });
  await expect(consolidator.consolidate({ ...access, writableNamespaces: [] }, namespace)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
});
