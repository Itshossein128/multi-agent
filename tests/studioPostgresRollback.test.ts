import { randomUUID } from "node:crypto";
import {
  createEmptyDefinition,
  createAgentRecord,
  createNode,
  createEdge,
  deserializeWorkflowDefinition,
  removeAgentNodes,
  nowIso,
  type AgentRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import type { StudioPrincipal, StudioStore } from "../src/studio/contracts";
import { createWorkflowService } from "../apps/web/src/services/workflowService";
import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
} from "../src/auth/internalPrincipal";

/**
 * Postgres persistence and rollback coverage for Studio workspace import and
 * cascading agent deletion (agent-detail-page Remaining work #3).
 *
 * Every test runs against a randomly named, migration-initialized schema and
 * drops only that schema. Set MEMORY_TEST_DATABASE_URL to enable; without it
 * the suite is skipped and the behaviors remain covered by the in-memory
 * contracts in agentRegistry.test.ts.
 */
const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

const TEST_SECRET = "studio-pg-rollback-secret";
const alice: AuthenticatedPrincipal = { userId: "pg-rollback-alice", tenantId: "tenant-rollback" };

function agentGraph(agentId: string, name = "Rollback graph"): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const agent = createNode("agent", { x: 150, y: 0 }, { agentId });
  const output = createNode("output", { x: 300, y: 0 });
  return {
    ...createEmptyDefinition(name),
    nodes: [input, agent, output],
    edges: [
      createEdge({ source: input.id, target: agent.id }),
      createEdge({ source: agent.id, target: output.id }),
      // Bypass edge that must survive a cascading agent-node removal.
      createEdge({ source: input.id, target: output.id }),
    ],
  };
}

/**
 * Fails the Nth workflow write inside the transaction so cascading deletion
 * must roll back every prior write. The injection wraps only the transaction
 * store, exactly where AgentService performs graph rewrites.
 */
class FailingWorkflowWriteStore extends PostgresStudioStore {
  private calls = 0;
  constructor(pool: unknown, private readonly failOnCall: number) {
    super(pool as never);
  }
  override async transaction<T>(operation: (store: StudioStore) => Promise<T>): Promise<T> {
    return super.transaction(async (tx) => {
      const proxied = Object.create(tx) as StudioStore;
      proxied.saveWorkflow = async (definition: Parameters<StudioStore["saveWorkflow"]>[0], principal?: StudioPrincipal) => {
        this.calls += 1;
        if (this.calls === this.failOnCall) throw new Error("simulated graph write failure");
        return tx.saveWorkflow(definition, principal);
      };
      return operation(proxied);
    });
  }
}

async function fetchOk<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

