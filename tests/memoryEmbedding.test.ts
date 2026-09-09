import { HttpEmbeddingProvider } from "../apps/server/src/memory/embeddingProvider";
import { createAgentRecord, validateAgent } from "@multi-agent/types";
import { publicAgent } from "../apps/web/src/lib/publicAgent";

const config = { endpoint: "http://localhost:9999/embeddings", provider: "local", model: "local-test", dimensions: 2, version: "v1" };
test("embedding adapter is independent of agent provider, batches and caches without exposing mutable vectors", async () => {
  const transport = jest.fn(async () => new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }), { status: 200 }));
  const embedding = new HttpEmbeddingProvider(config, transport as unknown as typeof fetch);
  const batch = await embedding.embedBatch(["first", "second"]);
  expect(batch).toEqual([[1, 0], [0, 1]]);
  batch[0][0] = 99;
  expect(await embedding.embed("first")).toEqual([1, 0]);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(embedding.metadata).toEqual({ provider: "local", model: "local-test", dimensions: 2, version: "v1" });
});
test("invalid embedding metadata/configuration and response dimensions fail explicitly", async () => {
  expect(() => new HttpEmbeddingProvider({ ...config, cacheSize: -1 })).toThrow(/cache/);
  expect(() => new HttpEmbeddingProvider({ ...config, dimensions: 0 })).toThrow(/configuration/);
  const embedding = new HttpEmbeddingProvider(config, (async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }))) as typeof fetch);
  await expect(embedding.embed("hello")).rejects.toThrow(/dimensions/);
  const failed = new HttpEmbeddingProvider(config, (async () => new Response("private provider diagnostic", { status: 500 })) as typeof fetch);
  await expect(failed.embed("hello")).rejects.toThrow("Embedding service unavailable.");
});
test("legacy memory stays valid and long-term budgets/scopes are validated and retained on readback", () => {
  const agent = createAgentRecord();
  agent.memory = { enabled: true, type: "run", scope: "agent", mode: "read_write", maxEntries: 5 };
  expect(validateAgent(agent)).toEqual([]);
  agent.memory.longTerm = { enabled: true, readableNamespaces: [{ scope: "agent", id: agent.id }], retrieval: { maxMemories: 5, maxTokens: 512 } };
  expect(validateAgent(agent)).toEqual([]);
  expect(publicAgent(agent).memory?.longTerm?.retrieval?.maxTokens).toBe(512);
  agent.memory.longTerm.retrieval!.maxTokens = 9000;
  expect(validateAgent(agent).join(" ")).toMatch(/context budget/);
  agent.memory.longTerm.readableNamespaces = [{ scope: "agent", id: "*" }];
  expect(validateAgent(agent).join(" ")).toMatch(/namespaces/);
});
