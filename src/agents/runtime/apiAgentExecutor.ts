import { nowIso, type AgentRecord } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";

type ChatModel = {
  invoke: (messages: unknown[]) => Promise<{ content: unknown }>;
};

type LLMFactoryLike = {
  getModel: (provider: string, options?: { model?: string }) => ChatModel;
};

/**
 * Wraps the existing API/LLM provider stack behind AgentExecutor.
 * Credentials remain an env/runtime concern — never taken from the agent record.
 */
export class ApiAgentExecutor implements AgentExecutor {
  constructor(private readonly getFactory: () => LLMFactoryLike = loadLlmFactory) { }

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    const { agent, runId, nodeId } = input;
    if (agent.backend.type !== "api") {
      throw new AgentExecutionFailedError(
        `ApiAgentExecutor cannot run backend type "${agent.backend.type}"`
      );
    }

    yield baseEvent("agent.started", input, {
      provider: agent.backend.provider,
      model: agent.backend.model,
    });

    try {
      const model = this.getFactory().getModel(agent.backend.provider, {
        model: agent.backend.model,
      });
      const result = await model.invoke([
        { role: "system", content: systemPromptFor(agent) },
        { role: "user", content: serializeInput(input.input) },
      ]);
      const content = result.content;
      yield baseEvent("agent.output", input, { content });
      yield baseEvent("agent.completed", input, { content });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield baseEvent("agent.failed", input, { error: message });
      throw new AgentExecutionFailedError(message);
    }
  }
}

function systemPromptFor(agent: AgentRecord): string {
  return agent.systemPrompt || "You are a helpful workflow agent.";
}

function serializeInput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value);
  }
}

function baseEvent(
  type: AgentExecutionEvent["type"],
  input: AgentExecutionInput,
  payload?: unknown
): AgentExecutionEvent {
  return {
    type,
    timestamp: nowIso(),
    agentId: input.agent.id,
    nodeId: input.nodeId,
    runId: input.runId,
    payload,
  };
}

function loadLlmFactory(): LLMFactoryLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../core/llmFactory") as {
    llmFactory: LLMFactoryLike;
  };
  return mod.llmFactory;
}
