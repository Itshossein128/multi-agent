# Data Model: Explicit Step Data Mapping

**Feature Branch**: `016-explicit-data-mapping`  
**Date**: 2026-11-05  
**Status**: Complete  

Related: [spec.md](./spec.md), [research.md](./research.md), [contracts/](./contracts/)

---

## 1. Overview

Additive optional data on the existing workflow document. No new stored entity outside `WorkflowDefinition`. Control-flow `WorkflowEdge` records are not given a new kind.

Unused workflows omit `dataMapping` and `dataWires`. `serializeWorkflowDefinition` must persist both when present and must omit them when absent.

---

## 2. Variable reference (authored token)

Stored as a string inside authored text or as the sole content of `inputBinding`.

| Form | Resolves from |
| :--- | :--- |
| `{{input}}` | Whole workflow input |
| `{{input.<field>(.<field>\|[index])*}}` | Walk from workflow input |
| `{{nodes.<nodeId>.output}}` | Whole `nodeResults[nodeId]` |
| `{{nodes.<nodeId>.output<path>}}` | Walk from that result |

**Path rules**

- `<nodeId>` is the exact node id, including hyphens, ending at `.output`.
- After the root value: at most 8 steps. A step is `.identifier` or `[non-negative integer]`.
- Identifiers match `[A-Za-z_][A-Za-z0-9_]*`.
- Only `{{ … }}` spans whose inside matches this grammar are references. Other brace spans stay literal text.

**Not references**

- Memory keys, agent ids, tool ids, condition `valueField`, subgraph mapping strings.
- Roots other than `input` and `nodes`.

---

## 3. NodeDataMapping (optional on `WorkflowNode`)

| Field | Type | Rules |
| :--- | :--- | :--- |
| `inputBinding` | string, optional | A single reference, optional surrounding whitespace. No surrounding prose. Replaces `valueForNode` for this node’s primary input. |
| `requiredInputs` | string[], optional | Port ids that must have a data wire before run. Empty or omitted means no required data port. Unknown ids are invalid. |

**Invariants**

- Omitted `dataMapping` means implicit input and no required ports.
- `inputBinding` and a data wire onto that node’s primary port cannot both be set.
- Binding node id must be a control-flow ancestor, not the node itself.

---

## 4. DataWire (optional `WorkflowDefinition.dataWires`)

| Field | Type | Rules |
| :--- | :--- | :--- |
| `id` | string | Unique within the workflow |
| `source` | string | Producer node id |
| `sourcePort` | `text` \| `json` \| `value` | Must be an output port of the source type |
| `target` | string | Consumer node id |
| `targetPort` | `prompt` \| `context` \| `input` \| `value` | Must be an input port of the target type |

**Invariants**

- At most one wire per (`target`, `targetPort`).
- `source` is a control-flow ancestor of `target` (following `edges` of kind `normal` or `conditional` only).
- A wire is not a `WorkflowEdge` and is ignored by topology, approval routing, and `valueForNode` predecessor scans.
- Empty array is treated as absent on serialize.

### Primary ports

These wires replace the primary input the same way `inputBinding` does: `context` (agent, approval), `input` (tool), `value` (output, memory, condition).

`prompt` does not replace the primary input. It supplies the agent task instruction string for that run.

---

## 5. Port catalog (v1, not persisted)

Declared by node type. Designers do not invent port ids.

| Node type | Inputs | Outputs |
| :--- | :--- | :--- |
| `agent` | `prompt`, `context` | `text`, `json` |
| `tool` | `input` | `text`, `json` |
| `output` | `value` | — |
| `memory` | `value` | `value` |
| `condition` | `value` | — |
| `approval` | `context` | — |
| `input` | — | `value` |
| `parallel_split`, `parallel_join`, `subgraph` | — | — |

Approval source handles remain `approved`, `rejected`, `needs_clarification` on control edges. They are not data ports.

Handle ids on the canvas are `data:in:<port>` and `data:out:<port>`.

---

## 6. Resolution state (runtime, not persisted)

| Field | Meaning |
| :--- | :--- |
| Primary input | Wire value, else `inputBinding`, else `valueForNode` |
| `text` output | String content of the producer result when the result is a string or has a string `content` / `text` field |
| `json` output | Producer result when it is a non-array object; otherwise unresolved |
| Interpolated text | Authored string with references replaced, after the primary input is chosen, without expanding braces inside replacement values |

Producer result is the value already stored in `nodeResults[id]` (`output` if that run result had one, otherwise `lastValue`).

---

## 7. Validation and runtime outcomes

Design-time issues block Run. Runtime issues fail the consuming step and do not substitute another step’s value.

| Code | When |
| :--- | :--- |
| `DATA_REF_SYNTAX` | `inputBinding` is not exactly one reference |
| `DATA_REF_FORBIDDEN` | Recognized reference uses a root other than `input` or `nodes` |
| `DATA_REF_DANGLING` | Node id is not in the workflow |
| `DATA_REF_NOT_UPSTREAM` | Node id is not a control-flow ancestor |
| `DATA_REF_UNKNOWN_FIELD` | Producer `outputSchema.properties` exists and the first field is absent |
| `DATA_REF_UNRESOLVED` | Runtime missing field, empty index, or wrong shape. Message includes the reference |
| `DATA_REF_TOO_LARGE` | Resolved value or interpolated string exceeds 256 KiB |
| `DATA_WIRE_CONFLICT` | Two wires to the same input, or a wire plus `inputBinding` on the primary input |
| `DATA_WIRE_NOT_UPSTREAM` | Wire source is not a control-flow ancestor |
| `DATA_INPUT_REQUIRED` | `requiredInputs` entry has no wire |
| `DATA_PORT_UNKNOWN` | Port id is not in the catalog for that node type |

Removing a node deletes incident control edges and incident data wires. Remaining tokens in other nodes’ text or bindings stay in the document and surface as `DATA_REF_DANGLING`.

---

## 8. Live preview (event payload, not a new record)

On `node.started` for the consuming node:

| Field | Rules |
| :--- | :--- |
| `input` | Preview of the resolved primary input, at most 8 000 characters |
| `inputBytes` | UTF-8 size of the full resolved input |
| `inputTruncated` | True when the preview is shorter than the full value |
| `inputBinding` | Optional expression or `port:<id>` that selected the primary input |

The inspector already displays `payload.input`. Execution uses the full value when it is within the 256 KiB cap.

---

## 9. Compatibility

- Documents without the new fields deserialize and run as they do today.
- `schemaVersion` stays 2.
- Condition routing, approval `branchKey`, and subgraph mapping objects are not reinterpreted as this grammar.
