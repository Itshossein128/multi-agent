# Implementation Prompt — Close Remaining Phase 4/5 Gaps

You are working in the repository:

`/home/hossein/Desktop/projects/multi-agent`

Your mission is to finish the remaining Phase 4 (Execution Timeline & Live Execution) and Phase 5 (Agent Management & Configuration) gaps, then perform an independent review and verification pass.

Do not use Agy, external subagents, or unverified generated code. Work directly in this repository. Do not reset, checkout, clean, or overwrite unrelated user changes. The working tree is already intentionally dirty because earlier Phase 3, 4, and 5 work must be preserved.

## Current baseline

The repository already contains working foundations. Do not rebuild them from scratch:

- The server dynamically compiles `WorkflowDefinition` into LangGraph.
- Supported workflow nodes include input, output, agent, tool, memory, condition, and human approval.
- Basic normal/conditional edges, real fan-out/fan-in, and condition-driven bounded loops are implemented.
- Runs have append-only sanitized events, ordered sequences, SSE replay/reconnect, timeline UI, graph runtime state, cancellation, human approval pause/resume, and whole-run retry from a stored definition snapshot.
- Agent CRUD, backend selection, execution policy, tool assignment, bounded short-term memory, server-side diagnostics, and standalone agent testing exist.
- CLI, API, and local backends exist. CLI authentication may legitimately remain `unknown`; credentials must never be inspected or returned to the browser.
- A focused verification run currently covers the Phase 4/5 runtime, persistence, authorization, workers, and agent UI contracts. Preserve its behavior while expanding coverage.
- Read these files before editing:
  - `docs/implementation-gaps.md`
  - `docs/visual-graph-editor-roadmap.md`
  - `docs/checklist.md`
  - `docs/agent-detail-page.md`
  - `VERIFICATION_REPORT.md`
  - `apps/server/src/compiler/workflowCompiler.ts`
  - `apps/server/src/compiler/validation.ts`
  - `apps/server/src/runtime/runExecutor.ts`
  - `apps/server/src/runtime/runStore.ts`
  - `apps/server/src/api/runs.ts`
  - `apps/server/src/api/studio/agentService.ts`
  - `src/agents/runtime/`
  - `apps/web/src/components/runs/`
  - `apps/web/src/app/(authenticated)/runs/`

First inspect `git status` and the current diff. Never discard existing changes.

## Non-negotiable engineering rules

1. The browser is a control plane, never an execution authority.
2. The server is authoritative for workflow validation, agent/tool access, credentials, runtime policy, run ownership, and event sanitization.
3. Agent entities and agent nodes remain separate. Tool entities and tool nodes remain separate.
4. Saved workflow definitions must never be mutated merely to display runtime state.
5. Run definitions must be immutable snapshots for historical replay and retry.
6. All public events must use the shared `RunEvent` contract. Never expose raw LangGraph/provider event shapes to the frontend.
7. Never store or return API keys, OAuth tokens, CLI session data, credential paths, authorization headers, or secret-bearing environment values.
8. Never silently fabricate provider usage or cost. If a provider does not report a value, use `null` or an explicit unavailable state.
9. Retry must not duplicate already-completed non-idempotent side effects unless the system explicitly proves the operation safe.
10. Fail closed on unknown node types, unknown providers, invalid tools, invalid ownership, invalid approval branches, unsafe commands, and missing snapshots.
11. Use `apply_patch` for source edits. Keep generated build output consistent with repository conventions.
12. Do not claim completion based only on typechecking or a successful build. Add and run behavioral tests.

## Phase A — Establish an evidence-backed gap list

Before implementing:

1. Compare the current source with `docs/implementation-gaps.md` and `docs/checklist.md`.
2. Classify each item as:
   - already implemented and verified;
   - implemented but unverified;
   - partially implemented;
   - not implemented;
   - intentionally out of scope.
3. Create a short working checklist in `implementation_plan.md` or an equivalent artifact. Do not ask for approval; proceed with implementation.
4. Preserve all existing behavior and tests. If a document is stale, update it only after the code and evidence are truthful.

## Phase B — Node-level retry and execution semantics

Implement safe retry semantics for individual retryable nodes/subtasks where the workflow model permits it.

Required behavior:

- Add an explicit, server-controlled retry policy with bounded attempts and backoff.
- Support retry configuration at the node or workflow policy level without trusting browser configuration as an authorization grant.
- Emit `node.retrying` with run ID, node ID, attempt number, maximum attempts, delay, and a sanitized reason.
- Correlate all attempts with the same logical run/node while preserving distinct event IDs and sequences.
- Do not rerun a completed node accidentally.
- Do not retry human approval, output, memory writes, or non-idempotent tools unless explicitly marked safe/idempotent.
- Mark retryability in failure events or metadata when known.
- Ensure cancellation interrupts backoff and prevents a new attempt.
- Ensure retry exhaustion produces exactly one terminal run failure/cancellation path.
- Keep whole-run retry behavior working from the immutable snapshot.
- Keep task `runId`, status, retry count, output, and error synchronized when a task-linked run is retried directly.

