# Implementation Plan: Autonomous ReAct Agent Loop

**Branch**: `012-react-agent-loop` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  

---

## Summary

Transform API-backed agent nodes from single-shot `model.invoke` into a **bounded ReAct loop**: resolve assigned `ToolRecord`s, bind provider-native tool schemas, execute authorized calls only through `ToolRuntime`, feed observations back until a final answer or `maxToolSteps`, and emit nested `tool.*` events on the parent agent `nodeId` for the existing live inspector.

Approach (from [research.md](./research.md)):

1. Extend `AgentRecord` / `AgentNodeConfig` with `executionMode` + `maxToolSteps`; resolve defaults from assigned tools.
2. Compiler injects `toolRuntime` + `resolvedTools` into `AgentExecutionInput` (trusted server wiring).
3. `toolBinding.ts` + ReAct loop inside `ApiAgentExecutor`; single-turn path preserved.
4. UI toggles in `NodeForms` / agent properties; tests in `tests/apiAgentExecutorReAct.test.ts`.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: `@langchain/core` (+ `@langchain/openai` / `@langchain/anthropic` / Google chat already via `llmFactory`), existing `ToolRuntime`, Hono/server compiler, Next.js web properties panel  
**Storage**: No new tables; agent/workflow JSON already persists `AgentRecord` / node config  
**Testing**: Jest (`pnpm test --runInBand`); primary suite `tests/apiAgentExecutorReAct.test.ts`  
**Target Platform**: Execution server + workflow editor (modern browsers)  
**Project Type**: Monorepo (`src/agents/runtime`, `src/tools`, `apps/server` compiler, `apps/web` forms, `packages/types`)  
**Performance Goals**:
- Default ≤5 tool rounds per agent node; hard cap 10 (FR-007).
- Cancel aborts in-flight tool execute via shared `AbortSignal` (FR-010).  
**Constraints**:
- Zero secret leakage in tool event payloads (FR-012); reuse run-store `redact`.
- Only assigned tools execute (FR-006); no blanket `approvalGranted` for mutating tools.
- CLI/worker agents out of scope (FR-017).
- No inspector UI rewrite—event contract only.  
**Scale/Scope**: ~1 binding helper, ApiAgentExecutor loop, thin compiler + types + form fields, 1 primary Jest suite (+ small regressions).

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution file is still a template stub; gates below follow established monorepo security/runtime norms (tenant isolation, control-plane authority, fail-closed credentials) used by prior features.

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | Tool execute forwards `credentialPrincipal`; leases stay server-mediated. |
| **Control-Plane Authority** | PASS | `toolRuntime` / `resolvedTools` injected only by server compiler—not client grants. |
| **Human Governance** | PASS | Mutating tools still subject to ToolRuntime approval/impact policy; no auto-approve in loop. |
| **Observability Without Authority Leak** | PASS | Nested `tool.*` events are display telemetry; secrets redacted via existing adapters. |
| **Backward Compatibility** | PASS | Missing new fields ⇒ prior single-turn behavior when no tools; explicit single_turn preserved. |
| **Simplicity & Monorepo Idioms** | PASS | Loop lives in existing `ApiAgentExecutor`; reuses ToolRuntime + event types. |
| **Performance / UX Safety** | PASS | Hard step ceiling; cancel via signal; fail-closed on limit. |

*Post-Phase 1 re-check*: PASS — contracts/data-model do not introduce client-side execution authority or new secret channels.

---

## Project Structure

### Documentation (this feature)

```text
specs/012-react-agent-loop/
├── plan.md                 # This file
├── research.md             # Phase 0 decisions
├── data-model.md           # Phase 1 entities + invariants
├── quickstart.md           # Phase 1 validation guide
├── contracts/
│   ├── agent-react-loop.contract.ts
│   └── agent-config.schema.md
├── checklists/
│   └── requirements.md
└── tasks.md                # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
packages/types/src/
├── index.ts                          # AgentRecord + AgentNodeConfig fields; migrateAgentRecord
└── agentConfiguration.ts             # validate optional mode / maxToolSteps if needed

src/agents/runtime/
├── toolBinding.ts                    # NEW: ToolRecord → bindable schemas; name map; helpers
├── apiAgentExecutor.ts               # ReAct loop + single_turn path; emit tool.* events
├── types.ts                          # AgentExecutionInput: toolRuntime?, resolvedTools?
├── agentExecutorFactory.ts           # Pass-through only if needed
└── mapAgentExecutionEvent.ts         # Already maps tool.*; verify payload passthrough

src/tools/
└── toolRuntime.ts                    # Reuse execute(); no semantic change required

apps/server/src/compiler/
└── workflowCompiler.ts               # Resolve tools; inject deps in runAgentThroughRuntime

apps/web/src/components/workflow/properties/
└── NodeForms.tsx                     # Mode + maxToolSteps + assigned tools visibility

tests/
└── apiAgentExecutorReAct.test.ts     # NEW: mocked LLM tool_calls + ToolRuntime
```

**Structure Decision**: Core change is execution-runtime (`src/agents/runtime`) with thin type, compiler, and properties-UI wiring. Live canvas inspector already consumes `tool.*` under `nodeId`—no `apps/web` live/ changes required for MVP.

---

## Complexity Tracking

*No constitutional violations. Complexity is justified by security: schema bind is separated from ToolRuntime execute so credentials and impact policy stay centralized.*

---

## Phase outputs

| Phase | Artifact | Status |
| :--- | :--- | :--- |
| 0 | [research.md](./research.md) | Complete |
| 1 | [data-model.md](./data-model.md) | Complete |
| 1 | [contracts/](./contracts/) | Complete |
| 1 | [quickstart.md](./quickstart.md) | Complete |
| 2 | tasks.md | Next: `/speckit-tasks` |
)
