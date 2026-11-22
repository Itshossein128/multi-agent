/**
 * Split structured thinking from an agent answer and pack it into run-log chunks.
 * The answer path must keep using `content` only. This module does not read credentials.
 */

export const THINKING_CHUNK_CHARS = 8_000;

export const THINKING_FOLLOW_THRESHOLD_PX = 48;

export const THINKING_COPY = {
  pending: "Thinking has not arrived yet.",
  none: "No thinking was shared.",
  unavailable: "Thinking is unavailable for this run.",
  incomplete: "The run record stopped before the rest of this thinking was saved.",
} as const;

export type ThinkingStatus = "shared" | "none";

export interface ThinkingLogPayload {
  channel: "thinking";
  thoughts: string;
  thinkingStatus: ThinkingStatus;
  final: boolean;
  part: number;
}

export function isBlankThinking(value: string): boolean {
  return value.trim().length === 0;
}

export function chunkThinkingText(text: string, limit = THINKING_CHUNK_CHARS): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += limit) chunks.push(text.slice(index, index + limit));
  return chunks;
}

/** `thoughts` is empty only when `thinkingStatus` is `"none"`. `part` is 0-based. The last payload has `final: true`. */
export function buildThinkingLogs(text: string): ThinkingLogPayload[] {
  if (isBlankThinking(text)) return [noneThinkingLog()];
  const chunks = chunkThinkingText(text);
  return chunks.map((thoughts, part) => ({
    channel: "thinking",
    thoughts,
    thinkingStatus: "shared",
    final: part === chunks.length - 1,
    part,
  }));
}

export function noneThinkingLog(part = 0): ThinkingLogPayload {
  return { channel: "thinking", thoughts: "", thinkingStatus: "none", final: true, part };
}

export function shouldFollowThinkingTail(distanceFromBottomPx: number, threshold = THINKING_FOLLOW_THRESHOLD_PX): boolean {
  return distanceFromBottomPx <= threshold;
}

export function splitModelContent(content: unknown): { thinking: string; answer: unknown } {
  if (typeof content === "string" || content == null) return { thinking: "", answer: content ?? "" };
  if (!Array.isArray(content)) return { thinking: "", answer: content };
  const thinking: string[] = [];
  const answer: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      answer.push(part);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    if (type === "redacted_thinking") continue;
    if (isThinkingType(type)) {
      const text = firstString(record.thinking, record.text, record.reasoning);
      if (text) thinking.push(text);
      continue;
    }
    if (typeof record.text === "string") answer.push(record.text);
  }
  return { thinking: thinking.join(""), answer: answer.join("") };
}

export function thinkingFromAdditional(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  if (typeof record.reasoning_content === "string") return record.reasoning_content;
  if (typeof record.reasoning === "string") return record.reasoning;
  return "";
}

/** Incremental JSONL reader. A completed reasoning line is returned before the process exits. */
export class CliThinkingParser {
  private buffer = "";
  private emitted = "";
  private pendingDelta = "";

  constructor(private readonly provider: string) {}

  push(chunk: string): string[] {
    this.buffer += chunk;
    const pieces: string[] = [];
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const piece = this.consumeEntry(extractCliThinkingEntry(this.provider, line));
      if (piece) pieces.push(piece);
    }
    return pieces;
  }

  finish(): string[] {
    const line = this.buffer;
    this.buffer = "";
    const pieces: string[] = [];
    if (line.trim()) {
      const piece = this.consumeEntry(extractCliThinkingEntry(this.provider, line));
      if (piece) pieces.push(piece);
    }
    if (this.pendingDelta.trim().length > 0) {
      pieces.push(this.pendingDelta);
    }
    this.pendingDelta = "";
    return pieces;
  }

  private consumeEntry(entry: { text: string; mode: "cumulative" | "delta" }): string {
    if (!entry.text) return "";
    if (entry.mode === "delta") {
      this.emitted += entry.text;
      this.pendingDelta += entry.text;
      if (this.pendingDelta.trim().length === 0) return "";
      const flushed = this.pendingDelta;
      this.pendingDelta = "";
      return flushed;
    }
    const prefix = this.pendingDelta.trim().length > 0 ? this.pendingDelta : "";
    this.pendingDelta = "";
    const taken = this.take(entry.text);
    return prefix + taken;
  }

  private take(text: string): string {
    if (!text) return "";
    if (text.startsWith(this.emitted)) {
      const delta = text.slice(this.emitted.length);
      this.emitted = text;
      return delta;
    }
    if (this.emitted.includes(text)) return "";
    this.emitted += text;
    return text;
  }
}

