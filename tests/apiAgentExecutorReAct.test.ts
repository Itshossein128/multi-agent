import { createAgentRecord, createToolRecord, type ToolRecord } from "@multi-agent/types";
import { ApiAgentExecutor } from "../src/agents/runtime/apiAgentExecutor";
import { AgentExecutionFailedError } from "../src/agents/runtime/errors";
import { AGENT_TOOL_LIMIT_EXCEEDED } from "../src/agents/runtime/reactSettings";
import type { AgentExecutionEvent, AgentExecutionInput } from "../src/agents/runtime/types";

type ScriptedResponse = {
  content?: unknown;
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
};

function createScriptedModel(responses: ScriptedResponse[]) {
  const invokeCalls: unknown[][] = [];
  const model: {
    bindTools: jest.Mock;
    invoke: jest.Mock;
  } = {
    bindTools: jest.fn(),
    invoke: jest.fn(async (messages: unknown[]) => {
      invokeCalls.push(messages);
      const next = responses.shift();
      if (!next) return { content: "fallback" };
      return {
        content: next.content ?? "",
        tool_calls: next.tool_calls,
        usage_metadata: { total_tokens: 1 },
        response_metadata: { finish_reason: next.tool_calls?.length ? "tool_calls" : "stop" },
      };
    }),
  };
  model.bindTools.mockImplementation(() => model);
  return { model, bindTools: model.bindTools, invokeCalls };
}

async function collect(
  executor: ApiAgentExecutor,
  input: AgentExecutionInput
): Promise<{ events: AgentExecutionEvent[]; error?: unknown }> {
  const events: AgentExecutionEvent[] = [];
  try {
    for await (const event of executor.execute(input)) {
      events.push(event);
    }
    return { events };
  } catch (error) {
    return { events, error };
  }
}

function baseInput(overrides: Partial<AgentExecutionInput> & { tools?: ToolRecord[] } = {}): AgentExecutionInput {
  const tool =
    overrides.tools?.[0] ??
    (() => {
      const t = createToolRecord({ name: "lookup", description: "Lookup fixture" });
      t.id = "tool_lookup";
      t.impact = "read-only";
      t.executionPolicy = { requiresApproval: false, idempotency: "optional", retryable: true };
      return t;
    })();
  const tools = overrides.tools ?? [tool];
  const agent = createAgentRecord({ name: "ReAct Agent", model: "gpt-4o", provider: "openai" });
  agent.id = "agent_react";
  agent.tools = tools.map((t) => t.id);
  agent.executionMode = "react";

  const { tools: _omit, agent: agentOverride, ...rest } = overrides;
  return {
    agent: agentOverride ?? agent,
    input: { prompt: "use the lookup tool" },
    runId: "run_1",
    nodeId: "node_agent",
    resolvedTools: tools,
    toolRuntime: {
      execute: jest.fn(async () => ({ result: "lookup-ok" })),
    },
    credentialPrincipal: { tenantId: "t1", principalId: "p1" },
    ...rest,
  };
}

describe("ApiAgentExecutor ReAct — US1 single-tool", () => {
  test("happy path: bindTools, one execute, nested events, final depends on tool", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    tool.impact = "read-only";
    const { model, bindTools } = createScriptedModel([
      {
        content: "",
        tool_calls: [{ id: "tc1", name: "lookup", args: { q: "alpha" } }],
      },
      { content: "Answer uses lookup-ok" },
    ]);
    const execute = jest.fn(async () => ({ result: "lookup-ok" }));
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const input = baseInput({
      tools: [tool],
      toolRuntime: { execute },
    });

    const { events, error } = await collect(executor, input);
    expect(error).toBeUndefined();
    expect(bindTools).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tool_lookup" }),
      { q: "alpha" },
      undefined,
      expect.objectContaining({
        runId: "run_1",
        agentId: "agent_react",
        authorizedToolIds: ["tool_lookup"],
        credentialPrincipal: { tenantId: "t1", principalId: "p1" },
      })
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "agent.started",
        "tool.started",
        "tool.completed",
        "agent.output",
        "agent.completed",
      ])
    );
    expect(events.every((e) => e.nodeId === "node_agent")).toBe(true);
    expect(events.every((e) => e.agentId === "agent_react" || e.type.startsWith("llm"))).toBe(true);

    const completed = events.find((e) => e.type === "agent.completed");
    expect(JSON.stringify(completed?.payload)).toContain("lookup-ok");
  });

  test("unauthorized tool name never executes; tool.failed observation; loop continues", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    const { model } = createScriptedModel([
      {
        content: "",
        tool_calls: [{ id: "bad", name: "evil_tool", args: {} }],
      },
      { content: "Recovered without evil" },
    ]);
    const execute = jest.fn(async () => ({ ok: true }));
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events, error } = await collect(
      executor,
      baseInput({ tools: [tool], toolRuntime: { execute } })
    );
    expect(error).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "tool.failed")).toBe(true);
    expect(events.some((e) => e.type === "agent.completed")).toBe(true);
  });

  test('executionMode single_turn with tools ⇒ no bindTools / no execute', async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    const { model, bindTools } = createScriptedModel([{ content: "single shot" }]);
    const execute = jest.fn(async () => ({ ok: true }));
    const agent = createAgentRecord({ name: "Single", model: "gpt-4o" });
    agent.tools = [tool.id];
    agent.executionMode = "single_turn";
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events, error } = await collect(
      executor,
      baseInput({
        agent,
        tools: [tool],
        toolRuntime: { execute },
      })
    );
    expect(error).toBeUndefined();
    expect(bindTools).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(model.invoke).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === "agent.completed")).toBe(true);
  });
});

