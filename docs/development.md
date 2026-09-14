# Development and runtime safety

## Local verification

Use Node 20+ and pnpm 10.17.0.

```bash
pnpm install --frozen-lockfile
pnpm test -- --runInBand
pnpm --filter server build
pnpm --filter web build
```

## Runtime guardrails

The server validates every workflow before creating a run. Validation results use stable codes such as `INVALID_EDGE_REFERENCE`, `UNSAFE_CYCLE`, and `MISSING_AGENT_CONFIG`; the editor may show them early, but server validation is authoritative.

Server-owned limits are configured only through environment variables:

- `WORKFLOW_MAX_NODES` (default `100`)
- `WORKFLOW_MAX_EDGES` (default `250`)
- `WORKFLOW_MAX_BRANCHES` (default `25`)
- `WORKFLOW_RECURSION_LIMIT` (default `100`)
- `WORKFLOW_MAX_STEPS` (default `1000`; includes retry attempts)
- `WORKFLOW_MAX_CONCURRENT_BRANCHES` (default `8`)
- `NODE_RETRY_MAX_ATTEMPTS` (default `3`) and `NODE_RETRY_MAX_BACKOFF_MS` (default `30000`)
- `RUN_MAX_DURATION_MS` (default `900000`)
- `RUN_MAX_EVENTS` (default `10000`), `RUN_EVENT_MAX_PAYLOAD_BYTES` (default `65536`), and `RUN_MAX_PAYLOAD_BYTES` (default `262144`)
- `AGENT_MAX_DURATION_MS` (default `120000`; bounds API-backed model calls through cancellation)
- `AGENT_MAX_OUTPUT_BYTES` (default `262144`)
- `TOOL_MAX_DURATION_MS` (default `30000`), `TOOL_MAX_OUTPUT_BYTES` (default `262144`), and `TOOL_ALLOW_SIDE_EFFECTS` (default `false`)

Run input is capped at 1 MiB. Runtime events, logs, and telemetry pass through redaction before they are persisted or sent to external observability services. Never put credentials in workflows, agent records, tool configuration, or run input.

Node retry is configured with `WorkflowNode.retryPolicy`, but configuration is not permission. The server rejects retries for CLI agents, agents with assigned tools, non-read-only tools, and tools without `metadata.idempotent: true`.

## CLI worker profiles

`CLI_WORKER_MODE=local` (the default) launches a policy-constrained child process and is suitable only for trusted code. It is not an OS security boundary.

For untrusted work use `CLI_WORKER_MODE=container` and set `CLI_WORKER_IMAGE` to a digest-pinned image (`image@sha256:...`). The container profile defaults to no network, a read-only root filesystem, dropped capabilities, no-new-privileges, non-root execution, and resource limits. Relevant settings are `CLI_WORKER_ALLOW_NETWORK`, `CLI_WORKER_DOCKER_EXECUTABLE`, `CLI_WORKER_MEMORY`, `CLI_WORKER_CPUS`, `CLI_WORKER_PIDS_LIMIT`, and `CLI_WORKER_USER`. Per-agent filesystem/network settings can further restrict execution but cannot widen server policy.

Build, smoke-test, publish, and configure the dedicated Codex/Claude worker by following [Immutable CLI worker image](cli-worker-image.md). Authentication is intentionally separate from the image.

CLI launch credentials use a server-only resolver and never belong in workflows, agents, tools, run input, or `WorkerSpec.env`. Two development adapters exist and are disabled by default:

- File delivery (`CLI_CREDENTIAL_FILE_ENABLED=true`) resolves provider credential files on the server and injects only the allowlisted unit into the per-run worker tmpfs:
  - Codex: `auth.json` → `/home/worker/.codex/auth.json` (source `CLI_CODEX_AUTH_FILE` or `~/.codex/auth.json`)
  - Claude Code: `.credentials.json` → `/home/worker/.claude/.credentials.json` (source `CLI_CLAUDE_CREDENTIALS_FILE` or `~/.claude/.credentials.json`). The resolver fail-closes when OAuth access/refresh material is empty or the refresh token is expired.
  Refreshed bytes may write back under an exclusive lock with compare-and-swap. Host credential paths are never exposed to the container. Host `.codex` / `.claude` directories are never mounted.
- Environment delivery (`CLI_CREDENTIAL_ENVIRONMENT_ENABLED=true`) accepts only a provider-constrained variable name through `CLI_CODEX_CREDENTIAL_ENV_VAR` or `CLI_CLAUDE_CREDENTIAL_ENV_VAR`; `WORKER_ALLOWED_ENV_KEYS` is not a container credential channel. Environment delivery exposes a credential to the CLI process and to Docker daemon/container inspection.

File delivery takes precedence when both are enabled. Container workers set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0` because Claude Code 2.1.270 requires bubblewrap for scrubbing and this worker image does not include it; the hardened Docker profile remains the isolation boundary. Neither adapter is the final production multi-tenant boundary. Prefer short-lived tokens or an external credential-injecting gateway for production.

## Browser E2E

With PostgreSQL migrations applied and the normal web/server environment configured:

```bash
pnpm --filter web test:e2e
```

The Playwright configuration reuses running services or starts them, uses installed Chrome, creates an isolated tenant through the real registration UI, and verifies run/timeline/approval/history behavior.

## Operational correlation

Structured runtime metadata uses `runId`, `workflowId`, `taskId`, `nodeId`, and `agentId` when available. Langfuse is optional: a missing or failing observability exporter cannot fail a workflow.
