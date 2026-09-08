import { type RunCreateRequest } from "@multi-agent/types";
import { RunStore } from "./runStore";
export declare class RunExecutor {
    private readonly store;
    constructor(store?: RunStore);
    getStore(): RunStore;
    start(request: RunCreateRequest): string;
    cancel(runId: string): boolean;
    private execute;
}
