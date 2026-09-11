import { createAgentRecord, type Run, type RunEvent } from "@multi-agent/types";
import { emptyBackend, validateAgentConfiguration } from "../apps/web/src/lib/agentConfiguration";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { publicAgent } from "../apps/web/src/lib/publicAgent";
import { createRunsRouter } from "../apps/server/src/api/runs";
import type { RunExecutor } from "../apps/server/src/runtime/runExecutor";

jest.mock("../apps/server/src/runtime/runExecutor", () => ({ RunExecutor: jest.fn() }));

describe("Agent detail configuration", () => {
  test("legacy credential fields do not reach agent form state", () => {
    const raw = { ...createAgentRecord(), metadata: { apiKey: "private-value", purpose: "review" }, backend: { type: "local", provider: "ollama", model: "qwen", baseUrl: "http://user:pass@localhost:11434?token=private", apiKey: "private-value" } };
    const visible = publicAgent(raw);
    expect(visible.metadata).toEqual({ purpose: "review" });
    expect(JSON.stringify(visible)).not.toMatch(/private-value|user:pass|token=/);
  });
  test("switching backend removes incompatible settings without adding permissions", () => {
    const cli = emptyBackend("cli");
    expect(cli).toEqual({ type: "cli", provider: "codex" });
    expect(validateAgentConfiguration(createAgentRecord({ backend: cli }))).toEqual([]);
    expect(validateAgentConfiguration(createAgentRecord({ backend: emptyBackend("local") }))).toContain("Model is required for API and local backends.");
  });
  test("rejects credential-bearing local URLs, metadata and contradictory policy", () => {
    const agent = createAgentRecord({ backend: { type: "local", provider: "ollama", model: "qwen", baseUrl: "http://user:password@localhost:11434" } });
    agent.metadata = { apiKey: "sensitive" };
    agent.executionPolicy = { shell: "disabled", allowedCommands: ["git"], workspaceRoot: "relative/path" };
    const errors = validateAgentConfiguration(agent).join(" ");
    expect(errors).toMatch(/without credentials/);
    expect(errors).toMatch(/runtime configuration/);
    expect(errors).toMatch(/Remove allowed commands/);
    expect(errors).toMatch(/absolute path/);
  });
});

describe("Agent run history and server event sanitization", () => {
  const run = (id: string): Run => ({
    id,
    workflowId: "workflow-1",
    startedAt: "2026-09-08T10:00:00Z",
    status: "running",
    metadata: {},
    ownerId: "principal-1",
    tenantId: "tenant-1",
  });
  test("history API includes related node events but excludes another agent and missing runs", async () => {
    const store = new RunStore(); store.create(run("r1"));
    const base = { runId: "r1", sequence: 0, timestamp: "2026-09-08T10:00:01Z", payload: {} };
    store.append("r1", { ...base, id: "a", type: "agent.started", agentId: "a1", nodeId: "n1" });
    store.append("r1", { ...base, id: "b", type: "node.completed", nodeId: "n1" });
    store.append("r1", { ...base, id: "c", type: "agent.started", agentId: "a2", nodeId: "n2" });
    store.append("r1", { ...base, id: "d", type: "node.completed", nodeId: "n2" });
    const { app } = createRunsRouter(
      { getStore: () => store } as unknown as RunExecutor,
      undefined,
      undefined,
      async () => ({ userId: "principal-1", tenantId: "tenant-1" }),
    );
    const response = await app.request("http://localhost/r1/history?agentId=a1");
    expect(response.status).toBe(200);
    expect((await response.json() as RunEvent[]).map((event) => event.id)).toEqual(["a", "b"]);
    expect((await app.request("http://localhost/missing/history?agentId=a1")).status).toBe(404);
    const list = await app.request("http://localhost/?agentId=a1");
    expect((await list.json() as Run[]).map((item) => item.id)).toEqual(["r1"]);
  });
  test("returns only runs with events for the agent, including repeated node instances", () => {
    const store = new RunStore();
    store.create(run("r1")); store.create(run("r2"));
    const event = (id: string, runId: string, agentId: string, nodeId: string): RunEvent => ({ id, runId, agentId, nodeId, type: "agent.started", sequence: 0, timestamp: "2026-09-08T10:00:01Z", payload: {} });
    store.append("r1", event("e1", "r1", "a1", "n1"));
    store.append("r1", event("e2", "r1", "a1", "n2"));
    store.append("r2", event("e3", "r2", "a2", "n3"));
    expect(store.list("a1").map((item) => item.id)).toEqual(["r1"]);
    expect(store.list("missing")).toEqual([]);
    expect(store.events("r1").map((item) => item.sequence)).toEqual([1, 2]);
  });
  test("sanitizes executor payloads before storage and subscriber delivery", () => {
    const store = new RunStore(); store.create(run("r1"));
    const receive = jest.fn(); store.subscribe("r1", receive);
    store.append("r1", { id: "event", runId: "r1", agentId: "a1", sequence: 0, timestamp: "2026-09-08T10:00:01Z", type: "agent.failed", payload: {
      error: "Failed request: Bearer credential-value", nested: { apiKey: "secret-value" }, stack: "private stack",
    } });
    const payload = store.events("r1")[0].payload;
    expect(JSON.stringify(payload)).not.toMatch(/credential-value|secret-value|private stack/);
    expect(receive.mock.calls[0][0].payload).toEqual(payload);
  });
});
