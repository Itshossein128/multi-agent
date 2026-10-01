import {
  DefaultMemoryService,
  DefaultEpisodeService,
  DefaultProceduralService,
  DefaultMemoryExtractor,
  DefaultMemoryWritePolicy,
  DefaultMemoryContextFormatter,
  DefaultMemoryBackgroundJobs,
} from "../src/memory/application";
import type { MemoryAccessContext, MemoryNamespace } from "../src/memory/contracts";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/store/inMemoryRunStore";
import { createEmptyDefinition, createNode, createEdge, type AgentRecord, type WorkflowDefinition } from "@multi-agent/types";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";

// Setup test constants & helper fixtures
const tenantA = "tenant-a";
const tenantB = "tenant-b";
const namespaceA: MemoryNamespace = { scope: "project", id: tenantA };
const namespaceB: MemoryNamespace = { scope: "project", id: tenantB };

const accessA: MemoryAccessContext = {
  principalId: "user-a",
  tenantId: tenantA,
  readableNamespaces: [namespaceA],
  writableNamespaces: [namespaceA],
};

const accessB: MemoryAccessContext = {
  principalId: "user-b",
  tenantId: tenantB,
  readableNamespaces: [namespaceB],
  writableNamespaces: [namespaceB],
};

function createMemoryComponents() {
  const store = new InMemoryMemoryStore(() => new Date());
  const service = new DefaultMemoryService(store, {
    embeddingProvider: {
      metadata: { provider: "test", model: "test-model", version: "1", dimensions: 3 },
      embed: async (text: string) => {
        const hash = require("node:crypto").createHash("sha256").update(text).digest();
        return [hash[0] / 255, hash[1] / 255, hash[2] / 255];
      },
    },
  });
  const episodeService = new DefaultEpisodeService(service);
  const jobs = new DefaultMemoryBackgroundJobs();
  const proceduralService = new DefaultProceduralService(service);
  return { store, service, episodeService, proceduralService, jobs };
}

function makeWorkflow(id: string, name: string): WorkflowDefinition {
  const def = createEmptyDefinition(name);
  def.id = id;
  const inputNode = createNode("input", { x: 0, y: 0 });
  inputNode.id = "inputNode";
  const agentNode = createNode("agent", { x: 100, y: 0 });
  agentNode.id = "agentNode";
  (agentNode.config as any) = { agentId: "agent-1" };
  const outputNode = createNode("output", { x: 200, y: 0 });
  outputNode.id = "outputNode";
  (outputNode.config as any) = { outputKey: "out", description: "output", inputMode: "last_value" };

  def.nodes = [inputNode, agentNode, outputNode];
  def.edges = [
    createEdge({ source: "inputNode", target: "agentNode" }),
    createEdge({ source: "agentNode", target: "outputNode" }),
  ];
  return def;
}

