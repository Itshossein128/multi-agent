# Feature Specification: Explicit Step Data Mapping

**Feature Branch**: `016-explicit-data-mapping`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Remaining work from the visual platform audit, Finding 3 and roadmap Phase 3: replace implicit step-to-step data passing with explicit variable references, a visual variable picker, and named input/output ports so designers can choose which upstream result a step receives."

---

## Architectural Context & Feature Boundary

### Current Gap
When a workflow branches or rejoins, a later step often receives only whatever the previous step happened to produce. Designers cannot reliably point a prompt, a condition, or an output at a specific earlier result, such as a triage category or the first record from a lookup. Workarounds require custom glue or memory keys, and the wrong value is easy to miss until a run is already wrong.

### Scope of This Feature
Let designers and operators see and choose how data moves between steps:

1. **Variable references** in step text and settings, filled from the workflow input or from a named earlier step’s result.
2. **A variable picker** in the step properties panel that lists only values already available from upstream steps and inserts a reference.
3. **Named data ports** so a step can offer distinct outputs and accept distinct inputs, wired on the canvas.
4. **Safe failure and compatibility** so a missing or illegal reference is visible, and workflows that never opt into mapping keep today’s step-to-step behavior.

### Out of Scope
- A general scripting or transform step (separate feature).
- Changing approval outcome handles that already route approved, rejected, and needs-clarification paths.
- Replacing nested-workflow input and output mapping already defined for subgraph steps.
- Reading another organization’s data, credentials, or hidden model secrets through a reference.
- Automatically rewriting saved workflows that do not use references or data-port wires.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Name the Value a Step Should Use (Priority: P1)

A designer building a branching workflow chooses a specific earlier result for a later step, for example the customer question from the workflow input or the category produced by the triage step. They can type a reference or insert one from a picker that only lists the workflow input and steps that actually lead into the step being edited. The picker shows canvas names, not internal identifiers. When the workflow runs, the step receives the named value. If the named step never ran or the field is missing, the run shows a clear failure for that reference instead of quietly substituting some other step’s output.

**Why this priority**: This is the data-loss problem designers hit as soon as a flow branches or joins. A reference that cannot be inserted and resolved is not yet useful, so the picker and the resolution ship together.

**Independent Test**: Build a workflow that splits and rejoins. Open the picker on a downstream step and confirm only upstream results are listed. Insert one field. Run once where that step produced the field and once where it did not. Confirm the first run uses that field and the second fails with a message that names the missing reference.

**Acceptance Scenarios**:

1. **Given** a workflow input that includes a customer question, **When** a later step’s text contains a reference to that input field, **Then** the running step receives the customer question in place of the reference.
2. **Given** a triage step that produced a category, **When** a downstream step references that step’s category, **Then** the downstream step receives the category even if another branch produced a different result more recently.
3. **Given** a step with upstream results, **When** the designer opens the variable picker, **Then** they see the workflow input and each upstream step’s available results, labeled by the step name on the canvas, and choosing one inserts a reference into the field being edited.
4. **Given** a step that cannot reach the current step, **When** the picker is open, **Then** that step’s results are absent.
5. **Given** a reference to a step that is not upstream of the current step, or to a field that was not produced, **When** the designer validates or the run reaches that step, **Then** the product names the broken reference and does not silently insert an unrelated previous result.
6. **Given** a step is renamed after a reference was saved, **When** the designer reopens the picker and runs the workflow, **Then** the picker shows the new name and the saved reference still resolves to that same step.
7. **Given** a saved workflow that contains no variable references, **When** it is opened and run after this feature, **Then** each step still receives the same kind of incoming value it receives today.

---

### User Story 2 - Wire a Specific Output into a Specific Input (Priority: P2)

A designer exposes a step output such as the main text, a structured result, or an error, and wires it to a named input on a later step such as the prompt, extra context, or a tool input. The wire is visible on the canvas. The receiving step uses the wired value for that input. Steps that do not use data ports continue to accept their usual incoming value.

**Why this priority**: Ports make structured hand-offs visible, but references already solve the highest-friction data-loss cases, so ports can follow the reference MVP.

**Independent Test**: On two steps that support data ports, wire one named output to one named input, run the workflow, and confirm the receiving input matches that output and not a different output from the same step.

**Acceptance Scenarios**:

1. **Given** a step that exposes more than one result, **When** the designer connects a named output to a named input on a later step, **Then** the canvas shows that connection as a data wire distinct from ordinary flow connections.
2. **Given** that wire is saved, **When** the workflow runs, **Then** the named input receives that output’s value.
3. **Given** a required named input has no wire and no other explicit value, **When** the designer validates, **Then** the product explains which input is unsatisfied and blocks a run that would proceed with an empty required input.
4. **Given** an approval step’s existing outcome paths, **When** this feature is used, **Then** those outcome paths still decide which way the workflow goes, and data ports do not replace them.

---

### Edge Cases