describe("ApiAgentExecutor ReAct — US2 multi-step", () => {
  test("multi-round: tool A then tool B then final", async () => {
    const toolA = createToolRecord({ name: "toolA" });
    toolA.id = "id_a";
    toolA.impact = "read-only";
    const toolB = createToolRecord({ name: "toolB" });
    toolB.id = "id_b";
    toolB.impact = "read-only";
    const { model } = createScriptedModel([
      { tool_calls: [{ id: "c1", name: "toolA", args: { n: 1 } }], content: "" },
      { tool_calls: [{ id: "c2", name: "toolB", args: { n: 2 } }], content: "" },
      { content: "both A and B" },
    ]);
    const order: string[] = [];
    const execute = jest.fn(async (tool: ToolRecord) => {
      order.push(tool.id);
      return { from: tool.id };
    });
    const agent = createAgentRecord({ name: "Multi" });
    agent.id = "agent_multi";
    agent.tools = ["id_a", "id_b"];
    agent.executionMode = "react";
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events, error } = await collect(
      executor,
      baseInput({
        agent,
        tools: [toolA, toolB],
        toolRuntime: { execute },
      })
    );
    expect(error).toBeUndefined();
    expect(order).toEqual(["id_a", "id_b"]);
    expect(model.invoke).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => e.type === "agent.completed")).toHaveLength(1);
    expect(JSON.stringify(events.find((e) => e.type === "agent.completed")?.payload)).toContain("both A and B");
  });

  test("parallel tool_calls in one round all execute before next invoke", async () => {
    const toolA = createToolRecord({ name: "toolA" });
    toolA.id = "id_a";
    toolA.impact = "read-only";
    const toolB = createToolRecord({ name: "toolB" });
    toolB.id = "id_b";
    toolB.impact = "read-only";
    const { model } = createScriptedModel([
      {
        content: "",
        tool_calls: [
          { id: "p1", name: "toolA", args: {} },
          { id: "p2", name: "toolB", args: {} },
        ],
      },
      { content: "done parallel" },
    ]);
    const order: string[] = [];
    const execute = jest.fn(async (tool: ToolRecord) => {
      order.push(tool.id);
      return { ok: true };
    });
    const agent = createAgentRecord({ name: "Parallel" });
    agent.tools = ["id_a", "id_b"];
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events, error } = await collect(
      executor,
      baseInput({ agent, tools: [toolA, toolB], toolRuntime: { execute } })
    );
    expect(error).toBeUndefined();
    expect(order).toEqual(["id_a", "id_b"]);
    expect(model.invoke).toHaveBeenCalledTimes(2);
    const started = events.filter((e) => e.type === "tool.started");
    expect(started).toHaveLength(2);
    expect((started[0].payload as { iteration: number }).iteration).toBe(1);
    expect((started[1].payload as { iteration: number }).iteration).toBe(1);
  });

  test("non-fatal tool failure becomes observation and loop continues", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    tool.impact = "read-only";
    const { model } = createScriptedModel([
      { tool_calls: [{ id: "t1", name: "lookup", args: {} }], content: "" },
      { content: "recovered after timeout" },
    ]);
    const execute = jest.fn(async () => {
      throw new Error("remote timeout");
    });
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events, error } = await collect(
      executor,
      baseInput({ tools: [tool], toolRuntime: { execute } })
    );
    expect(error).toBeUndefined();
    expect(events.some((e) => e.type === "tool.failed")).toBe(true);
    expect(events.some((e) => e.type === "agent.completed")).toBe(true);
    expect(JSON.stringify(events.find((e) => e.type === "agent.completed")?.payload)).toContain(
      "recovered after timeout"
    );
  });
});

