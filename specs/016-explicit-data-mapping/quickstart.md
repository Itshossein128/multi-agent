# Quickstart: Explicit Step Data Mapping

**Feature**: `016-explicit-data-mapping`  
**Purpose**: Validate the feature end-to-end after implementation—without embedding full test suites here.

See also: [data-model.md](./data-model.md), [contracts/data-mapping.contract.ts](./contracts/data-mapping.contract.ts), [contracts/data-mapping.codes.md](./contracts/data-mapping.codes.md).

---

## Prerequisites

- Repo dependencies installed (`pnpm install`)
- Types buildable (`pnpm --filter @multi-agent/types build`)
- For manual Studio checks: `pnpm run dev` (web + server), an organization with permission to edit and run a workflow

---

## 1. Automated gates (primary)

```bash
pnpm test --runInBand --testPathPattern='dataMapping|workflowCompilerDataMapping'

# Implicit input and approval/condition routing stay intact
pnpm test --runInBand --testPathPattern='workflowCompiler|canvasRouting|topologyValidation'
```

**Expect**

- A workflow with no `dataMapping` and no `dataWires` still passes the previous compiler cases (single predecessor uses the previous value; two predecessors still expose `branches` when no binding is set).
- `{{nodes.<upstreamId>.output.category}}` resolves to that field even when a later sibling wrote a different `lastValue`.
- Missing field, empty `[0]`, dangling id, non-ancestor, forbidden root, and oversize value fail with the codes in `data-mapping.codes.md` and do not insert a different step’s output.
- Two wires to one port, or a primary wire plus `inputBinding`, fail design validation.
- Approval handles `approved` / `rejected` / `needs_clarification` still create conditional control edges and do not create data wires.
- Save/load round-trip keeps `dataWires` and `inputBinding`. A document that omits them still deserializes.

---

## 2. Typecheck / build

```bash
pnpm exec tsc --noEmit
pnpm --filter @multi-agent/types build
pnpm --filter server build
pnpm --filter web build
```

**Expect**: clean compile. `schemaVersion` remains 2.

---

## 3. Manual Studio smoke

### A. Picker selects one upstream field (SC-001, SC-002)

1. Create a workflow that splits after an input into two producers, then joins at a later agent step.
2. Open the later step’s task instruction. Open the variable picker.
3. Confirm the two upstream steps and the workflow input are listed by canvas name, and a step that does not lead here is absent.
4. Insert the first producer’s category (or whole output).
5. Run with that field present. In the Live inspector Input section, confirm the resolved value is that field, not the other branch.
6. Run again with the field missing. Confirm the step fails and the message quotes the reference.

### B. Rename does not retarget (FR-006)

1. Insert a reference to an agent step.
2. Rename the agent record (the canvas title).
3. Reopen the picker and run. The token still names the same node id, and the picker shows the new title.

### C. Data wire (SC for ports)

1. From an agent step, connect the `text` or `json` data handle to a later step’s context/value handle.
2. Confirm the wire looks different from a normal flow connection and that approval outcome handles are unchanged.
3. Run and confirm the later step’s input is that port’s value.
4. Draw a second wire into the same input. Confirm validation names the conflict and Run stays blocked.

### D. Untouched workflow (SC-004)

1. Open a saved workflow that has no references and no data wires.
2. Run it. Step inputs match the pre-feature behavior for that graph.

---

## 4. Failure signals

- Run starts while a design-time `DATA_*` error is present on the graph.
- A bad reference silently becomes the previous step’s value.
- A data wire changes which approval path is taken.
- The inspector Input section stays empty after a mapped step has started, when the event payload included `input`.
