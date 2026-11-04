# Implementation Plan: Independent Agent Configuration Per Workflow Step

**Branch**: `013-agent-step-config` (spec; current checkout may be `develop`) | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  

---

## Summary

Decouple Workflow Editor agent-node authoring from the shared Agent Registry so a single base Agent can be reused across steps and workflows with **independent** `taskInstruction`, `modelSettingsOverride`, and `activeTools`, while preserving existing node `executionMode` / `maxToolSteps`. Ordinary properties-panel edits write only `AgentNodeConfig` on the selected node; registry mutation moves behind an explicit “Edit Agent in Registry” path. A pure effective-config resolver feeds validation, compile, and all agent executors without mutating shared `AgentRecord`s. Runs continue to freeze settings via the existing workflow/agents/tools snapshot lifecycle.

Approach (from [research.md](./research.md)):

1. Extend `AgentNodeConfig` (+ shared resolve/validate helpers in `packages/types`).
2. Rewrite `AgentForm` to step-local controls + registry deep-link; stop `updateAgentRecord` from the node panel.
3. Thread step fields through compiler → `AgentExecutionInput` → ContextAssembler / executors (additive instruction; ephemeral model settings; effective tool set).
4. Align ReAct authorization and mode derivation with the **effective** tool set; fail closed on unsupported backend overrides.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: Existing monorepo stack — `@multi-agent/types`, workflow compiler (`apps/server`), agent runtime (`src/agents/runtime`), Next.js properties panel (`apps/web`), Jest  
**Storage**: No new tables; step fields live in workflow definition node `config` JSON (already persisted with workflows). Agent registry schema unchanged aside from remaining the source of base defaults.  
**Testing**: Jest (`pnpm test --runInBand`); new suites for effective-config resolve/validate, NodeForms non-mutation, compiler injection, executor instruction/settings/tools application, concurrency isolation  
**Target Platform**: Execution server + workflow editor (modern browsers)  
**Project Type**: Monorepo (`packages/types`, `apps/web`, `apps/server` compiler, `src/agents/runtime`)  
**Performance Goals**:
- Effective-config resolve is O(tools) per node and must not rewrite shared agent records.
- Two concurrent runs with the same base Agent show no cross-leak (SC-007).  
**Constraints**:
- Step overrides must not expand privileges (tools subset-only; no policy/credential/backend edits from node panel).
- No silent drop of UI-accepted overrides at runtime (FR-025).
- No new interpolation engine (FR-009).
- In-flight immutability via existing run snapshots only (FR-027).
- Preserve `mutatesCode`, `role`, node `executionMode` / `maxToolSteps`.  
**Scale/Scope**: ~1 shared resolve/validate module, AgentForm redesign, thin compiler + execution input plumbing across API/local/CLI/process/webhook adapters, validation parity (web + server), focused Jest coverage for SC-001–SC-010.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution file (`.specify/memory/constitution.md`) is still a template stub and is **not** treated as ratified law. Gates below follow established monorepo security/runtime norms used by prior features (`012-react-agent-loop`, credential broker).

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | Tool authorization still intersects registry ∩ tenant-visible tools; no client-side grant expansion via `activeTools`. |
| **Control-Plane Authority** | PASS | Effective tools/settings resolved server-side from snapshotted workflow + agents; client cannot authorize by inventing tool ids. |
| **Human Governance** | PASS | Step overrides do not bypass approval, `mutatesCode`, or ToolRuntime impact policy. |
| **Observability Without Authority Leak** | PASS | No new secret channels; model overrides are non-secret sampling params only. |
| **Backward Compatibility** | PASS | Absent new fields ⇒ prior behavior; legacy workflows need no reconfiguration (FR-032). |
| **Simplicity & Monorepo Idioms** | PASS | Reuses `AgentNodeConfig`, ContextAssembler, run snapshots; no new versioning product. |
| **Performance / UX Safety** | PASS | Fail closed on incompatible base-agent switch and unsupported backend overrides. |

*Post-Phase 1 re-check*: PASS — [data-model.md](./data-model.md) and [contracts/](./contracts/) keep authority on the server, store step config only on nodes, and document backend support matrices without inventing capabilities.

---

## Project Structure

### Documentation (this feature)

```text
specs/013-agent-step-config/
├── plan.md                 # This file
├── research.md             # Phase 0 decisions
├── data-model.md           # Phase 1 entities + invariants
├── quickstart.md           # Phase 1 validation guide
├── contracts/
│   ├── agent-step-config.schema.md
│   └── agent-step-config.contract.ts
├── checklists/
│   └── requirements.md
└── tasks.md                # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
packages/types/src/
├── index.ts                         # Extend AgentNodeConfig fields
├── agentConfiguration.ts            # Reuse modelSettingsSchema / validateAgent rules
└── agentStepConfig.ts               # NEW: resolve + validate effective step config

apps/web/src/components/workflow/properties/
└── NodeForms.tsx                    # Step-local AgentForm; registry deep-link; no patchAgent

apps/web/src/lib/workflow/
└── validation.ts                    # Client validation for step fields / incompatibilities

apps/web/src/store/
└── useWorkflowStore.ts              # updateNodeConfig path only for step edits (no behavior change required beyond callers)

apps/server/src/compiler/
├── nodeValidators.ts                # Server validation parity for new fields
└── workflowCompiler.ts              # Resolve effective tools/settings/instruction; inject into runtime

src/agents/runtime/
├── types.ts                         # AgentExecutionInput: taskInstruction?, modelSettingsOverride?, effectiveToolIds?
├── contextAssembler.ts              # Optional step-instruction context item (base system unchanged)
├── agentRuntime.ts                  # Pass step instruction into assembler request
├── reactSettings.ts                 # Derive mode from effective tools when provided
├── apiAgentExecutor.ts              # Apply ephemeral settings; authorize against effective tools; additive instruction
├── localAgentExecutor.ts            # Same settings + instruction rules for local backends
├── cliAgentExecutor.ts              # Additive STEP INSTRUCTIONS section; unsupported overrides fail closed
├── processAgentExecutor.ts          # Additive instruction in existing payload channels
└── webhookAgentExecutor.ts          # Additive instruction in existing payload channels

tests/
├── agentStepConfig.test.ts          # NEW: resolve/validate/omit-vs-empty/zero/partial/clear
├── agentStepConfigExecution.test.ts # NEW: executors honor instruction/settings/tools without mutating AgentRecord
└── (extend) workflow validation / NodeForms tests as needed
```

**Structure Decision**: Persist step config on existing workflow nodes; centralize pure resolve/validate in `packages/types`; apply at compile/runtime via `AgentExecutionInput` without cloning registry writes. UI ownership split: node panel = step config; `/org/agents/[agentId]` = shared registry.

---

## Complexity Tracking

*No constitutional violations.*  
Slight complexity (pure effective-config module + multi-executor plumbing) is required so concurrent runs never temporarily mutate a shared `AgentRecord` (FR-024 / SC-007).

---

## Phase outputs

| Phase | Artifact | Status |
| :--- | :--- | :--- |
| 0 | [research.md](./research.md) | Complete |
| 1 | [data-model.md](./data-model.md) | Complete |
| 1 | [contracts/](./contracts/) | Complete |
| 1 | [quickstart.md](./quickstart.md) | Complete |
| 2 | tasks.md | Next: `/speckit-tasks` |
