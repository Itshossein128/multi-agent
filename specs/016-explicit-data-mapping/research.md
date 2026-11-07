# Research: Explicit Step Data Mapping

**Feature Branch**: `016-explicit-data-mapping`  
**Date**: 2026-11-05  
**Status**: Completed  

---

## Executive Summary

Step input today is `valueForNode` in `apps/server/src/compiler/workflowCompiler.ts`: a single predecessor yields `state.lastValue`; two or more yield `{ branches }` keyed by source node id; `parallel_join` uses its own carrier. `nodeResults[node.id]` stores `result.output ?? result.lastValue`. Agent step text lives in `AgentNodeConfig.taskInstruction`. Approval copy lives in `ApprovalNodeConfig.message`. The Live inspector already renders `view.input` when an event payload includes `input`, but `node.started` does not send that field.

Canvas routing already uses React Flow `sourceHandle` for approval outcomes and condition branches (`edgeSemanticsFromSourceHandle`). Those handles must stay control-flow. `serializeWorkflowDefinition` copies a fixed field list and drops anything else, so new mapping data will not survive save/load unless serialization is extended. Schema version is capped at 2.

All design choices below are resolved. Nothing remains as NEEDS CLARIFICATION.

---

## Technical Decisions & Rationale

### Decision 1: Grammar and identity

#### Problem
The spec’s examples look like `{{input.customerQuery}}` and `{{nodes.triage_agent.output.category}}`. Canvas titles are not stable ids. Agent titles come from the shared agent record. Node ids look like `agent-<base36>-<base36>` and contain hyphens but not dots.

#### Alternatives Considered
1. **Store the display name inside the token** — Breaks when the agent is renamed and collides when two steps share a name. Fails FR-006.
2. **Quoted ids (`nodes["agent-ab"].output`)** — Unambiguous, but the picker would show syntax the spec does not use.
3. **`{{nodes.<exactNodeId>.output…}}` and `{{input…}}`, labels only in the picker** (Selected).

#### Decision
- A reference is recognized only when the inside of `{{` `}}` matches the grammar. Any other `{{ … }}` is left as literal text so prompts that mention braces do not fail.
- Roots are only `input` and `nodes`. Any other root (`env`, `credentials`, `secret`, `memory`) is `DATA_REF_FORBIDDEN`.
- Node identity is the exact `node.id` between `nodes.` and `.output`. Hyphens are part of the id. The following path is `.field` or `[index]`.
- `{{input}}` and `{{nodes.<id>.output}}` mean the whole value.
- Path after `output` or after `input`: at most 8 segments. Indexes are non-negative integers. Identifiers are `[A-Za-z_][A-Za-z0-9_]*`.
- The picker inserts this token and shows the canvas label. Duplicate labels get a short id suffix. Renaming a label does not rewrite tokens.

#### Rationale
Meets the spec examples, survives rename, and cannot see credentials because those stores are not roots.

---

### Decision 2: Where references apply

#### Problem
Some strings are addresses (`memory.key`, agent id, tool id). Interpolating them would let a value choose where data is written. Other strings are the text a person or model reads.

#### Alternatives Considered
1. **Interpolate every string on the node** — Turns keys and ids into data-dependent addresses.
2. **Interpolate only `taskInstruction` and `approval.message`, plus one optional primary-input binding** (Selected).

#### Decision
- Authored text, one pass, no expansion of values that came from data: `agent.config.taskInstruction`, `approval.config.message`.
- `WorkflowNode.dataMapping.inputBinding` is either absent or a single whole reference. When set, it replaces `valueForNode` as that node’s primary input.
- A data wire to the primary port (`context`, `input`, or `value`) is a second source for that same input. Both set → `DATA_WIRE_CONFLICT`.
- Agent `prompt` wire, when present, is the task instruction string for that run. It is data, not a template. `taskInstruction` templates apply only when `prompt` is unwired.
- Subgraph `inputMappings` / `outputMappings`, condition `valueField`, memory keys, and registry ids are not templates.
- Nodes with neither a binding, a data wire, nor a template keep `valueForNode` exactly.

#### Rationale
Covers the branch/join story (bind the primary input to one upstream field) and the prompt story (inline tokens) without a scripting language.

---

### Decision 3: Data wires are not control edges

#### Problem
`WorkflowEdge` is how the compiler decides what runs next and what `valueForNode` considers a predecessor. Approval handles already occupy `sourceHandle` values `approved`, `rejected`, and `needs_clarification`.

#### Alternatives Considered
1. **New `WorkflowEdge.kind = "data"`** — Every edge walk must be audited or data wires change execution order.
2. **Hide wires only inside node config** — Harder to draw, validate, and delete as connections.
3. **`definition.dataWires[]`, omitted when empty; React Flow edges derived from that list** (Selected).

