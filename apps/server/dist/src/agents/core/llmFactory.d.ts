import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentModelSettings } from '@multi-agent/types';
export interface LLMProvider {
    createModel(): BaseChatModel;
}
export declare class GoogleProvider implements LLMProvider {
    private readonly modelOverride?;
    private readonly settings;
    constructor(modelOverride?: string | undefined, settings?: AgentModelSettings);
    createModel(): BaseChatModel;
}
export declare class AnthropicProvider implements LLMProvider {
    private readonly modelOverride?;
    private readonly settings;
    constructor(modelOverride?: string | undefined, settings?: AgentModelSettings);
    createModel(): BaseChatModel;
}
export declare class OpenAIProvider implements LLMProvider {
    private readonly modelOverride?;
    private readonly settings;
    constructor(modelOverride?: string | undefined, settings?: AgentModelSettings);
    createModel(): BaseChatModel;
}
export declare class LLMFactory {
    private providers;
    constructor();
    register(name: string, provider: new (model?: string, settings?: AgentModelSettings) => LLMProvider): void;
    getModel(providerName: string, options?: {
        model?: string;
        settings?: AgentModelSettings;
    }): BaseChatModel;
}
declare const defaultFactory: LLMFactory;
export declare function getLLM(options?: {
    provider?: string;
    model?: string;
}): BaseChatModel;
export { defaultFactory as llmFactory };
