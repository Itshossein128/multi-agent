# Keep workflow execution and inspection on the Studio canvas

Starting a workflow now keeps the operator on `/o/{orgSlug}/org` in read-only Live mode instead of redirecting to the standalone run page. The same mounted React Flow canvas shows run topology, lifecycle status, traversed edges, node execution evidence, human review, and run controls. Exit Live restores the draft; copied `workflowId`/`runId` URLs reattach, and standalone bookmarks remain usable.

The approval banner reuses existing decision/gap-report controls and authenticated clarification APIs, with server-calculated reviewer capabilities (including custom membership role overrides) and duplicate/stale-request guards. Capability hints are response-only; the existing server checks still authorize every write. The tray shows authoritative status/connection health, elapsed time and step budget, filters events, and requests Cancel/Retry through existing APIs. Retry attaches the new run ID. Graph lifecycle updates coalesce over a fixed 32ms window while inspector streams stay node-scoped.

Validation also corrected a Run-before-workflow-load race and a pre-existing retry guard that rejected valid empty agent snapshots in tool-only workflows. Missing snapshots and required agent links still fail closed.

## Browser smoke (quickstart A-G)

Executed against the running local web/execution stack with newly registered test accounts and dedicated test organizations, real authenticated APIs and real SSE; no mocked run outcomes or external model providers.

| Scenario | Result |
|---|---|
| A: Run remains on canvas; Exit restores Design | PASS |
| B: lifecycle statuses and traversed paths | PASS: completed/approval/failed states in Chrome; separate condition workflow showed distinct normal/conditional taken edges |
| C: node inspector opens/closes alongside canvas | PASS: tool evidence visible; same canvas DOM element retained |
| D: existing run deep link/reload | PASS |
| E: standalone bookmark and Open on canvas | PASS |
| F: approve with review notes; run resumes without reload | PASS: existing remediation modal |
| G: collapse/filter, Cancel, Retry to a different run | PASS |

Browser coverage is maintained in `apps/web/e2e/studio-run.spec.ts`. A separate manually inspected conditional-workflow screenshot is `.local/canvas-live-smoke/branch-completed.png`; its page had no JavaScript errors or failed execution requests. Chrome MCP could not acquire its occupied profile, so isolated installed Chrome was driven with Playwright without closing the existing browser.

Structured clarification, reject decisions, viewer restrictions, stale responses, explicit skipped states, retry boundaries and burst/coalescing behavior have unit/component/integration coverage. The browser review did not measure production streaming FPS or collect operator surveys. Inputs/results absent from backend events remain labeled unavailable. Existing task-scoped clarification follow-ups retain the task workflow; the run endpoint supports resume submissions.

## Automated validation

**22 regression suites passed (147 tests;4 optional PostgreSQL cases skipped), and both real Chrome journeys passed.** Final commands and counts are recorded in `verification.md`. Production web compilation, root/web/server typechecks, targeted lint and whitespace checks are included. The existing optional PostgreSQL persistence test is skipped when `MEMORY_TEST_DATABASE_URL` is absent.
