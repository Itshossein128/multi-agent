import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
type SpawnedProcess = {
    stdin: {
        write(value: string): void;
        end(): void;
    };
    stdout: AsyncIterable<Buffer | string>;
    stderr: AsyncIterable<Buffer | string>;
    once(event: "error" | "close", listener: (value: Error | number | null) => void): void;
    kill(signal?: NodeJS.Signals): void;
};
export type CliSpawn = (executable: string, args: string[], options: {
    cwd: string;
    shell: false;
    stdio: ["pipe", "pipe", "pipe"];
}) => SpawnedProcess;
export interface CliRuntimePolicy {
    enabled: boolean;
    allowedExecutables: string[];
    workspaceRoots: string[];
    maxOutputBytes: number;
}
export declare function cliRuntimePolicyFromEnvironment(env?: NodeJS.ProcessEnv): CliRuntimePolicy;
/** Executes a configured CLI directly (never through a shell) in its approved workspace. */
export declare class CliAgentExecutor implements AgentExecutor {
    private readonly spawn;
    private readonly runtimePolicy;
    constructor(spawn?: CliSpawn, runtimePolicy?: CliRuntimePolicy);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
    private run;
    private assertServerPolicy;
}
export {};
