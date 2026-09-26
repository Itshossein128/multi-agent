import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import type { AgentModelSettings } from '@multi-agent/types';

// Initialize global network proxy dispatcher if configured in environment
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
if (proxyUrl) {
  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch {
    // ignore if already configured
  }
}

// ------------------------------------------------------------------
// SOLID Principle Refactoring:
// Open/Closed Principle (OCP) & Single Responsibility Principle (SRP)
// ------------------------------------------------------------------

export interface LLMProvider {
  createModel(): BaseChatModel;
}

/** Optional per-invocation credential supplied by the broker lease path. */
export interface ModelCredentialOptions {
  apiKey?: string;
}

export class GoogleProvider implements LLMProvider {
  constructor(private readonly modelOverride?: string, private readonly settings: AgentModelSettings = {}, private readonly credential?: string) { }

  createModel(): BaseChatModel {
    const modelName = this.modelOverride || process.env.LLM_MODEL || 'gemini-3.6-flash';
    return new ChatGoogleGenerativeAI({
      model: modelName,
      apiKey: this.credential || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'mock-key',
      temperature: this.settings.temperature,
      topP: this.settings.topP,
      maxOutputTokens: this.settings.maxTokens,
    }) as unknown as BaseChatModel;
  }
}

export class AnthropicProvider implements LLMProvider {
  constructor(private readonly modelOverride?: string, private readonly settings: AgentModelSettings = {}, private readonly credential?: string) { }

  createModel(): BaseChatModel {
    const modelName = this.modelOverride || process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
    return new ChatAnthropic({
      modelName,
      apiKey: this.credential || process.env.ANTHROPIC_API_KEY || 'mock-key',
      temperature: this.settings.temperature,
      topP: this.settings.topP,
      maxTokens: this.settings.maxTokens ?? 4096,
    }) as unknown as BaseChatModel;
  }
}

export class OpenAIProvider implements LLMProvider {
  constructor(private readonly modelOverride?: string, private readonly settings: AgentModelSettings = {}, private readonly credential?: string) { }

  createModel(): BaseChatModel {
    const modelName = this.modelOverride || process.env.LLM_MODEL || 'gpt-4o';
    return new ChatOpenAI({
      modelName,
      openAIApiKey: this.credential || process.env.OPENAI_API_KEY || 'mock-key',
      temperature: this.settings.temperature,
      topP: this.settings.topP,
      maxTokens: this.settings.maxTokens,
    }) as unknown as BaseChatModel;
  }
}

export class LLMFactory {
  private providers: Map<string, new (model?: string, settings?: AgentModelSettings, credential?: string) => LLMProvider> = new Map();

  constructor() {
    this.register('gemini', GoogleProvider);
    this.register('google', GoogleProvider);
    this.register('anthropic', AnthropicProvider);
    this.register('openai', OpenAIProvider);
  }

  register(name: string, provider: new (model?: string, settings?: AgentModelSettings, credential?: string) => LLMProvider) {
    this.providers.set(name.toLowerCase(), provider);
  }

  /**
   * Build a chat model. `options.apiKey` is a short-lived leased credential
   * from the broker; when absent, providers fall back to server environment.
   * The key is held only by the model instance for this invocation and is
   * never logged, persisted, or placed in agent/tool records.
   */
  getModel(providerName: string, options?: { model?: string; settings?: AgentModelSettings; apiKey?: string }): BaseChatModel {
    const Provider = this.providers.get(providerName.toLowerCase());
    if (Provider) {
      return new Provider(options?.model, options?.settings, options?.apiKey).createModel();
    }
    throw new Error(`Unsupported API provider: ${providerName}`);
  }
}

// Singleton instance for backward compatibility with existing getLLM() calls
const defaultFactory = new LLMFactory();

export function getLLM(options?: { provider?: string; model?: string }): BaseChatModel {
  const provider = options?.provider || process.env.LLM_PROVIDER || 'openai';
  return defaultFactory.getModel(provider, { model: options?.model });
}

export { defaultFactory as llmFactory };
