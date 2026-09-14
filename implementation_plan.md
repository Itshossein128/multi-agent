# Remaining Phase 4/5 hardening implementation plan

Date: 2026-09-14

This matrix is based on the repository source, current documentation, and the focused Phase 4/5 baseline test run (9 suites passed, 72 tests passed, 3 infrastructure-dependent tests skipped).

| Area | Baseline classification | Evidence / gap | Planned disposition |
|---|---|---|---|
| Dynamic workflow compilation and lifecycle events | Implemented and verified | LangGraph nodes, conditional routing, approvals, and stable run/node/edge events are covered by focused tests. | Preserve behavior and extend event metadata for bounded retries and steps. |
| Whole-run retry and immutable snapshots | Implemented and verified | `RunExecutor.retry` starts a new run from persisted workflow/agent/tool snapshots. | Keep separate from node retry; add regression coverage for task linkage. |
| Node-scoped retry | Not implemented | `node.retrying` exists in the public event vocabulary, but node execution has no bounded retry policy or abortable backoff. | Add a typed per-node policy, server-owned ceilings, conservative idempotency eligibility, abortable exponential backoff, and attempt-aware events/tests. |
| Parallel fan-out/fan-in | Implemented but incomplete | Parallel branches execute, but the single `lastValue` reducer can discard one branch at a join and there is no live concurrency limit. | Add a merge-safe per-node result map and a cancellation-aware execution semaphore. |
| Cycles and loops | Implemented but incomplete | Back-edges compile and LangGraph recursion limits execution; iteration/step progress is not independently observable or budgeted. | Add a server-owned workflow step ceiling and step metadata/events. Keep graph recursion as a second bound. |
| Branch-only cancellation | Out of scope for the current LangGraph invocation contract | A run currently has one abort signal; selectively stopping one already-running branch would require a scheduler-level branch identity/cancellation protocol. | Do not claim support. Preserve whole-run cancellation and document this limitation. |
| Authoritative workflow validation | Implemented but incomplete | Structural checks exist, but unknown types, identifier grammar, node-specific shapes, edge compatibility, approval vocabulary, supported tool categories, and agent tool assignments need stricter checks. | Harden the shared server validation boundary and add negative tests. |
| Tool/agent/event resource bounds | Implemented but incomplete | CLI output is bounded and event payloads are recursively redacted, but generic event payload byte size and API/local/tool output are not uniformly bounded. | Add central JSON-safe byte bounding at persistence and runtime output boundaries; cap client timeline retention. |
| Secret/error redaction | Implemented but incomplete | Credential-shaped keys and stack-like fields are redacted; URL credentials/query secrets, nested causes, and headers need explicit regression coverage. | Strengthen the central sanitizer and test stored/subscriber payloads. |
| Provider usage and observability | Implemented but incomplete | Lifecycle telemetry exists, but model adapters do not consistently propagate token/finish metadata and cost is not reliably available. | Propagate provider-reported usage and finish metadata when supplied; never synthesize cost. Document unavailable cost as a limitation. |
| Task/run consistency | Implemented but needs regression proof | Task start/retry clears stale fields and assigns the new run, with terminal reconciliation and an event-loss-window check. | Add tests proving retry count, new run linkage, and stale output/error clearing. |
| Authorization and tenant ownership | Implemented and verified, audit required | Principal-scoped stores and ownership tests exist. Some service calls need review for defense-in-depth consistency. | Audit all run/studio read/write paths and add cross-tenant negative tests where missing. |
| Browser E2E | Not implemented | Operational integration tests exercise routers/runtime, but there is no real-browser workflow editor/run/timeline/approval suite. | Add Playwright configuration and high-value browser scenarios if the local authenticated app can be deterministically bootstrapped; otherwise record the exact environment blocker and do not relabel integration tests as browser E2E. |
| Hardened worker isolation | Partially implemented | The local worker has executable/workspace/env/output/time controls and cleanup, but it is not an OS/container security boundary. | Add a fail-closed hardened container worker profile plus contract tests where Docker is optional; retain local runtime only for trusted execution and document guarantees. |
| Documentation claims | Inconsistent | Roadmap/checklist/report contain older completion claims that do not match the remaining hardening gaps. | Update the gap register, roadmap/checklist, verification report, and runtime/worker operational guidance after verification. |

## Verification gates

1. Focused compiler/runtime/validation/redaction/task/authorization tests.
2. Server and web type-checks.
3. Full test suite, recording any environment-dependent skips separately from failures.
4. Production build.
5. Browser E2E and hardened-worker smoke test only when their declared external prerequisites are available.

Completion claims will distinguish implemented-and-tested behavior from explicit limitations. Existing passing behavior will not be weakened to satisfy a checklist item.
