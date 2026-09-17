# Real-world readiness validation — 2026-09-17

## Decision

**GO for controlled real projects and tasks on the validated self-hosted stack.**

The application passed its complete automated suite, browser lifecycle scenarios, PostgreSQL persistence checks, load checks, and Docker worker-isolation smoke tests. External paid/provider-backed agent execution was intentionally not invoked, so provider credentials, quotas, model behavior, and third-party outages remain a deployment-specific release gate rather than a proven result of this validation.

## Independent evidence

- `pnpm test --runInBand`: **36/36 suites, 326/326 tests passed** against the local PostgreSQL test database and real local child processes.
- `pnpm --dir apps/web test:e2e`: **4/4 Playwright Chrome scenarios passed**.
- `pnpm -r --if-present build`: packages/types, server, and web production builds passed.
- `pnpm --filter web lint`: passed with no errors or warnings.
- `pnpm exec ts-node --transpile-only infrastructure/docker/verification-load-smoke.ts --scenario all`: **6/6 checks passed, 0 failed, 0 blocked**.
- `git diff --check`: passed.
- Persisted PostgreSQL workflow `pisa-organization-workflow`: **21 nodes, 24 edges, 0 validation issues, 10 referenced agents, 2 referenced tools, compiler success, output inputMode `last_value`**.
- Live boundary checks: `/health` returned 200; unauthenticated Studio API returned 401; unauthenticated `/org` redirected to login.

## Browser scenarios exercised

1. Registration creates an authenticated session with user id, tenant id, and email.
2. Sign-out invalidates access; protected routes redirect to login.
3. Invalid credentials are rejected and valid credentials sign the user back in.
4. Agent create, configuration save, reload persistence, duplicate, and delete.
5. Workflow create, edit, validation, rename, save, and reload persistence.
6. Deterministic local workflow failure, failed timeline/detail, and retry behavior.
7. Successful workflow run, manual approval, completion timeline, and reload persistence.

## Runtime, persistence, and isolation scenarios exercised

- Workflow validation and compilation, fan-out/fan-in, conditional branches, bounded loops, retry/failure, full-run cancellation, branch cancellation, approval approve/reject/timeout, SSE replay, and payload/event bounds.
- Worker completion, non-zero exit, timeout, cancellation, output limit, environment filtering, workspace path/symlink protection, and cleanup.
- PostgreSQL migrations, registration/login, ownership, tenant isolation, memory CRUD/search/transaction/concurrency, run/task persistence, and reconstruction after restart.
- 80-node DAG compilation; 32 concurrent SSE subscribers; 24 runs × 200 events; bounded retention with terminal-event preservation.
- Docker worker image: non-root user, writable private home, read-only root, read-only/read-write workspace policies, network disabled, and cleanup after failure.

## Defects fixed during validation

1. Tool testing could authorize the saved registry record and then execute browser-supplied configuration. The registry record is now authoritative; unsaved ids return 404 and the web client sends only `toolId`.
2. `branch.skipped`/`branch.cancelled` lifecycle events could be downgraded to generic log events, hiding branch state from the timeline.
3. Several API tests accidentally invoked the real agent runtime with a mock key and leaked asynchronous work after Jest completed. Tests now use inert/deterministic runtimes and drain active work.
4. Credential login sessions omitted the database email/display name.
5. Concurrent workflow loads could race and let a stale response overwrite the newer workflow state.
6. Playwright could collide with occupied development ports or start a local web server at a different address from `E2E_BASE_URL`.
7. Timeline selection, dashboard preview, internal navigation, memory-token initialization, and generated-report linting caused React/Next lint failures. The lint gate now passes cleanly.

## Remaining release gates and non-blocking warnings

- No real OpenAI, Anthropic, Gemini, Codex, or Claude provider request was made. Run one explicitly approved disposable-project canary per configured provider before enabling it for production users.
- The E2E suite creates uniquely named local test users/workflows/tools/runs in PostgreSQL; use a dedicated test database or periodic retention cleanup in CI.
- Next.js reports that the `middleware` convention is deprecated in favor of `proxy`; schedule the migration before a future Next major upgrade.
- React Flow warns when attribution is hidden unless the deployment has the appropriate Pro entitlement; confirm license/configuration before public deployment.

## Readiness boundary

Within the validated boundary—local/self-hosted web and API, PostgreSQL, deterministic tools, workflow runtime, and the isolated Docker worker image—the application is ready for real project/task use. Provider-backed behavior becomes ready only after the deployment-specific canary above passes with the actual credentials, model, quota, and network policy intended for production.
