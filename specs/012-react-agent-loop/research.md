# Research: Autonomous ReAct Agent Loop

**Feature Branch**: `012-react-agent-loop`  
**Date**: 2026-11-04  
**Status**: Completed  

---

## Executive Summary

`ApiAgentExecutor` today performs a single `model.invoke` with no tool binding. `agent.tools: string[]` is assignment metadata used for tool-node authorization and retry eligibility—not for in-agent execution. `ToolRuntime` already provides the secure execute boundary (schema, impact, credentials, timeout, abort). Live canvas already projects `tool.started` / `tool.completed` / `tool.failed` under a parent `nodeId`.

This feature wires **resolve → bind → bounded ReAct loop → ToolRuntime → tool.\* events** inside `ApiAgentExecutor`, with types/UI for `executionMode` and `maxToolSteps`. No new persistence schema or inspector redesign.

All Technical Context unknowns are resolved below.

---

## Technical Decisions & Rationale

### Decision 1: Implement the loop inside `ApiAgentExecutor` (+ `toolBinding` helper)

#### Problem
Agent nodes never call tools; only standalone tool nodes do.

#### Alternatives Considered
1. **LangGraph `ToolNode` / prebuilt ReAct agent graph per agent node** — Heavier compiler change; duplicates ToolRuntime policy; harder to keep credential/event contracts identical.
2. **Always expand assigned tools into sibling canvas tool nodes at compile time** — Breaks autonomous multi-step reasoning; forces linear topology.
3. **Bounded loop in `ApiAgentExecutor` with shared `toolBinding.ts`** (Selected) — Keeps AgentExecutor contract; reuses ToolRuntime; emits existing event types with `nodeId`.

#### Rationale
Matches FR-003–FR-011 with minimal surface area. CLI/worker adapters stay single-turn (FR-017 / out of scope).

---

### Decision 2: Inject `ToolRuntime` + resolved `ToolRecord[]` via `AgentExecutionInput`

#### Problem
`AgentExecutionInput` has no tool runtime or registry slice; compiler only passes `agent` (with tool ID strings).

#### Decision
Extend `AgentExecutionInput` with optional trusted fields (server composition only):

- `toolRuntime?: Pick<ToolRuntime, "execute">`
- `resolvedTools?: ToolRecord[]` — already filtered to `agent.tools` ∩ project registry ∩ enabled

Compiler (`runAgentThroughRuntime`) resolves tools from compile `options.tools` and injects the same `toolRuntime` used for tool nodes. Executors ignore these when absent or when mode is `single_turn`.

#### Rationale
Mirrors `credentialPrincipal` / `memoryAccess` pattern: never authorize from client config alone; server wires capabilities.

---

### Decision 3: Schema conversion via LangChain structured tools + `bindTools`

#### Problem
Repo has zero `bindTools` / `DynamicStructuredTool` / `ToolMessage` usage today. Models from `llmFactory` are raw `ChatOpenAI` / `ChatAnthropic` / `ChatGoogleGenerativeAI`.

#### Decision
- Add `src/agents/runtime/toolBinding.ts`:
  - Map each `ToolRecord` → a LangChain tool (name = stable call name derived from `tool.name` with id disambiguation if needed; description; JSON-schema → Zod or JSON-schema tool definition as supported by `@langchain/core`).
  - Actual side effects stay in `ToolRuntime.execute` (tool `func` is a thin adapter or binding is schema-only + manual execute from `tool_calls`).
- Prefer **schema-only bind + manual execute from `AIMessage.tool_calls`** so ToolRuntime remains the sole execution path (credentials, impact, idempotency).
- Widen local `ChatModel` type to include optional `bindTools(tools): ChatModel`.
- If `bindTools` is missing at runtime for a provider model, fail with a clear capability error when ReAct expects tools (do not silent-fallback).

#### Rationale
FR-005 requires ToolRuntime; LangChain bind is only for provider-native tool calling schemas. OpenAI / Anthropic / Gemini LangChain chats already support `bindTools`.

---

### Decision 4: Loop semantics — step = tool-calling round; parallel calls in one round

#### Problem
Spec: `maxToolSteps` 1–10, default 5; “tool steps” = rounds that contain tool requests.

#### Decision
```
resolve mode + maxToolSteps (clamp 1..10, default 5)
if single_turn OR no resolved tools → existing single invoke path
else:
  modelWithTools = model.bindTools(boundSchemas)
  for step in 0..maxToolSteps-1:
    assert !signal.aborted
    response = await modelWithTools.invoke(messages, { signal })
    if no tool_calls → emit llm/agent completed; return content
    append AIMessage with tool_calls
    for each tool_call (stable order):
      authorize against agent.tools / resolvedTools map
      emit tool.started { toolId, name, input (for telemetry path), iteration: step+1, callId }
      try ToolRuntime.execute(...); emit tool.completed; append ToolMessage
      catch non-fatal → emit tool.failed; append error ToolMessage
      catch fatal/security → emit tool.failed; fail agent node
  // exhausted
  emit agent.failed with code AGENT_TOOL_LIMIT_EXCEEDED; throw
```

