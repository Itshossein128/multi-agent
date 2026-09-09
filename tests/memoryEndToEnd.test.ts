import { randomUUID } from "node:crypto";
import { createAgentRecord, type MemoryNamespace } from "@multi-agent/types";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import type { AgentExecutionInput } from "../src/agents/runtime/types";
import { DefaultMemoryService, DefaultMemoryExtractor, DefaultMemoryWritePolicy, DefaultMemoryContextFormatter, DefaultMemoryBackgroundJobs } from "../src/memory/application";
import { InMemoryMemoryStore, PostgresMemoryStore, runMemoryMigrations, type PgPool } from "../src/memory/infrastructure";
import type { MemoryStore, RuntimeMemoryDependencies, MemoryAccessContext } from "../src/memory/contracts";

async function exercise(store: MemoryStore, reopen: () => MemoryStore) {
  const agent = createAgentRecord();
  const ns: MemoryNamespace = { scope: "agent", id: agent.id };
  agent.memory = { enabled: true, type: "run", scope: "agent", mode: "read_write", maxEntries: 5, shortTerm: { enabled: false }, longTerm: { enabled: true, writeMode: "hot_path", retrieval: { maxTokens: 2048, minScore: 0 } } };
  const access: MemoryAccessContext = { principalId: "e2e-user", tenantId: randomUUID(), readableNamespaces: [ns], writableNamespaces: [ns] };
  const dependencies = (memoryStore: MemoryStore): RuntimeMemoryDependencies => ({
    service: new DefaultMemoryService(memoryStore), extractor: new DefaultMemoryExtractor(), writePolicy: new DefaultMemoryWritePolicy(), formatter: new DefaultMemoryContextFormatter(), jobs: new DefaultMemoryBackgroundJobs(),
  });
  const seen: AgentExecutionInput[] = [];
  const factory = { create: () => ({ async *execute(input: AgentExecutionInput) {
    seen.push(input);
    yield { type: "agent.completed" as const, timestamp: new Date().toISOString(), agentId: input.agent.id, runId: input.runId, nodeId: input.nodeId, payload: { content: "Acknowledged." } };
  } }) };
  const base = { agent, memoryAccess: access, nodeId: "node", input: { input: "Remember that this project uses pnpm for package management." }, runId: "first" };
  const deps = dependencies(store);
  const events = [];
  for await (const event of new AgentRuntime(factory, deps).execute(base)) events.push(event);
  expect(events.some((event) => event.type === "memory.write" && (event.payload as { count: number }).count === 1)).toBe(true);
  const records = await deps.service.list({ namespaces: [ns] }, access);
  expect(records).toHaveLength(1);
  expect(records[0].source.type).toBe("user");
  // A different service/runtime instance reads the durable store; no run-local Map is reused.
  const secondDeps = dependencies(reopen());
  for await (const _event of new AgentRuntime(factory, secondDeps).execute({ ...base, runId: "second", input: { input: "Which package manager does this project use?" } })) { /* drain */ }
  expect(seen[1].context?.memoryContext).toContain("pnpm");
  expect(seen[1].context?.history).toEqual([]);
  expect(await secondDeps.service.list({ namespaces: [ns] }, access)).toHaveLength(1);
  const candidate = { namespace: ns, kind: "semantic" as const, content: records[0].content, source: records[0].source, idempotencyKey: "durable-alias" };
  const alias = await secondDeps.service.remember(candidate, access);
  expect(alias.memory.id).toBe(records[0].id);
  await secondDeps.service.update(alias.memory.id, { content: "This project now uses npm for package management.", metadata: { reviewed: true } }, access);
  const reopenedService = dependencies(reopen()).service;
  const retry = await reopenedService.remember(candidate, access);
  expect(retry.memory.id).toBe(alias.memory.id);
  expect(retry.memory.content).toContain("now uses npm");
  expect(await reopenedService.list({ namespaces: [ns] }, access)).toHaveLength(1);
  for await (const _event of new AgentRuntime(factory, secondDeps).execute(base)) { /* retry */ }
  expect(await secondDeps.service.list({ namespaces: [ns] }, access)).toHaveLength(1);
}
test("semantic memory works end-to-end through runtime and selective extraction across runs", async () => {
  const store = new InMemoryMemoryStore();
  await exercise(store, () => store);
});

const databaseTest = process.env.MEMORY_TEST_DATABASE_URL ? test : test.skip;
databaseTest("PostgreSQL survives service reconstruction and runtime retries without duplicate memories", async () => {
  const { Pool } = require("pg") as { Pool: new (options: Record<string, unknown>) => PgPool & { end(): Promise<void> } };
  const schema = `memory_e2e_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL });
  let pool: (PgPool & { end(): Promise<void> }) | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
    await runMemoryMigrations(pool);
    await exercise(new PostgresMemoryStore(pool), () => new PostgresMemoryStore(pool!));
  } finally {
    await pool?.end();
    if (!/^memory_e2e_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe test schema cleanup");
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}, 30000);
