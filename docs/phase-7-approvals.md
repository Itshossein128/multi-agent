# Human-in-the-loop approvals

A Human Approval node in the Graph Editor now pauses a real workflow run, surfaces the pending decision on the run detail page, and resumes execution exactly where it left off once a human approves or rejects.

## Mechanism

Approval nodes are compiled using LangGraph's dynamic `interrupt()` (`apps/server/src/compiler/workflowCompiler.ts`): the node function calls `interrupt({ nodeId, message, approvalType, timeoutSeconds, context })`, which pauses the graph. `RunExecutor` (`apps/server/src/runtime/runExecutor.ts`) watches the `streamEvents` output for the `{ method: "updates", params: { node: "__interrupt__" } }` chunk this produces, records an `ApprovalRequest`, appends a `human_approval.requested` event, and sets the run to `waiting_for_human`.

Resolving an approval (`POST /runs/:runId/approvals/:approvalId/resolve`) recompiles the workflow and resumes with `compiled.graph.streamEvents(new Command({ resume: decision }), { configurable: { thread_id: runId } })`. `interrupt()` returns the resume value inside the node function, which becomes the node's `branch` (for conditional routing) and `lastValue` (for downstream nodes).

**This requires the same checkpointer instance across the initial run and the resume.** `RunExecutor` creates one `MemorySaver` per run and retains it (`checkpointers: Map<runId, BaseCheckpointSaver>`) alongside the workflow/agents needed to recompile (`pausedContext: Map<runId, {...}>`) — both are cleared once the run reaches a terminal state.

## Branching

An approval node can have conditional outgoing edges, exactly like a Condition node, using the fixed branch-key vocabulary `"approved"` / `"rejected"`:

```text
Human Approval
    ├── approved → Deploy Agent
    └── rejected → Revision Agent
```

The compiler wires `addConditionalEdges` for any `condition`- or `approval`-type node **that has at least one outgoing conditional edge**; a plain (non-conditional) edge out of an approval node still routes as a normal single-path gate. The Graph Editor's edge properties panel offers the two fixed branch keys as a dropdown when the edge's source is an approval node (`PropertiesPanel.tsx`), and `validation.ts` warns if a conditional edge from an approval node uses any other branch key.

## Timeout auto-approve

`approvalType: "timeout"` (set on the node in the Graph Editor) auto-resolves the approval as `"approved"` after `timeoutSeconds`, unless a human resolves it first — matching the existing "Timeout — auto-approve after" UI copy. This is a `setTimeout` scheduled when the request is created and cleared on manual resolution; it does not survive a server restart (see limits below).

## Approval states

`ApprovalStatus` is `"requested" | "approved" | "rejected" | "expired" | "cancelled"` (`packages/types/src/approval.ts`). This implementation actively produces `requested`, `approved`, `rejected` (manual or auto-timeout), and `cancelled` (when the run is cancelled while waiting). `"expired"` is reserved for a future manual-approval expiry policy and is not produced yet.

## UI

The run detail page (`/runs/[runId]`) renders `ApprovalPanel` above the timeline whenever the run has a pending (`status: "requested"`) approval — message, JSON context, an optional response field, and Approve/Reject buttons calling `runService.resolveApproval`. `useRunStore` patches `run.status` to `waiting_for_human`/`running` locally on `human_approval.requested`/`resolved` SSE events (the store's `Run` snapshot is otherwise fetched once) and refetches the approval list on the same events.

## Existing platform limits

- Everything is in-memory (`RunStore`/`RunExecutor`, same as every other run today) — a server restart loses pending approvals and their timers, same as any other in-flight run. Durable persistence is Phase 9.
- The Dashboard (`apps/web/src/lib/runtimeTracker.ts`) and Task Board are pre-existing mock/legacy surfaces not wired to the real execution server at all — they do not show pending approvals. Only the Run detail page (real, SSE-backed) does.
- `LangGraphEventAdapter`'s `"tasks"`-derived `node.completed` events don't carry a `nodeId` (a pre-existing gap, not introduced by this phase) — the per-node `"updates"`-derived `log` events do, and are what the Timeline's node-status view actually relies on.

## Verification

`tests/humanApproval.test.ts` covers: pause → list → resolve → resume → completion; conditional branch routing on rejection; rejecting an already-resolved approval; timeout auto-approve; cancelling a run while waiting for human input.
