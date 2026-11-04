import { AgentExecutionFailedError } from "../src/agents/runtime/errors";
import { AGENT_TOOL_LIMIT_EXCEEDED } from "../src/agents/runtime/reactSettings";
import { classifyRunFailure } from "../apps/server/src/runtime/runExecutor";

describe("classifyRunFailure ReAct codes", () => {
  test("surfaces AGENT_TOOL_LIMIT_EXCEEDED distinctly", () => {
    const result = classifyRunFailure(
      new AgentExecutionFailedError(
        "AGENT_TOOL_LIMIT_EXCEEDED: Agent exceeded max tool steps (2).",
        AGENT_TOOL_LIMIT_EXCEEDED
      )
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AGENT_TOOL_LIMIT_EXCEEDED");
    expect(result.error?.retryable).toBe(false);
  });

  test("keeps generic agent failures as AGENT_EXECUTION_FAILED", () => {
    const result = classifyRunFailure(new AgentExecutionFailedError("model blew up"));
    expect(result.error?.code).toBe("AGENT_EXECUTION_FAILED");
  });
});
