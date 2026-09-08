import {
  createAgentRecord,
  migrateAgentRecord,
  agentBackendLabel,
  type AgentBackend,
} from "@multi-agent/types";
import { AgentExecutorFactory } from "../src/agents/runtime/agentExecutorFactory";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import { ApiAgentExecutor } from "../src/agents/runtime/apiAgentExecutor";
import { mapAgentExecutionEvent } from "../src/agents/runtime/mapAgentExecutionEvent";
import { UnsupportedBackendError } from "../src/agents/runtime/errors";
import type { AgentExecutionEvent, AgentExecutor } from "../src/agents/runtime/types";

describe("Agent backend abstraction", () => {
  test("migrates legacy model/provider records into api backend", () => {
    const migrated = migrateAgentRecord({
      id: "agent-1",
      name: "Reviewer",
      model: "claude-3-5-sonnet",
      provider: "anthropic",
      systemPrompt: "review code",
      tools: [],
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(migrated.backend).toEqual({
      type: "api",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
    });
    expect(agentBackendLabel(migrated.backend)).toBe("claude-3-5-sonnet");
  });

  test("createAgentRecord defaults to api/openai backend", () => {
    const agent = createAgentRecord({ name: "Planner" });
    expect(agent.backend).toEqual({ type: "api", provider: "openai", model: "gpt-4o" });
  });
});

describe("AgentExecutorFactory", () => {
  const factory = new AgentExecutorFactory();

  test("resolves api backend to ApiAgentExecutor", () => {
    const executor = factory.create({ type: "api", provider: "openai", model: "gpt-4o" });
    expect(executor).toBeInstanceOf(ApiAgentExecutor);
  });

  test("unknown / unimplemented backends fail explicitly", async () => {
    const backend: AgentBackend = { type: "cli", provider: "codex" };
    const executor = factory.create(backend);
    const agent = createAgentRecord({ backend });

    const events: AgentExecutionEvent[] = [];
    await expect(async () => {
      for await (const event of executor.execute({
        agent,
        input: { prompt: "hi" },
        runId: "run-1",
        nodeId: "node-1",
      })) {
        events.push(event);
      }
    }).rejects.toBeInstanceOf(UnsupportedBackendError);

    expect(events.some((event) => event.type === "agent.failed")).toBe(true);
    const failed = events.find((e) => e.type === "agent.failed");
    expect(JSON.stringify(failed?.payload)).toMatch(/not implemented/i);
  });
});

describe("AgentRuntime", () => {
  test("delegates to the factory-selected executor", async () => {
    const calls: string[] = [];
    const stub: AgentExecutor = {
      async *execute() {
        calls.push("executed");
        yield {
          type: "agent.completed",
          timestamp: new Date().toISOString(),
          payload: { content: "ok" },
        };
      },
    };

    const factory = {
      create: (backend: AgentBackend) => {
        calls.push(`create:${backend.type}`);
        return stub;
      },
    };

    const runtime = new AgentRuntime(factory as AgentExecutorFactory);
    const agent = createAgentRecord();
    const events: AgentExecutionEvent[] = [];
    for await (const event of runtime.execute({
      agent,
      input: "hello",
      runId: "run-1",
      nodeId: "agent-node",
    })) {
      events.push(event);
    }

    expect(calls).toEqual(["create:api", "executed"]);
    expect(events[0]?.type).toBe("agent.completed");
  });
});

describe("ApiAgentExecutor", () => {
  test("invokes model via factory and emits started/output/completed", async () => {
    const invoke = jest.fn(async () => ({ content: "answer" }));
    const executor = new ApiAgentExecutor(() => ({
      getModel: (provider, options) => {
        expect(provider).toBe("openai");
        expect(options?.model).toBe("gpt-4o-mini");
        return { invoke };
      },
    }));

    const agent = createAgentRecord({
      backend: { type: "api", provider: "openai", model: "gpt-4o-mini" },
    });
    agent.systemPrompt = "Be brief.";

    const events: AgentExecutionEvent[] = [];
    for await (const event of executor.execute({
      agent,
      input: { q: "2+2" },
      runId: "run-1",
      nodeId: "n1",
    })) {
      events.push(event);
    }

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual([
      "agent.started",
      "agent.output",
      "agent.completed",
    ]);
    expect((events[2]?.payload as { content: string }).content).toBe("answer");
  });
});

describe("mapAgentExecutionEvent", () => {
  test("maps executor events into RunEvents", () => {
    const [runEvent] = mapAgentExecutionEvent(
      {
        type: "agent.failed",
        timestamp: "2026-01-01T00:00:00.000Z",
        agentId: "a1",
        nodeId: "n1",
        runId: "r1",
        payload: { error: "boom" },
      },
      "r1"
    );

    expect(runEvent.type).toBe("agent.failed");
    expect(runEvent.agentId).toBe("a1");
    expect(runEvent.nodeId).toBe("n1");
    expect(runEvent.payload).toEqual({ error: "boom" });
  });
});
