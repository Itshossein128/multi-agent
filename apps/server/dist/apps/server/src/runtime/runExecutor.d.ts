import { type AgentTestRequest, type RunCreateRequest } from "@multi-agent/types";
import { RunStore } from "./runStore";
import { AgentRuntime } from "../../../../src/agents/runtime";
export declare class RunExecutor {
    private readonly store;
    private readonly agentRuntime;
    constructor(store?: RunStore, agentRuntime?: Pick<AgentRuntime, "execute">);
    getStore(): RunStore;
    startAgentTest(request: AgentTestRequest): string;
    private executeAgentTest;
    start(request: RunCreateRequest): string;
    cancel(runId: string): boolean;
    private execute;
}
