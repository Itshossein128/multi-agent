import { nowIso } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";

export type LocalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface LocalRuntimePolicy { allowedOrigins: string[]; }

export function localRuntimePolicyFromEnvironment(env: NodeJS.ProcessEnv = process.env): LocalRuntimePolicy {
  const configured = (env.LOCAL_MODEL_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  return { allowedOrigins: configured.length ? configured.map(normalizeOrigin) : [
    "http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434",
    "http://127.0.0.1:1234", "http://localhost:1234", "http://[::1]:1234",
  ] };
}

/** Ollama and LM Studio adapters use their documented local HTTP APIs; no API key is persisted. */
export class LocalAgentExecutor implements AgentExecutor {
  constructor(private readonly fetchImpl: LocalFetch = fetch, private readonly runtimePolicy: LocalRuntimePolicy = localRuntimePolicyFromEnvironment()) {}

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
    const origin = normalizeOrigin(baseUrl);
    if (!this.runtimePolicy.allowedOrigins.includes(origin)) throw new Error(`Local model origin "${origin}" is not allowed by the server runtime.`);
    const settings = backend.settings ?? {};
    const response = await this.fetchImpl(new URL(ollama ? "/api/chat" : "/v1/chat/completions", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: input.signal,
      body: JSON.stringify(ollama
        ? { model: backend.model, stream: false, messages: messages(input), options: { temperature: settings.temperature, top_p: settings.topP, num_predict: settings.maxTokens } }
        : { model: backend.model, messages: messages(input), temperature: settings.temperature, top_p: settings.topP, max_tokens: settings.maxTokens }),
    });
    const body = await response.json().catch(() => undefined) as unknown;
    const record = body && typeof body === "object" ? body as Record<string, unknown> : undefined;
    const error = record?.error;
    const errorMessage = error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : error === undefined ? "unknown error" : String(error);
    if (!response.ok) throw new Error(`Local ${backend.provider} request failed (${response.status}): ${errorMessage.slice(0, 500)}`);
    const content = ollama ? nestedContent(record?.message) : lmStudioContent(record?.choices);
    if (typeof content !== "string") throw new Error(`Local ${backend.provider} response did not contain assistant content.`);
    return content;
  }
}
function messages(input: AgentExecutionInput) {
  const system = input.agent.systemPrompt || "You are a helpful workflow agent.";
  const value = typeof input.input === "string" ? input.input : JSON.stringify(input.input ?? {});
  const history = (input.context?.history ?? []) as { input: unknown; output: unknown }[];
  return [
    { role: "system", content: system },
    ...history.flatMap((entry) => [{ role: "user", content: typeof entry.input === "string" ? entry.input : JSON.stringify(entry.input ?? {}) }, { role: "assistant", content: typeof entry.output === "string" ? entry.output : JSON.stringify(entry.output ?? {}) }]),
    ...(typeof input.context?.memoryContext === "string" && input.context.memoryContext ? [{ role: "user", content: input.context.memoryContext }] : []),
    { role: "user", content: value },
  ];
}
function event(type: AgentExecutionEvent["type"], input: AgentExecutionInput, payload: unknown): AgentExecutionEvent {
  return { type, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload };
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Local model URL must use HTTP(S) without embedded credentials.");
  return url.origin;
}
function nestedContent(value: unknown): unknown {
  return value && typeof value === "object" ? (value as { content?: unknown }).content : undefined;
}
function lmStudioContent(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  return nestedContent(value[0] && typeof value[0] === "object" ? (value[0] as { message?: unknown }).message : undefined);
}
