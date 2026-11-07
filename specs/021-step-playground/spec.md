# Feature Specification: Single-Step Playground

**Feature Branch**: `021-step-playground`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Remaining work from the visual platform audit, roadmap Phase 5: let a designer test one workflow step with a sample input from the canvas, see that step’s result, and avoid running the rest of the workflow or changing the saved graph."

---

## Architectural Context & Feature Boundary

### Current Gap
To learn what one step will do, a designer must run the whole workflow. That is slow, may trigger later steps and human approvals, and mixes a question about one step with everything downstream. There is no **Test this step** action on the canvas.

### Scope of This Feature
From a step on the canvas, a designer can:

1. Open a playground for that step.
2. Supply a sample input, or reuse an input from a recent run of that step when one exists.
3. Run only that step and read its result, error, and timing.
4. Leave the saved workflow unchanged.
5. Keep side effects from happening unless the designer explicitly confirms a live trial.

### Out of Scope
- Replacing full workflow runs or the live canvas.
- Editing the step’s saved configuration from the playground without the usual save path. The playground tests; it does not become a second editor.
- Load testing, batch evaluation, or a shared library of fixtures.
- Running every downstream step “from here.”
- Bypassing organization permissions, quotas, or credential rules.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Test One Step With a Sample Input (Priority: P1)

A designer selects a step and chooses **Test this step**. They provide a sample input, run the trial, and see that step’s output or a readable error, plus how long it took. Later steps do not run. Human approvers are not asked to act. The workflow graph on the canvas stays as it was.

**Why this priority**: A single-step trial with a sample input is the entire request. Safety constraints are part of making that trial trustworthy.

**Independent Test**: On an output step, provide a sample object, run the playground, and confirm the shown result matches that step’s behavior. Confirm no later step has a new run result and the saved graph is unchanged.

**Acceptance Scenarios**:

1. **Given** a step that can be tested, **When** the designer chooses **Test this step**, **Then** they can enter a sample input and start a trial without starting a full workflow run.
2. **Given** a sample input the step can accept, **When** the trial finishes, **Then** the playground shows the step result or a failure reason and the elapsed time.
3. **Given** a trial, **When** it runs, **Then** steps after the selected step do not run and no human approval request is sent.
4. **Given** a finished trial, **When** the designer returns to the canvas, **Then** the saved workflow’s steps, connections, and settings are unchanged.

---

### User Story 2 - Reuse a Recent Input (Priority: P2)

If the step has a recent workflow run, the designer can start the playground from that run’s input for this step instead of hand-building a sample. They can still edit the sample before the trial. The historical run is not modified.

**Why this priority**: Real upstream payloads are hard to recreate by hand. The feature is still useful with typed samples alone, so this story can follow.

**Independent Test**: Complete a workflow run, open **Test this step** on a middle step, load the input that step received, change one field, run the trial, and confirm the historical run’s recorded result is unchanged.

**Acceptance Scenarios**:

1. **Given** a step that received an input in a recent run, **When** the designer opens the playground, **Then** they can load that input as the sample.
2. **Given** a loaded sample, **When** the designer edits it and runs the trial, **Then** the trial uses the edited sample.
3. **Given** a historical run, **When** a playground trial finishes, **Then** that run’s recorded inputs and outputs are unchanged.
4. **Given** a step with no prior run, **When** the designer opens the playground, **Then** they can still type a sample and are told there is no saved input to reuse.

---

### User Story 3 - Confirm Before Anything Leaves the Studio (Priority: P1)

A step that would send a message, change external data, charge a model call, or write memory does not do that on an ordinary trial. The playground tells the designer the trial would have a side effect and waits for an explicit confirmation before a live trial. Declining confirmation still shows a safe preview where the step can produce one without the side effect, and otherwise cancels the live action. Credential and quota rules still apply to any confirmed live trial.

**Why this priority**: An unconfirmed test that mutates production systems or spends budget would make the playground unsafe to use.

**Independent Test**: Open the playground on a step that writes memory or calls a tool with an external effect. Run without confirming and confirm the write or call did not happen. Confirm once and confirm the product performs the action under normal permission and quota checks.

**Acceptance Scenarios**:

1. **Given** a step whose real execution would write memory, call a side-effecting tool, or send an approval, **When** the designer runs a trial without confirming a live action, **Then** that write, call, or approval does not happen.
2. **Given** the same step, **When** the designer explicitly confirms a live trial, **Then** the action is attempted under the same permission, credential, and quota rules as a normal run, and the result or denial is shown.
3. **Given** a model-backed step, **When** the designer is about to run a live trial, **Then** the playground states that the trial can consume model quota before they confirm.
4. **Given** a denied credential or quota, **When** a confirmed live trial runs, **Then** the playground shows the denial and does not bypass the control.

