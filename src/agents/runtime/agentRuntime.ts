import { AgentExecutorFactory, agentExecutorFactory } from "./agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";

/**
 * Thin runtime boundary: resolve an executor from the agent backend, then stream events.
 * Kept inside the existing server process — not a distributed service.
 */
export class AgentRuntime {
  constructor(private readonly executorFactory: AgentExecutorFactory = agentExecutorFactory) {}

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    const executor = this.executorFactory.create(input.agent.backend);
    yield* executor.execute(input);
  }
}
