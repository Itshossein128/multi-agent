import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

export function getLLM(): any {
  const provider = process.env.LLM_PROVIDER?.toLowerCase() || 'openai';
  const modelName = process.env.LLM_MODEL || (provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o');

  if (provider === 'anthropic') {
    return new ChatAnthropic({
      modelName,
      apiKey: process.env.ANTHROPIC_API_KEY || 'mock-key',
      temperature: 0.2,
    });
  }

  return new ChatOpenAI({
    modelName,
    openAIApiKey: process.env.OPENAI_API_KEY || 'mock-key',
    temperature: 0.2,
  });
}
