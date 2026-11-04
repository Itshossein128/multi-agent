import { createAgentRecord, createToolRecord } from "@multi-agent/types";
import { ApiAgentExecutor } from "../src/agents/runtime/apiAgentExecutor";
import type { AgentExecutionInput } from "../src/agents/runtime/types";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";

function collect(events: AsyncIterable<{ type: string; payload?: unknown }>) {
  return (async () => {
    const out: Array<{ type: string; payload?: unknown }> = [];
    for await (const event of events) out.push(event);
    return out;
  })();
}

describe("agent step config execution", () => {
  test("additive taskInstruction appears after system and before task; systemPrompt unchanged", async () => {
    const agent = {
      ...createAgentRecord({ name: "A", model: "gpt-4o" }),
      id: "agent_1",
      systemPrompt: "BASE PERSONA",
      tools: [],
      backend: { type: "api" as const, provider: "openai", model: "gpt-4o" },
    };
    const captured: unknown[] = [];
    const executor = new ApiAgentExecutor(() => ({
      getModel: () => ({
        invoke: async (messages: unknown[]) => {
          captured.push(...messages);
          return { content: "ok" };
        },
      }),
    }));
    await collect(
      executor.execute({
        agent,
        input: "workflow task",
        runId: "run_1",
        nodeId: "node_a",
        taskInstruction: "STEP ONLY",
      })
    );
    expect(agent.systemPrompt).toBe("BASE PERSONA");
    const roles = (captured as Array<{ role?: string; content?: string }>).map((m) => m.content);
    expect(roles[0]).toContain("BASE PERSONA");
    expect(roles.some((c) => typeof c === "string" && c.includes("STEP INSTRUCTIONS") && c.includes("STEP ONLY"))).toBe(
      true
    );
    const stepIdx = roles.findIndex(
      (c) => typeof c === "string" && c.includes("STEP INSTRUCTIONS") && c.includes("STEP ONLY")
    );
    const taskIdx = roles.findIndex((c) => c === "workflow task");
    expect(stepIdx).toBeGreaterThan(0);
    expect(taskIdx).toBeGreaterThan(stepIdx);
  });

  test("omitted taskInstruction keeps legacy message shape", async () => {
    const agent = {
      ...createAgentRecord({ name: "A", model: "gpt-4o" }),
      id: "agent_1",
      systemPrompt: "BASE",
      tools: [],
      backend: { type: "api" as const, provider: "openai", model: "gpt-4o" },
    };
    const captured: unknown[] = [];
    const executor = new ApiAgentExecutor(() => ({
      getModel: () => ({
        invoke: async (messages: unknown[]) => {
          captured.push(...messages);
          return { content: "ok" };
        },
      }),
    }));
    await collect(
      executor.execute({
        agent,
        input: "task",
        runId: "run_1",
        nodeId: "node_a",
      })
    );
    expect(
      (captured as Array<{ content?: string }>).some(
        (m) => typeof m.content === "string" && m.content.includes("STEP INSTRUCTIONS")
      )
    ).toBe(false);
  });

  test("two concurrent executes with shared AgentRecord never mutate it and keep distinct instructions", async () => {
    const agent = {
      ...createAgentRecord({ name: "Shared", model: "gpt-4o" }),
      id: "agent_1",
      systemPrompt: "PERSONA",
      tools: [],
      backend: { type: "api" as const, provider: "openai", model: "gpt-4o", settings: { temperature: 0.5 } },
    };
    const before = JSON.stringify(agent);
    const captures: Record<string, unknown[]> = { a: [], b: [] };
    const makeExec = (bucket: string) =>
      new ApiAgentExecutor(() => ({
        getModel: (_p, options) => ({
          invoke: async (messages: unknown[]) => {
            captures[bucket].push({ messages, settings: options?.settings });
            return { content: bucket };
          },
        }),
      }));
    await Promise.all([
      collect(
        makeExec("a").execute({
          agent,
          input: "in-a",
          runId: "run_a",
          nodeId: "n_a",
          taskInstruction: "INSTR_A",
          modelSettingsOverride: { temperature: 0 },
        })
      ),
      collect(
        makeExec("b").execute({
          agent,
          input: "in-b",
          runId: "run_b",
          nodeId: "n_b",
          taskInstruction: "INSTR_B",
          modelSettingsOverride: { temperature: 1 },
        })
      ),
    ]);
    expect(JSON.stringify(agent)).toBe(before);
    const aText = JSON.stringify(captures.a);
    const bText = JSON.stringify(captures.b);
    expect(aText).toContain("INSTR_A");
    expect(aText).not.toContain("INSTR_B");
    expect(bText).toContain("INSTR_B");
    expect(bText).not.toContain("INSTR_A");
    expect((captures.a[0] as { settings?: { temperature?: number } }).settings?.temperature).toBe(0);
    expect((captures.b[0] as { settings?: { temperature?: number } }).settings?.temperature).toBe(1);
    expect(agent.backend.type === "api" && agent.backend.settings?.temperature).toBe(0.5);
  });

  test("API executor uses effective merged settings including temperature 0 without mutating agent", async () => {
    const agent = {
      ...createAgentRecord({ name: "A", model: "gpt-4o" }),
      id: "agent_1",
      tools: [],
      backend: {
        type: "api" as const,
        provider: "openai",
        model: "gpt-4o",
        settings: { temperature: 0.8, maxTokens: 100 },
      },
    };
    let seenSettings: unknown;
    const executor = new ApiAgentExecutor(() => ({
      getModel: (_p, options) => {
        seenSettings = options?.settings;
        return { invoke: async () => ({ content: "ok" }) };
      },
    }));
    await collect(
      executor.execute({
        agent,
        input: "x",
        runId: "r",
        nodeId: "n",
        modelSettingsOverride: { temperature: 0 },
      })
    );
    expect(seenSettings).toEqual({ temperature: 0, maxTokens: 100 });
    expect(agent.backend.type === "api" && agent.backend.settings).toEqual({
      temperature: 0.8,
      maxTokens: 100,
    });
  });

  test("activeTools subset binds only effective tools; out-of-set never executes", async () => {
    const toolA = { ...createToolRecord({ name: "A" }), id: "tool_a", enabled: true };
    const toolB = { ...createToolRecord({ name: "B" }), id: "tool_b", enabled: true };
    const agent = {
      ...createAgentRecord({ name: "A", model: "gpt-4o" }),
      id: "agent_1",
      tools: ["tool_a", "tool_b"],
      executionMode: "react" as const,
      backend: { type: "api" as const, provider: "openai", model: "gpt-4o" },
    };
    const execute = jest.fn(async () => ({
      ok: true as const,
      output: "done",
      durationMs: 1,
    }));
    let boundNames: string[] = [];
    let round = 0;
    const model = {
      bindTools: (tools: unknown[]) => {
        boundNames = (tools as Array<{ function?: { name?: string } }>).map(
          (t) => t.function?.name ?? ""
        );
        return {
          invoke: async () => {
            round += 1;
            if (round === 1) {
              return {
                content: "",
                tool_calls: [{ id: "c1", name: "B", args: {} }],
              };
            }
            return { content: "final" };
          },
        };
      },
      invoke: async () => ({ content: "no-react" }),
    };
    const executor = new ApiAgentExecutor(() => ({ getModel: () => model }));
    await collect(
      executor.execute({
        agent,
        input: "x",
        runId: "r",
        nodeId: "n",
        resolvedTools: [toolA],
        toolRuntime: { execute },
        nodeExecutionMode: "react",
      } as AgentExecutionInput)
    );
    expect(boundNames).toEqual(["A"]);
    expect(execute).not.toHaveBeenCalled();
  });

  test("activeTools: [] does not bind or execute tools even when agent.tools nonempty", async () => {
    const agent = {
      ...createAgentRecord({ name: "A", model: "gpt-4o" }),
      id: "agent_1",
      tools: ["tool_a"],
      executionMode: "react" as const,
      backend: { type: "api" as const, provider: "openai", model: "gpt-4o" },
    };
    const execute = jest.fn();
    const bindTools = jest.fn();
    const executor = new ApiAgentExecutor(() => ({
      getModel: () => ({
        bindTools,
        invoke: async () => ({ content: "single" }),
      }),
    }));
    await collect(
      executor.execute({
        agent,
        input: "x",
        runId: "r",
        nodeId: "n",
        resolvedTools: [],
        activeTools: [],
        toolRuntime: { execute },
        nodeExecutionMode: "react",
      })
    );
    expect(bindTools).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test("ContextAssembler path delivers step instruction without mutating systemPrompt", async () => {
    const agent = {
      ...createAgentRecord({ name: "A", model: "gpt-4o" }),
      id: "agent_1",
      systemPrompt: "SYS",
      tools: [],
      backend: { type: "api" as const, provider: "openai", model: "gpt-4o" },
    };
    const captured: unknown[] = [];
    const runtime = new AgentRuntime({
      create: () =>
        new ApiAgentExecutor(() => ({
          getModel: () => ({
            invoke: async (messages: unknown[]) => {
              captured.push(...messages);
              return { content: "ok" };
            },
          }),
        })),
    });
    await collect(
      runtime.execute({
        agent,
        input: "task",
        runId: "run_1",
        nodeId: "node_1",
        taskInstruction: "FROM ASSEMBLER",
      })
    );
    expect(agent.systemPrompt).toBe("SYS");
    expect(JSON.stringify(captured)).toContain("FROM ASSEMBLER");
    expect(JSON.stringify(captured)).toContain("SYS");
  });
});
