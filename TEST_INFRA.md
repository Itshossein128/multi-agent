# Test Infrastructure Specification — Dual-Track Opaque-Box E2E Suite

**Authoritative Request**: `.agents/teamwork/ORIGINAL_REQUEST.md`  
**Architecture Reference**: `PROJECT.md` & `.agents/teamwork/e2e_explorer_1/analysis.md`

---

## 1. Test Topology & Suites

| Suite | Path | Runner | Scope |
|---|---|---|---|
| **Programmatic Pipeline E2E** | `tests/e2eVeloraWorkflowPipeline.test.ts` | Jest (`pnpm test --runInBand`) | Tiers 1–4 opaque-box verification of `F1–F10`, `F12`, and `R1–R8` via `RunExecutor`, `compileWorkflow`, `validateWorkflow`, `AgentRuntime`, `CliAgentExecutor`, `ApiAgentExecutor`, `ToolRuntime`, `AgentService`, and Hono routers (`runs`, `studio`, `dashboard`). |
| **Shared Velora E2E Harness** | `tests/helpers/veloraE2EFixtures.ts` | Imported by Jest E2E | Deterministic temp Velora mirror builder, protocol-authentic CLI stdout/JSONL fixtures (`cursor`/`codex`/`agy`), Hono principal assertion helper, `AgentRuntime` scriptable pipeline double, dynamic M3 seed loader, and target-repo git boundary checker. |
| **Studio Browser & API E2E** | `apps/web/e2e/agentic-velora.spec.ts` | Playwright (`pnpm --filter web test:e2e`) | Tiers 1–4 verification of `F11` & `R8.2` against live `http://localhost:3060/o/agentic-velora/org` (read-only live registration audit) + ephemeral imported Studio org (canvas, `dynamic_fanout`, `reinvokeOnClarification`, Cursor/Codex/Agy backend forms, live run & clarification UI). |

---

## 2. Opaque-Box & Tiered Coverage Methodology

Every test asserts **externally observable outcomes** (HTTP responses, `RunStore` statuses/events, `agentSessions`, `loopIterations`, `output/` artifacts, CLI spawn specs/redaction, and DOM locators) without relying on private implementation details.

