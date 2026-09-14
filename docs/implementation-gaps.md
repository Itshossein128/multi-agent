# Remaining implementation gaps

Audit date: 2026-09-14. Detailed classification and verification gates are in [`../implementation_plan.md`](../implementation_plan.md). This file records what still remains after the Phase 4/5 hardening pass; it does not treat modeled types or skipped infrastructure checks as completed behavior.

## Closed in this pass

- Node-scoped retry is bounded and opt-in. Only non-CLI agents without assigned tools and explicitly idempotent read-only tools are eligible. Attempts/backoff are capped by server policy, cancellation interrupts backoff, and `node.failed`/`node.retrying` events include attempt metadata.
- Parallel work is limited by a cancellation-aware server semaphore. Fan-in receives a merge-safe map of predecessor results. A separate workflow-step ceiling bounds cycles in addition to LangGraph recursion limits.
- Server validation now rejects unknown node types, unsafe identifiers/positions/configs, invalid connection directions, invalid approval branch names, unsupported tool categories/impact, unsafe retry policies, and missing/disabled agent tool assignments.
- Compiler lifecycle events retain their public `RunEvent` types through persistence instead of being downgraded to `log`.
- Run/event/agent/tool payloads have explicit byte ceilings and truncation markers. Stored and subscriber-delivered events share the same redacted payload; URL credentials/query secrets, cookies, sessions, authorization values, stacks, and credential-shaped keys are sanitized.
- Browser timeline retention and server event counts are bounded. A terminal run event is retained after the diagnostic event ceiling is reached.
- API and local model adapters preserve provider-reported usage and finish metadata. Unknown cost remains unknown; it is never synthesized.
- Run creation and agent tests execute principal-scoped registry records, not modified client copies with merely matching IDs. Whole-run retry updates linked task state/run identity and clears stale terminal data.
- An opt-in Docker worker profile adds an isolation-oriented execution boundary: digest-pinned image, no network by default, read-only root, dropped capabilities, no-new-privileges, non-root user, PID/CPU/memory limits, bounded tmpfs, explicit workspace mount mode, cancellation, and cleanup. Its effective isolation still depends on the deployment's Docker daemon and host policy.
- Playwright covers authenticated browser registration, a real function-tool workflow, live timeline, human approval, completion, and historical reload using the running web/server/PostgreSQL stack.

## Deliberate limitations

- Branch-only cancellation is not implemented. A LangGraph run currently owns one abort signal; selective cancellation needs scheduler-level branch identities and cleanup semantics. Whole-run cancellation is supported.
- `database`, `search`, `file`, `mcp`, `cli`, and `custom` tool categories remain fail-closed. Function and configured HTTP tools are the executable categories.
- The local-process CLI worker is for trusted execution and is not an isolation boundary. Use `CLI_WORKER_MODE=container` for untrusted CLI agents.
- Provider cost is recorded only if a future provider integration supplies authoritative cost. Token usage alone is not converted to money.
- The browser E2E covers the highest-risk run/timeline/approval/reload path. UI-driven task creation, provider failure, cancellation, and cross-browser coverage remain follow-up scenarios.
- Performance/load testing for very large graphs, many SSE subscribers, long-running loops, and durable event retention remains outstanding.
- Legacy Langfuse integration cleanup and evaluation/dataset features remain outside this Phase 4/5 hardening scope.

## Next verification work

1. Run the full Jest suite and production builds on every supported CI platform.
2. Run the container worker against the deployment's digest-pinned CLI image; the unit contract does not prove Docker daemon policy.
3. Extend Playwright with failure/cancel/task flows and a second browser engine where deployment support requires it.
4. Add load/leak budgets for SSE fan-out, event persistence, and maximum-sized workflows.