---

### Edge Cases

- The sample input is not valid for the step: the trial fails with a message that names the problem, and the saved step configuration is not overwritten with the sample.
- The designer closes the playground mid-trial: the trial is cancelled if it has not completed, and no later step starts.
- Two playground trials on the same step overlap: each shows its own result, and neither changes the saved workflow.
- The step is an approval step: the default trial shows the approval request that would be raised and does not notify approvers until a live trial is confirmed.
- The step is a nested workflow: the trial runs that nested workflow once, using the sample as its input, and stops at the nesting depth the product already allows. It does not keep expanding forever, and it does not run steps that sit after the nested step on the parent canvas.
- A condition step: the trial shows which path the sample would take, without running the steps on that path.
- The designer lacks permission to run workflows: the playground does not run a live trial.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A designer MUST be able to start **Test this step** from a step on the canvas.
- **FR-002**: The playground MUST accept a sample input supplied by the designer and MUST run only the selected step for that trial.
- **FR-003**: A trial MUST show the step result or a readable failure, and the elapsed time.
- **FR-004**: A trial MUST NOT run later steps and MUST NOT send human approval requests unless the designer explicitly confirmed a live trial that is defined to do so.
- **FR-005**: A trial MUST NOT change the saved workflow’s steps, connections, or settings.
- **FR-006**: When a recent run has an input for the selected step, the designer MUST be able to load and edit it as the sample. The historical run MUST remain unchanged.
- **FR-007**: Steps with no prior input MUST still allow a hand-entered sample.
- **FR-008**: A trial that would write memory, call a side-effecting tool, notify an approver, or spend model quota MUST explain that before the action and MUST NOT perform it until the designer confirms a live trial.
- **FR-009**: A confirmed live trial MUST obey the same permission, credential, and quota rules as a normal run, and MUST surface denials in the playground.
- **FR-010**: An invalid sample MUST fail the trial with a readable reason and MUST NOT be saved as the step’s configuration.
- **FR-011**: A condition trial MUST show the path the sample would take and MUST NOT execute the steps on that path.
- **FR-012**: Designers who are not allowed to run workflows MUST NOT be able to start a live trial.
- **FR-013**: A nested-workflow step MUST run in the playground as one trial of that nested workflow, using the sample as its input, and MUST stop at the nesting depth the product already enforces. The trial MUST show the nested result or a failure and MUST NOT run steps that follow the nested step on the parent workflow.

### Key Entities

- **Step Trial**: One execution of a single step in the playground, with a sample input and a recorded result or failure.
- **Sample Input**: Designer-entered or recently reused data used only for the trial.
- **Live Trial Confirmation**: An explicit designer choice to allow a real side effect or model charge for that trial.
- **Trial Result**: The output, path decision, timing, and error shown for the trial, kept separate from saved workflow runs unless the designer confirmed a live action that itself creates a normal operational record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 4 of 5 designers test one step with a sample input and read a result or a clear error in under 2 minutes, without a full workflow run.
- **SC-002**: 100% of unconfirmed checklist trials on side-effecting steps perform no memory write, external tool effect, or approval notification.
- **SC-003**: 100% of checklist trials leave the saved workflow graph and settings unchanged.
- **SC-004**: In at least 90% of internal trials that reuse a recent input, the designer can load that input, edit it, and see a trial result without any change to the historical run.
- **SC-005**: 100% of confirmed live trials that lack permission or quota are denied with a visible reason and do not complete the protected action.

## Assumptions

- The first release supports the step types that already run as a single unit: agent, tool, memory, condition, input, output, and prompt or transform steps if those exist. Parallel split and join are not separate playground targets; designers test the steps inside a branch.
- A nested workflow is tested as one bounded trial, as FR-013 requires, using the nesting depth the product already enforces.
- Ordinary trials do not appear as successful production workflow runs. A confirmed live side effect may create the same operational record that the side effect creates today, and the playground must say so before confirmation.
- Model trials always require the quota confirmation in US3, because they spend budget even when they have no other side effect.
- Sample inputs are not a new long-term fixture library. Keeping the last sample on the designer’s local editing session is acceptable; organization-wide fixture sharing is out of scope.
- The playground uses the step’s saved settings. Unsaved canvas edits are included only after the designer has applied them through the normal editing flow, so a trial cannot surprise them with a half-typed panel. If the panel has unsaved edits, the playground warns and uses the last saved settings unless the designer applies the edits first.