- **Tier 1 — Feature Coverage (`>= 5` cases per feature `F1–F12`)**:
  - `F1` (`F1-T1..F1-T6`): Same-session continuation across `specify -> Supervisor -> plan -> Supervisor -> tasks`, `reinvokeOnClarification: true` vs `false`, raised `shortTermMemoryMaxTokens` + ReAct tool summary retention, `subgraphRunner` session & checkpointer propagation, `resumePromptMode` `"delta"` vs `"full"`.
  - `F2` (`F2-T1..F2-T5`): `dynamic_fanout` with `N = 12` (`> 8` legacy cap) & `maxConcurrency` semaphore, `fanout.*` event lifecycle, `workflowId` target with `"node"` isolation, `delegate_subagents` tool via `ToolRuntime`, `failFast: false` vs `true` (`AbortSignal`).
  - `F3` (`F3-T1..F3-T5`): Non-linear `speckit-*` branching (`clarify`, `constitution`, `checklist`, `analyze`), scoped `sourceNodeId->targetBranch` recursion guard isolation, `humanApprovalGateRequired: false` autonomous completion, `needs_human` approval/rejection, `node.loop_limit_reached` fallback routing.
  - `F4` (`F4-T1..F4-T6`): Cursor CLI (`agent`, `CURSOR_API_KEY` launch secret + `[REDACTED]`, `--resume` & `thinkingText`), Codex CLI `0.164.0` (`-s read-only`, `-s workspace-write --approve-for-me`, `exec resume <thread_id> -`), Antigravity `agy` (`stream-json`, `--conversation`), `AgentService.diagnostics()`, and `agenticVeloraOrgSeed` 9-agent validation & provider distribution.
  - `F5` (`F5-T1..F5-T5`): `delivery_plan_reader_tool` live `delivery-plan.ts` status (`R.0`/`A.6`/`A.7` implemented -> `A.1` remaining), `speckit_workspace_tool` `.specify/feature.json` `feature_directory` resolution, `velora_knowledge_tool` + `velora_graphify_tool`, Stage 1 `dynamic_fanout` per-requirement QA verdicts, `velora_output_report_tool` writes under `<temp>/output/`.
  - `F6` (`F6-T1..F6-T5`): Stage 2 Prompt Architect single-prompt vs multi-prompt adaptation, 100% open gap ID coverage, `speckit-prompts/` artifact persistence (`README.md`, `01-*.md`, `coverage.json`), fail-closed validation on corrupt/empty gap reports.
  - `F7` (`F7-T1..F7-T5`): Stage 3 `specify -> Supervisor -> plan -> Supervisor -> tasks` single `sessionId`, Supervisor rejection + Q&A revision loop, dynamic `speckit-clarify`/`checklist`/`analyze`/`constitution`, monotonic `turnCount` in `state.updated` & `agentSessions`.
  - `F8` (`F8-T1..F8-T5`): Stage 4 phase partitioning + write-enabled Implementer, `speckit-converge` convergence, `implement -> converge` continuation loop, sequential multi-prompt execution (`K = 2`), `speckit-converge` recursion guard exhaustion.
  - `F9` (`F9-T1..F9-T5`): Stage 5–6 clean QA pass -> Stage 8, `QA -> Defect Fixer -> QA` direct loop with zero SpecKit re-entry, multi-iteration defect remediation, `sessionMode: "node"` retention on Fixer, Fixer recursion guard fallback.
  - `F10` (`F10-T1..F10-T5`): Zero-HITL completion (`0` `human_approval.requested`), exception-only `needs_human` pause & autonomous resume, Stage 8 sequential `graphify` + `cli.py index --semantic`, active-job PID guard (live PID blocked vs dead PID allowed), fail-closed `--semantic` no-downgrade when embedding endpoint is unavailable.
  - `F11` (`F11-T1..F11-T5`): Playwright Studio API registration check (9 agents, tools, Velora workspace), live canvas rendering + `dynamic_fanout` + `"Workflow is valid"`, per-agent `systemPrompt`/CLI backend/secret hygiene/workspace check, tools & workspaces pages, `NodeForms` (`dynamic_fanout`, `reinvokeOnClarification`) & `AgentBackendPanel` (`cursor`, `codex`, `agy`).
  - `F12` (`F12-T1..F12-T5`): Full 8-stage seeded `agentic-velora` workflow execution, `git status`/`rev-parse HEAD` unchanged on `/home/hossein/Desktop/projects/building-management`, seed completeness & `validateWorkflow()`, `velora_output_report_tool` path boundary enforcement, cross-tenant `404` isolation.
- **Tier 2 — Boundary & Corner Cases (`T2-B1..T2-B8`, `T2-UI-B1..T2-UI-B2`)**
- **Tier 3 — Cross-Feature Combinations (`T3-C1..T3-C4`, `T3-UI-C1`)**
- **Tier 4 — Real-World Velora Phase `A.1` & Operator Readiness Scenarios (`T4-R1..T4-R3`)**

---

## 3. Strict Target Boundary & Fixture Isolation Rules (`R8.1`)

1. **Zero Target-Repo Mutation**: Automated tests MUST NEVER write, modify, or delete any file inside `/home/hossein/Desktop/projects/building-management` (including `output/`).
2. **Read-Only Probes vs Isolated Temp Mirror**:
   - Read-only tools (`delivery_plan_reader_tool`, `speckit_workspace_tool`) may read `/home/hossein/Desktop/projects/building-management` to verify real phase discovery (`R.0/A.6/A.7` implemented -> `A.1` remaining) and `.specify/feature.json` (`feature_directory`).
   - All write-path tests (`velora_output_report_tool`, `velora_knowledge_tool` `index --semantic` active-job PID check, `velora_graphify_tool` `update`/`extract`, Stage 4/6 workspace edits) MUST target an isolated temp mirror created via `fs.mkdtempSync(path.join(os.tmpdir(), "velora-e2e-"))` and cleaned up in `afterEach`/`afterAll`.
3. **Git Boundary Assertion (`F12-T2`)**: `tests/e2eVeloraWorkflowPipeline.test.ts` snapshots `git -C /home/hossein/Desktop/projects/building-management status --porcelain` and `rev-parse HEAD` in `beforeAll` and asserts byte-identical values in `afterAll`.

---

## 4. Provider & CLI Execution Strategy (`R1.4`)

