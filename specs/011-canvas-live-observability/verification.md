# Foundation and US1 verification (2026-11-04)

Initial checkpoint scope: T001-T016. See the US2/US3 continuation below for current progress.

- Setup: root `npx tsc --noEmit` passed after scaffolding.
- TDD: foundation first run failed 19 tests against stubs; subsequent foundation run passed all 19. US1 first run failed all three suites for the missing session prop/wiring and canvas link; implementation made all three pass.
- Regression: 9 suites / 42 tests passed, including timeline, workflow store and archetype editor. Existing archetype editor tests emitted React act warnings.
- Final feature/timeline check: 7 suites / 37 tests passed. Supplemental nested-completion projection regression also passed (18 projection tests).
- Root and web TypeScript checks passed. Targeted source ESLint passed.
- `pnpm --filter web build` passed (compilation, TypeScript, static generation and build traces).
- `git diff --check` passed.
- `.specify/extensions.yml` is absent; no pre/post implementation hooks registered.
- Existing ignore rules cover Node/TypeScript builds, dependencies, environment files, ESLint and Docker inputs. No ignore changes needed. Web package is private; no npm publishing ignore needed.

Behavior covered by automated tests: run start stays on the studio and caches its definition; enter/exit and URL mode; run retarget and late snapshot suppression; snapshot fallback; stream disposal; deep-link attachment; draft preservation; palette/properties and keyboard freeze; canvas drag/connect/delete callback guards; standalone run page/timeline and tenant-scoped canvas link.

At this initial checkpoint, live browser smoke was not run and status chrome, inspector, approvals and run tray were scaffolds as specified in T002.


## US2 and US3 continuation (2026-11-04)

US2/US3 checkpoint scope: T001-T029. This continuation implements T017-T029 (Phases 4 and 5). US4, US5 and polish remain unchecked.

- US2 TDD: the new chrome tests failed against the previous UI, then all four projection/chrome/canvas suites passed (28 tests).
- US3 TDD: four view-model tests failed against the stub and inspector tests failed for its missing props; both suites passed after implementation.
- Combined regression: 12 suites / 57 tests passed, covering projection, all seven node types, normal/conditional edges, canvas identity under stream updates, inspector node-scoped subscription, editor click/close integration, session lifecycle, toolbar, standalone page, timeline and workflow store.
- Additional null-evidence regression failed first, then passed after preserving explicit null tool arguments/results; final targeted check passed 3 suites / 9 tests.
- Root `npx tsc --noEmit`, web `tsc --noEmit`, targeted source ESLint and `git diff --check` passed.
- Production `pnpm --filter web build` passed. Subsequent null-evidence and focus-restoration refinements passed web typecheck/lint and the targeted regression above.
- No `.specify/extensions.yml` exists; no pre/post implementation hooks registered. Existing ignore rules remain sufficient.

US2 now projects lifecycle events and pending approvals to node status rings, icons and explicit labels (idle/running/waiting_human/completed/failed/skipped). Condition nodes retain their branch handles. Traversed edges glow and animate with distinct conditional styling. CSS honors reduced motion. A shallow status-event subscription preserves React Flow node/edge identities for stream-only updates.

US3 opens a modeless side inspector from Live node clicks, without changing draft selection/history or replacing the canvas. It shows recorded inputs, start/retry counts, step/timing, published output/thoughts, invocation-correlated tool arguments/results/errors, result envelopes and contract diagnostics. Only selected-node or explicitly associated parent/keyed state events trigger inspector stream updates. Missing evidence is explicitly labeled unavailable; client code does not infer exact inputs/results from unrelated run data.

Live browser smoke and performance measurements were not run. Backend events sometimes omit exact input/result evidence; the inspector displays it when present. Approval actions and run tray controls remain for US4/US5.


## Remaining tasks: US4, US5 and polish (2026-11-04)

The remaining T030-T046 implementation was divided among three parallel subagents: approval/clarification controls, tray/model controls, and graph coalescing/operator documentation. The primary agent integrated the editor, reviewed cross-component behavior, added real-browser coverage and recorded this evidence.

