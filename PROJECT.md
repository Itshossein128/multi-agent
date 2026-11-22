# Project: Agentic Velora Delivery System (`multi-agent` Enhancements + `agentic-velora` Studio Registration)

**Authoritative Request**: `/home/hossein/Desktop/projects/multi-agent/.agents/teamwork/ORIGINAL_REQUEST.md`  
**Phase 0 Survey Sources**:
- `survey_1_gen3`: `/home/hossein/Desktop/projects/multi-agent/.agents/teamwork/teamwork_preview_explorer_survey_1_gen3/analysis.md`
- `survey_2_gen2`: `/home/hossein/Desktop/projects/multi-agent/.agents/teamwork/teamwork_preview_explorer_survey_2_gen2/analysis.md`
- `survey_3_gen2`: `/home/hossein/Desktop/projects/multi-agent/.agents/teamwork/teamwork_preview_explorer_survey_3_gen2/analysis.md`

---

## Architecture

- **Platform (`multi-agent`)**:
  - `@multi-agent/types` (`packages/types/src/`): Defines `WorkflowNodeType` (adding `"dynamic_fanout"`), `DynamicFanoutNodeConfig`, `AgentNodeConfig` (adding `reinvokeOnClarification?: boolean` and `shortTermMemoryMaxTokens?: number`), and `AgentDiagnostics` readiness details.
  - **Runtime & Providers (`src/agents/runtime/`, `src/security/`)**:
    - `CliAgentExecutor` (`cliAgentExecutor.ts`) + `thinkingText.ts` + `sandboxExecutionBarrier.ts`: Full support for `cursor` (`agent` executable in allowlists, `CURSOR_API_KEY` env delivery via `workerCredentials.ts`, `--output-format json|stream-json` parsing, `--resume [chatId]` in `sessionCommandArgs`, local-mode `--force` / `--mode` flags), alongside `codex` (`0.164.0`) and `agy` (`1.5.8`).
    - `AgentRuntime` + `ApiAgentExecutor` + `shortTermMemory.ts`: Expanded/configurable `shortTermHistories` retention + concise ReAct tool-call/observation transcript preservation across shared-session turns.
  - **Workflow Compiler & Sub-Agent Delegation (`apps/server/src/compiler/`, `src/tools/`)**:
    - `workflowCompiler.ts` + `nodeValidators.ts` + `topologyValidation.ts` + `validation.ts`:
      - `dynamic_fanout` node: reads array items from `state.lastValue` (or `itemField`), fans out N worker invocations concurrently up to `maxConcurrency` semaphore (supporting arbitrary `N`, not capped at 8), emits `fanout.*` run events, aggregates per-item results/verdicts/handoffs into `state.lastValue` and `state.nodeResults[node.id]`.
      - `reinvokeOnClarification`: when an `AgentNodeConfig` has `reinvokeOnClarification: true` and pauses via `needs_human`, resuming with `clarificationAnswers` re-invokes the **same agent session** (`resumeSession`) with those answers so it finishes its turn seamlessly.
      - Recursion guard matching fix (`workflowCompiler.ts:500`): match full `sourceNodeId->targetBranch` before `->targetBranch` fallback to avoid cross-gate collisions.
      - `subgraphRunner.ts`: propagate `agentSessions` and `shortTermHistories`, and preserve checkpointing (`MemorySaver` fallback) instead of `checkpointer: false`.
    - `delegate_subagents` tool (`src/tools/subagentDelegationTool.ts`): enables ReAct orchestrator/discovery agents to dynamically spawn N sub-agents per item with inherited `credentialPrincipal`, `tenantId`, concurrency cap, and cancellation `signal`.
  - **Velora Delivery & Knowledge Tools (`src/tools/`)**:
    - `deliverySystemTools.ts`: Fix `.specify/feature.json` `feature_directory` lookup; upgrade `delivery_plan_reader_tool` to parse `apps/web/src/app/data/delivery-plan.ts` live status (`R.0`/`A.6`/`A.7` `implemented` -> `A.1` next remaining phase) alongside `schedule.json`.
    - `veloraKnowledgeTool.ts`: Wraps `python3 scripts/knowledge/cli.py status`, `context`, and `index --semantic` (enforcing Velora `AGENTS.md` active-job PID check before indexing, never downgrading hybrid to lexical).
    - `veloraGraphifyTool.ts`: Wraps `graphify query`, `explain`, `path`, `update`, and semantic `extract`.
    - `veloraOutputReportTool.ts`: Writes/reads structured gap, QA, and SpecKit prompt artifacts strictly scoped to `/home/hossein/Desktop/projects/building-management/output/`.
  - **Studio Organization & UI (`src/studio/seeds/agenticVeloraOrgSeed.ts`, `apps/web/src/`)**:
    - Registers all 9 required agents, tools, workspace/output bindings, optimal verified backends (`codex`, `agy`, `cursor`), and the multi-stage workflow topology in `agentic-velora` (`id=4cc4a715-3ac8-42d4-84ad-83bbdc45f03a`, `http://localhost:3060/o/agentic-velora/org`).
    - Updates `apps/web` Studio UI (`NodeForms.tsx`, `AgentBackendPanel.tsx`, canvas nodes/validators) to display and validate `dynamic_fanout`, `reinvokeOnClarification`, and Cursor/Codex/Agy backend configurations.