#### Decision
- Control `edges` are unchanged.
- Handle ids for data ports are prefixed `data:` (`data:in:prompt`, `data:out:text`). `addEdge` creates a `DataWire` when the handle has that prefix and does not create a control edge.
- A data-wire source must already be a control-flow ancestor of the target. That keeps order and rejects cycles without a new topology engine.
- Deleting a node removes data wires that touch it, the same way control edges are removed. Template text that still names the id remains and fails validation as `DATA_REF_DANGLING`.
- v1 ports:
  - agent: inputs `prompt`, `context`; outputs `text`, `json`
  - tool: input `input`; outputs `text`, `json`
  - output: input `value`
  - memory: input `value`; output `value`
  - condition: input `value`
  - input: output `value`
- No data ports on `parallel_split`, `parallel_join`, `subgraph`, or as approval sources. Parallel results are selected with `{{nodes.<branchId>.output…}}` because `nodeResults` is already keyed by node id. Subgraph boundaries stay on feature 014 mappings. Approval keeps its three outcome handles only. An optional approval input `context` is allowed and does not add a source handle.
- No port is required until the designer lists it in `dataMapping.requiredInputs`.
- `text` is the string content of the producer result when one exists; `json` is the structured result when it is a non-array object. Wiring a port the producer did not fill fails that consumer at run time with the port name. There is no `error` port in v1: a failed step stays failed and is not turned into a data edge.

#### Rationale
FR-010 and FR-011 stay true because control edges and approval handles are untouched. Designers still see a wire on the canvas.

---

### Decision 4: Fail closed, with a size cap

#### Problem
The spec requires a named failure for a missing step, a non-upstream step, a missing field, an empty list index, and an oversized value. It forbids substituting `lastValue`.

#### Alternatives Considered
1. **Empty string on failure** — Silent data loss, which is the bug this feature exists to remove.
2. **Design-time-only checks** — Cannot see skipped branches or runtime shapes.
3. **Design-time structural checks plus runtime resolution** (Selected).

#### Decision
- Design time (server authoritative, web parity): syntax of recognized refs, dangling ids, non-ancestors, two sources for one input, unknown port ids, required inputs with no source.
- Run time: walk the path against `state.input` or `nodeResults[id]`. Missing field, empty index, or wrong shape → `DATA_REF_UNRESOLVED`. The message includes the raw reference. Do not fall back to `lastValue`.
- A skipped ancestor that never wrote `nodeResults` is `DATA_REF_UNRESOLVED` when a later step evaluates that reference.
- Resolved value and any interpolated string are capped at `DEFAULT_CONTRACT_PAYLOAD_BYTES` (256 KiB). Over the cap → `DATA_REF_TOO_LARGE`. No truncation into the executing step.
- If the producer’s `outputSchema` lists `properties` and the first field is not among them, design time reports `DATA_REF_UNKNOWN_FIELD`. With no schema, the field is checked at run time only.

#### Rationale
Matches SC-003 and the edge cases. The cap reuses a bound the execution path already knows.

---

### Decision 5: Live inspection

#### Problem
FR-012 / SC-005 need the operator to see the resolved input. `buildNodeExecutionView` already assigns `view.input` from `payload.input`. `node.started` currently sends type, attempt, and step only. Run event payloads are capped (default 64 KiB) below the 256 KiB execution cap.

#### Alternatives Considered
1. **Put the full resolved value on the event** — Can exceed the event cap and duplicate large payloads into the stream.
2. **Show nothing until a separate fetch** — The inspector would stay empty for the common case.
3. **Bounded preview on `node.started`** (Selected).

#### Decision
- `node.started.payload.input` is a preview of the resolved primary input: at most 8 000 characters of JSON or string, plus `inputBytes` and `inputTruncated`.
- `payload.inputBinding` is the expression or port id that supplied it, when one did.
- The step still executes with the full resolved value when it is under the 256 KiB cap.
- The inspector’s existing Input section renders that payload. No second inspector model.

#### Rationale
Operators can point at the value that was used. The event stream stays bounded.

---

### Decision 6: Persistence without a schema bump

#### Problem
`deserializeWorkflowDefinition` rejects `schemaVersion > 2` and then re-serializes through a fixed field list.

#### Alternatives Considered
1. **Bump to schema 3** — Older builds would reject the document outright.
2. **Stay on schema 2 and teach serialize/deserialize the new optional fields** (Selected).

#### Decision
- `schemaVersion` remains 2.
- Absent `dataMapping` and absent or empty `dataWires` serialize as today.
- Round-trip preserves both when present.

#### Rationale
Legacy documents stay valid. New documents still open on this build. No migration rewrite.

---

## Best Practices Applied

- One grammar shared by the editor and the server, so the picker cannot insert a token the compiler does not understand.
- Fail closed at the consuming step with the reference text in the message.
- Do not expand templates found inside resolved data (blocks untrusted text from becoming a second template).
- Keep control flow, approval routing, and subgraph mappings on their current contracts.

## Alternatives Rejected as a Set

A general expression language (filters, arithmetic, default filters) was rejected. The spec forbids scripting, and feature 017 is the transform step. Silent fallback to `lastValue` was rejected because it recreates the data-loss bug.
