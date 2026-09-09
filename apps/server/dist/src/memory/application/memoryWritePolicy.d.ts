import type { MemoryCandidate, MemoryWriteDecision, MemoryWritePolicy } from "../contracts";
export declare class DefaultMemoryWritePolicy implements MemoryWritePolicy {
    shouldRemember(candidate: MemoryCandidate): Promise<MemoryWriteDecision>;
}
