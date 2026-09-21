import { nowIso, type AgentRecord, type AgentModelSettings } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";
import { llmFactory } from "../core/llmFactory";
import { ExecutionTelemetry } from "../../observability/telemetry";

type ChatModel = {
  invoke: (messages: unknown[], options?: { signal?: AbortSignal }) => Promise<{
    content: unknown;
    usage_metadata?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
  }>;
};

type LLMFactoryLike = {
  getModel: (provider: string, options?: { model?: string; settings?: AgentModelSettings }) => ChatModel;
};

/**
 * Wraps the existing API/LLM provider stack behind AgentExecutor.
 * Credentials remain an env/runtime concern — never taken from the agent record.
 */
export class ApiAgentExecutor implements AgentExecutor {
  constructor(private readonly getFactory: () => LLMFactoryLike = loadLlmFactory, private readonly telemetry: ExecutionTelemetry = ExecutionTelemetry.disabled()) { }

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
      const startedAt = Date.now();
      yield baseEvent("llm.started", input, { provider: agent.backend.provider, model: agent.backend.model });
      const model = this.getFactory().getModel(agent.backend.provider, {
        model: agent.backend.model,
        settings: agent.backend.settings,
      });
      const messages = buildMessages(input);
      const telemetryContext = { runId, workflowId: input.workflowId, nodeId, agentId: agent.id, agentName: agent.name, backendType: agent.backend.type, provider: agent.backend.provider, model: agent.backend.model, input: messages };
      const result = await this.telemetry.withAgent(telemetryContext, () => this.telemetry.withGeneration(telemetryContext, () => model.invoke(messages, { signal: input.signal })));
      const content = result.content;
      const usage = result.usage_metadata;
      const finishReason = result.response_metadata?.finish_reason ?? result.response_metadata?.stop_reason;
      yield baseEvent("llm.completed", input, {
        provider: agent.backend.provider,
        model: agent.backend.model,
        durationMs: Date.now() - startedAt,
        ...(usage ? { usage } : {}),
        ...(finishReason !== undefined ? { finishReason } : {}),
      });
      yield baseEvent("agent.output", input, { content });
      yield baseEvent("agent.completed", input, { content });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield baseEvent("llm.failed", input, { provider: agent.backend.provider, model: agent.backend.model, error: message.slice(0, 500) });
      yield baseEvent("agent.failed", input, { error: message });
      throw new AgentExecutionFailedError(message);
    }
  }
}

/**
 * Build messages from AssembledContext when available, otherwise fall back to
 * legacy context assembly for backward compatibility.
 */
function buildMessages(input: AgentExecutionInput): unknown[] {
  if (input.assembledContext) {
    return assembledContextToMessages(input.assembledContext, input.agent);
  }
  // Legacy path: context assembled by executor
  const history = (input.context?.history ?? []) as { input: unknown; output: unknown }[];
  return [
    { role: "system", content: systemPromptFor(input.agent) },
    ...history.flatMap((entry) => [
      { role: "user", content: serializeInput(entry.input) },
      { role: "assistant", content: serializeInput(entry.output) },
    ]),
    ...(typeof input.context?.memoryContext === "string" && input.context.memoryContext
      ? [{ role: "user", content: input.context.memoryContext }]
      : []),
    { role: "user", content: serializeInput(input.input) },
  ];
}

/** Serialize AssembledContext items into API chat messages. */
function assembledContextToMessages(ctx: import("./contextAssembler").AssembledContext, agent: AgentRecord): unknown[] {
  const messages: unknown[] = [];
  for (const item of ctx.items) {
    const content = item.content as Record<string, unknown>;
    switch (item.source) {
      case "system":
        messages.push({ role: "system", content: content.text ?? systemPromptFor(agent) });
        break;
      case "task":
        messages.push({ role: "user", content: content.text ?? "" });
        break;
      case "history": {
        const entries = (content.entries ?? []) as { input: unknown; output: unknown }[];
        for (const entry of entries) {
          messages.push({ role: "user", content: serializeInput(entry.input) });
          messages.push({ role: "assistant", content: serializeInput(entry.output) });
        }
        break;
      }
      case "long_term_memory":
        if (typeof content.text === "string" && content.text.trim()) {
          messages.push({ role: "user", content: content.text });
        }
        break;
      case "previous_output":
        if (typeof content.text === "string" && content.text.trim()) {
          messages.push({ role: "user", content: content.text });
        }
        break;
      case "runtime_state":
      case "metadata":
        // These are not serialized to model messages — they exist for diagnostics/extensibility
        break;
    }
  }
  return messages;
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
  return llmFactory as unknown as LLMFactoryLike;
}
