import type { Run, RunEvent } from "@multi-agent/types";
type Listener = (event: RunEvent) => void;
interface MemoryOwner {
    principalId: string;
    tenantId: string;
}
interface Entry {
    run: Run;
    events: RunEvent[];
    listeners: Set<Listener>;
    abort: AbortController;
    memoryOwner?: MemoryOwner;
}
export declare class RunStore {
    private entries;
    create(run: Run, memoryOwner?: MemoryOwner): Run;
    getMemoryOwner(runId: string): MemoryOwner | undefined;
    get(runId: string): Entry | undefined;
    list(agentId?: string): Run[];
    append(runId: string, event: RunEvent): {
        payload: RunEvent["payload"];
        sequence: number;
        id: string;
        runId: string;
        type: import("@multi-agent/types").RunEventType;
        timestamp: string;
        nodeId?: string;
        agentId?: string;
        toolId?: string;
        parentEventId?: string;
    } | undefined;
    update(runId: string, patch: Partial<Run>): Run | undefined;
    events(runId: string, after?: number): RunEvent[];
    subscribe(runId: string, listener: Listener): (() => undefined) | (() => boolean);
    cancel(runId: string): boolean;
    signal(runId: string): AbortSignal | undefined;
}
export {};