- A reference points at a list item, such as the first record’s identifier, and the list is empty: the step fails with a message that names the reference, and later steps do not receive a fabricated item.
- A reference is used inside a branch that was skipped: the skipped step does not invent a value, and a downstream step that required it fails visibly if that reference is evaluated.
- Two wires target the same named input: validation rejects the conflict and names both sources.
- A data wire creates a loop that the workflow’s topology rules already forbid: existing topology validation still rejects it.
- The referenced value is very large: the step fails with a size limit message rather than truncating silently or stalling the studio.
- The designer removes a step that is still referenced: validation lists every broken reference before run.
- Parallel branches produce several results: a later step can select one branch’s result by reference or by port, and does not have to accept a blended bag of all branches unless the designer asked for that.
- Live inspection of a running or finished step shows the resolved input that step actually used, so an operator can tell a mapping error from a model error.
- A reference tries to read a credential, a hidden model secret, or another organization’s data: the reference is rejected and nothing secret is shown in the picker or the run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Designers MUST be able to place variable references in step text and in step settings that accept incoming data, using the workflow input and a specific earlier step’s result fields.
- **FR-002**: A reference MUST be resolved from the named source before the step consumes the text or setting.
- **FR-003**: A reference to a missing step, a step that is not upstream, a missing field, or an empty list item that the reference requires MUST fail that step with a message that identifies the reference. The product MUST NOT substitute a different step’s output.
- **FR-004**: The step properties panel MUST offer a picker of the workflow input and upstream step results, labeled with the names shown on the canvas, and inserting a choice MUST write a reference into the field being edited.
- **FR-005**: The picker MUST exclude steps that are not upstream of the step being edited.
- **FR-006**: Renaming a step MUST NOT break saved references to that step, and the picker MUST show the updated name.
- **FR-007**: Steps that declare named outputs and named inputs MUST let designers wire a specific output to a specific input on the canvas.
- **FR-008**: A named input marked required MUST be satisfied by a wire or an explicit value before run. Unsatisfied required inputs MUST block the run with a message that identifies the step and input.
- **FR-009**: A named input MUST have at most one source. Conflicting wires MUST be rejected at validation.
- **FR-010**: Workflows that do not use references or data-port wires MUST keep their current incoming-value behavior with no mandatory edit.
- **FR-011**: Approval outcome routing MUST keep its current meaning. Data ports MUST NOT change which approval path is taken.
- **FR-012**: Operators MUST be able to inspect the resolved inputs a step actually received during a run.
- **FR-013**: References and port wires MUST stay inside the current organization’s workflow data. They MUST NOT reveal credentials or another organization’s records.
- **FR-014**: Saved workflows MUST preserve references, port declarations, and data wires across reopen.

### Key Entities

- **Variable Reference**: A saved pointer, written in step text or settings, to the workflow input or to a field of a specific step’s result.
- **Variable Picker Entry**: A designer-facing label for one available input or upstream result, used to insert a reference.
- **Data Port**: A named input or named output on a step, separate from the wires that only decide which step runs next.
- **Data Wire**: A canvas connection from one step’s named output to a later step’s named input.
- **Resolved Step Input**: The concrete value a step received after references and wires were applied, visible during and after a run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a guided task with a branch and a join, at least 4 of 5 designers make a later step use one chosen upstream field on the first attempt, without writing custom glue or storing the value by hand.
- **SC-002**: Designers who use the picker insert a working reference in under 30 seconds in at least 90% of usability trials, without typing internal identifiers.
- **SC-003**: 100% of release-checklist cases with a missing step, a non-upstream step, a missing field, or an empty required list item fail with a message that names the reference, and none of those cases silently use a different step’s output.
- **SC-004**: 100% of a sampled set of existing workflows that contain no references and no data-port wires still complete a smoke run with the same step-to-step values as before this feature.
- **SC-005**: In a live or finished run, an operator can point to the resolved input of a mapped step from the studio in at least 90% of internal debug walkthroughs.

## Assumptions

- Designers already edit workflows on the visual canvas and can run them in place. This feature adds data selection on that canvas.
- The reference forms designers see include the workflow input, such as `{{input.customerQuery}}`, and a step result, such as `{{nodes.triage_agent.output.category}}`, including a single list position such as the first record’s identifier. The picker inserts these forms so designers rarely type them.
- References read data the step is already allowed to see. They are not a scripting language and cannot call tools, models, or the network.
- A practical result size limit applies. Oversized values fail the step with an explanation.
- Existing approval outcome handles remain the way those paths are drawn. Data ports are an additional kind of connection.
- Nested-workflow boundary mapping stays as already specified. This feature does not reopen that design.
- Port support in the first release covers steps that already produce a main result and, where the product already distinguishes them, a structured result and an error. It does not require every future step type to ship in the same release.
- When both a data wire and a reference exist, the wire fills the named input, and references inside text are still replaced. Steps with neither keep today’s incoming value.
- Topology rules already in the product still decide which loops and joins are legal.
