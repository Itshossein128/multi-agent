import type { Memory } from "@multi-agent/types";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import { HybridMemoryRetriever } from "../src/memory/application/hybridMemoryRetriever";
import { DefaultMemoryService } from "../src/memory/application/memoryService";
import { DeterministicFreshnessPolicy } from "../src/memory/application/memoryReliability";
import { extractEffectiveAt, extractTransition, interpretMemoryTemporalQuery } from "../src/memory/application/memoryTemporal";
import type { MemoryAccessContext } from "../src/memory/contracts";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const namespace = { scope: "project" as const, id: "temporal-project" };
const access: MemoryAccessContext = { principalId: "tester", tenantId: "tenant-a", readableNamespaces: [namespace], writableNamespaces: [namespace] };

function memory(id: string, content: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id, tenantId: "tenant-a", namespace, kind: "semantic", visibility: "shared", content,
    subject: "repository package manager", importance: 0.8, confidence: 0.9, source: { type: "user" },
    status: "active", createdAt: "2026-09-28T10:00:00.000Z", updatedAt: "2026-09-28T10:00:00.000Z",
    contentHash: id, version: 1, ...overrides,
  };
}

async function setup(...memories: Memory[]) {
  const store = new InMemoryMemoryStore(() => new Date(NOW));
  for (const item of memories) await store.insert(item);
  return { store, retriever: new HybridMemoryRetriever(store, { now: () => NOW }) };
}

const npm = () => memory("npm", "The project package manager is npm.", { validFrom: "2024-01-01T00:00:00.000Z", validUntil: "2026-03-01T00:00:00.000Z", temporalScope: "historical" });
const pnpm = () => memory("pnpm", "The project package manager is pnpm.", { validFrom: "2026-03-01T00:00:00.000Z", temporalScope: "current" });

test("current, as-of, and timeline retrieval use validity rather than record recency", async () => {
  const { retriever } = await setup(npm(), pnpm());
  const current = await retriever.retrieve({ text: "What package manager does the project use now?", namespaces: [namespace] }, access);
  expect(current.results.map(item => item.memory.id)).toEqual(["pnpm"]);
  expect(current.diagnostics.candidates.find(item => item.memoryId === "npm")?.dropReason).toBe("no_longer_current");

  const historical = await retriever.retrieve({ text: "What package manager did the project use in 2025?", namespaces: [namespace] }, access);
  expect(historical.results.map(item => item.memory.id)).toEqual(["npm"]);
  expect(historical.diagnostics.temporalMode).toBe("as_of");

  const timeline = await retriever.retrieve({ text: "Show the package-manager history.", namespaces: [namespace] }, access);
  expect(timeline.results.map(item => item.memory.id)).toEqual(["npm", "pnpm"]);
  expect(timeline.diagnostics.temporalMode).toBe("history");
});

test("future-effective facts do not leak and activate on the injectable clock", async () => {
  const future = memory("future-db", "The project database is PostgreSQL.", { subject: "database", validFrom: "2026-10-01T00:00:00.000Z", temporalScope: "future" });
  const store = new InMemoryMemoryStore(() => new Date(NOW));
  await store.insert(future);
  const before = await new HybridMemoryRetriever(store, { now: () => NOW }).retrieve({ text: "What database does the project use now?", namespaces: [namespace] }, access);
  expect(before.results).toHaveLength(0);
  expect(before.diagnostics.candidates[0].dropReason).toBe("not_yet_valid");
  const after = await new HybridMemoryRetriever(store, { now: () => Date.parse("2026-10-02T00:00:00.000Z") }).retrieve({ text: "What database does the project use now?", namespaces: [namespace] }, access);
  expect(after.results.map(item => item.memory.id)).toContain("future-db");
});

test("a validity gap produces no nearest-value answer", async () => {
  const old = npm(); old.validUntil = "2026-03-01T00:00:00.000Z";
  const next = pnpm(); next.validFrom = "2026-06-01T00:00:00.000Z";
  const { retriever } = await setup(old, next);
  const result = await retriever.retrieve({ text: "What package manager did the project use as of 2026-04-15?", namespaces: [namespace] }, access);
  expect(result.results).toHaveLength(0);
  expect(result.diagnostics.temporal?.dropped).toBe(2);
});

test("overlapping single-valued intervals remain visible as an unresolved temporal conflict", async () => {
  const a = npm(); a.validUntil = "2026-12-01T00:00:00.000Z";
  const b = pnpm(); b.validFrom = "2026-06-01T00:00:00.000Z";
  const { retriever } = await setup(a, b);
  const result = await retriever.retrieve({ text: "What package manager does the project use now?", namespaces: [namespace] }, access);
  expect(result.results.map(item => item.memory.id).sort()).toEqual(["npm", "pnpm"]);
  expect(result.diagnostics.conflict?.unresolved).toBe(1);
  expect(result.diagnostics.temporal?.overlapUnresolved).toBe(1);
});

