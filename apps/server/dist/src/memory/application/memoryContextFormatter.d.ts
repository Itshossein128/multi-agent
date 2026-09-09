import type { MemoryContextFormatter, MemoryRetrievalResult } from "../contracts";
import type { MemorySearchResult } from "@multi-agent/types";
export interface MemoryContextFormatterOptions {
    countTokens?: (text: string) => number;
}
/** UTF-8 bytes are a conservative bound for byte-based tokenizers, not a chars/4 estimate.
 * Supply the actual model tokenizer for tighter accounting. This is context data, never a system message. */
export declare class DefaultMemoryContextFormatter implements MemoryContextFormatter {
    private readonly counter;
    constructor(options?: MemoryContextFormatterOptions);
    countTokens(text: string): number;
    render(results: MemorySearchResult[]): string;
    select(results: MemorySearchResult[], maxTokens: number): MemorySearchResult[];
    format(result: MemoryRetrievalResult, maxTokens: number): string;
}
