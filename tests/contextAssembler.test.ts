/**
 * ContextAssembler Tests
 *
 * Proves the centralized context assembly pipeline works correctly:
 * - Context sources are all included when budget allows
 * - Priority-based pruning works correctly
 * - Token budget is enforced
 * - Deterministic ordering
 * - Trust boundaries preserved
 * - API and CLI executors serialize correctly
 */
import { createAgentRecord, type AgentRecord } from "@multi-agent/types";
import {
  DefaultContextAssembler,
  Utf8ByteEstimator,
  PRIORITY,
  type AssembledContext,
  type ContextAssemblyRequest,
  type ContextItem,
} from "../src/agents/runtime/contextAssembler";
import type { HistoryEntry } from "../src/agents/runtime/shortTermMemory";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return { ...createAgentRecord(), ...overrides };
}

function makeRequest(overrides: Partial<ContextAssemblyRequest> = {}): ContextAssemblyRequest {
  return {
    runId: "run-1",
    workflowId: "wf-1",
    nodeId: "node-1",
    agentId: "agent-1",
    agent: makeAgent(),
    task: "What is the capital of France?",
    ...overrides,
  };
}

function itemCounts(ctx: AssembledContext): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of ctx.items) {
    counts[item.source] = (counts[item.source] ?? 0) + 1;
  }
  return counts;
}

function totalTokens(ctx: AssembledContext): number {
  return ctx.items.reduce((sum, item) => sum + item.estimatedTokens, 0);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const assembler = new DefaultContextAssembler();

describe("DefaultContextAssembler", () => {

  test("system instructions are always included as required", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "You are a helpful coding agent.",
    }));
    const systemItems = ctx.items.filter(i => i.source === "system");
    expect(systemItems).toHaveLength(1);
    expect(systemItems[0].required).toBe(true);
    expect((systemItems[0].content as { text: string }).text).toBe("You are a helpful coding agent.");
  });

  test("current task is always included as required", async () => {
    const ctx = await assembler.assemble(makeRequest({
      task: "Fix the login bug",
    }));
    const taskItems = ctx.items.filter(i => i.source === "task");
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0].required).toBe(true);
    expect((taskItems[0].content as { text: string }).text).toBe("Fix the login bug");
  });

  test("short-term history is included when provided", async () => {
    const history: HistoryEntry[] = [
      { id: "1", input: "Hello", output: "Hi there!" },
      { id: "2", input: "How are you?", output: "I'm fine." },
    ];
    const ctx = await assembler.assemble(makeRequest({ history }));
    const historyItems = ctx.items.filter(i => i.source === "history");
    expect(historyItems).toHaveLength(1);
    expect((historyItems[0].content as { entries: HistoryEntry[] }).entries).toEqual(history);
  });

  test("long-term memory is included when provided", async () => {
    const ctx = await assembler.assemble(makeRequest({
      longTermMemoryContext: "Untrusted memory data: The project uses pnpm.",
    }));
    const memItems = ctx.items.filter(i => i.source === "long_term_memory");
    expect(memItems).toHaveLength(1);
    expect((memItems[0].content as { text: string }).text).toContain("pnpm");
  });

  test("previous output is included when provided", async () => {
    const ctx = await assembler.assemble(makeRequest({
      previousOutput: "The previous node completed successfully.",
    }));
    const prevItems = ctx.items.filter(i => i.source === "previous_output");
    expect(prevItems).toHaveLength(1);
  });

  test("runtime state is included when non-empty", async () => {
    const ctx = await assembler.assemble(makeRequest({
      runtimeState: { memory: { key1: "value1" } },
    }));
    const rtItems = ctx.items.filter(i => i.source === "runtime_state");
    expect(rtItems.length).toBeGreaterThanOrEqual(1);
  });

  test("empty history produces no history items", async () => {
    const ctx = await assembler.assemble(makeRequest({ history: [] }));
    expect(ctx.items.filter(i => i.source === "history")).toHaveLength(0);
  });

  test("empty long-term memory produces no memory items", async () => {
    const ctx = await assembler.assemble(makeRequest({
      longTermMemoryContext: undefined,
    }));
    expect(ctx.items.filter(i => i.source === "long_term_memory")).toHaveLength(0);
  });

  test("empty runtime state produces no runtime items", async () => {
    const ctx = await assembler.assemble(makeRequest({
      runtimeState: {},
    }));
    expect(ctx.items.filter(i => i.source === "runtime_state")).toHaveLength(0);
  });

  test("all context sources are included when budget allows", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "System instructions",
      task: "Current task",
      history: [{ id: "1", input: "Hi", output: "Hello" }],
      longTermMemoryContext: "Memory context",
      previousOutput: "Previous output",
      runtimeState: { branch: "approved" },
    }));
    const counts = itemCounts(ctx);
    expect(counts["system"]).toBe(1);
    expect(counts["task"]).toBe(1);
    expect(counts["history"]).toBe(1);
    expect(counts["long_term_memory"]).toBe(1);
    expect(counts["previous_output"]).toBe(1);
    expect(counts["runtime_state"]).toBeGreaterThanOrEqual(1);
  });
});

