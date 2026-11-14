import { buildNodeExecutionView } from "../apps/web/src/lib/runCanvasProjection";
import type { RunEvent } from "@multi-agent/types";
import {
  THINKING_CHUNK_CHARS,
  THINKING_COPY,
  buildThinkingLogs,
  chunkThinkingText,
  shouldFollowThinkingTail,
  splitModelContent,
} from "../src/agents/runtime/thinkingText";

const event = (sequence: number, payload: Record<string, unknown>): RunEvent => ({
  id: `e${sequence}`, runId: "r", nodeId: "n", type: "log", sequence, timestamp: "2026-11-14T00:00:00.000Z", payload,
});

test("chunks stay within 8000 characters and rejoin in part order", () => {
  const text = `${"a".repeat(THINKING_CHUNK_CHARS)}bc`;
  const chunks = chunkThinkingText(text);
  expect(chunks.every((chunk) => chunk.length <= THINKING_CHUNK_CHARS)).toBe(true);
  const logs = buildThinkingLogs(text);
  expect(logs.map((log) => log.part)).toEqual([0, 1]);
  expect(logs.every((log) => log.channel === "thinking" && log.thinkingStatus === "shared")).toBe(true);
  expect(logs[1].final).toBe(true);
  expect(logs.map((log) => log.thoughts).join("")).toBe(text);
});

test("blank thinking is a none marker and reasoning text is not copied into the answer", () => {
  expect(buildThinkingLogs("   ")[0]).toMatchObject({ channel: "thinking", thoughts: "", thinkingStatus: "none", final: true, part: 0 });
  const split = splitModelContent([
    { type: "thinking", thinking: "consider", signature: "secret-signature" },
    { type: "reasoning", text: "hidden reason" },
    { type: "text", text: "answer" },
  ]);
  expect(split.thinking).toBe("considerhidden reason");
  expect(split.thinking).not.toContain("secret-signature");
  expect(split.answer).toBe("answer");
  expect(THINKING_COPY.none).toBe("No thinking was shared.");
  expect(THINKING_COPY.unavailable).toBe("Thinking is unavailable for this run.");
  expect(THINKING_COPY.pending).toBe("Thinking has not arrived yet.");
  expect(THINKING_COPY.incomplete).toBe("The run record stopped before the rest of this thinking was saved.");
});

test("follow the latest text only within 48 pixels of the bottom", () => {
  expect(shouldFollowThinkingTail(48)).toBe(true);
  expect(shouldFollowThinkingTail(0)).toBe(true);
  expect(shouldFollowThinkingTail(49)).toBe(false);
});

test("a truncated thinking payload marks the attempt record incomplete", () => {
  const view = buildNodeExecutionView("n", {
    events: [event(1, { channel: "thinking", thoughts: "kept", thinkingStatus: "shared", final: false, part: 0 }), event(2, { truncated: true, preview: "{\"channel\":\"thinking\"}" })],
  });
  expect(view.thinkingAttempts[0].recordIncomplete).toBe(true);
  expect(view.thinkingAttempts[0].text).toBe("kept");
});
