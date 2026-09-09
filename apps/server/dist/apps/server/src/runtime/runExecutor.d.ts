import { type AgentTestRequest, type RunCreateRequest } from "@multi-agent/types";
import { type CompileOptions } from "../compiler/workflowCompiler";
import { RunStore } from "./runStore";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { AgentRuntime } from "../../../../src/agents/runtime";
export declare class RunExecutor {
    private readonly store;
    private readonly agentRuntime;
    private readonly checkpointer?;
    constructor(store?: RunStore, agentRuntime?: Pick<AgentRuntime, "execute">, checkpointer?: CompileOptions["checkpointer"]);
    getStore(): RunStore;
    startAgentTest(request: AgentTestRequest, memoryAccess?: MemoryAccessContext): string;
    private executeAgentTest;
    start(request: RunCreateRequest, memoryAccess?: MemoryAccessContext): string;
    cancel(runId: string): boolean;
    private execute;
}
