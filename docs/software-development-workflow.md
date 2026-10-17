# Local software-development workflow

The `software-development` workflow uses four sequential Codex CLI agents:

1. Software Architect: inspect the request and plan behavioral acceptance tests.
2. Implementation Engineer: reproduce failures, implement changes, and run focused checks.
3. Independent Verification Engineer: inspect the complete diff and verify acceptance criteria.
4. Review and Repair Engineer: repair remaining findings and rerun required checks.

Open `/o/dev/org?workflowId=software-development` in Studio. Supply a task description or a JSON object naming the repository, requested changes, acceptance criteria, and an accessible intake file. The workflow's original input remains authoritative across handoffs. Agents save their detailed reports under `.local/software-development/` in the configured repository workspace.

The reusable repository package is `examples/workflows/software-development.local.json`; the current operator copy is `.local/software-development/workflow-package.json`. Use **Import package** in the browser to restore its workflow and agent records. The package contains no credentials. Its workspace path targets this local checkout; update the backend arguments and workspace policy before importing it for another repository. Agent handoffs are bounded, and the CLI uses medium reasoning effort to keep routine review runs within account limits. Each CLI agent has an explicit repository workspace, a restricted executable allowlist containing `codex`, and a Codex workspace sandbox. The planner and verifier are instructed to preserve product source; implementation and repair stages may edit it. Review the workspace policy before using another repository.

For development of the platform itself, run the execution server without file watching. Otherwise an agent's source edit can interrupt its own run:

```bash
# Terminal 1, from the repository root
pnpm build:types
pnpm --filter web dev

# Terminal 2, from apps/server
NODE_TLS_REJECT_UNAUTHORIZED=1 ORG_RLS=enforce AGENT_MAX_DURATION_MS=3600000 CLI_AGENT_MAX_OUTPUT_BYTES=4194304 \
  node --require ./scripts/require-punycode.cjs --import tsx src/index.ts
```

Restart the execution server after the run finishes to load changed server code. Verify saved run status, output, and events after restarting before claiming durable delivery. Use the run detail page for progress; a completed workflow alone does not prove that acceptance tests passed.

Tasks on the board may target this workflow directly. Run tasks sequentially when they share a working checkout. The initial repair intake is `.local/software-development/intake.json`, and tasks `repair-finding-6` through `repair-finding-13` track the reported authentication, SSRF, initiator authorization, RLS, detached persistence, deletion, audit concurrency, and budget settlement findings.

Agents must not reset the database, change credentials, stop Studio services, commit, push, or deploy unless the original task explicitly authorizes it. The verifier passes concrete findings to the repair stage using a successful result envelope with a `NEEDS_WORK` verdict; the final repair stage must return a blocked envelope if defects or required checks remain unresolved.

Use one active repair task per shared checkout. For this initial batch, mounted authentication and RLS authorization are prerequisites for meaningful API checks; detached persistence and tenant-scoped budget recovery must be reviewed together; deletion depends on reliable revocation and durable execution cleanup. HTTP destination protection and broker audit allocation have more independent implementations, but run them sequentially here to keep edits and verification attributable. Parallel repair requires isolated checkouts and isolated test data, followed by integration verification.

Board status describes each card's actual lifecycle. A shared batch run belongs in task metadata and descriptions; it does not mean every associated card has a running worker. Keep implemented findings in review until their acceptance checks finish.