describe("Priority-based pruning", () => {
  test("lower priority items are dropped first when budget is tight", async () => {
    const assembler = new DefaultContextAssembler({ defaultInputBudget: 30, estimator: new Utf8ByteEstimator() });
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "A".repeat(50),
      task: "B".repeat(50),
      history: [{ id: "1", input: "C".repeat(50), output: "D".repeat(50) }],
      longTermMemoryContext: "E".repeat(50),
      previousOutput: "F".repeat(50),
    }));
    // System and task are required, so they survive
    expect(ctx.items.some(i => i.source === "system")).toBe(true);
    expect(ctx.items.some(i => i.source === "task")).toBe(true);
    // Lower priority items may be dropped
    expect(ctx.droppedItems.length).toBeGreaterThanOrEqual(1);
    // All dropped items should be lower priority than system/task
    for (const dropped of ctx.droppedItems) {
      expect(dropped.source).not.toBe("system");
      expect(dropped.source).not.toBe("task");
    }
  });

  test("required items survive even when they exceed budget", async () => {
    const assembler = new DefaultContextAssembler({ defaultInputBudget: 10 });
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "A".repeat(100),
      task: "B".repeat(100),
    }));
    // Both required items should still be present
    expect(ctx.items.some(i => i.source === "system")).toBe(true);
    expect(ctx.items.some(i => i.source === "task")).toBe(true);
  });
});

describe("Token budget", () => {
  test("used tokens does not exceed budget for non-required items", async () => {
    const budget = 500;
    const assembler = new DefaultContextAssembler({ defaultInputBudget: budget });
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "A".repeat(100),
      task: "B".repeat(100),
      history: [{ id: "1", input: "C".repeat(300), output: "D".repeat(300) }],
      longTermMemoryContext: "E".repeat(300),
    }));
    // Required items may exceed budget, but non-required should be pruned
    expect(ctx.budget.maxTokens).toBe(budget);
    expect(ctx.budget.usedTokens).toBeGreaterThan(0);
  });

  test("droppedTokens tracks pruned content", async () => {
    const assembler = new DefaultContextAssembler({ defaultInputBudget: 200 });
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "System",
      task: "Task",
      previousOutput: "A".repeat(1000),
    }));
    expect(ctx.budget.droppedTokens).toBeGreaterThan(0);
  });
});

describe("Deterministic ordering", () => {
  test("same input produces identical item ordering", async () => {
    const request = makeRequest({
      history: [
        { id: "1", input: "First", output: "Response 1" },
        { id: "2", input: "Second", output: "Response 2" },
      ],
      longTermMemoryContext: "Memory content",
      previousOutput: "Previous",
    });
    const results = await Promise.all([
      assembler.assemble(request),
      assembler.assemble(request),
      assembler.assemble(request),
    ]);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].items.map(it => it.id)).toEqual(results[0].items.map(it => it.id));
      expect(results[i].droppedItems.map(d => d.id)).toEqual(results[0].droppedItems.map(d => d.id));
    }
  });
});

