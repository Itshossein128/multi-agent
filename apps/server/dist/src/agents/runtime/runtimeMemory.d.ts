import type { RuntimeMemoryDependencies } from "../../memory/contracts";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";
export declare function memoryEvent(input: AgentExecutionInput, type: "memory.read" | "memory.write", payload: Record<string, unknown>): AgentExecutionEvent;
/** Owns one node's memory lifecycle; no authority is inferred from agent/browser configuration. */
export declare class RuntimeMemory {
    private readonly input;
    private readonly deps?;
    constructor(input: AgentExecutionInput, deps?: RuntimeMemoryDependencies | undefined);
    private get config();
    get enabled(): boolean | undefined;
    private failure;
    private requireAccess;
    private guard;
    assertResult(events: AgentExecutionEvent[]): void;
    read(): Promise<{
        context?: string;
        events: AgentExecutionEvent[];
    }>;
    private write;
    afterSuccess(output: unknown): Promise<AgentExecutionEvent[]>;
}
