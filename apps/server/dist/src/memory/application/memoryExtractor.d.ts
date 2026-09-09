import type { MemoryCandidate, MemoryExtractionInput, MemoryExtractor } from "../contracts";
/** Only an explicit candidate channel or an anchored user request promotes data. Events/output prose are never mined. */
export declare class DeterministicMemoryExtractor implements MemoryExtractor {
    extract(input: MemoryExtractionInput): Promise<MemoryCandidate[]>;
}
export { DeterministicMemoryExtractor as DefaultMemoryExtractor };