Counting: each model response that contains ≥1 tool_call consumes one step toward `maxToolSteps`. A final text-only response does not consume a “tool step” beyond the last tool round.

#### Rationale
Matches spec assumption; prevents unbounded loops (FR-007/008).

---

### Decision 5: Authorization & side-effect approval inside the loop

#### Problem
Tool nodes pass `approvalGranted: true` because the operator wired the node. Autonomous model requests are not the same grant.

#### Decision
1. **Assignment gate (always)**: Map `tool_call.name` → `ToolRecord`. If not in `resolvedTools` / `agent.tools`, do **not** execute; append error ToolMessage; emit `tool.failed` with unauthorized reason (FR-006).
2. **Impact / approval**: Do **not** blanket-set `approvalGranted: true`. Pass `approvalGranted: false` unless tool is read-only or `requiresApproval === false`. Let `ToolRuntime` enforce impact policy. Policy rejection → non-fatal error observation unless classified as security breach (then fail closed).
3. **Idempotency**: Use `${runId}:${nodeId}:${callId}` (or iteration+name+hash) as `idempotencyKey` when policy requires it.
4. **Credentials**: Forward `credentialPrincipal` (+ `runId`, `agentId`, `authorizedToolIds: agent.tools`) exactly as tool nodes do.

#### Rationale
Fail-closed for mutating tools without approval aligns with ToolRuntime and tenant safety; read-only tools work out of the box for the primary UX.

---

### Decision 6: Fatal vs non-fatal tool errors

#### Decision
| Error class | Behavior |
| :--- | :--- |
| Unassigned / unknown tool name | Error ToolMessage + `tool.failed`; continue loop |
| `TOOL_INPUT_INVALID` / timeout / remote 5xx / `ToolPolicyError` for missing approval | Error ToolMessage + `tool.failed`; continue loop |
| AbortError / signal aborted | Stop loop; propagate cancel |
| Credential broker hard failure mid-tool when fail-closed required | Fail agent node |
| `AGENT_TOOL_LIMIT_EXCEEDED` | Fail agent node; distinct payload `code` |

Surface limit exceeded via `agent.failed` payload `{ code: "AGENT_TOOL_LIMIT_EXCEEDED", maxToolSteps }` and `AgentExecutionFailedError` message including that code so run classification can map it (extend `classifyRunFailure` if needed).

---

### Decision 7: Configuration fields on `AgentRecord` + `AgentNodeConfig`

#### Decision
Add optional:

```ts
executionMode?: "single_turn" | "react"
maxToolSteps?: number  // effective clamp 1..10
```

**Effective mode resolution** (node override wins over agent):

1. Explicit `executionMode` on node config if set
2. Else explicit on agent record if set
3. Else default: `react` if `agent.tools.length > 0`, else `single_turn`

**Effective maxToolSteps**: node → agent → `5`, then clamp.

Migrate via existing `migrateAgentRecord`; ignore unknown legacy fields safely.

UI (`AgentForm` in `NodeForms.tsx`): show assigned tools (keep list; improve labels when registry match exists), mode select, max steps number input. Node form can expose overrides when editing an agent node.

---

### Decision 8: Telemetry / inspector payload shape

#### Decision
Reuse existing event types. Payload conventions for inspector compatibility (`buildNodeExecutionView` / `runCanvasProjection`):

- `tool.started`: `{ toolId, name, arguments|input, iteration, toolCallId|callId }`
- `tool.completed`: `{ toolId, output|result, durationMs, toolCallId }`
- `tool.failed`: `{ toolId, error, toolCallId }`

Always set `nodeId: input.nodeId` on `AgentExecutionEvent`. Rely on existing `redact()` in run store adapters for secret scrubbing; additionally avoid putting leased API keys into tool args/events.

---

### Decision 9: Testing strategy

#### Decision
Primary suite: `tests/apiAgentExecutorReAct.test.ts`

- Fake `getModel` returning a scripted sequence of responses with/without `tool_calls`
- Fake `toolRuntime.execute` recording calls + returning fixtures
- Assert: bind called when react+tools; loop count; unauthorized rejection; limit exceeded; abort mid-loop; event order with `nodeId`
- Keep single-turn path regression in existing `agentExecutor.test.ts`

Optional thin compiler test: resolved tools injected into runtime input when agent has tools.

---

### Decision 10: Provider support

#### Decision
No new providers. Use LangChain chat models already constructed by `llmFactory` for `openai`, `anthropic`, `gemini`/`google`. Document known limitations (e.g. some reasoning models may reject tools) as fail-clear capability errors when `bindTools` or invoke rejects tool schemas.

---

## Resolved Clarifications

| Topic | Resolution |
| :--- | :--- |
| Ceiling behavior | Fail-closed `AGENT_TOOL_LIMIT_EXCEEDED` (no synthetic final answer) |
| Step meaning | One model round that includes tool_calls |
| Mutating tools | ToolRuntime policy; no automatic approvalGranted |
| CLI agents | Out of scope; unchanged |
| Inspector | No UI rewrite; event contract only |
)
