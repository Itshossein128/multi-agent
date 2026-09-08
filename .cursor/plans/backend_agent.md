Implement a small architectural refactor **before Phase 5 (Agent Detail Page)** so the multi-agent system is not limited to API-key-based model execution.

The goal is to make agent execution backend-agnostic so an agent can eventually run through:

* API providers
* CLI-based agent runtimes
* local model runtimes

Do **not** implement all CLI integrations yet. This phase is about introducing the correct abstraction now so later support for Codex CLI, Claude Code, agy, Ollama, etc. does not require rewriting the Graph Editor, LangGraph compiler, Execution Timeline, or Agent Detail Page.

Before changing anything, inspect the existing codebase, especially:

* Agent model/types
* WorkflowDefinition
* Graph Editor agent-node configuration
* LangGraph compiler / graph builder
* Phase 4 Run / RunEvent models
* execution services
* current model/provider initialization
* API routes
* any existing provider-specific code

Reuse current architecture and naming conventions. Avoid creating a parallel runtime architecture.

---

# 1. Architectural Goal

Refactor execution into this shape:

```text
WorkflowDefinition
        ↓
LangGraph Compiler
        ↓
Agent Node
        ↓
Agent Runtime
        ↓
AgentExecutor
        ↓
 ┌──────── API ────────┐
 │ OpenAI / Anthropic  │
 │ Google / others     │
 └─────────────────────┘

 ┌──────── CLI ────────┐
 │ Codex CLI           │
 │ Claude Code         │
 │ agy                 │
 └─────────────────────┘

 ┌────── Local ────────┐
 │ Ollama              │
 │ LM Studio           │
 └─────────────────────┘
```

LangGraph should orchestrate agents.

LangGraph should **not** need to know whether an agent is powered by an API, CLI, or local runtime.

---

# 2. Introduce Agent Backend Model

Replace or refactor the current direct provider/model configuration into a backend abstraction.

Use a discriminated union similar to:

```ts
export type AgentBackend =
  | {
      type: "api";
      provider: string;
      model: string;
    }
  | {
      type: "cli";
      provider: "codex" | "claude-code" | "agy" | string;
      model?: string;
      executable?: string;
      args?: string[];
    }
  | {
      type: "local";
      provider: "ollama" | "lmstudio" | string;
      model: string;
      baseUrl?: string;
    };
```

Adapt this to existing project types rather than duplicating equivalent fields.

Important:

* Do not hardcode only three API providers.
* Keep the shape extensible.
* Do not store API keys directly inside reusable frontend agent state unless the existing security architecture already explicitly supports it.
* Authentication/credentials should remain a runtime/backend concern.

---

# 3. Refactor Agent Model

The Agent entity should conceptually support:

```ts
interface Agent {
  id: string;
  name: string;
  description?: string;

  backend: AgentBackend;

  systemPrompt: string;

  tools?: string[];
  memory?: AgentMemoryConfig;

  executionPolicy?: AgentExecutionPolicy;

  metadata?: Record<string, unknown>;
}
```

If the existing project already has an Agent model, evolve it instead of replacing it unnecessarily.

Preserve compatibility where reasonable.

---

# 4. Introduce Execution Policy

Add an optional execution policy model for future CLI/local-agent execution.

Conceptually:

```ts
export interface AgentExecutionPolicy {
  filesystem?: "none" | "read" | "read-write";
  shell?: "disabled" | "restricted" | "full";
  network?: boolean;
  workspaceRoot?: string;
  allowedCommands?: string[];
}
```

This does **not** need to be fully enforced in this refactor unless an execution boundary already exists where it can be applied cleanly.

The immediate purpose is to establish the correct domain model before Phase 5.

Do not implement unsafe unrestricted shell execution just to satisfy this type.

---

# 5. Introduce AgentExecutor Abstraction

Create a backend-agnostic execution contract.

Conceptually:

```ts
export interface AgentExecutor {
  execute(
    input: AgentExecutionInput
  ): AsyncIterable<AgentExecutionEvent>;
}
```

or equivalent if the current runtime uses promises instead of async iterables.

