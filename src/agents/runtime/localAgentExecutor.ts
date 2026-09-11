import { nowIso } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";

export type LocalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Ollama and LM Studio adapters use their documented local HTTP APIs; no API key is persisted. */
export class LocalAgentExecutor implements AgentExecutor {
  constructor(private readonly fetchImpl: LocalFetch = fetch) {}

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    if (input.agent.backend.type !== "local") throw new AgentExecutionFailedError("LocalAgentExecutor requires a local backend.");
    const backend = input.agent.backend;
    yield event("agent.started", input, { provider: backend.provider, model: backend.model });
    try {
      const content = await this.invoke(backend, input);
      yield event("agent.output", input, { content });
      yield event("agent.completed", input, { content });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield event("agent.failed", input, { error: message });
      throw new AgentExecutionFailedError(message);
    }
  }

  private async invoke(backend: Extract<AgentExecutionInput["agent"]["backend"], { type: "local" }>, input: AgentExecutionInput): Promise<unknown> {
    const baseUrl = backend.baseUrl || (backend.provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234");
    const ollama = backend.provider === "ollama";
    const response = await this.fetchImpl(new URL(ollama ? "/api/chat" : "/v1/chat/completions", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: input.signal,
      body: JSON.stringify(ollama
        ? { model: backend.model, stream: false, messages: messages(input) }
        : { model: backend.model, messages: messages(input) }),
    });
    const body = await response.json().catch(() => undefined) as any;
    if (!response.ok) throw new Error(`Local ${backend.provider} request failed (${response.status}): ${body?.error?.message ?? body?.error ?? "unknown error"}`);
    const content = ollama ? body?.message?.content : body?.choices?.[0]?.message?.content;
    if (content === undefined) throw new Error(`Local ${backend.provider} response did not contain assistant content.`);
    return content;
  }
}
function messages(input: AgentExecutionInput) {
  const system = input.agent.systemPrompt || "You are a helpful workflow agent.";
  const value = typeof input.input === "string" ? input.input : JSON.stringify(input.input ?? {});
  return [{ role: "system", content: system }, { role: "user", content: value }];
}
function event(type: AgentExecutionEvent["type"], input: AgentExecutionInput, payload: unknown): AgentExecutionEvent {
  return { type, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload };
}
