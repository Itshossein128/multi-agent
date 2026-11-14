import { createAgentRecord } from "@multi-agent/types";
import { ApiAgentExecutor } from "../src/agents/runtime/apiAgentExecutor";
import { CliThinkingParser } from "../src/agents/runtime/thinkingText";

function collect(events: AsyncIterable<{ type: string; payload?: unknown }>) {
  return (async () => {
    const out: Array<{ type: string; payload?: unknown }> = [];
    for await (const event of events) out.push(event);
    return out;
  })();
}

function executor(content: unknown, additional_kwargs?: unknown) {
  const agent = {
    ...createAgentRecord({ name: "A", model: "gpt-4o" }),
    id: "agent_1",
    tools: [],
    backend: { type: "api" as const, provider: "openai", model: "gpt-4o" },
  };
  return new ApiAgentExecutor(() => ({
    getModel: () => ({ invoke: async () => ({ content, additional_kwargs }) }),
  })).execute({ agent, input: "question", runId: "run_1", nodeId: "node_a" });
}

test("thinking and reasoning text stay out of the answer", async () => {
  const events = await collect(executor([
    { type: "thinking", thinking: "consider", signature: "secret-signature" },
    { type: "reasoning", text: "hidden reason" },
    { type: "text", text: "answer" },
  ]));
  const completed = events.find((event) => event.type === "agent.completed");
  expect((completed?.payload as { content?: string }).content).toBe("answer");
  const thinking = events.filter((event) => event.type === "log").map((event) => JSON.stringify(event.payload)).join("");
  expect(thinking).toContain("consider");
  expect(thinking).toContain("hidden reason");
  expect(thinking).not.toContain("secret-signature");
  expect((completed?.payload as { content?: string }).content).not.toContain("hidden reason");
});

test("additional reasoning content is thinking, not the answer", async () => {
  const events = await collect(executor("visible", { reasoning_content: "private chain" }));
  expect((events.find((event) => event.type === "agent.completed")?.payload as { content?: string }).content).toBe("visible");
  expect(events.some((event) => event.type === "log" && JSON.stringify(event.payload).includes("private chain"))).toBe(true);
});

test("redacted thinking alone records that nothing was shared", async () => {
  const events = await collect(executor([{ type: "redacted_thinking" }]));
  const completed = events.find((event) => event.type === "agent.completed");
  expect((completed?.payload as { content?: string; thinkingStatus?: string }).content).toBe("");
  expect((completed?.payload as { thinkingStatus?: string }).thinkingStatus).toBe("none");
  const logs = events.filter((event) => event.type === "log").map((event) => event.payload as { thoughts?: string; thinkingStatus?: string });
  expect(logs).toEqual([expect.objectContaining({ thoughts: "", thinkingStatus: "none" })]);
});

test("Agy result text stays the answer and a thinking field is the only thinking", () => {
  const parser = new CliThinkingParser("agy");
  const thinking = JSON.stringify({ event: "status", thinking: "look first" });
  const result = JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "final answer" } });
  expect(parser.push(`${thinking}\n${result}\n`)).toEqual(["look first"]);
});