- **Strict Boundary (R8.1)**:
  - ZERO product feature implementation or code edits in `/home/hossein/Desktop/projects/building-management`. All changes live in `/home/hossein/Desktop/projects/multi-agent` + Studio configuration in `agentic-velora`.

---

## Feature Inventory

Every requirement from `ORIGINAL_REQUEST.md` (R1–R8) is mapped to a milestone below:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Stateful Same-Session Continuation & `reinvokeOnClarification` | Preserve exact `sessionId` across `speckit-specify` → Supervisor → `speckit-plan` → Supervisor → `speckit-tasks` + loops; re-invoke paused agent in same session after `needs_human` clarification; raise `shortTermHistories` bounds + persist ReAct tool summaries; propagate sessions/checkpointer in `subgraphRunner.ts` | M1, M2 | R1.1, R4 |
| F2 | Dynamic Sub-Agent Fan-Out / Per-Item Delegation | `dynamic_fanout` workflow node (N items, concurrency semaphore, event stream, output aggregation) + `delegate_subagents` `ToolRuntime` tool | M1, M2 | R1.2, R2.3 |
| F3 | Non-Linear Routing, Guard Scoping & Exception-Only HITL | Exact `sourceNodeId->targetBranch` guard matching; flexible dynamic `speckit-*` skill routing (`clarify`/`analyze`/`checklist`/`constitution`); post-QA→Fixer direct loop; `humanApprovalGateRequired: false` + `needs_human` exception-only HITL | M2 | R1.3, R4.4, R6, R7.1 |
| F4 | Intelligent Provider Integration (`Cursor` w/ API Key, `Codex CLI`, `agy`) | Add `agent` to allowlists (`DEFAULT_SANDBOX_ALLOWED_EXECUTABLES`, `apps/server/.env`); Cursor `--resume`, `--output-format json/stream-json` parsing, `thinkingText`, `CURSOR_API_KEY` env delivery, `agentService.diagnostics` upgrades; verify Codex CLI (`0.164.0`) & Antigravity (`agy 1.5.8`) flags & optimal role assignments | M1 | R1.4 |
| F5 | Stage 1 Knowledge-Backed Discovery & Per-Req QA Fan-Out | Fix `deliverySystemTools.ts` (`feature_directory`, live `delivery-plan.ts` parser); add `velora_knowledge_tool`, `velora_graphify_tool`, `velora_output_report_tool`; configure Discovery & Knowledge Analyst + dynamic Per-Requirement End-User QA Agent saving reports to `building-management/output/` | M3 | R2 |
| F6 | Stage 2 Complexity-Adaptive SpecKit Prompt Architect | Configure Prompt Architect consuming `output/` reports to emit 1 prompt for simple phases or N sequential sub-stage prompts for complex phases | M3 | R3 |
| F7 | Stage 3 Stateful SpecKit Pipeline + Supervisor Governance | Single shared-session SpecKit Executor + SpecKit Supervisor/Reviewer inspecting/approving/answering after `specify`, `plan`, `tasks` with dynamic auxiliary `speckit-*` branching | M2, M3 | R4 |
| F8 | Stage 4 Orchestrated Implementation & Convergence | Orchestrator partitions execution phases and drives SpecKit Implementer (`speckit-implement` + `speckit-converge`) with write-enabled workspace permissions | M3 | R5 |
| F9 | Stage 5–6 Post-Implementation End-User QA & Direct Fixer Loop | Post-Impl QA verification against `:5173`/API/E2E → dedicated Post-QA Defect Fixer remediation loop bypassing SpecKit (`specify`/`plan`/`tasks`) | M3 | R6 |
| F10 | Stage 7–8 Exception-Only HITL & Semantic Knowledge Sync | Autonomous progression with exception-only HITL (`needs_human` on genuine ambiguity only) + Stage 8 Semantic Knowledge & Graphify Updater (`graphify` semantic update + `cli.py index --semantic` with active-job PID check) | M2, M3 | R7 |
| F11 | Studio Web UI & Complete `agentic-velora` Live Registration | `apps/web` UI support for `dynamic_fanout`/Cursor/`reinvokeOnClarification`; register all 9 agents, tools, system prompts, skill bindings, provider configs, workspace/output bindings, and workflow topology in `http://localhost:3060/o/agentic-velora/org` | M4 | R8.2 |
| F12 | Comprehensive E2E Suite, Build/Typecheck & Boundary Verification | Tiers 1–4 opaque-box E2E tests (all 8 stages + Cursor/Codex/Agy + dynamic fan-out + same-session continuation + HITL + knowledge sync), Tier 5 adversarial hardening, `pnpm test --runInBand`, `tsc`, server/web builds, `git diff --check`, live Studio API/UI check, Velora `git status`/`git log` boundary check | E2E_TRACK, M5 | R8.1, Acceptance Criteria |

