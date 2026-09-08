# Agent detail page

Open an agent using **Details** in the Graph Editor palette or `/org/agents/<agentId>`.

The page reuses `AgentRecord`, `AgentBackend`, `AgentExecutionPolicy`, `Run` and `RunEvent` from the shared types package. Configuration is saved through `workflowService`; React Query owns loaded data and mutations, while the form maintains its own editable draft. The page never imports LangGraph or executor implementations.

## Configuration and navigation

General configuration, API/CLI/local backend fields, execution policy and tool ID assignments can be edited. Switching backend type asks before resetting incompatible fields and preserves the policy. Risky filesystem/shell choices require confirmation. The runtime does not yet fully enforce the policy, which is stated in the form.

Edits remain pending until Save succeeds. Storage failures are surfaced and keep the draft intact. Page actions and browser reload/close protect unsaved changes; browser history navigation within the SPA is not globally intercepted. Deletion is blocked while any saved workflow references the agent, with instructions to remove the nodes and save first.

Workflow usages distinguish agent IDs from node instance IDs. `Open in Graph` uses `/org?workflowId=<id>&focusNode=<nodeId>`; the editor resolves that navigation after loading its saved workflow. Each repeated agent node is listed separately.

## Execution inspection

The execution server exposes `GET /runs?agentId=<id>` and `GET /runs/<runId>/history?agentId=<id>`. History includes the agent's normalized events plus un-attributed events on its related nodes, excluding events attributed to another agent. The run and agent pages share `ExecutionTimeline` and its selectable event detail panel.

Executor payloads are sanitized at the run store boundary before both history and subscriber delivery. Credential-like legacy configuration fields are removed before agent data enters query/form state. No credential input or browser-side availability probe is introduced.

## Existing platform limits

- Agents and one saved workflow still use the existing browser-local persistence service. No parallel storage was added.
- Runs/events are real but retained only in execution server memory; restart clears history. Refresh is explicit on the detail page.
- Backend diagnostics/authentication status has no endpoint, so health is Unknown. Agent status is labeled as last observed event status and is separate from backend health.
- The model has no agent-level memory settings or session mode. Memory is described as workflow-level configuration, not inferred ownership of neighboring nodes.
- Tool descriptions are resolved from saved workflow tool nodes. There is no global Tool Detail route or per-agent tool enabled flag.
- CLI/local execution implementations are unchanged. There is no safe dedicated single-agent test endpoint, so no Test action is added.
- Recorded provider/model values are shown only when present in events. Complete backend/version snapshots are not persisted and are never inferred from current configuration.

## Verification

`tests/agentDetail.test.ts` covers configuration constraints, legacy credential filtering, run filtering, related-node event scope, missing-run responses, and sanitization before storage/subscriber delivery. Existing agent executor tests remain applicable. Tests resolve TypeScript before generated JavaScript siblings to avoid exercising stale compiled artifacts.
