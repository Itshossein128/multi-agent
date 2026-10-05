import { nowIso } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";

/**
 * Dedicated safe local test executor for offline self-test and onboarding verification.
 * Runs 100% locally with zero external network or billable LLM calls.
 */
export class OfflineTestAgentExecutor implements AgentExecutor {
  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    yield {
      type: "agent.started",
      timestamp: nowIso(),
      agentId: input.agent.id,
      nodeId: input.nodeId,
      runId: input.runId,
      payload: { mode: "offline_test" },
    };

    const content = "Offline workflow self-test execution verified successfully.";

    yield {
      type: "agent.output",
      timestamp: nowIso(),
      agentId: input.agent.id,
      nodeId: input.nodeId,
      runId: input.runId,
      payload: { content },
    };

    yield {
      type: "agent.completed",
      timestamp: nowIso(),
      agentId: input.agent.id,
      nodeId: input.nodeId,
      runId: input.runId,
      payload: { content },
    };
  }
}