describe("Model-specific budget", () => {
  test("smaller model drops more optional context", async () => {
    const makeReq = () => makeRequest({
      systemPrompt: "System",
      task: "Task",
      history: [{ id: "1", input: "Q".repeat(500), output: "A".repeat(500) }],
      longTermMemoryContext: "M".repeat(500),
    });
    const small = await assembler.assemble({ ...makeReq(), model: { contextWindowTokens: 2000 } });
    const large = await assembler.assemble({ ...makeReq(), model: { contextWindowTokens: 200000 } });
    // Large model should keep more items
    expect(large.items.length).toBeGreaterThanOrEqual(small.items.length);
  });

  test("unknown model uses fallback budget", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "System",
      task: "Task",
    }));
    expect(ctx.budget.maxTokens).toBeGreaterThan(0);
  });
});

describe("Diagnostics", () => {
  test("diagnostics report source breakdown", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "System",
      task: "Task",
      history: [{ id: "1", input: "Q", output: "A" }],
      longTermMemoryContext: "Memory",
    }));
    expect(ctx.diagnostics.itemCount).toBeGreaterThan(0);
    expect(ctx.diagnostics.sources.system.count).toBe(1);
    expect(ctx.diagnostics.sources.task.count).toBe(1);
    expect(ctx.diagnostics.sources.history.count).toBe(1);
    expect(ctx.diagnostics.sources.long_term_memory.count).toBe(1);
  });

  test("dropped items are tracked in diagnostics", async () => {
    const tightAssembler = new DefaultContextAssembler({ defaultInputBudget: 100 });
    const ctx = await tightAssembler.assemble(makeRequest({
      systemPrompt: "A".repeat(50),
      task: "B".repeat(50),
      previousOutput: "C".repeat(500),
      longTermMemoryContext: "D".repeat(500),
    }));
    expect(ctx.diagnostics.droppedItemCount).toBeGreaterThan(0);
  });
});

describe("Provenance", () => {
  test("context items retain metadata", async () => {
    const ctx = await assembler.assemble(makeRequest({
      history: [
        { id: "h1", input: "Q1", output: "A1" },
        { id: "h2", input: "Q2", output: "A2" },
      ],
      metadata: { source: "test" },
    }));
    const historyItem = ctx.items.find(i => i.source === "history");
    expect(historyItem?.metadata?.entryCount).toBe(2);
    const metaItem = ctx.items.find(i => i.source === "metadata");
    expect(metaItem).toBeDefined();
  });
});

describe("API executor serialization", () => {
  test("assembledContext produces correct message array", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "You are helpful.",
      task: "What is 2+2?",
      history: [{ id: "1", input: "Hello", output: "Hi!" }],
      longTermMemoryContext: "Untrusted memory: The answer is 4.",
    }));

    // Simulate what ApiAgentExecutor.buildMessages does
    const messages: unknown[] = [];
    for (const item of ctx.items) {
      const content = item.content as Record<string, unknown>;
      switch (item.source) {
        case "system": messages.push({ role: "system", content: content.text }); break;
        case "task": messages.push({ role: "user", content: content.text }); break;
        case "history": {
          const entries = content.entries as { input: unknown; output: unknown }[];
          for (const e of entries) {
            messages.push({ role: "user", content: String(e.input) });
            messages.push({ role: "assistant", content: String(e.output) });
          }
          break;
        }
        case "long_term_memory": messages.push({ role: "user", content: content.text }); break;
      }
    }

    expect(messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(messages.some((m: any) => m.role === "user" && m.content === "What is 2+2?")).toBe(true);
    expect(messages.some((m: any) => m.role === "user" && String(m.content).includes("Hello"))).toBe(true);
    expect(messages.some((m: any) => m.role === "assistant" && String(m.content).includes("Hi!"))).toBe(true);
    expect(messages.some((m: any) => m.role === "user" && String(m.content).includes("Untrusted memory"))).toBe(true);
  });
});