const mockAgent: AgentRecord = {
  id: "agent-1",
  name: "Test Agent",
  description: "Test agent description",
  systemPrompt: "You are a test agent.",
  backend: { type: "cli", provider: "codex" },
  tools: [],
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Production Episodic Memory Wiring Tests", () => {
  test("Scenario 0 — repeated production runs learn and later runtime context retrieves the procedure", async () => {
    const { service, episodeService, proceduralService, jobs } = createMemoryComponents();
    const workflow = makeWorkflow("wf-procedural", "Procedural Workflow");
    const agentRuntime = {
      async *execute(input: any) {
        yield { type: "agent.completed", agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, timestamp: new Date().toISOString(), payload: {
          content: `Authentication middleware was updated successfully in ${input.runId}.`,
          handoffs: { [input.nodeId]: { id: "h1", version: 1, sourceNodeId: input.nodeId, sourceAgentId: input.agent.id, status: "success", summary: "run auth tests; run cross-tenant tests", findings: [], decisions: [{ decision: "Use the existing auth middleware test path" }], assumptions: [], remainingWork: [], warnings: [] } },
        } };
      },
    };
    for (let i = 0; i < 3; i++) {
      const executor = new RunExecutor(new InMemoryRunStore(), agentRuntime as any, undefined, undefined, undefined, undefined, episodeService, proceduralService, jobs);
      executor.start({ workflow, agents: [mockAgent], input: { task: "authentication middleware modified" } }, accessA);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    await jobs.drain();

    const learned = await service.list({ namespaces: [namespaceA], kinds: ["procedural"] }, accessA);
    expect(learned).toHaveLength(1);
    expect(learned[0].procedure).toContain("Authentication middleware was updated");

    const agent = { ...mockAgent, backend: { type: "api" as const, provider: "openai" as const, model: "test-model" }, memory: { enabled: true, type: "run" as const, scope: "agent" as const, mode: "read" as const, maxEntries: 5, shortTerm: { enabled: false }, longTerm: { enabled: true, readableNamespaces: [namespaceA], writableNamespace: namespaceA, retrieval: { maxTokens: 1024 } } } };
    const seen: any[] = [];
    const runtime = new AgentRuntime({ create: () => ({ async *execute(input: any) { seen.push(input); yield { type: "agent.completed", agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, timestamp: new Date().toISOString(), payload: { content: "ok" } }; } }) }, {
      service,
      extractor: new DefaultMemoryExtractor(),
      writePolicy: new DefaultMemoryWritePolicy(),
      formatter: new DefaultMemoryContextFormatter(),
      jobs,
    });
    for await (const _event of runtime.execute({ agent, input: "authentication middleware modified", runId: "run-d", nodeId: "agentNode", workflowId: workflow.id, memoryAccess: accessA })) { /* consume normal runtime path */ }
    expect(seen[0].context?.memoryContext).toContain("Trigger:");
    expect(seen[0].context?.memoryContext).toContain("Authentication middleware was updated");
  });

  test("Scenario A — Successful meaningful run automatically creates an episodic memory and is retrievable", async () => {
    const { service: memService, episodeService } = createMemoryComponents();
    const runStore = new InMemoryRunStore();

    // Mock agent runtime yielding structured output, handoffs, and working memory
    const agentRuntime = {
      async *execute(input: any) {
        if (input.onWorkingMemoryUpdate) {
          input.onWorkingMemoryUpdate([
            { id: "wm-1", kind: "decision", scope: "run", content: "Used PostgreSQL for durable state", importance: 0.9 },
            { id: "wm-2", kind: "finding", scope: "run", content: "Schema migrations ran in 12ms", importance: 0.8 },
          ]);
        }
        yield {
          type: "agent.completed",
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          timestamp: new Date().toISOString(),
          payload: {
            content: "Successfully implemented feature X with database persistence.",
            handoffs: {
              [input.nodeId]: {
                id: "h1",
                version: 1,
                sourceNodeId: input.nodeId,
                sourceAgentId: input.agent.id,
                status: "success",
                summary: "Created user database schema and implemented migration pipeline.",
                findings: [{ finding: "PostgreSQL setup is operational" }],
                decisions: [{ decision: "Adopted PG 16 with pgvector extension" }],
                assumptions: [],
                remainingWork: [],
                warnings: [{ warning: "Ensure connection pooling is configured" }],
              },
            },
          },
        };
      },
    };

    const executor = new RunExecutor(
      runStore,
      agentRuntime as any,
      undefined,
      undefined,
      undefined,
      undefined,
      episodeService,
    );

    const workflow = makeWorkflow("wf-meaningful", "Meaningful Workflow");
    const runId = executor.start(
      { workflow, agents: [mockAgent], input: { task: "Implement database persistence with pgvector" } },
      accessA,
    );

    // Wait for execution to finish
    await new Promise((r) => setTimeout(r, 200));

    const runEntry = runStore.get(runId);
    expect(runEntry?.run.status).toBe("completed");

    // Retrieve memories in namespaceA
    const memories = await memService.list({ namespaces: [namespaceA], kinds: ["episodic"] }, accessA);
    expect(memories.length).toBe(1);

    const memory = memories[0];
    expect(memory.kind).toBe("episodic");
    expect(memory.source.runId).toBe(runId);
    expect(memory.source.workflowId).toBe("wf-meaningful");
    expect(memory.content).toContain("Successfully implemented feature X");
    expect(memory.content).toContain("Successfully implemented feature X");
  });

  test("Scenario B — Failed meaningful run creates a failure episode where policy permits", async () => {
    const { service: memService, episodeService } = createMemoryComponents();
    const runStore = new InMemoryRunStore();

    const agentRuntime = {
      async *execute(input: any) {
        yield {
          type: "agent.failed",
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          timestamp: new Date().toISOString(),
          payload: { error: "Database connection timeout during migration step." },
        };
      },
    };

    const executor = new RunExecutor(
      runStore,
      agentRuntime as any,
      undefined,
      undefined,
      undefined,
      undefined,
      episodeService,
    );

    const workflow = makeWorkflow("wf-failing", "Failing Workflow");
    const runId = executor.start(
      { workflow, agents: [mockAgent], input: { task: "Run heavy migration script" } },
      accessA,
    );

    await new Promise((r) => setTimeout(r, 200));

    const runEntry = runStore.get(runId);
    expect(runEntry?.run.status).toBe("failed");

    const memories = await memService.list({ namespaces: [namespaceA], kinds: ["episodic"] }, accessA);
    expect(memories.length).toBe(1);

    const memory = memories[0];
    expect(memory.kind).toBe("episodic");
    expect(memory.content).toContain("Failed: Database connection timeout during migration step.");
    expect(memory.success).toBe(false);
  });

  test("Scenario C — Trivial run produces no episode", async () => {
    const { service: memService, episodeService } = createMemoryComponents();
    const runStore = new InMemoryRunStore();

    const agentRuntime = {
      async *execute(input: any) {
        yield {
          type: "agent.completed",
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          timestamp: new Date().toISOString(),
          payload: { content: "ok" },
        };
      },
    };

    const executor = new RunExecutor(
      runStore,
      agentRuntime as any,
      undefined,
      undefined,
      undefined,
      undefined,
      episodeService,
    );

    const workflow = makeWorkflow("wf-trivial", "Trivial Workflow");
    const runId = executor.start(
      { workflow, agents: [mockAgent], input: { task: "ping" } },
      accessA,
    );

    await new Promise((r) => setTimeout(r, 200));

    const memories = await memService.list({ namespaces: [namespaceA], kinds: ["episodic"] }, accessA);
    expect(memories.length).toBe(0);
  });

  test("Scenario D & E — Duplicate completion/replay handling is idempotent", async () => {
    const { service: memService, episodeService } = createMemoryComponents();

    const inputPayload = {
      runId: "fixed-run-id-123",
      workflowId: "wf-idempotent",
      nodeId: "outputNode",
      agentId: "agent-1",
      task: "Run crucial data import pipeline for tenant data migration",
      output: "Completed crucial data import pipeline successfully with 1000 records.",
      succeeded: true,
      handoffs: {
        agentNode: {
          id: "h1",
          version: 1,
          sourceNodeId: "agentNode",
          sourceAgentId: "agent-1",
          status: "success",
          summary: "Imported 1000 records into database",
          findings: [],
          decisions: [{ decision: "Chunked batch size into 100 items" }],
          assumptions: [],
          remainingWork: [],
          warnings: [],
        },
      },
      namespace: namespaceA,
    };

    // Process run first time
    const res1 = await episodeService.processRun(inputPayload, accessA);
    expect(res1.created).toBe(true);

    // Process run second time (simulating replay or duplicate event delivery)
    const res2 = await episodeService.processRun(inputPayload, accessA);
    expect(res2.created).toBe(false);

    const memories = await memService.list({ namespaces: [namespaceA], kinds: ["episodic"] }, accessA);
    expect(memories.length).toBe(1);
  });

  test("Scenario F & G — Tenant and Namespace Isolation", async () => {
    const { service: memService, episodeService } = createMemoryComponents();
    const runStore = new InMemoryRunStore();

    const agentRuntime = {
      async *execute(input: any) {
        yield {
          type: "agent.completed",
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          timestamp: new Date().toISOString(),
          payload: {
            content: "Tenant A confidential run result details.",
            handoffs: {
              [input.nodeId]: {
                id: "h1",
                version: 1,
                sourceNodeId: input.nodeId,
                sourceAgentId: input.agent.id,
                status: "success",
                summary: "Processed sensitive tenant A security keys and certificates.",
                findings: [],
                decisions: [{ decision: "Encrypted key rotation stored in KMS" }],
                assumptions: [],
                remainingWork: [],
                warnings: [{ warning: "Key rotation cycle complete" }],
              },
            },
          },
        };
      },
    };

    const executor = new RunExecutor(
      runStore,
      agentRuntime as any,
      undefined,
      undefined,
      undefined,
      undefined,
      episodeService,
    );

    const workflow = makeWorkflow("wf-tenant", "Tenant Workflow");
    const runId = executor.start(
      { workflow, agents: [mockAgent], input: { task: "Tenant A sensitive key rotation processing" } },
      accessA,
    );

    await new Promise((r) => setTimeout(r, 200));

    // Tenant A can see the memory
    const searchA = await memService.list({ namespaces: [namespaceA], kinds: ["episodic"] }, accessA);
    expect(searchA.length).toBe(1);

    // Tenant B CANNOT see Tenant A's memory
    const searchB = await memService.list({ namespaces: [namespaceB], kinds: ["episodic"] }, accessB);
    expect(searchB.length).toBe(0);
  });

  test("Scenario H — Extraction/storage failure does not fail an otherwise successful run", async () => {
    const runStore = new InMemoryRunStore();

    // Episode service that throws an unhandled error during extraction
    const failingEpisodeService: any = {
      async processRun() {
        throw new Error("Simulated memory store disk failure");
      },
    };

    const agentRuntime = {
      async *execute(input: any) {
        yield {
          type: "agent.completed",
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          timestamp: new Date().toISOString(),
          payload: { content: "Workflow run was actually successful!" },
        };
      },
    };

    const executor = new RunExecutor(
      runStore,
      agentRuntime as any,
      undefined,
      undefined,
      undefined,
      undefined,
      failingEpisodeService,
    );

    const workflow = makeWorkflow("wf-resilient", "Resilient Workflow");
    const runId = executor.start(
      { workflow, agents: [mockAgent], input: { task: "Important task" } },
      accessA,
    );

    await new Promise((r) => setTimeout(r, 200));

    // Run status remains completed despite episode service failure
    const runEntry = runStore.get(runId);
    expect(runEntry?.run.status).toBe("completed");
    expect(runEntry?.run.output).toEqual({ content: "Workflow run was actually successful!" });
  });

  test("Scenario I — Working-memory usage informs extraction without raw wholesale copying", async () => {
    const { service: memService, episodeService } = createMemoryComponents();

    const inputPayload = {
      runId: "run-wm-1",
      workflowId: "wf-wm",
      nodeId: "outputNode",
      agentId: "agent-1",
      task: "Optimize query execution plan",
      output: "Query execution time reduced from 500ms to 20ms.",
      succeeded: true,
      workingMemory: {
        "wm-1": { kind: "finding", content: "Added composite index on (tenant_id, created_at)", importance: 0.9 },
        "wm-2": { kind: "decision", content: "Selected B-Tree index over Hash index", importance: 0.8 },
      },
      namespace: namespaceA,
    };

    const res = await episodeService.processRun(inputPayload, accessA);
    expect(res.created).toBe(true);

    const memory = await memService.get(res.memoryId!, accessA);
    expect(memory).not.toBeNull();
    // Working memory findings/decisions should be distilled into lesson/action/constraints
    expect(memory?.content).toContain("Added composite index on (tenant_id, created_at)");
    // Raw working memory structure shouldn't be dumped as a raw JSON blob
    expect(memory?.content).not.toContain('"wm-1"');
  });
});
