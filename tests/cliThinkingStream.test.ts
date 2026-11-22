import { parseCodexOutput, parseClaudeOutput } from "../src/agents/runtime/cliAgentExecutor";
import { CliThinkingParser, extractCliThinkingLine } from "../src/agents/runtime/thinkingText";

const reasoning = JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "plan the edit" } });
const answer = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } });
const tool = JSON.stringify({ type: "item.completed", item: { type: "command_execution", text: "ls" } });

test("a Codex reasoning line is thinking before the process exits, and the answer stays the agent message", () => {
  const parser = new CliThinkingParser("codex");
  expect(parser.push(`${reasoning}\n`)).toEqual(["plan the edit"]);
  expect(parser.push(`${tool}\n${answer}\n`)).toEqual([]);
  expect(parseCodexOutput(`${reasoning}\n${tool}\n${answer}\n`).content).toBe("done");
});

test("plain stdout is not thinking", () => {
  const parser = new CliThinkingParser("cursor");
  expect(parser.push("just the answer\n")).toEqual([]);
  expect(extractCliThinkingLine("codex", "just the answer")).toBe("");
});

test("Claude thinking blocks stay out of the answer", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "thinking", thinking: "weigh it", signature: "sig" }, { type: "text", text: "ship it" }] },
  });
  const parser = new CliThinkingParser("claude-code");
  expect(parser.push(`${line}\n`)).toEqual(["weigh it"]);
  expect(parseClaudeOutput(JSON.stringify({ session_id: "s", result: "ship it" })).content).toBe("ship it");
});

test("an updated reasoning item is not emitted twice when the completed item repeats it", () => {
  const parser = new CliThinkingParser("codex");
  const updated = JSON.stringify({ type: "item.updated", item: { id: "r1", type: "reasoning", text: "plan" } });
  const completed = JSON.stringify({ type: "item.completed", item: { id: "r1", type: "reasoning", text: "plan" } });
  expect(parser.push(`${updated}\n${completed}\n`)).toEqual(["plan"]);
});

test("Cursor delta thinking preserves repeated short tokens and spaces without dropping duplicates", () => {
  const parser = new CliThinkingParser("cursor");
  const lines = [
    JSON.stringify({ type: "thinking", subtype: "delta", text: "the " }),
    JSON.stringify({ type: "thinking", subtype: "delta", text: "file" }),
    JSON.stringify({ type: "thinking", subtype: "delta", text: " " }),
    JSON.stringify({ type: "thinking", subtype: "delta", text: "in " }),
    JSON.stringify({ type: "thinking", subtype: "delta", text: "the" }),
    JSON.stringify({ type: "thinking", subtype: "completed" }),
    JSON.stringify({ type: "tool_call", subtype: "started", call_id: "c1" }),
  ].join("\n") + "\n";

  const emitted = parser.push(lines).concat(parser.finish());
  expect(emitted.join("")).toBe("the file in the");
});

test("Cursor result thinking_blocks fallback extracts thinking when present", () => {
  const parser = new CliThinkingParser("cursor");
  const resultLine = JSON.stringify({
    type: "result",
    subtype: "success",
    result: "final answer",
    thinking_blocks: [{ text: "step 1; " }, { text: "step 2" }],
  });
  expect(parser.push(`${resultLine}\n`)).toEqual(["step 1; step 2"]);
});