test("multi-valued temporal facts coexist", async () => {
  const chrome = memory("chrome", "Application supports Chrome.", { subject: "supported browsers", validFrom: "2025-01-01T00:00:00.000Z" });
  const firefox = memory("firefox", "Application supports Firefox.", { subject: "supported browsers", validFrom: "2026-01-01T00:00:00.000Z" });
  const { retriever } = await setup(chrome, firefox);
  const result = await retriever.retrieve({ text: "Which browsers are supported currently?", namespaces: [namespace] }, access);
  expect(result.results.map(item => item.memory.id).sort()).toEqual(["chrome", "firefox"]);
  expect(result.diagnostics.conflict?.suppressed).toBe(0);
});

test("correction invalidates authority while evolution closes the old interval", async () => {
  const store = new InMemoryMemoryStore(() => new Date(NOW));
  const service = new DefaultMemoryService(store, { now: () => NOW });
  const wrong = await service.remember({ namespace, kind: "semantic", content: "In 2025 the project database was MySQL.", subject: "database", validFrom: "2025-01-01T00:00:00.000Z", validUntil: "2026-01-01T00:00:00.000Z", source: { type: "user" } }, access);
  await service.remember({ namespace, kind: "semantic", content: "In 2025 the project database was PostgreSQL.", subject: "database", validFrom: "2025-01-01T00:00:00.000Z", validUntil: "2026-01-01T00:00:00.000Z", supersedesMemoryId: wrong.memory.id, source: { type: "human_feedback" } }, access);
  const correction = await service.recall({ text: "What database did the project use in 2025?", namespaces: [namespace] }, access);
  expect(correction.results).toHaveLength(1);
  expect(correction.results[0].memory.content).toContain("PostgreSQL");

  const old = await service.remember({ namespace, kind: "semantic", content: "The project package manager is npm.", subject: "repository package manager", validFrom: "2024-01-01T00:00:00.000Z", source: { type: "user" } }, access);
  const next = await service.remember({ namespace, kind: "semantic", content: "The project package manager is pnpm.", subject: "repository package manager", validFrom: "2026-03-01T00:00:00.000Z", replacesMemoryId: old.memory.id, source: { type: "user" } }, access);
  expect(await store.get("tenant-a", old.memory.id)).toMatchObject({ status: "active", validUntil: "2026-03-01T00:00:00.000Z", replacedByMemoryId: next.memory.id });
});

test("historical validity is not mislabeled stale and legacy facts remain current-compatible", async () => {
  const historical = npm(); historical.updatedAt = "2024-01-01T00:00:00.000Z";
  expect(new DeterministicFreshnessPolicy(undefined, () => NOW).evaluate(historical)).toMatchObject({ status: "historical", score: 1 });
  const legacy = memory("legacy", "The project package manager is pnpm.");
  const { retriever } = await setup(legacy);
  expect((await retriever.retrieve({ text: "What package manager does the project use?", namespaces: [namespace] }, access)).results).toHaveLength(1);
  expect((await retriever.retrieve({ text: "What package manager did the project use as of 2025-06-01?", namespaces: [namespace] }, access)).results).toHaveLength(0);
});

test("deterministic interpretation covers bounded temporal intents and explicit transitions", () => {
  expect(interpretMemoryTemporalQuery("currently", NOW).mode).toBe("current");
  expect(interpretMemoryTemporalQuery("in 2025", NOW)).toMatchObject({ mode: "as_of", at: "2025-01-01T00:00:00.000Z" });
  expect(interpretMemoryTemporalQuery("before 2026-04-01", NOW)).toMatchObject({ mode: "range", to: "2026-04-01T00:00:00.000Z" });
  expect(interpretMemoryTemporalQuery("after 2026-04-01", NOW)).toMatchObject({ mode: "range", from: "2026-04-01T00:00:00.000Z" });
  expect(interpretMemoryTemporalQuery("When did the package manager change?", NOW).mode).toBe("history");
  expect(extractEffectiveAt("Starting October 1, production will use PostgreSQL.", NOW)).toBe("2026-10-01T00:00:00.000Z");
  expect(extractTransition("The project migrated from npm to pnpm on 2026-03-01.", NOW)).toEqual({ oldValue: "npm", newValue: "pnpm", effectiveAt: "2026-03-01T00:00:00.000Z" });
});