**Cross-check**: All 12 features (F1–F12) have explicit Milestone assignments; zero unassigned features.

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | `m1_types_providers_sessions` | `@multi-agent/types` (`dynamic_fanout`, `reinvokeOnClarification`, session memory config), Cursor CLI (`agent` allowlists, `CURSOR_API_KEY` delivery, `--resume`, JSON/thinking parsing, diagnostics), `ApiAgentExecutor`/`shortTermMemory` transcript & limit upgrades, `agentRuntime.ts` | none | BLOCKED: m1_challenger_2 REJECT (3 defects; Iter 2 remediation queued) |
| E2E | `e2e_testing_track` | Parallel opaque-box E2E test infrastructure & Tiers 1–4 test suite covering all R1–R8 acceptance criteria (`tests/`), publishes `TEST_READY.md` | none (runs in parallel; final full execution in M5) | PLANNED |
| M2 | `m2_workflow_engine_fanout_hitl` | `workflowCompiler.ts` (`dynamic_fanout` node, `reinvokeOnClarification`, scoped recursion guard), `nodeValidators.ts`, `topologyValidation.ts`, `validation.ts`, `subgraphRunner.ts` (session+checkpointer propagation), `subagentDelegationTool.ts` | M1 | PLANNED |
| M3 | `m3_velora_tools_and_seed` | Fix `deliverySystemTools.ts` (`feature_directory`, live `delivery-plan.ts`), add `veloraKnowledgeTool`, `veloraGraphifyTool`, `veloraOutputReportTool`, register in `toolExecutorFactory.ts`, create `agenticVeloraOrgSeed.ts` + sync CLI script with all 9 agents & full 8-stage workflow | M1, M2 | PLANNED |
| M4 | `m4_studio_ui_and_live_registration` | Update `apps/web/` UI (`NodeForms.tsx`, `AgentBackendPanel.tsx`, canvas nodes/validators), build types/server/web, restart live servers if needed, sync & verify `agentic-velora` (`http://localhost:3060/o/agentic-velora/org`) via Studio API & real browser | M1, M2, M3 | PLANNED |
| M5 | `m5_final_verification` | Final Milestone: pass 100% E2E suite (Tiers 1–4), Tier 5 adversarial coverage hardening, full `pnpm test --runInBand`, `npx tsc --noEmit`, `pnpm run typecheck:tests`, `pnpm --filter server build`, `pnpm --filter web build`, `git diff --check`, `graphify update .`, live Studio API/UI check, Velora `git status`/`git log` boundary check | M4, E2E | PLANNED |