describe("ApiAgentExecutor ReAct — US3 inspector payloads", () => {
  test("tool event payloads include inspector-compatible fields", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    tool.impact = "read-only";
    const { model } = createScriptedModel([
      { tool_calls: [{ id: "tc_inspector", name: "lookup", args: { q: "x" } }], content: "" },
      { content: "final" },
    ]);
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events } = await collect(
      executor,
      baseInput({
        tools: [tool],
        toolRuntime: { execute: async () => ({ value: 1 }) },
      })
    );
    const started = events.find((e) => e.type === "tool.started")!;
    expect(started.payload).toMatchObject({
      toolId: "tool_lookup",
      name: "lookup",
      arguments: { q: "x" },
      iteration: 1,
      toolCallId: "tc_inspector",
    });
    expect(started.nodeId).toBe("node_agent");
    expect(started.agentId).toBe("agent_react");

    const completed = events.find((e) => e.type === "tool.completed")!;
    expect(completed.payload).toMatchObject({
      toolId: "tool_lookup",
      toolCallId: "tc_inspector",
      output: { value: 1 },
    });
    expect(typeof (completed.payload as { durationMs: number }).durationMs).toBe("number");

    const failedPath = createScriptedModel([
      { tool_calls: [{ id: "tc_fail", name: "lookup", args: {} }], content: "" },
      { content: "ok" },
    ]);
    const { events: failEvents } = await collect(
      new ApiAgentExecutor(() => ({ getModel: () => failedPath.model })),
      baseInput({
        tools: [tool],
        toolRuntime: {
          execute: async () => {
            throw new Error("boom");
          },
        },
      })
    );
    const failed = failEvents.find((e) => e.type === "tool.failed")!;
    expect(failed.payload).toMatchObject({
      toolId: "tool_lookup",
      toolCallId: "tc_fail",
      error: expect.stringContaining("boom"),
    });
  });

  test("secret-like values are redacted from tool event payloads", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    tool.impact = "read-only";
    const secret = "sk-plantedsecrettoken123456";
    const { model } = createScriptedModel([
      {
        tool_calls: [{ id: "s1", name: "lookup", args: { apiKey: secret, q: "ok" } }],
        content: "",
      },
      { content: "done" },
    ]);
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events } = await collect(
      executor,
      baseInput({
        tools: [tool],
        toolRuntime: {
          execute: async () => ({ bearer: `Bearer ${secret}`, data: "safe" }),
        },
      })
    );
    const blob = JSON.stringify(events.filter((e) => e.type.startsWith("tool.")));
    expect(blob).not.toContain(secret);
    expect(blob).toContain("[redacted]");
  });
});

