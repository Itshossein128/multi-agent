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
- `RUN_MAX_DURATION_MS` (default `900000`)
- `AGENT_MAX_DURATION_MS` (default `120000`; bounds API-backed model calls through cancellation)
- `TOOL_MAX_DURATION_MS` (default `30000`) and `TOOL_ALLOW_SIDE_EFFECTS` (default `false`)

Run input is capped at 1 MiB. Runtime events, logs, and telemetry pass through redaction before they are persisted or sent to external observability services. Never put credentials in workflows, agent records, tool configuration, or run input.

## Operational correlation

Structured runtime metadata uses `runId`, `workflowId`, `taskId`, `nodeId`, and `agentId` when available. Langfuse is optional: a missing or failing observability exporter cannot fail a workflow.
