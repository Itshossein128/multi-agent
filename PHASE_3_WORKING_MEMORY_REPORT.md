# Phase 3: Structured Run-Scoped Working Memory

## Outcome

Phase 3 provides a real, bounded, versioned working-memory abstraction for a
single workflow run. It is checkpointed separately from workflow execution
state, conversation history, `AgentHandoff`, observability events, and
long-term semantic memory.

## Data flow

```
Agent result: workingMemoryUpdates (untrusted)
  -> AgentRuntime strips the channel from normal output
  -> workflowCompiler validates and authorizes each update
  -> RuntimeState.workingMemory (checkpointed, keyed reducer)
  -> ContextAssembler selects visible active entries within its budget
  -> producing agent and authorized downstream agents only
```

`RuntimeState.memory` remains generic workflow execution state. It is not
working memory. `shortTermHistories` remains conversation history, and
`handoffs` remains the compact inter-agent transfer protocol.

## Security and lifecycle

- Entries are versioned and include run, workflow, node, agent, handoff and
  timestamp provenance.
- `agent` entries are visible only to their owner. `workflow` entries are
  shared only when the server-owned scope policy permits them.
- The model cannot write for another agent or select a scope disallowed by the
  runtime. Tenant access remains enforced by the existing run API ownership
  boundary; working-memory content is not returned by run endpoints or events.
- Content, metadata and entry counts are bounded. Sensitive, trivial,
  malformed and oversized updates are rejected without failing an otherwise
  successful agent node. Malformed channels are stripped before history,
  handoff, node-output and long-term-memory paths.
- Supported lifecycle statuses are `active`, `resolved`, `superseded` and
  `discarded`; updates are retained as auditable state rather than deleted.

## Context and persistence

The ContextAssembler receives working memory as its own untrusted source.
It injects only active, visible entries in deterministic kind/importance/time
order and applies a 1,500-token default sub-budget before the overall context
budget. The checkpoint reducer merges by stable entry id, allowing parallel
branches to add entries without overwriting each other. With a durable
LangGraph checkpointer, this state is recovered after restart and supplied to
the resumed downstream agent.

Working memory is never written automatically to `studio_memories` or the
semantic memory service. It does not replace AgentHandoff, trigger episodic or
procedural extraction, consolidation, contradiction detection, or an artifact
store.

## Verification

Executed on 2026-09-21:

- `pnpm test` — 46 suites passed, 520 tests passed; 2 suites / 35 tests skipped.
- `pnpm exec tsc --noEmit --pretty false` — passed.
- `pnpm build` — passed.
- `git diff --check` — passed.

`tests/workingMemory.test.ts` covers the domain model, lifecycle, validation,
scope policy, deterministic selection, context isolation and separation from
handoffs and long-term memory. `tests/workingMemoryRuntime.test.ts` covers the
real runtime boundary, checkpoint/restart, approval pause/resume, parallel and
fan-in behavior, tenant isolation, event redaction, compatibility and handoff
references.
