import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import type { WorkerRuntime } from "./workerRuntime";
export interface CliRuntimePolicy {
    enabled: boolean;
    allowedExecutables: string[];
    workspaceRoots: string[];
    maxOutputBytes: number;
}
export declare function cliRuntimePolicyFromEnvironment(env?: NodeJS.ProcessEnv): CliRuntimePolicy;
export declare function resolveCliSpawnExecutable(executable: string, allowedExecutables: string[], env?: NodeJS.ProcessEnv): string;
export declare class CliAgentExecutor implements AgentExecutor {
    private readonly workerRuntime;
    private readonly runtimePolicy;
    constructor(workerRuntime?: WorkerRuntime, runtimePolicy?: CliRuntimePolicy);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