export function extractCliThinkingLine(provider: string, line: string): string {
  return extractCliThinkingEntry(provider, line).text;
}

function extractCliThinkingEntry(provider: string, line: string): { text: string; mode: "cumulative" | "delta" } {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return { text: "", mode: "cumulative" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { text: "", mode: "cumulative" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { text: "", mode: "cumulative" };
  const record = parsed as Record<string, unknown>;
  if (provider === "cursor") {
    if (record.type === "thinking") {
      if (record.subtype === "completed") return { text: "", mode: "cumulative" };
      if (record.subtype === "delta") {
        return { text: typeof record.text === "string" ? record.text : "", mode: "delta" };
      }
      return { text: firstString(record.text, record.thinking, record.reasoning), mode: "cumulative" };
    }
    if (record.type === "assistant") {
      const message = record.message;
      const content = message && typeof message === "object" && !Array.isArray(message)
        ? (message as Record<string, unknown>).content
        : record.content;
      return { text: thinkingBlocks(content), mode: "cumulative" };
    }
    if (record.type === "result" && Array.isArray(record.thinking_blocks)) {
      const text = record.thinking_blocks
        .map((block) => (block && typeof block === "object" && typeof (block as Record<string, unknown>).text === "string"
          ? (block as Record<string, unknown>).text as string
          : ""))
        .filter(Boolean)
        .join("");
      return { text, mode: "cumulative" };
    }
    return { text: "", mode: "cumulative" };
  }
  if (provider === "agy") {
    if (record.event === "result") return { text: "", mode: "cumulative" };
    return { text: firstString(record.thinking, record.reasoning), mode: "cumulative" };
  }
  if (provider === "codex") {
    if (record.type !== "item.completed" && record.type !== "item.updated") return { text: "", mode: "cumulative" };
    const item = record.item;
    if (!item || typeof item !== "object" || Array.isArray(item)) return { text: "", mode: "cumulative" };
    const itemRecord = item as Record<string, unknown>;
    const itemType = typeof itemRecord.type === "string" ? itemRecord.type : "";
    if (!isThinkingType(itemType)) return { text: "", mode: "cumulative" };
    return { text: textFromReasoningItem(itemRecord), mode: "cumulative" };
  }
  if (provider === "claude-code" || provider === "claude") {
    const message = record.message;
    const content = message && typeof message === "object" && !Array.isArray(message)
      ? (message as Record<string, unknown>).content
      : record.content;
    return { text: thinkingBlocks(content), mode: "cumulative" };
  }
  return { text: "", mode: "cumulative" };
}

function thinkingBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const record = part as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    if (type === "redacted_thinking" || !isThinkingType(type)) return "";
    return firstString(record.thinking, record.text, record.reasoning);
  }).join("");
}

function textFromReasoningItem(item: Record<string, unknown>): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.thinking === "string") return item.thinking;
  if (!Array.isArray(item.summary)) return "";
  return item.summary.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
      return (part as Record<string, unknown>).text as string;
    }
    return "";
  }).join("");
}

function isThinkingType(type: string): boolean {
  return type === "thinking" || type === "reasoning" || type.endsWith("_reasoning") || type.includes("reasoning");
}

function firstString(...values: unknown[]): string {
  for (const value of values) if (typeof value === "string" && value.trim()) return value;
  return "";
}