describe("ApiAgentExecutor ReAct — US5 safety", () => {
  test("maxToolSteps ceiling fails closed with AGENT_TOOL_LIMIT_EXCEEDED", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    tool.impact = "read-only";
    const responses: ScriptedResponse[] = [
      { tool_calls: [{ id: "1", name: "lookup", args: {} }], content: "" },
      { tool_calls: [{ id: "2", name: "lookup", args: {} }], content: "" },
      { tool_calls: [{ id: "3", name: "lookup", args: {} }], content: "" },
    ];
    const { model } = createScriptedModel(responses);
    const execute = jest.fn(async () => ({ ok: true }));
    const agent = createAgentRecord({ name: "Limited" });
    agent.tools = [tool.id];
    agent.executionMode = "react";
    agent.maxToolSteps = 2;
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events, error } = await collect(
      executor,
      baseInput({ agent, tools: [tool], toolRuntime: { execute } })
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(AgentExecutionFailedError);
    expect((error as AgentExecutionFailedError).code).toBe(AGENT_TOOL_LIMIT_EXCEEDED);
    const failed = events.find((e) => e.type === "agent.failed");
    expect(failed?.payload).toMatchObject({ code: AGENT_TOOL_LIMIT_EXCEEDED, maxToolSteps: 2 });
  });

  test("AbortSignal stops further tool rounds", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    tool.impact = "read-only";
    const controller = new AbortController();
    let invokes = 0;
    const model: { bindTools: jest.Mock; invoke: jest.Mock } = {
      bindTools: jest.fn(),
      invoke: jest.fn(async () => {
        invokes += 1;
        if (invokes === 1) {
          return {
            content: "",
            tool_calls: [{ id: "a1", name: "lookup", args: {} }],
          };
        }
        controller.abort();
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    };
    model.bindTools.mockImplementation(() => model);
    const execute = jest.fn(async (_t: ToolRecord, _i: Record<string, unknown>, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      expect(signal?.aborted).toBe(false);
      return { ok: true };
    });
    const agent = createAgentRecord({ name: "Cancelable" });
    agent.tools = [tool.id];
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { error } = await collect(
      executor,
      baseInput({
        agent,
        tools: [tool],
        toolRuntime: { execute },
        signal: controller.signal,
      })
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[2]).toBe(controller.signal);
    expect(invokes).toBe(2);
    expect(error).toBeDefined();
    // No third model round / second tool execute after abort
    expect(execute.mock.calls.length).toBe(1);
  });

  test("Decision 5: requiresApproval false write tool gets approvalGranted true", async () => {
    const tool = createToolRecord({ name: "writer" });
    tool.id = "tool_writer";
    tool.impact = "write";
    tool.executionPolicy = { requiresApproval: false, idempotency: "optional", retryable: true };
    const { model } = createScriptedModel([
      { tool_calls: [{ id: "w1", name: "writer", args: { v: 1 } }], content: "" },
      { content: "wrote" },
    ]);
    const execute = jest.fn(async () => ({ ok: true }));
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { error } = await collect(
      executor,
      baseInput({ tools: [tool], toolRuntime: { execute } })
    );
    expect(error).toBeUndefined();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tool_writer" }),
      { v: 1 },
      undefined,
      expect.objectContaining({ approvalGranted: true })
    );
  });

  test("Decision 5: requiresApproval true write tool gets approvalGranted false", async () => {
    const tool = createToolRecord({ name: "mutator" });
    tool.id = "tool_mutator";
    tool.impact = "write";
    tool.executionPolicy = { requiresApproval: true, idempotency: "required", retryable: false };
    const { model } = createScriptedModel([
      { tool_calls: [{ id: "m1", name: "mutator", args: {} }], content: "" },
      { content: "done" },
    ]);
    const execute = jest.fn(async () => ({ ok: true }));
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    await collect(executor, baseInput({ tools: [tool], toolRuntime: { execute } }));
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({ approvalGranted: false })
    );
  });

  test("ReAct with assigned tools fails closed when toolRuntime missing", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    const { model, bindTools } = createScriptedModel([{ content: "should not run" }]);
    const agent = createAgentRecord({ name: "NoRuntime" });
    agent.tools = [tool.id];
    agent.executionMode = "react";
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { error } = await collect(
      executor,
      baseInput({
        agent,
        tools: [tool],
        resolvedTools: [tool],
        toolRuntime: undefined,
      })
    );
    expect(error).toBeInstanceOf(AgentExecutionFailedError);
    expect(String((error as Error).message)).toMatch(/ToolRuntime/i);
    expect(bindTools).not.toHaveBeenCalled();
  });

  test("ReAct with assigned tools fails closed when resolvedTools empty", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    tool.enabled = false;
    const { model, bindTools } = createScriptedModel([{ content: "should not run" }]);
    const agent = createAgentRecord({ name: "NoResolved" });
    agent.tools = [tool.id];
    agent.executionMode = "react";
    const execute = jest.fn(async () => ({ ok: true }));
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { error } = await collect(
      executor,
      baseInput({
        agent,
        tools: [tool],
        resolvedTools: [],
        toolRuntime: { execute },
      })
    );
    expect(error).toBeInstanceOf(AgentExecutionFailedError);
    expect(String((error as Error).message)).toMatch(/resolved/i);
    expect(bindTools).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test("fatal/security tool failure fails the agent node", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    tool.impact = "read-only";
    const { model } = createScriptedModel([
      { tool_calls: [{ id: "f1", name: "lookup", args: {} }], content: "" },
      { content: "should not reach" },
    ]);
    const fatal = Object.assign(new Error("credential broker hard fail (fail-closed)"), {
      code: "CREDENTIAL_BROKER_FAILURE",
      fatal: true,
    });
    const execute = jest.fn(async () => {
      throw fatal;
    });
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { events, error } = await collect(
      executor,
      baseInput({ tools: [tool], toolRuntime: { execute } })
    );
    expect(error).toBeInstanceOf(AgentExecutionFailedError);
    expect(events.some((e) => e.type === "agent.failed")).toBe(true);
    expect(events.some((e) => e.type === "agent.completed")).toBe(false);
    expect(model.invoke).toHaveBeenCalledTimes(1);
  });

  test("node single_turn override disables ReAct even when agent is react", async () => {
    const tool = createToolRecord({ name: "lookup" });
    tool.id = "tool_lookup";
    const { model, bindTools } = createScriptedModel([{ content: "no tools" }]);
    const execute = jest.fn(async () => ({ ok: true }));
    const agent = createAgentRecord({ name: "Overridden" });
    agent.tools = [tool.id];
    agent.executionMode = "react";
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    const { error } = await collect(
      executor,
      baseInput({
        agent,
        tools: [tool],
        toolRuntime: { execute },
        nodeExecutionMode: "single_turn",
      })
    );
    expect(error).toBeUndefined();
    expect(bindTools).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
