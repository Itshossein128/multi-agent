import type { AgentRuntime } from "../../src/agents/runtime/agentRuntime";

/**
 * Keeps a test run in-flight until cancellation without invoking a model or CLI
 * provider. API tests can drive run events explicitly and remain hermetic even
 * when provider credentials are configured on the developer machine.
 */
export function createInertAgentRuntime(): Pick<AgentRuntime, "execute"> {
  return {
    async *execute(input) {
      const signal = input.signal;
      if (!signal || signal.aborted) return;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  };
}
