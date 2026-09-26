import { DefaultMemoryService, DefaultMemoryBackgroundJobs, DefaultMemoryContextFormatter, DefaultMemoryExtractor, DefaultMemoryWritePolicy, RealMemoryConsolidator, BoundedMemoryConsolidationScheduler } from "../src/memory/application";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import type { MemoryAccessContext, MemoryNamespace } from "../src/memory/contracts";
import { createAgentRecord } from "@multi-agent/types";

const tenant = "consolidation-tenant";
const namespace: MemoryNamespace = { scope: "project", id: "project-a" };
const access: MemoryAccessContext = { principalId: "owner", tenantId: tenant, readableNamespaces: [namespace], writableNamespaces: [namespace] };

function fixture() {
  const store = new InMemoryMemoryStore();
  const embeddingProvider = {
    metadata: { provider: "test", model: "test", version: "1", dimensions: 3 },
    embed: async (text: string) => {
      if (/\b(?:npm|pnpm)\b/i.test(text)) return [1, 0, 0];
      if (/\bnx\b/i.test(text)) return [0, 1, 0];
      const bytes = Buffer.from(text);
      return [bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0].map(value => value / 255);
    },
  };
  const jobs = new DefaultMemoryBackgroundJobs();
  const consolidator = new RealMemoryConsolidator({ store, embeddingProvider });
  const scheduler = new BoundedMemoryConsolidationScheduler(store, consolidator, jobs);
  const service = new DefaultMemoryService(store, { embeddingProvider, consolidationScheduler: scheduler });
  return { store, jobs, scheduler, service };
}

async function drain(jobs: DefaultMemoryBackgroundJobs) { await jobs.drain(); }

test("production memory write schedules consolidation and supersedes an older semantic fact", async () => {
  const { store, jobs, service } = fixture();
  const old = (await service.remember({ namespace, kind: "semantic", content: "The project uses npm.", source: { type: "user" } }, access)).memory;
  const current = (await service.remember({ namespace, kind: "semantic", content: "The project uses npm but migrated to pnpm.", source: { type: "user" } }, access)).memory;
  await drain(jobs);

  const oldStored = await store.get(tenant, old.id);
  const currentStored = await store.get(tenant, current.id);
  expect(oldStored?.status).toBe("superseded");
  expect(oldStored?.supersededByMemoryId).toBe(current.id);
  expect(currentStored?.status).toBe("active");
  expect((await service.list({ namespaces: [namespace], kinds: ["semantic"] }, access)).map(memory => memory.id)).toEqual([current.id]);
});

test("duplicate/paraphrase writes converge and related facts remain separate", async () => {
  const { jobs, service } = fixture();
  await service.remember({ namespace, kind: "semantic", content: "The project uses pnpm.", source: { type: "user" } }, access);
  await service.remember({ namespace, kind: "semantic", content: "The project uses pnpm for package management.", source: { type: "user" } }, access);
  await service.remember({ namespace, kind: "semantic", content: "The project uses Nx for task orchestration.", source: { type: "user" } }, access);
  await drain(jobs);

  const memories = await service.list({ namespaces: [namespace], kinds: ["semantic"] }, access);
  expect(memories.length).toBe(2);
  expect(memories.some(memory => memory.content.includes("pnpm"))).toBe(true);
  expect(memories.some(memory => memory.content.includes("Nx"))).toBe(true);
});

test("concurrent consolidation scheduling coalesces and remains idempotent", async () => {
  const { jobs, scheduler, service } = fixture();
  await Promise.all([
    service.remember({ namespace, kind: "semantic", content: "The repository uses pnpm.", source: { type: "user" } }, access),
    service.remember({ namespace, kind: "semantic", content: "This repository uses pnpm.", source: { type: "user" } }, access),
  ]);
  await drain(jobs);
  await Promise.all([scheduler.recover(), scheduler.recover()]);
  await drain(jobs);
  const memories = await service.list({ namespaces: [namespace], kinds: ["semantic"] }, access);
  expect(memories.length).toBe(1);
});

test("canonical-only consolidation result reaches RuntimeMemory and ContextAssembler", async () => {
  const { jobs, service } = fixture();
  const old = (await service.remember({ namespace, kind: "semantic", content: "The project uses npm.", source: { type: "user" } }, access)).memory;
  const current = (await service.remember({ namespace, kind: "semantic", content: "The project uses npm but migrated to pnpm.", source: { type: "user" } }, access)).memory;
  await drain(jobs);

  const agent = { ...createAgentRecord(), backend: { type: "api" as const, provider: "openai" as const, model: "test" }, memory: { enabled: true, type: "run" as const, scope: "agent" as const, mode: "read" as const, maxEntries: 5, shortTerm: { enabled: false }, longTerm: { enabled: true, readableNamespaces: [namespace], writableNamespace: namespace, retrieval: { maxTokens: 1024 } } } };
  const seen: any[] = [];
  const runtime = new AgentRuntime({ create: () => ({ async *execute(input: any) { seen.push(input); yield { type: "agent.completed", timestamp: new Date().toISOString(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "ok" } }; } }) }, {
    service,
    extractor: new DefaultMemoryExtractor(),
    writePolicy: new DefaultMemoryWritePolicy(),
    formatter: new DefaultMemoryContextFormatter(),
    jobs,
  });
  for await (const _event of runtime.execute({ agent, input: "Which package manager does the project use?", runId: "retrieval-run", nodeId: "node", workflowId: "workflow", memoryAccess: access })) { /* normal runtime path */ }
  expect(seen[0].context?.memoryContext).toContain(current.content);
  expect(seen[0].context?.memoryContext).not.toContain(old.content);
});
