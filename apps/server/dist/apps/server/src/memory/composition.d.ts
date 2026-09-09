import type { MemoryService, RuntimeMemoryDependencies } from "../../../../src/memory/contracts";
export interface MemoryComposition {
    service?: MemoryService;
    runtime?: RuntimeMemoryDependencies;
    close(): Promise<void>;
}
/** No migrations at startup; durable storage never silently falls back to a Map. */
export declare function createMemoryComposition(): MemoryComposition;