---

## Interface Contracts

### `@multi-agent/types` ↔ `workflowCompiler` / `apps/web`
- `WorkflowNodeType`: add `"dynamic_fanout"`.
- `DynamicFanoutNodeConfig`:
  ```ts
  export interface DynamicFanoutNodeConfig {
    targetAgentId?: string;
    workflowId?: string;
    itemsField?: string;       // default: read array from state.lastValue (or lastValue[itemsField])
    itemPromptTemplate?: string;
    maxConcurrency?: number;   // default 4, bounded 1..16
    maxItems?: number;         // default 50
    aggregateField?: string;   // optional output key
    failFast?: boolean;        // default false (collect all verdicts)
    taskInstruction?: string;
  }
  ```
- `AgentNodeConfig`: add optional `reinvokeOnClarification?: boolean` (default `false` for backward compatibility) and `shortTermMemoryMaxTokens?: number`.

### `CliAgentExecutor` (`cursor` provider) ↔ `workerCredentials` / `sandboxExecutionBarrier`
- Default executable `"agent"` allowed in `DEFAULT_SANDBOX_ALLOWED_EXECUTABLES` and `apps/server/.env` `CLI_AGENT_ALLOWED_EXECUTABLES`.
- `CURSOR_API_KEY` injected via `WorkerLaunchSecrets` when `CLI_CREDENTIAL_ENVIRONMENT_ENABLED=true` (or broker).
- `sessionCommandArgs`: when `backend.provider === "cursor"`:
  - Uses `--output-format stream-json` (or `json`) when session capture/resume is active (unless user explicitly requested another structured format) to extract `session_id` / `chat_id` and assistant result text.
  - Passes `--resume <sessionId>` on continuation turns.
  - Supports `--force` / `--mode plan` / `--mode ask` from `backend.args` without breaking `--trust` / `-p`.

### `Velora Delivery Tools` ↔ `/home/hossein/Desktop/projects/building-management`
- Strictly read-only on Velora product code (`delivery_plan_reader_tool`, `employer_requirements_extractor_tool`, `speckit_workspace_tool`, `velora_knowledge_tool` `status`/`context`, `velora_graphify_tool` `query`/`explain`/`path`).
- `velora_output_report_tool` writes ONLY under `<projectRoot>/output/` (path-normalized boundary check).
- `velora_knowledge_tool` `index --semantic` MUST check `cli.py status` and `.knowledge/index.progress.json` PID liveness first and refuse if an active job is running or downgrade would occur.

---

## Code Layout

- `packages/types/src/` — Shared contracts, node/agent configs, validation helpers
- `src/agents/runtime/` — `agentRuntime.ts`, `cliAgentExecutor.ts`, `apiAgentExecutor.ts`, `shortTermMemory.ts`, `thinkingText.ts`, `workerCredentials.ts`, `workerRuntime.ts`
- `src/security/` — `sandboxExecutionBarrier.ts`, `workerRuntimeBarrier.ts`, `credentialGateway.ts`, `providerCredentials.ts`
- `src/tools/` — `deliverySystemTools.ts`, `subagentDelegationTool.ts`, `veloraKnowledgeTool.ts`, `veloraGraphifyTool.ts`, `veloraOutputReportTool.ts`, `toolExecutorFactory.ts`
- `src/studio/seeds/` — `agenticVeloraOrgSeed.ts` (+ existing seeds untouched unless needed)
- `apps/server/src/compiler/` — `workflowCompiler.ts`, `nodeValidators.ts`, `topologyValidation.ts`, `validation.ts`, `subgraphRunner.ts`
- `apps/server/src/api/studio/` — `agentService.ts`
- `apps/web/src/` — `components/agents/`, `components/workflow/`, `lib/agentConfiguration.ts`
- `tests/` & `apps/web/e2e/` — Unit, integration, E2E pipeline, and UI specs