Add tests for:

- transient failure then successful node retry;
- retry exhaustion;
- cancellation during backoff;
- non-retryable side effect;
- no duplicate completed node;
- `node.retrying` sequence and redaction;
- task/run linkage after retry;
- ownership isolation for retry.

## Phase C — Parallelism, loops, and guardrails

Harden the existing real LangGraph branching behavior.

Required behavior:

- Add a server-controlled maximum number of concurrently active branches per run.
- Add a maximum loop iteration/step budget in addition to the existing recursion limit.
- Make loop exit semantics explicit and observable. Emit iteration/branch state without exposing untrusted prompt content.
- Ensure a branch cancellation cancels only the intended branch unless the run policy requires whole-run cancellation.
- Ensure whole-run cancellation stops all active branches and downstream work.
- Ensure fan-in waits for the required predecessors and does not lose or overwrite branch results unexpectedly.
- Ensure event sequences remain monotonic and deterministic enough for replay, while preserving real concurrency.
- Fail with a clear sanitized error when a branch or loop budget is exceeded.
- Bound parallel branch creation so a malicious workflow cannot create unbounded work.

Add tests for:

- parallel branch cap;
- fan-out/fan-in with multiple results;
- cancellation while several branches are active;
- loop exit after a bounded number of iterations;
- loop budget exhaustion;
- replay ordering and edge traversal under concurrency;
- no unbounded memory/event growth.

## Phase D — Authoritative workflow validation

Complete server-side validation before compilation. The frontend may provide earlier feedback but is never authoritative.

Required behavior:

- Reject unknown `node.type` values explicitly.
- Define and test a compatibility matrix for supported source/target node connections.
- Reject malformed node and edge IDs, invalid configs, missing references, duplicate IDs, and invalid branch keys.
- Enforce approval outgoing branch keys to be exactly `approved` and/or `rejected`.
- Validate condition branches and all conditional edges consistently on server and client.
- Validate tool references, enabled state, category support, impact policy, and agent tool assignments.
- Preserve cycle support only where the runtime can bound it safely.
- Return stable machine-readable issue codes and safe user-facing messages.

Add negative tests for every rejected class and ensure the API never leaks raw provider, filesystem, or database internals.

## Phase E — Resource budgets and redaction

Make resource protection consistent across all run paths.

Required behavior:

- Enforce a maximum serialized RunEvent payload size at the store boundary.
- Bound stdout, stderr, tool output, agent output, memory context, timeline buffering, and retry metadata.
- Preserve valid UTF-8 when truncating.
- Redact secrets before persistence, before subscriber delivery, before history responses, and before logs.
- Redact nested objects, arrays, error causes, headers, URLs, environment-like objects, stack traces, and provider diagnostics.
- Never include raw prompt/input/output content in telemetry unless it is explicitly bounded and policy-approved.
- Add tests that inject credentials through every likely location and verify they do not appear in stored events, API responses, logs, or UI-facing diagnostics.

## Phase F — Provider usage, cost, and observability

Improve observability without introducing fake data or coupling the UI to Langfuse/provider internals.

Required behavior:

- Normalize provider-reported token usage, cached tokens, latency, finish reason, and cost when available.
- Use `null`/unavailable when usage or cost is not provided; never estimate silently.
- Emit safe lifecycle observations for API/local LLM calls, CLI execution, tool execution, approval waits, retries, cancellation, and failures.
- Include stable run/node/agent/tool correlation IDs.
- Ensure telemetry failures never change business execution outcome.
- Ensure telemetry callbacks are not invoked twice for one event.
- Remove or isolate legacy tracing paths that conflict with the current OTel/server boundary.
- Replace any browser-side direct Langfuse polling or fabricated cost calculation with a server-owned read model.
- Do not log raw exceptions if they may contain secrets; use sanitized error classes/messages.

Add deterministic tests for usage propagation, unavailable usage, telemetry failure isolation, correlation, and duplicate-event prevention.

## Phase G — Browser E2E and historical replay

Add browser-level behavioral coverage for the critical Studio path using the project’s existing browser test conventions. If no suitable framework exists, add the smallest maintainable Playwright setup and document how to run it.

Cover:

1. Authenticate as a test user.
2. Create or load an agent.
3. Configure a backend without entering credentials in browser state.
4. Create/edit a workflow with agent, tool, condition, approval, and output nodes.
5. Save and reload the workflow.
6. Start a run.
7. Observe live timeline events and graph node/edge state.
8. Disconnect/reconnect and verify historical gap replay without duplicates.
9. Resolve approval and verify resume events.
10. Cancel an active run and verify terminal cancellation.
11. Retry a failed run and verify navigation to the new run snapshot.
12. Open a historical run and verify the same timeline model is used.
13. Open Agent Detail and verify diagnostics, execution history, workflow usage, tool assignment, validation errors, and unsaved-change protection.
14. Verify RTL/layout behavior if the application supports Persian UI.

