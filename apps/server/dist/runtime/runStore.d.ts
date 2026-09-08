import type { Run, RunEvent } from "@multi-agent/types";
type Listener = (event: RunEvent) => void;
interface Entry {
    run: Run;
    events: RunEvent[];
    listeners: Set<Listener>;
    abort: AbortController;
}
export declare class RunStore {
    private entries;
    create(run: Run): Run;
    get(runId: string): Entry | undefined;
    append(runId: string, event: RunEvent): {
        sequence: number;
        id: string;
        runId: string;
        type: import("@multi-agent/types").RunEventType;
        timestamp: string;
        nodeId?: string;
        agentId?: string;
        toolId?: string;
        parentEventId?: string;
        payload: Record<string, unknown>;
    } | undefined;
    update(runId: string, patch: Partial<Run>): Run | undefined;
    events(runId: string, after?: number): RunEvent[];
    subscribe(runId: string, listener: Listener): (() => undefined) | (() => boolean);
    cancel(runId: string): boolean;
    signal(runId: string): AbortSignal | undefined;
}
export {};