- **Deterministic Protocol Mode (Default `pnpm test --runInBand`)**:
  - `CliAgentExecutor` is exercised via `SandboxedWorkerRuntime` + mock `WorkerRuntime` inspecting exact `executable`, `args`, `env` (`WorkerLaunchSecrets` carrying `CURSOR_API_KEY`), `cwd`, and `stdin`, returning protocol-authentic streams for `cursor` (`agent`), `codex` (`0.164.0`), and `agy` (`1.5.8`).
  - Note on Codex `0.164.0`: Non-interactive write-capable invocations use `-s workspace-write` + `--approve-for-me` (or `--dangerously-bypass-approvals-and-sandbox`), never deprecated `--full-auto`.
  - Full 8-stage workflow graph executions (`RunExecutor` + `compileWorkflow`) use a deterministic protocol-compliant `AgentRuntime` test double supporting `onSessionUpdate`, `resumeSession`, `clarificationAnswers`, `needs_human`, `shortTermHistories`, and `ToolRuntime` invocations.
- **Host Readiness & Policy Probes**:
  - Always verify `DEFAULT_SANDBOX_ALLOWED_EXECUTABLES`, `defaultCliExecutable("cursor") === "agent"`, `validateAgent()` credential rejection (`assertNoCredentials`), `WorkerCredentialResolver` launch-secret injection, and `[REDACTED]` stdout/stderr scrubbing.
  - Optional live CLI version smoke (`RUN_LIVE_CLI_PROBES=1`) runs `codex --version`, `agy --version`, `agent --version` via `execFileSync` (zero LLM tokens).

---

## 5. Playwright Execution & Authentication Rules

- **Live Stack Command**:
  ```bash
  E2E_BASE_URL=http://localhost:3060 pnpm --filter web test:e2e e2e/agentic-velora.spec.ts
  ```
  Setting `E2E_BASE_URL=http://localhost:3060` activates `webServer: []` in `apps/web/playwright.config.ts` so Playwright connects cleanly to `:3060` (Next.js) + `:4000` (Execution Server) + PostgreSQL without spawning a conflicting `:4100` execution server.
- **Two-Context Auth Strategy**:
  1. **Ephemeral Org Context (Mutating UI/Run Tests)**: Registers a fresh user at `/register`, creates an ephemeral org at `/onboarding/organization`, imports the `agenticVeloraOrgSeed` package (or E2E workflow package), and tests canvas editing, `dynamic_fanout` forms, `reinvokeOnClarification`, `Cursor`/`Codex`/`Agy` backend config, live runs, and clarification submission without touching the live `agentic-velora` org.
  2. **Live `agentic-velora` Context (Read-Only Live Registration Audit)**:
     - Uses `E2E_VELORA_EMAIL` / `E2E_VELORA_PASSWORD` when provided, OR registers a short-lived E2E viewer user, grants a temporary `status='active', role='viewer'` membership in `agentic-velora` (`4cc4a715-3ac8-42d4-84ad-83bbdc45f03a`) via `MEMORY_DATABASE_URL`, verifies `/o/agentic-velora/org` read-only in Chrome, and removes the temporary membership + user in `afterAll` (`try/finally`).
- **Playwright Health Gates**:
  - `pageerror`: empty (`[]`)
  - `console` (`type === "error"`): empty (`[]`)
  - `/api/o/.*/execution/` responses with `status >= 400` (outside explicit negative/RBAC tests): empty (`[]`)

---

## 6. Verification Commands & Diagnostics

```bash
# 1. Typecheck all tests
pnpm run typecheck:tests

# 2. Run programmatic Velora E2E suite
pnpm test --runInBand -- tests/e2eVeloraWorkflowPipeline.test.ts

# 3. Verify Playwright test discovery & TypeScript compilation
pnpm --filter web exec tsc --noEmit
E2E_BASE_URL=http://localhost:3060 pnpm --filter web exec playwright test e2e/agentic-velora.spec.ts --list

# 4. Run Playwright Studio E2E suite against live servers (M4/M5)
E2E_BASE_URL=http://localhost:3060 pnpm --filter web test:e2e e2e/agentic-velora.spec.ts

# 5. Full verification gate (M5)
pnpm test --runInBand
npx tsc --noEmit
pnpm run typecheck:tests
pnpm --filter server build
pnpm --filter web build
git diff --check
```

- **Failure Diagnostics**: `assertRunCompletedOrDump(runStore, runId)` logs `run.status`, `run.error`, ordered `runStore.events(runId)` (`type`, `nodeId`, `agentId`), `agentSessions`, and `loopIterations` on unexpected run failure. Playwright stores traces, screenshots, and video in `apps/web/test-results/`.