The tests must assert behavior, not screenshots alone. Do not use fake timers or mocked event streams for the primary acceptance path.

## Phase H — Worker isolation and deployment hardening

Document and implement a clearly separated development profile and hardened execution profile.

Required behavior:

- Keep the local process runtime available for trusted development only.
- Provide a worker adapter that can execute untrusted CLI/code workloads in an isolated container or stronger sandbox boundary.
- Do not describe ordinary Docker as a complete security boundary for fully untrusted code.
- For the hardened profile, apply least privilege: non-root user, read-only root filesystem where possible, no privileged mode, no host Docker socket, dropped Linux capabilities, seccomp/AppArmor or equivalent, CPU/memory/PID/time limits, restricted mounts, explicit workspace mount, and default-deny network policy.
- Separate control-plane credentials from worker containers.
- Do not mount the host home directory or the repository broadly into an untrusted worker.
- Add lifecycle cleanup for worker processes/containers after success, failure, timeout, and cancellation.
- Document the optional VM/gVisor/Kata boundary for workloads that remain fully untrusted.
- Add a Compose smoke profile for web + server + PostgreSQL and a hardened worker profile without pretending the latter is enabled by default.
- Verify health checks, migrations, graceful shutdown, restart behavior, and approval recovery.

Add tests or executable smoke checks for policy enforcement, mount restrictions, network denial, timeout cleanup, and worker orphan detection. If host kernel/runtime capabilities prevent a security claim, report that explicitly and leave the deployment in a fail-closed state.

## Phase I — Authorization and state consistency audit

Verify every run/agent/tool/workflow/approval/retry/diagnostics endpoint:

- requires authentication where appropriate;
- checks both user and tenant ownership;
- treats missing ownership as fail-closed for scoped requests;
- never lets browser-supplied snapshots widen authority;
- does not expose another tenant’s IDs, events, tools, agents, metadata, or diagnostics;
- keeps durable and in-memory stores behaviorally aligned;
- handles restart/hydration and missing snapshots honestly.

Add cross-user and cross-tenant regression tests for read, stream, cancel, retry, resolve approval, diagnostics, and definition/history endpoints.

## Phase J — Documentation and completion evidence

After implementation:

- Update `docs/implementation-gaps.md` so every remaining item accurately states implemented, verified, or intentionally deferred.
- Update `docs/checklist.md`, `docs/agent-detail-page.md`, `docs/architecture.md`, and the roadmap only where the code and tests support the claim.
- Record exact commands, test counts, build results, migration results, and any environment restrictions.
- Do not mark browser E2E, sandbox isolation, or production hardening complete without running their actual checks.
- Add a concise `walkthrough.md` or verification section describing the final behavior and known limits.

## Required verification commands

Run the narrowest relevant tests first, then the full available verification:

```bash
pnpm test tests/phase4Phase5Completion.test.ts tests/phase5Runtime.test.ts tests/humanApproval.test.ts tests/operationalE2E.test.ts tests/ownershipAuthorization.test.ts tests/agentDetail.test.ts tests/agentRegistry.test.ts tests/agentExecutor.test.ts tests/agents/runtime/workerRuntime.test.ts --runInBand
pnpm --filter @multi-agent/types build
pnpm --filter server build
pnpm --filter web build
git diff --check
```

If PostgreSQL, Docker, worker spawning, or browser automation requires permissions unavailable in the current environment, run the tests with the necessary approved access. If a check still cannot run, report the exact blocker and do not convert it into a passing claim.

Then run:

```bash
pnpm test --runInBand
```

Separate and report:

- passed focused behavioral tests;
- passed builds and migrations;
- full-suite failures caused by real code;
- full-suite failures caused by environment restrictions or pre-existing external/LLM dependencies.

## Definition of done

The work is complete only when:

1. Every in-scope gap has an implementation or an explicit, justified deferral.
2. Node retry, concurrency/loop budgets, validation, redaction, resource limits, observability, authorization, and task/run consistency have behavioral tests.
3. Browser E2E proves the critical run/timeline/approval/reconnect/retry path.
4. The hardened worker deployment is honest about its security boundary and has cleanup/health checks.
5. Types, server, web, migration, focused tests, and applicable full-suite checks have been run.
6. The final report names changed files, exact evidence, unresolved risks, and does not claim more isolation or correctness than the tests prove.

Do not stop after creating a plan. Implement the changes, review your own diff as a security-focused senior software engineer, fix issues discovered during review, and only then report the final evidence.