The contract should support enough context for future implementations, including where appropriate:

```ts
interface AgentExecutionInput {
  agent: Agent;
  input: unknown;
  runId: string;
  nodeId: string;
  workflowId?: string;
  context?: Record<string, unknown>;
}
```

Do not tightly couple this interface to React Flow.

Do not tightly couple this interface to a specific LLM SDK.

Do not expose raw LangGraph internal event types through this interface.

---

# 6. AgentExecutionEvent

Create or reuse a normalized execution-event type for the executor boundary.

Where possible, integrate this with the existing Phase 4 `RunEvent` architecture rather than creating a second event system.

Conceptually:

```ts
interface AgentExecutionEvent {
  type:
    | "agent.started"
    | "agent.output"
    | "agent.completed"
    | "agent.failed"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "log";

  timestamp: string;

  payload?: unknown;

  agentId?: string;
  nodeId?: string;
  runId?: string;
}
```

Prefer mapping executor events into existing `RunEvent`s.

Do not make the frontend depend directly on provider-specific event shapes.

---

# 7. Agent Executor Factory / Registry

Introduce a factory or registry responsible for selecting the appropriate executor.

Conceptually:

```ts
const executor = agentExecutorFactory.create(agent.backend);
```

or:

```ts
const executor = executorRegistry.resolve(agent.backend);
```

Then:

```ts
for await (const event of executor.execute(input)) {
  // map / forward into RunEvent architecture
}
```

The selection logic must be isolated.

Avoid code like this scattered throughout the runtime:

```ts
if (agent.provider === "openai") { ... }
else if (agent.provider === "anthropic") { ... }
```

A central registry/factory is preferred.

---

# 8. Current API Executor

Wrap the **currently working API-based execution** behind the new executor interface.

For example:

```text
AgentExecutor
└── ApiAgentExecutor
```

If the project already supports multiple API providers, either:

* use one API executor with an internal provider adapter layer, or
* use multiple provider executors behind the same registry

Choose whichever best matches the current codebase.

The key requirement is that current working behavior must continue functioning after the refactor.

---

# 9. Remove Direct Model Construction From LangGraph Nodes

Inspect the LangGraph compiler / graph builder.

If agent nodes currently contain provider-specific code like:

```ts
const model = new ChatOpenAI(...)
```

or:

```ts
const model = new ChatAnthropic(...)
```

refactor this.

The LangGraph node should instead delegate to the agent runtime/executor abstraction.

Target shape:

```text
LangGraph Node
      ↓
AgentRuntime
      ↓
AgentExecutor
```

The compiler should compile workflow structure.

It should not own provider-specific authentication/model initialization logic.

---

# 10. Agent Runtime Service

Introduce a small runtime/service boundary if one does not already exist.

Conceptually:

```ts
class AgentRuntime {
  constructor(
    private executorFactory: AgentExecutorFactory
  ) {}

  async *execute(input: AgentExecutionInput) {
    const executor = this.executorFactory.create(input.agent.backend);

    yield* executor.execute(input);
  }
}
```

Do not overengineer this into a distributed service.

Keep it inside the existing server/runtime architecture for now.

---

# 11. Keep LangGraph as Orchestrator

Do not replace LangGraph.

The intended relationship is:

```text
LangGraph
   = workflow orchestration

AgentExecutor
   = how a specific agent actually executes
```

Example:

```text
Planner Node
   ↓
Codex CLI

Researcher Node
   ↓
OpenAI API

Reviewer Node
   ↓
Claude Code CLI
```

LangGraph should be able to orchestrate these identically at the workflow level.

---

# 12. Prepare CLI Executor Interfaces, But Do Not Fully Implement Them

Create only the minimum placeholder boundaries necessary for future implementations such as:

```ts
class CodexCliExecutor implements AgentExecutor
class ClaudeCodeCliExecutor implements AgentExecutor
class AgyCliExecutor implements AgentExecutor
```

Do **not** implement real CLI process spawning unless it is trivial and clearly isolated.

It is acceptable for unsupported backends to fail with a clear error such as:

