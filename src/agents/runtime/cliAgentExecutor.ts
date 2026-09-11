import { spawn as nodeSpawn } from "node:child_process";
import { nowIso, type AgentBackend } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";

type SpawnedProcess = {
  stdin: { write(value: string): void; end(): void };
  stdout: AsyncIterable<Buffer | string>;
  stderr: AsyncIterable<Buffer | string>;
  once(event: "error" | "close", listener: (value: Error | number | null) => void): void;
  kill(signal?: NodeJS.Signals): void;
};
export type CliSpawn = (executable: string, args: string[], options: { cwd: string; shell: false; stdio: ["pipe", "pipe", "pipe"] }) => SpawnedProcess;

/** Executes a configured CLI directly (never through a shell) in its approved workspace. */
export class CliAgentExecutor implements AgentExecutor {
  constructor(private readonly spawn: CliSpawn = nodeSpawn as unknown as CliSpawn) {}

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    if (input.agent.backend.type !== "cli") throw new AgentExecutionFailedError("CliAgentExecutor requires a CLI backend.");
    const backend = input.agent.backend;
    const policy = input.agent.executionPolicy!;
    const executable = backend.executable || backend.provider;
    const args = [...(backend.args ?? [])];
    yield event("agent.started", input, { provider: backend.provider, executable, args });
    try {
      const output = await this.run(executable, args, policy.workspaceRoot!, prompt(input), input.signal);
      yield event("agent.output", input, { content: output });
      yield event("agent.completed", input, { content: output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield event("agent.failed", input, { error: message });
      throw new AgentExecutionFailedError(message);
    }
  }

  private async run(executable: string, args: string[], cwd: string, input: string, signal?: AbortSignal): Promise<string> {
    const child = this.spawn(executable, args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      child.stdin.write(input);
      child.stdin.end();
      const [stdout, stderr, code] = await Promise.all([read(child.stdout), read(child.stderr), waitForExit(child)]);
      signal?.throwIfAborted();
      if (code !== 0) throw new Error(`CLI command "${executable}" exited with code ${code}: ${stderr || "no stderr"}`);
      return stdout;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}

async function read(stream: AsyncIterable<Buffer | string>): Promise<string> {
  let value = "";
  for await (const chunk of stream) value += chunk.toString();
  return value;
}
function waitForExit(child: SpawnedProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => reject(error));
    child.once("close", (code) => resolve(code as number | null));
  });
}
function prompt(input: AgentExecutionInput): string {
  return typeof input.input === "string" ? input.input : JSON.stringify(input.input ?? {});
}
function event(type: AgentExecutionEvent["type"], input: AgentExecutionInput, payload: unknown): AgentExecutionEvent {
  return { type, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload };
}
