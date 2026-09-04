import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

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

export class GoogleProvider implements LLMProvider {
  createModel(): BaseChatModel {
    const modelName = process.env.LLM_MODEL || 'gemini-3.6-flash';
    return new ChatGoogleGenerativeAI({
      model: modelName,
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'mock-key',
      temperature: 0.2,
    }) as unknown as BaseChatModel;
  }
}

export class AnthropicProvider implements LLMProvider {
  createModel(): BaseChatModel {
    const modelName = process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
    return new ChatAnthropic({
      modelName,
      apiKey: process.env.ANTHROPIC_API_KEY || 'mock-key',
      temperature: 0.2,
    }) as unknown as BaseChatModel;
  }
}

export class OpenAIProvider implements LLMProvider {
  createModel(): BaseChatModel {
    const modelName = process.env.LLM_MODEL || 'gpt-4o';
    return new ChatOpenAI({
      modelName,
      openAIApiKey: process.env.OPENAI_API_KEY || 'mock-key',
      temperature: 0.2,
    }) as unknown as BaseChatModel;
  }
}

export class LLMFactory {
  private providers: Map<string, LLMProvider> = new Map();

  constructor() {
    this.register('gemini', new GoogleProvider());
    this.register('google', new GoogleProvider());
    this.register('anthropic', new AnthropicProvider());
    this.register('openai', new OpenAIProvider());
  }

  register(name: string, provider: LLMProvider) {
    this.providers.set(name.toLowerCase(), provider);
  }

  getModel(providerName: string): BaseChatModel {
    const provider = this.providers.get(providerName.toLowerCase());
    if (provider) {
      return provider.createModel();
    }
    // Fallback to OpenAI
    return this.providers.get('openai')!.createModel();
  }
}

// Singleton instance for backward compatibility with existing getLLM() calls
const defaultFactory = new LLMFactory();

export function getLLM(): BaseChatModel {
  const provider = process.env.LLM_PROVIDER || 'openai';
  return defaultFactory.getModel(provider);
}
