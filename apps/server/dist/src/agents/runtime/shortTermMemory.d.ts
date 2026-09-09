import type { AgentExecutionInput } from "./types";
export interface HistoryEntry {
    id: string;
    input: unknown;
    output: unknown;
}
export interface ShortTermHistory {
    entries: HistoryEntry[];
    maxEntries: number;
    maxTokens: number;
}
export type ShortTermHistories = Record<string, ShortTermHistory>;
export declare function historyKey(input: AgentExecutionInput): string;
export declare function boundedInteger(value: number | undefined, fallback: number, max: number): number;
/** UTF-8 bytes are a conservative token upper bound, independent of model tokenizer. */
export declare function boundText(text: string, budget: number): string;
export declare function boundHistory(history: ShortTermHistory): ShortTermHistory;
/** Updates contain only new entries: parallel branches sharing an agent cannot overwrite each other. */
export declare function mergeHistories(current: ShortTermHistories, update: ShortTermHistories): ShortTermHistories;
