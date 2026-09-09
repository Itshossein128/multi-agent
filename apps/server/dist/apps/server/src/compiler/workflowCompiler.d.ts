import { StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { type AgentRecord, type WorkflowDefinition, type WorkflowNode } from "@multi-agent/types";
import { AgentRuntime } from "../../../../src/agents/runtime";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { type ShortTermHistories } from "../../../../src/agents/runtime/shortTermMemory";
export declare class UnsupportedPhase4NodeError extends Error {
    readonly nodeId: string;
    constructor(nodeId: string, node: WorkflowNode);
}
export interface RuntimeState {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    memory: Record<string, unknown>;
    shortTermHistories?: ShortTermHistories;
    branch?: string;
    lastValue?: unknown;
}
declare const State: import("@langchain/langgraph").AnnotationRoot<{
    shortTermHistories: import("@langchain/langgraph").BaseChannel<ShortTermHistories, ShortTermHistories | import("@langchain/langgraph").OverwriteValue<ShortTermHistories>, unknown>;
    input: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
    output: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
    memory: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
    branch: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
    lastValue: import("@langchain/langgraph").BaseChannel<unknown, unknown, unknown>;
}>;
export type CompiledWorkflow = ReturnType<StateGraph<typeof State["State"], typeof State["Node"]>["compile"]>;
export interface AgentExecutionEvent {
    type: string;
    timestamp: string;
    payload?: unknown;
    agentId?: string;
    nodeId?: string;
    runId?: string;
}
export interface CompileOptions {
    signal?: AbortSignal;
    runtime?: Pick<AgentRuntime, "execute">;
    memoryAccess?: MemoryAccessContext;
    /** A stable run identity enables checkpoints; anonymous compilation stays stateless. */
    checkpointer?: BaseCheckpointSaver | false;
    /** @deprecated Prefer AgentRuntime via the default path; kept for tests/overrides. */
    agentRunner?: (agent: AgentRecord, state: RuntimeState, meta: {
        runId: string;
        nodeId: string;
    }) => Promise<unknown>;
    runId?: string;
    workflowId?: string;
    onAgentEvent?: (event: AgentExecutionEvent) => void;
}
export declare function compileWorkflow(definition: WorkflowDefinition, agents: AgentRecord[], options?: CompileOptions): {
    graph: import("@langchain/langgraph").CompiledStateGraph<{
        shortTermHistories: ShortTermHistories;
        input: Record<string, unknown>;
        output: Record<string, unknown>;
        memory: Record<string, unknown>;
        branch: string | undefined;
        lastValue: unknown;
    }, {
        shortTermHistories?: ShortTermHistories | import("@langchain/langgraph").OverwriteValue<ShortTermHistories> | undefined;
        input?: Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>> | undefined;
        output?: Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>> | undefined;
        memory?: Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>> | undefined;
        branch?: string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined;
        lastValue?: unknown;
    }, "__start__", {
        shortTermHistories: import("@langchain/langgraph").BaseChannel<ShortTermHistories, ShortTermHistories | import("@langchain/langgraph").OverwriteValue<ShortTermHistories>, unknown>;
        input: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        output: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        memory: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        branch: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
        lastValue: import("@langchain/langgraph").BaseChannel<unknown, unknown, unknown>;
    }, {
        shortTermHistories: import("@langchain/langgraph").BaseChannel<ShortTermHistories, ShortTermHistories | import("@langchain/langgraph").OverwriteValue<ShortTermHistories>, unknown>;
        input: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        output: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        memory: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        branch: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
        lastValue: import("@langchain/langgraph").BaseChannel<unknown, unknown, unknown>;
    }, import("@langchain/langgraph").StateDefinition, unknown, unknown, unknown, []>;
    agentByNode: Map<string, AgentRecord | undefined>;
    issues: import("./validation").WorkflowIssue[];
};
export {};
