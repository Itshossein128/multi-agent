import type { AgentExecutionInput } from "./types";

export interface HistoryEntry { id: string; input: unknown; output: unknown }
export interface ShortTermHistory { entries: HistoryEntry[]; maxEntries: number; maxTokens: number }
export type ShortTermHistories = Record<string, ShortTermHistory>;

export function historyKey(input: AgentExecutionInput): string {
  return JSON.stringify([input.runId, input.agent.id, input.agent.memory?.scope === "node" ? input.nodeId : "agent"]);
}

export function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value!))) : fallback;
}

/** UTF-8 bytes are a conservative token upper bound, independent of model tokenizer. */
export function boundText(text: string, budget: number): string {
  return Buffer.from(text).subarray(0, budget).toString("utf8").replace(/\uFFFD$/, "");
}

export function boundHistory(history: ShortTermHistory): ShortTermHistory {
  const maxEntries = boundedInteger(history.maxEntries, 20, 100);
  const maxTokens = boundedInteger(history.maxTokens, 4096, 16384);
  if (!maxEntries || !maxTokens) return { entries: [], maxEntries, maxTokens };
  let size = 2;
  const entries: HistoryEntry[] = [];
  for (const entry of history.entries.slice(-maxEntries).reverse()) {
    const cost = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (size + cost > maxTokens || entries.length >= maxEntries) break;
    entries.unshift(entry);
    size += cost;
  }
  return { entries, maxEntries, maxTokens };
}

/** Updates contain only new entries: parallel branches sharing an agent cannot overwrite each other. */
export function mergeHistories(current: ShortTermHistories, update: ShortTermHistories): ShortTermHistories {
  const result = { ...current };
  for (const [key, next] of Object.entries(update)) {
    const entries = new Map((current[key]?.entries ?? []).map(entry => [entry.id, entry]));
    for (const entry of next.entries) entries.set(entry.id, entry);
    result[key] = boundHistory({ ...next, entries: [...entries.values()] });
  }
  return result;
}
