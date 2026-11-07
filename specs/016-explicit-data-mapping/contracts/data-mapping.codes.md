# Data-mapping issue codes

Normative strings for server `validation.ts`, web `validation.ts`, and compiler runtime errors. Messages must include the reference text or the port id. Do not substitute another step’s output when any of these fire.

| Code | Phase | Meaning |
| :--- | :--- | :--- |
| `DATA_REF_SYNTAX` | design | `inputBinding` is not exactly one well-formed reference. |
| `DATA_REF_FORBIDDEN` | design or run | Reference root is not `input` or `nodes`. |
| `DATA_REF_DANGLING` | design | `nodes.<id>` is not a node in this workflow. |
| `DATA_REF_NOT_UPSTREAM` | design | Referenced node is not a control-flow ancestor of the consumer. |
| `DATA_REF_UNKNOWN_FIELD` | design | Producer output schema lists properties, and the first field is not one of them. |
| `DATA_REF_UNRESOLVED` | run | Field missing, index past the end or into an empty list, or the value has the wrong shape. Message quotes the reference. |
| `DATA_REF_TOO_LARGE` | run | Resolved value or interpolated string is over 256 KiB. |
| `DATA_WIRE_CONFLICT` | design | Two wires share a target port, or a primary-port wire and `inputBinding` are both set. |
| `DATA_WIRE_NOT_UPSTREAM` | design | Wire source is not a control-flow ancestor of the target. |
| `DATA_INPUT_REQUIRED` | design | A port listed in `requiredInputs` has no wire. |
| `DATA_PORT_UNKNOWN` | design | Port is not in the v1 catalog for that node type. |

Runtime failures use the consuming node id. Design issues name the node and, for wires, the wire id.

Approval outcome keys (`approved`, `rejected`, `needs_clarification`) are not data-mapping codes and must not be emitted by this feature.
