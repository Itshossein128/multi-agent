import { ConsolidationEngine, DeterministicMemoryConsolidationJudge, HybridMemoryRetriever } from "../src/memory/application";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import type { Memory, MemoryAccessContext, MemoryCandidate } from "../src/memory/contracts";
import { contentHash } from "../src/memory/application/access";

const namespace = { scope: "agent" as const, id: "kind-aware-agent" };
const access: MemoryAccessContext = { principalId: "user", tenantId: "kind-tenant", agentId: namespace.id, readableNamespaces: [namespace], writableNamespaces: [namespace] };
const now = Date.parse("2026-09-26T00:00:00.000Z");

function memory(id: string, kind: Memory["kind"], content: string, patch: Partial<Memory> = {}): Memory {
  const timestamp = new Date(now).toISOString();
  return { id, tenantId: access.tenantId, namespace, kind, visibility: "private", content, contentHash: contentHash(content), importance: .7,
    source: { type: "agent", runId: `${id}-run` }, status: "active", createdAt: timestamp, updatedAt: timestamp, version: 1, ...patch };
}

test("three similar incidents remain distinct through production retrieval", async () => {
  const store = new InMemoryMemoryStore(() => new Date(now));
  const records = [
    memory("episode-column", "episodic", "Migration failed because a duplicate column existed.", { subject: "database migration incident", source: { type: "agent", runId: "run-a" } }),
    memory("episode-lock", "episodic", "Migration failed because a database lock timed out.", { subject: "database migration incident", source: { type: "agent", runId: "run-b" } }),
    memory("episode-permission", "episodic", "Migration failed because the migration role lacked permission.", { subject: "database migration incident", source: { type: "agent", runId: "run-c" } }),
  ];
  for (const item of records) await store.insert(item);
  const result = await new HybridMemoryRetriever(store, { now: () => now }).retrieve({ text: "investigate database migration incident", namespaces: [namespace], kinds: ["episodic"], limit: 3, maxTokens: 4096 }, access);
  expect(result.results.map(item => item.memory.id).sort()).toEqual(records.map(item => item.id).sort());
  expect(result.diagnostics.conflict?.suppressedByKind?.episodic ?? 0).toBe(0);
  expect(result.diagnostics.candidates.every(item => item.dropReason !== "conflict_suppressed")).toBe(true);
});

test("episodic consolidation keeps old failures and later successes, while replay identity deduplicates", async () => {
  const store = new InMemoryMemoryStore(() => new Date(now));
  const failure = memory("failure", "episodic", "Deployment failed because the migration was missing.", { source: { type: "agent", runId: "run-1" }, situation: "deployment" });
  const success = memory("success", "episodic", "Deployment succeeded after applying the migration.", { source: { type: "agent", runId: "run-2" }, situation: "deployment" });
  const replay = memory("replay", "episodic", failure.content, { source: { type: "agent", runId: "run-1" }, situation: "deployment" });
  for (const item of [failure, success, replay]) await store.insert(item);
  const engine = new ConsolidationEngine({ store, now: () => now });
  await engine.consolidate(access, namespace);
  const active = (await store.search({ tenantId: access.tenantId, namespaces: [namespace], status: "active", includeExpired: false, limit: 20 })).filter(item => item.kind === "episodic");
  expect(active).toHaveLength(2);
  expect(active.some(item => item.id === "success")).toBe(true);
  expect(active.filter(item => ["failure", "replay"].includes(item.id))).toHaveLength(1);
});

test("tight episodic budget is a budget drop, not conflict suppression", async () => {
  const store = new InMemoryMemoryStore(() => new Date(now));
  for (let index = 0; index < 3; index++) await store.insert(memory(`budget-${index}`, "episodic", `Migration incident ${index}: inspect a distinct subsystem.`, { source: { type: "agent", runId: `budget-run-${index}` } }));
  const result = await new HybridMemoryRetriever(store, { now: () => now }).retrieve({ text: "migration incident subsystem", namespaces: [namespace], kinds: ["episodic"], limit: 3, maxTokens: 1 }, access);
  expect(result.results.length).toBeLessThan(3);
  expect(result.diagnostics.conflict?.suppressedByKind?.episodic ?? 0).toBe(0);
  expect(result.diagnostics.candidates.some(item => item.dropReason === "budget_dropped")).toBe(true);
});

test("semantic conflict remains kind-specific and procedural triggers stay independent", async () => {
  const judge = new DeterministicMemoryConsolidationJudge();
  const base = (kind: Memory["kind"], content: string, fields: Partial<MemoryCandidate> = {}): MemoryCandidate => ({ namespace, kind, content, source: { type: "user" }, ...fields });
  const semanticStore = new InMemoryMemoryStore(() => new Date(now));
  await semanticStore.insert(memory("npm", "semantic", "The repository package manager is npm.", { subject: "package-manager-npm", metadata: { __reliability_verification_status: "stale" } }));
  await semanticStore.insert(memory("pnpm", "semantic", "The repository package manager is pnpm.", { subject: "package-manager-pnpm", metadata: { __reliability_verification_status: "verified" } }));
  const semantic = await new HybridMemoryRetriever(semanticStore, { now: () => now }).retrieve({ text: "repository package manager", namespaces: [namespace], kinds: ["semantic"] }, access);
  expect(semantic.results.map(item => item.memory.id)).toEqual(["pnpm"]);
  const procedural = await judge.decide(base("procedural", "Trigger: authentication failure\nProcedure: rotate credentials", { trigger: "authentication failure", procedure: "rotate credentials" }), [memory("migration", "procedural", "Trigger: migration failure\nProcedure: rollback schema", { trigger: "migration failure", procedure: "rollback schema" })]);
  expect(procedural.type).toBe("keep_both");
});
