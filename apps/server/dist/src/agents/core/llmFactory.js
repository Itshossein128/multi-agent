"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.llmFactory = exports.LLMFactory = exports.OpenAIProvider = exports.AnthropicProvider = exports.GoogleProvider = void 0;
exports.getLLM = getLLM;
const openai_1 = require("@langchain/openai");
const anthropic_1 = require("@langchain/anthropic");
const google_genai_1 = require("@langchain/google-genai");
const undici_1 = require("undici");
// Initialize global network proxy dispatcher if configured in environment
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
if (proxyUrl) {
    try {
        (0, undici_1.setGlobalDispatcher)(new undici_1.ProxyAgent(proxyUrl));
    }
    catch {
        // ignore if already configured
    }
}
class GoogleProvider {
    modelOverride;
    settings;
    constructor(modelOverride, settings = {}) {
        this.modelOverride = modelOverride;
        this.settings = settings;
    }
    createModel() {
        const modelName = this.modelOverride || process.env.LLM_MODEL || 'gemini-3.6-flash';
        return new google_genai_1.ChatGoogleGenerativeAI({
            model: modelName,
            apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'mock-key',
            temperature: this.settings.temperature,
            topP: this.settings.topP,
            maxOutputTokens: this.settings.maxTokens,
        });
    }
}
exports.GoogleProvider = GoogleProvider;
class AnthropicProvider {
    modelOverride;
    settings;
    constructor(modelOverride, settings = {}) {
        this.modelOverride = modelOverride;
        this.settings = settings;
    }
    createModel() {
        const modelName = this.modelOverride || process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
        return new anthropic_1.ChatAnthropic({
            modelName,
            apiKey: process.env.ANTHROPIC_API_KEY || 'mock-key',
            temperature: this.settings.temperature,
            topP: this.settings.topP,
            maxTokens: this.settings.maxTokens ?? 4096,
        });
    }
}
exports.AnthropicProvider = AnthropicProvider;
class OpenAIProvider {
    modelOverride;
    settings;
    constructor(modelOverride, settings = {}) {
        this.modelOverride = modelOverride;
        this.settings = settings;
    }
    createModel() {
        const modelName = this.modelOverride || process.env.LLM_MODEL || 'gpt-4o';
        return new openai_1.ChatOpenAI({
            modelName,
            openAIApiKey: process.env.OPENAI_API_KEY || 'mock-key',
            temperature: this.settings.temperature,
            topP: this.settings.topP,
            maxTokens: this.settings.maxTokens,
        });
    }
}
exports.OpenAIProvider = OpenAIProvider;
class LLMFactory {
    providers = new Map();
    constructor() {
        this.register('gemini', GoogleProvider);
        this.register('google', GoogleProvider);
        this.register('anthropic', AnthropicProvider);
        this.register('openai', OpenAIProvider);
    }
    register(name, provider) {
        this.providers.set(name.toLowerCase(), provider);
    }
    getModel(providerName, options) {
        const Provider = this.providers.get(providerName.toLowerCase());
        if (Provider) {
            return new Provider(options?.model, options?.settings).createModel();
        }
        throw new Error(`Unsupported API provider: ${providerName}`);
    }
}
exports.LLMFactory = LLMFactory;
// Singleton instance for backward compatibility with existing getLLM() calls
const defaultFactory = new LLMFactory();
exports.llmFactory = defaultFactory;
function getLLM(options) {
    const provider = options?.provider || process.env.LLM_PROVIDER || 'openai';
    return defaultFactory.getModel(provider, { model: options?.model });
}
//# sourceMappingURL=llmFactory.js.map