- US4 red-to-green: pending/resolved requests, allowed decisions and notes, duplicate/in-flight blocking, stale clarification packages and permission restrictions. Existing gap-review modal is reused. Structured resume questions use the existing clarification API; task-scoped follow-up packages retain their task workflow.
- US5 red-to-green: all run statuses, budget default1000, elapsed timer/terminal freeze, event filters, collapse, Cancel/Retry, duplicate requests and retarget recovery. Server responses/events remain the authority for outcomes.
- T042: fixed32ms graph lifecycle commit window, immediate attachment changes, timer/subscription cleanup and separate node-scoped inspector subscription; burst fixtures prove the deadline cannot be extended indefinitely.
- T043: operator guidance added to `docs/development.md`.
- Browser-discovered loading race: Run is now disabled while the requested definition loads; regression failed first and passed after the guard.
- Browser-discovered retry boundary: valid empty agent snapshots now support tool-only workflows; missing snapshots and required agent references still fail closed. A real runtime regression failed first, then completed failure/retry/success with preserved input/tools/provenance.
- Integration refinements: attachment-generation and latest-response guards prevent stale approvals after exit/retarget/reopen; explicit and SSE approval refreshes share ordering; load replays lifecycle evidence while preserving terminal precedence; resolved clarification banners disappear.

Before the final permission-capability refinement: combined regression passed18 suites /111 tests with one existing PostgreSQL-dependent case skipped; root/server/web typechecks, targeted lint, production web build and whitespace checks passed. Both installed-Chrome browser journeys passed against actual local authenticated web/execution services and real SSE, including console/page-error assertions. Final validation is recorded below.

### Browser smoke A-G

See `pr-description.md` for the completed review checklist. Maintained browser tests are `apps/web/e2e/studio-run.spec.ts` (Run/inspect/review/approve/reload/bookmark/Exit and Cancel/failure/Retry). A separate manually inspected four-node conditional workflow completed with three traversed edges: two normal indigo and one conditional purple; all four nodes completed, with no page errors or failed execution requests. Screenshots are local test artifacts, not tracked application files.

The Chrome MCP connection was unavailable because its profile was occupied. Installed Chrome was launched in isolated Playwright contexts; no existing browser was closed. Dedicated local test accounts/organizations were created. No external LLM provider was used. Missing input/result event evidence remains explicitly unavailable. Production continuous-stream FPS and operator-survey percentages were not measured.


### Final validation and completion

All T001-T046 are complete and checked in tasks.md. Requirements checklist remains16/16 checked and unmodified.

- Final combined regression: **22 suites passed;147 tests passed;4 existing optional PostgreSQL tests skipped** (151 total). This includes all feature suites, runtime contract/retry regressions, approval capabilities, ownership authorization and clarification response integration. The skipped cases require `MEMORY_TEST_DATABASE_URL`.
- Final installed-Chrome browser journeys: **2 passed** against `E2E_BASE_URL=http://localhost:3060`, using `pnpm --filter web exec playwright test e2e/studio-run.spec.ts --reporter=list`. Run-to-canvas, node inspection, review notes/approval, reload/deep links, standalone bookmark, Exit, collapse/filter, Cancel and Retry to a different run were exercised. Console/page errors were captured and asserted empty after test setup; the Cancel/Retry journey also asserted no failed execution HTTP requests.
- `npx tsc --noEmit`, `pnpm --filter server exec tsc --noEmit`, `pnpm --filter web exec tsc --noEmit`: passed.
- Targeted ESLint on changed web source and `git diff --check`: passed.
- `pnpm --filter web build`: passed compilation, TypeScript, page generation and build tracing.
- Final pre/post-hook check: `.specify/extensions.yml` absent; no implementation hooks registered.
- Existing ignore rules verified; no dependency, publishing or ignore-file changes needed.

Reviewer capabilities now come from response-only hints on the existing approvals read API. They are computed for the authenticated principal using existing run-write access, explicit execute permissions (when present), and approval role/decision policy, including trusted membership approval-role overrides. Stored/untrusted hint fields are overwritten in response copies; write authorization never consumes them. A legacy ownership fixture was corrected to assert missing-membership denial before seeding an active reviewer membership and expecting success.

Evidence: `.local/canvas-live-smoke/final-regression.log`, maintained browser test in `apps/web/e2e/studio-run.spec.ts`, screenshots under `.local/canvas-live-smoke/` and `apps/web/test-results/`. `pr-description.md` records the review-ready change description and A-G smoke checklist; no remote PR was created.
