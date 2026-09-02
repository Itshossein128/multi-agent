import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

export function getLLM(): any {
  const provider = process.env.LLM_PROVIDER?.toLowerCase() || 'openai';

  if (provider === 'gemini' || provider === 'google') {
    const modelName = process.env.LLM_MODEL || 'gemini-1.5-flash';
    return new ChatGoogleGenerativeAI({
      model: modelName,
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'mock-key',
      temperature: 0.2,
    });
  }

  if (provider === 'anthropic') {
    const modelName = process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
    return new ChatAnthropic({
      modelName,
      apiKey: process.env.ANTHROPIC_API_KEY || 'mock-key',
      temperature: 0.2,
    });
  }

  const modelName = process.env.LLM_MODEL || 'gpt-4o';
  return new ChatOpenAI({
    modelName,
    openAIApiKey: process.env.OPENAI_API_KEY || 'mock-key',
    temperature: 0.2,
  });
}