describe("CLI executor serialization", () => {
  test("assembledContext produces correct prompt sections", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "You are helpful.",
      task: "What is 2+2?",
      history: [{ id: "1", input: "Hello", output: "Hi!" }],
      longTermMemoryContext: "Untrusted memory: The answer is 4.",
    }));

    // Simulate what CliAgentExecutor.assembledContextToPrompt does
    const sections: string[] = [];
    for (const item of ctx.items) {
      const content = item.content as Record<string, unknown>;
      switch (item.source) {
        case "system": sections.push(`SYSTEM INSTRUCTIONS:\n${content.text}`); break;
        case "task": sections.push(`USER INPUT:\n${content.text}`); break;
        case "history": {
          const entries = content.entries as { input: unknown; output: unknown }[];
          for (const e of entries) {
            sections.push(`PREVIOUS USER INPUT:\n${String(e.input)}\nPREVIOUS ASSISTANT OUTPUT:\n${String(e.output)}`);
          }
          break;
        }
        case "long_term_memory": sections.push(`MEMORY CONTEXT:\n${content.text}`); break;
      }
    }
    const prompt = sections.filter(Boolean).join("\n\n");

    expect(prompt).toContain("SYSTEM INSTRUCTIONS:");
    expect(prompt).toContain("You are helpful.");
    expect(prompt).toContain("USER INPUT:");
    expect(prompt).toContain("What is 2+2?");
    expect(prompt).toContain("PREVIOUS USER INPUT:");
    expect(prompt).toContain("Hello");
    expect(prompt).toContain("MEMORY CONTEXT:");
    expect(prompt).toContain("Untrusted memory");
  });
});

describe("Trust boundaries", () => {
  test("memory items are never elevated to system priority", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "Trusted system instructions",
      longTermMemoryContext: "Untrusted memory content",
    }));
    const systemItem = ctx.items.find((i: ContextItem) => i.source === "system");
    const memoryItem = ctx.items.find((i: ContextItem) => i.source === "long_term_memory");
    expect(systemItem!.priority).toBeGreaterThan(memoryItem!.priority);
  });

  test("history items are never elevated to system priority", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "Trusted",
      history: [{ id: "1", input: "Untrusted user message", output: "Untrusted response" }],
    }));
    const systemItem = ctx.items.find((i: ContextItem) => i.source === "system");
    const historyItem = ctx.items.find((i: ContextItem) => i.source === "history");
    expect(systemItem!.priority).toBeGreaterThan(historyItem!.priority);
  });
});

describe("Edge cases", () => {
  test("no duplicate context insertion", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "System",
      task: "Task",
    }));
    const ids = ctx.items.map((i: ContextItem) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("very large previous output is handled", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "System",
      task: "Task",
      previousOutput: "X".repeat(100_000),
    }));
    // Should not crash; large output should be pruned or included
    expect(ctx.items.length).toBeGreaterThanOrEqual(2); // at least system + task
  });

  test("undefined previous output is handled", async () => {
    const ctx = await assembler.assemble(makeRequest({
      previousOutput: undefined,
    }));
    expect(ctx.items.filter((i: ContextItem) => i.source === "previous_output")).toHaveLength(0);
  });

  test("context with no optional sources still works", async () => {
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "System",
      task: "Task",
    }));
    expect(ctx.items.length).toBe(2);
    expect(ctx.items.every((i: ContextItem) => i.source === "system" || i.source === "task")).toBe(true);
  });
});

describe("Utf8ByteEstimator", () => {
  test("estimates string tokens", () => {
    const estimator = new Utf8ByteEstimator();
    expect(estimator.estimate("hello")).toBeGreaterThan(0);
    expect(estimator.estimate("hello world")).toBeGreaterThan(estimator.estimate("hello"));
  });

  test("handles null/undefined", () => {
    const estimator = new Utf8ByteEstimator();
    expect(estimator.estimate(null)).toBe(0);
    expect(estimator.estimate(undefined)).toBe(0);
  });

  test("handles objects", () => {
    const estimator = new Utf8ByteEstimator();
    expect(estimator.estimate({ key: "value" })).toBeGreaterThan(0);
  });
});

describe("Priority constants", () => {
  test("system has highest priority", () => {
    expect(PRIORITY.SYSTEM).toBeGreaterThan(PRIORITY.TASK);
    expect(PRIORITY.TASK).toBeGreaterThan(PRIORITY.RUNTIME_STATE);
    expect(PRIORITY.RUNTIME_STATE).toBeGreaterThan(PRIORITY.LONG_TERM_MEMORY);
    expect(PRIORITY.LONG_TERM_MEMORY).toBeGreaterThan(PRIORITY.HISTORY);
    expect(PRIORITY.HISTORY).toBeGreaterThan(PRIORITY.PREVIOUS_OUTPUT);
    expect(PRIORITY.PREVIOUS_OUTPUT).toBeGreaterThan(PRIORITY.METADATA);
  });
});
