# Quickstart: Autonomous ReAct Agent Loop

**Feature**: `012-react-agent-loop`  
**Purpose**: Validate the feature end-to-end after implementation—without embedding full test suites here.

See also: [data-model.md](./data-model.md), [contracts/agent-react-loop.contract.ts](./contracts/agent-react-loop.contract.ts), [contracts/agent-config.schema.md](./contracts/agent-config.schema.md).

---

## Prerequisites

- Repo dependencies installed (`pnpm install`)
- Types buildable (`pnpm run build:types`)
- For manual studio check: `pnpm run dev` (web + server) and a project with at least one **read-only** registry tool and an **API** agent

---

## 1. Unit / contract tests (primary gate)

```bash
pnpm test --runInBand tests/apiAgentExecutorReAct.test.ts
```

**Expect**

- Scripted LLM with one `tool_calls` round then final text → `tool.started` / `tool.completed` / `agent.completed`; `toolRuntime.execute` called once with authorized id
- Two sequential tool rounds → both execute; final answer returned
- Unassigned tool name → no `execute`; error observation; loop can continue
- `maxToolSteps` exhausted → failure with `AGENT_TOOL_LIMIT_EXCEEDED`
- `AbortSignal` aborted mid-loop → no further `execute`
- `executionMode: "single_turn"` with tools assigned → no bind/execute loop

Optional regression:

```bash
pnpm test --runInBand tests/agentExecutor.test.ts
```

---

## 2. Typecheck

```bash
pnpm exec tsc --noEmit
pnpm --filter @multi-agent/types build
```

**Expect**: clean compile with new optional fields on `AgentRecord` / `AgentNodeConfig`.

---

## 3. Manual studio smoke (optional)

1. Create/enable a **read-only** tool in the project registry (simple echo/lookup fixture if available).
2. Create an API agent; assign that tool’s id; leave mode default (should present as ReAct when tools assigned).
3. Set max tool steps to `5` (or leave default).
4. Build a one-node (or agent-only) workflow whose user task clearly requires the tool.
5. Run from the editor (Live Observability if available).
6. Select the agent node → inspector shows nested tool start/args/result, then final agent output.
7. Toggle agent to **Single-turn**, re-run → no nested tool calls from the agent loop.
8. Set max tool steps to `1`, use a prompt that forces repeated tool use → run fails with limit-exceeded visible on the node/run.
9. Start a multi-step tool agent run and **Cancel** during the loop → run stops; no new tool iterations after cancel.

**Expect**: SC-001–SC-008 behaviors observable without wiring a separate tool node for the happy path.

---

## 4. Security spot-checks

- Force model to request a tool id **not** on `agent.tools` → execute never called; inspector may show failed/unauthorized tool event.
- Confirm run event payloads for tool args do not contain leased provider API keys (existing redact path + no key logging).

---

## Out of scope for this quickstart

- CLI/worker agent ReAct
- Mutating tools that require human approval (may correctly receive policy error observations)
- New MCP/tool category authoring
)