describePostgres("Studio Postgres persistence and rollback", () => {
  let pool: any;
  let schema: string;

  beforeAll(async () => {
    const { Pool } = require("pg");
    schema = `studio_rollback_${randomUUID().replace(/-/g, "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 8 });
    const applied = await runStudioMigrations(pool);
    expect(applied.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (!pool) return;
    const { Pool } = require("pg");
    const admin = new Pool({ connectionString: databaseUrl });
    try {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  function studioApp(store: PostgresStudioStore | InMemoryStudioStore) {
    return createStudioRouter(store, (request) => {
      const token = request.headers.get("X-Multi-Agent-Principal");
      return token ? verifyInternalPrincipalAssertion(token, TEST_SECRET) : alice;
    });
  }

  function studioFetch(app: ReturnType<typeof createStudioRouter>) {
    const fetchImpl: typeof fetch = async (input, init) => {
      const source = input instanceof Request && init === undefined ? input : new Request(String(input), init);
      const url = new URL(source.url);
      url.pathname = url.pathname.replace(/^\/studio(?=\/|$)/, "") || "/";
      const headers = new Headers(source.headers);
      if (!headers.has("X-Multi-Agent-Principal")) {
        headers.set("X-Multi-Agent-Principal", createInternalPrincipalAssertion(alice, TEST_SECRET));
      }
      return app.fetch(new Request(url, { method: source.method, headers, body: source.body, ...(source.body ? { duplex: "half" } : {}) } as RequestInit));
    };
    return fetchImpl;
  }

  function browserService(app: ReturnType<typeof createStudioRouter>) {
    return createWorkflowService({ fetch: studioFetch(app), apiUrl: "http://studio.test" });
  }

  test("legacy workspace import persists agents, workflows, and tools for the importing principal", async () => {
    const store = new PostgresStudioStore(pool);
    const app = studioApp(store);
    const service = browserService(app);
    const agent = createAgentRecord({ name: "Imported agent" });
    const workflow = agentGraph(agent.id, "Imported workflow");

    await service.importWorkspace({ workflows: [workflow], agents: [agent] });

    expect((await service.getAgent(agent.id))?.name).toBe("Imported agent");
    const stored = await store.getWorkflow(workflow.id, alice);
    expect(stored).not.toBeNull();
    expect(stored?.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agent.id)).toBe(true);
    // Import is ownership-stamped: another principal cannot see it.
    expect(await store.getAgent(agent.id, { userId: "someone-else", tenantId: alice.tenantId })).toBeNull();
  });

  test("invalid legacy workflow data is rejected before any import write", async () => {
    const store = new PostgresStudioStore(pool);
    const app = studioApp(store);
    const service = browserService(app);
    const agent = createAgentRecord({ name: "Invalid import agent" });
    await service.importWorkspace({ agents: [agent], tools: [] });
    const agentsBefore = await store.listAgents(alice);

    const broken = { ...createEmptyDefinition("Broken"), nodes: "not-an-array", edges: [] } as unknown as WorkflowDefinition;
    await expect(service.importWorkspace({ workflows: [broken] })).rejects.toThrow();
    // Nothing changed: validation happens before the store transaction starts.
    expect((await store.listAgents(alice)).map((item) => item.id)).toEqual(agentsBefore.map((item) => item.id));
  });

  test("interrupted import rolls back every entity write", async () => {
    const store = new PostgresStudioStore(pool);
    const app = studioApp(store);
    const service = browserService(app);
    const agentsBefore = (await store.listAgents(alice)).map((item) => item.id);

    // Simulate a crash between the workflow write and the agent write inside
    // the same transaction: the import endpoint uses exactly this pattern.
    await expect(
      store.transaction(async (tx) => {
        await tx.saveWorkflow(agentGraph("interrupted-wf", "Interrupted workflow"), alice);
        await tx.saveAgent(createAgentRecord({ name: "Interrupted agent" }), alice);
        throw new Error("simulated import interruption");
      })
    ).rejects.toThrow(/simulated import interruption/);

    // Rolled back: neither the workflow nor the agent survived, and nothing
    // else changed.
    expect(await store.getWorkflow("interrupted-wf", alice)).toBeNull();
    expect((await store.listAgents(alice)).map((item) => item.id)).toEqual(agentsBefore);

    // The service-level import still succeeds after the interruption.
    const agent = createAgentRecord({ name: "After interruption" });
    await service.importWorkspace({ agents: [agent], tools: [] });
    expect(await store.getAgent(agent.id, alice)).not.toBeNull();
  });

  test("cascading agent deletion through Postgres removes agent nodes and incident edges from every saved workflow", async () => {
    const store = new PostgresStudioStore(pool);
    const app = studioApp(store);
    const service = browserService(app);
    const agent = await service.createAgent({ name: "Cascaded agent" });
    const first = agentGraph(agent.id, "Cascade one");
    const second = agentGraph(agent.id, "Cascade two");
    await service.saveWorkflow(first);
    await service.saveWorkflow(second);
    // Unrelated graph that must stay intact.
    const bystander = await service.createAgent({ name: "Bystander agent" });
    const unrelated = agentGraph(bystander.id, "Unrelated graph");
    await service.saveWorkflow(unrelated);

    await service.deleteAgent(agent.id, { removeReferences: true });

    expect(await store.getAgent(agent.id, alice)).toBeNull();
    for (const saved of [first, second]) {
      const stored = deserializeWorkflowDefinition(await store.getWorkflow(saved.id, alice));
      expect(stored.nodes).toHaveLength(2);
      expect(stored.nodes.some((node) => node.type === "agent")).toBe(false);
      expect(stored.edges).toHaveLength(1); // input -> output survives; incident edges removed
    }
    const untouched = deserializeWorkflowDefinition(await store.getWorkflow(unrelated.id, alice));
    expect(untouched.nodes).toHaveLength(3);
    expect(await store.getAgent(bystander.id, alice)).not.toBeNull();
  });

  test("a failed graph write during cascading deletion rolls back the agent deletion and every workflow rewrite", async () => {
    const store = new PostgresStudioStore(pool);
    const app = studioApp(store);
    const service = browserService(app);
    const agent = await service.createAgent({ name: "Doomed cascade" });
    const first = agentGraph(agent.id, "Failing cascade one");
    const second = agentGraph(agent.id, "Failing cascade two");
    await service.saveWorkflow(first);
    await service.saveWorkflow(second);
    const beforeFirst = deserializeWorkflowDefinition(await store.getWorkflow(first.id, alice));
    const beforeSecond = deserializeWorkflowDefinition(await store.getWorkflow(second.id, alice));
    const beforeAgent = await store.getAgent(agent.id, alice);

    // Prove the removal payload is correct before injecting the failure.
    expect(removeAgentNodes(first, agent.id).nodes).toHaveLength(2);

    // Fail the second workflow write so the transaction must roll back both
    // rewrites and the agent deletion.
    const failingStore = new FailingWorkflowWriteStore(pool, 2);
    const serviceOnFailingStore = browserService(studioApp(failingStore));
    await expect(serviceOnFailingStore.deleteAgent(agent.id, { removeReferences: true })).rejects.toThrow(/simulated graph write failure/);

    expect(await store.getAgent(agent.id, alice)).toEqual(beforeAgent);
    expect(deserializeWorkflowDefinition(await store.getWorkflow(first.id, alice))).toEqual(beforeFirst);
    expect(deserializeWorkflowDefinition(await store.getWorkflow(second.id, alice))).toEqual(beforeSecond);
  });

  test("a failed deletion leaves agent and workflows intact when nothing was written yet", async () => {
    const store = new PostgresStudioStore(pool);
    const app = studioApp(store);
    const service = browserService(app);
    const agent = await service.createAgent({ name: "Referenced agent" });
    const graph = agentGraph(agent.id, "Referencing workflow");
    await service.saveWorkflow(graph);

    // Without removeReferences the route fails closed with 409 before mutating anything.
    const guardService = browserService(app);
    await expect(guardService.deleteAgent(agent.id)).rejects.toThrow(/Remove this agent/);
    expect(await store.getAgent(agent.id, alice)).not.toBeNull();
    const stored = deserializeWorkflowDefinition(await store.getWorkflow(graph.id, alice));
    expect(stored.nodes).toHaveLength(3);
    void nowIso;
  });

  test("successful data stays available to the same principal after a fresh store (restart)", async () => {
    const store = new PostgresStudioStore(pool);
    const app = studioApp(store);
    const service = browserService(app);
    const agent = await service.createAgent({ name: "Durable agent" });
    const workflow = agentGraph(agent.id, "Durable workflow");
    await service.updateAgent(agent.id, { description: "Survives restart" });
    await service.saveWorkflow(workflow);

    // "Restart": brand-new store instances over the same database, same principal.
    const restartedStore = new PostgresStudioStore(pool);
    const restartedApp = studioApp(restartedStore);
    const restartedService = browserService(restartedApp);

    const agentAfter = await restartedService.getAgent(agent.id);
    expect(agentAfter).not.toBeNull();
    expect(agentAfter?.description).toBe("Survives restart");
    const workflowAfter = await restartedService.getWorkflow(workflow.id);
    expect(workflowAfter?.name).toBe("Durable workflow");
    expect(workflowAfter?.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agent.id)).toBe(true);

    // A different principal still cannot see the private entities.
    expect(await restartedStore.getAgent(agent.id, { userId: "other-user", tenantId: alice.tenantId })).toBeNull();
    void restartedApp;
  });

  test("importWorkspace inside store.transaction rolls back atomically if transaction fails", async () => {
    const store = new PostgresStudioStore(pool);
    const agent = createAgentRecord({ name: "Rolled back imported agent" });
    const workflow = agentGraph(agent.id, "Rolled back imported wf");

    await expect(
      store.transaction(async (tx) => {
        await tx.importWorkspace({ workflows: [workflow], agents: [agent], tools: [] }, alice);
        expect(await tx.getAgent(agent.id, alice)).not.toBeNull();
        throw new Error("simulated outer transaction failure");
      })
    ).rejects.toThrow("simulated outer transaction failure");

    expect(await store.getAgent(agent.id, alice)).toBeNull();
    expect(await store.getWorkflow(workflow.id, alice)).toBeNull();
  });
});

describe("PostgresStudioStore importWorkspace transaction boundaries (Unit)", () => {
  test("importWorkspace inside transaction executes queries on transaction client and rolls back on failure", async () => {
    const executedQueries: string[] = [];
    let clientConnectCalls = 0;
    let released = false;

    const mockClient = {
      query: jest.fn(async (sql: string) => {
        executedQueries.push(sql);
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(() => {
        released = true;
      }),
    };

    const mockPool = {
      connect: jest.fn(async () => {
        clientConnectCalls += 1;
        return mockClient;
      }),
      query: jest.fn(),
    };

    const store = new PostgresStudioStore(mockPool as any);
    const agent = createAgentRecord({ name: "Transaction import agent" });
    const workflow = createEmptyDefinition("Transaction import wf");

    await expect(
      store.transaction(async (tx) => {
        await tx.importWorkspace({ workflows: [workflow], agents: [agent], tools: [] }, alice);
        throw new Error("simulated transaction failure after import");
      })
    ).rejects.toThrow("simulated transaction failure after import");

    expect(clientConnectCalls).toBe(1);
    expect(executedQueries).toContain("BEGIN");
    expect(executedQueries).toContain("ROLLBACK");
    expect(released).toBe(true);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO studio_workflows"),
      expect.anything()
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO studio_agents"),
      expect.anything()
    );
  });
});
