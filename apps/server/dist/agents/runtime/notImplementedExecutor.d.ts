import type { AgentBackend } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
/**
 * Placeholder for future CLI / local backends.
 * Fails explicitly — never falls back to API execution.
 */
export declare class NotImplementedAgentExecutor implements AgentExecutor {
    private readonly backend;
    constructor(backend: AgentBackend);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
/** Future Codex CLI integration boundary. */
export declare class CodexCliExecutor extends NotImplementedAgentExecutor {
    constructor();
}
/** Future Claude Code CLI integration boundary. */
export declare class ClaudeCodeCliExecutor extends NotImplementedAgentExecutor {
    constructor();
}
/** Future agy CLI integration boundary. */
export declare class AgyCliExecutor extends NotImplementedAgentExecutor {
    constructor();
}
/** Future Ollama local runtime boundary. */
export declare class OllamaLocalExecutor extends NotImplementedAgentExecutor {
    constructor(model?: string);
}
