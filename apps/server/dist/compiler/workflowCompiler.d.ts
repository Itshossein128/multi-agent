import { StateGraph } from "@langchain/langgraph";
import type { AgentRecord, WorkflowDefinition, WorkflowNode } from "@multi-agent/types";
export declare class UnsupportedPhase4NodeError extends Error {
    readonly nodeId: string;
    constructor(nodeId: string, node: WorkflowNode);
}
export interface RuntimeState {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    memory: Record<string, unknown>;
    branch?: string;
    lastValue?: unknown;
}
declare const State: import("@langchain/langgraph").AnnotationRoot<{
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
        input: Record<string, unknown>;
        output: Record<string, unknown>;
        memory: Record<string, unknown>;
        branch: string | undefined;
        lastValue: unknown;
    }, {
        input?: Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>> | undefined;
        output?: Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>> | undefined;
        memory?: Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>> | undefined;
        branch?: string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined;
        lastValue?: unknown;
    }, "__start__", {
        input: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        output: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        memory: import("@langchain/langgraph").BaseChannel<Record<string, unknown>, Record<string, unknown> | import("@langchain/langgraph").OverwriteValue<Record<string, unknown>>, unknown>;
        branch: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
        lastValue: import("@langchain/langgraph").BaseChannel<unknown, unknown, unknown>;
    }, {
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
