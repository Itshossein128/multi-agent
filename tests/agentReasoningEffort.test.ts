import { createAgentRecord, validateAgent } from "@multi-agent/types";
import { ChatOpenAI } from "@langchain/openai";
import { LLMFactory } from "../src/agents/core/llmFactory";

test("OpenAI agents forward low reasoning effort to the model request", () => {
  const backend = { type: "api" as const, provider: "openai", model: "gpt-5.6-luna", settings: { reasoningEffort: "low" as const } };
  const agent = createAgentRecord({ name: "Luna", backend });
  expect(validateAgent(agent)).toEqual([]);
  const model = new LLMFactory().getModel("openai", { model: backend.model, settings: backend.settings, apiKey: "test-key" }) as ChatOpenAI;
  expect(model.invocationParams({}).reasoning_effort).toBe("low");
});

test("reasoning effort is rejected for providers that do not support this setting", () => {
  const agent = createAgentRecord({ backend: { type: "api", provider: "anthropic", model: "example", settings: { reasoningEffort: "low" } } });
  expect(validateAgent(agent)).toContain("Invalid or unsupported model setting: reasoningEffort.");
});