```text
Backend "cli:codex" is not implemented yet.
```

Do not silently fall back to API execution.

Do not simulate CLI execution.

---

# 13. Prepare Local Runtime Support

The architecture should also support future local backends such as:

```text
Ollama
LM Studio
```

No full implementation is required now unless equivalent support already exists.

Ensure the `AgentBackend` model can represent them cleanly.

---

# 14. Run / RunEvent Integration

Phase 4 already introduced real workflow execution and an execution timeline.

Do not create a separate execution history model.

All executor output should eventually flow into the existing model:

```text
AgentExecutor
      ↓
AgentExecutionEvent
      ↓
RunEvent adapter
      ↓
SSE
      ↓
Execution Timeline
```

Existing Timeline UI should remain agnostic to whether the source was:

* OpenAI API
* Anthropic API
* Codex CLI
* Claude Code
* agy
* Ollama

---

# 15. Graph Editor Compatibility

The Graph Editor should continue working.

Agent nodes should reference an `agentId`.

They should not directly store provider SDK instances or credentials.

Do not couple React Flow node state to execution backend implementation.

If agent-node configuration currently stores:

```ts
provider
model
```

migrate toward:

```ts
backend
```

while preserving compatibility where appropriate.

---

# 16. Persistence / Migration

If agent data is currently persisted in localStorage or another persistence mechanism, handle the schema change safely.

For example, migrate older records like:

```json
{
  "provider": "openai",
  "model": "gpt-..."
}
```

into:

```json
{
  "backend": {
    "type": "api",
    "provider": "openai",
    "model": "gpt-..."
  }
}
```

Do not silently break existing saved agents/workflows.

Use the existing migration/versioning pattern if one exists.

---

# 17. Error Handling

Unsupported backend types should produce clear domain/runtime errors.

Examples:

```text
Unsupported agent backend: cli/codex
```

```text
Executor not registered for backend: local/ollama
```

Do not let this surface as a generic null-reference or SDK error.

These errors should be convertible into the existing `run.failed` / `agent.failed` RunEvents.

---

# 18. Security Constraints

Do not put secrets inside workflow definitions.

Do not store API keys inside React Flow state.

Do not execute arbitrary shell commands as part of this refactor.

Do not add unrestricted CLI permissions.

Future CLI executors must respect `AgentExecutionPolicy`.

The backend/runtime, not the frontend, must own process execution.

---

# 19. Tests

Add focused tests for the new abstraction.

At minimum test:

* API backend resolves to the correct executor
* unknown backend fails clearly
* agent runtime delegates correctly
* existing API agent execution still works
* provider-specific code is no longer required in LangGraph node logic
* executor events can be mapped into RunEvents
* old agent config can be migrated if migration is required

Do not write excessive tests for unimplemented CLI backends.

---

# 20. Out of Scope

Do NOT implement in this refactor:

* Full Codex CLI integration
* Full Claude Code integration
* Full agy integration
* CLI OAuth/login flows
* Process lifecycle management
* PTY/terminal UI
* Remote workers
* Container sandboxing
* Distributed queues
* Full permission engine
* Local-model orchestration platform
* Agent Detail Page UI

Those come later.

---

# 21. Definition of Done

This refactor is complete when:

1. Agent execution is no longer architecturally tied to API providers.
2. Agent configuration uses an extensible backend abstraction.
3. LangGraph nodes do not directly instantiate provider-specific models.
4. Current API execution still works.
5. Agent execution goes through a stable `AgentExecutor` boundary.
6. Executor selection is centralized through a factory/registry.
7. Executor output can flow into existing Phase 4 RunEvents.
8. Graph Editor and Timeline remain backend-agnostic.
9. CLI and local executors can be added later without redesigning core workflow execution.
10. Existing persisted agents/workflows are not silently broken.
11. Unsupported backends fail explicitly.
12. No arbitrary CLI process execution or unsafe shell permissions are introduced in this phase.

Before coding, first inspect the existing implementation and identify the minimal set of files/types/services that need to change.

Prefer a focused refactor over a broad rewrite.
