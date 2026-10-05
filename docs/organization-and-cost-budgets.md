# Organization goals and cost budgets

## Organization

Open **Goals** in the app, or use `/studio/organization` on the execution server.
Assign exactly one CEO agent, then managers and members. Reporting cycles are rejected.
Company goals can have parent goals, a project, and an owner agent. An approved active
goal can be delegated into a task; the task keeps `organizationGoalId` in its metadata,
so the goal view shows its progress and output.

For an agent-authored strategy proposal, configure a CEO agent and choose **CEO strategy
proposal** when creating a goal. This creates a proposed goal and assigns a strategy
task to the CEO agent. Review the CEO task output in the goal view, then approve the
goal before delegating implementation tasks. A strategy proposal cannot be approved
until the CEO task completes with a nonempty output.

All organization records are scoped to a tenant. The organization and budget UI use
the authenticated execution proxy; direct server endpoints require a trusted principal.
PostgreSQL deployments require studio migrations through 016; run `pnpm db:migrate`
before starting the server. Local development can use the in-memory adapters.

## Monthly budgets

Open **Budgets**, or use `GET /studio/budgets` and `PUT /studio/budgets` with:

```json
{ "scope": "company", "limitUsd": 25, "thresholdPercent": 80 }
```

Agent and project scopes also require `scopeId`. Each agent invocation checks the
company cap, its agent cap, and the linked task's project caps. The check reserves
`BUDGET_RUN_RESERVATION_USD` (default `1`) before invoking the provider, using row
locks in PostgreSQL so concurrent workers observe the same remaining balance. A
denied invocation fails with `BUDGET_EXCEEDED` before calling the provider. The
reservation is settled after invocation, and unfinished reservations from terminal
runs are reconciled at startup. Alerts are recorded when spending crosses the
configured threshold or cap.

Set `MODEL_PRICING_USD_PER_MILLION_JSON` to a JSON object keyed by
`provider:model`, for example:

```json
{"openai:example-model":{"input":2,"output":8}}
```

Rates are USD per million input/output tokens. When an adapter omits usage or no
matching rate is configured, a budgeted invocation is conservatively charged its
full reservation. Without a configured budget, unknown costs are not invented.
The dashboard shows the configured company cap and marks estimated cost. External
providers may bill more than the reservation for a single invocation; choose a
reservation above the maximum expected call cost when strict financial exposure
matters. Project caps apply to task-linked runs; direct runs without an authoritative
project association use company and agent caps.
