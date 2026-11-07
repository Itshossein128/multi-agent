# Feature Specification: Transform Step

**Feature Branch**: `017-transform-node`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Remaining work from the visual platform audit, Finding 7 and roadmap Phase 3: add a Code / Transform step that reshapes data between steps with a small sandboxed script so designers do not spend a model call on mechanical formatting."

---

## Architectural Context & Feature Boundary

### Current Gap
Designers who need to reshape a result — pull a code block out of a reply, rename fields, or pick one item from a list — have no step for that job. They either push the work into a model prompt, which is slow and costly, or they cannot express it on the canvas at all.

### Scope of This Feature
Add a first-class **Transform** step that:

1. Takes the value arriving at that step.
2. Runs a short script the designer wrote to return a new value.
3. Passes that new value to the following steps.
4. Stays inside a strict safety box: no network, no credentials, no files, no other organization, and hard time and size limits.
5. Shows success, the returned value, and script errors on that step during a run.

### Out of Scope
- Choosing models, calling tools, or running an agent loop.
- Installing packages or reusing scripts from outside the workflow.
- A second scripting language in the first release.
- The general variable-reference and data-port system, except that a transform step consumes the value the workflow already delivers to a step and produces a normal step result later features can map.
- Weakening tenant isolation, credential handling, or the isolation already used for untrusted workers.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reshape a Result Without a Model (Priority: P1)

A designer drops a Transform step between two existing steps, writes a short script, and saves the workflow. On a run, the script sees the incoming value and the next step receives only what the script returned. The run does not call a model for that step. Re-running the same incoming value through the same script returns the same result.

**Why this priority**: Mechanical reshaping is the reason this step exists. Safety and failure display matter, but they support this outcome.

**Independent Test**: Place a transform between an input and an output. Script it to keep one field and rename another. Run twice with the same input. Confirm both outputs match, and confirm no model usage is attributed to that step.

**Acceptance Scenarios**:

1. **Given** the step palette, **When** the designer adds a Transform step, **Then** the canvas shows it as its own step type with a place to edit the script.
2. **Given** a saved script that maps an incoming value to a new shape, **When** the workflow runs, **Then** the following step receives that new shape.
3. **Given** the same incoming value and the same saved script, **When** the step runs again, **Then** the returned value is the same.
4. **Given** a transform step, **When** it runs, **Then** the run record does not treat that step as a model call.

---

### User Story 2 - Unsafe or Broken Scripts Fail the Step Only (Priority: P1)

A designer, or a pasted script, tries to reach the network, read credentials, touch files, read another organization, or run for too long. The step fails closed. The studio shows the failure on that step. Other tenants and other workflows are unaffected. A script that returns nothing usable, throws, or exceeds the size limit also fails that step with a designer-readable reason.

**Why this priority**: A transform step executes designer-written logic inside a multi-tenant studio. It cannot ship unless misuse stays inside the step.

**Independent Test**: Run the release checklist of hostile scripts (network, credential read, file read, cross-organization read, oversized output, over-time script) and confirm each fails that step, names the reason, and leaves other organizations’ data unchanged.

**Acceptance Scenarios**:

1. **Given** a script that attempts a network call, a credential read, a file read, or access outside the incoming value, **When** the step runs, **Then** the attempt is denied and the step fails with a reason the designer can read.
2. **Given** a script that does not finish within the product time limit or returns a value over the size limit, **When** the limit is hit, **Then** the step fails and the workflow does not continue as if the script had succeeded.
3. **Given** a script error, **When** an operator inspects the run, **Then** the transform step shows the failure and does not present an empty success.
4. **Given** a failed transform in one organization, **When** another organization’s workflow runs, **Then** that other workflow is unaffected.

---

### User Story 3 - Fix a Script From the Step Panel (Priority: P2)

A designer sees a script failure, changes the script on the step, saves, and runs again. The previous workflow definition is not trapped on the failed script. The panel makes the incoming example and the script’s job obvious enough that a designer can correct a small mapping mistake without leaving the workflow.

**Why this priority**: Authors will get scripts wrong. Recovery is what makes the step usable after the first failure, and it can follow the safe execution path.

**Independent Test**: Save a script that fails on a missing field, read the step error, change the script, run again, and confirm the new result is used and the earlier failure remains visible on the earlier run.

**Acceptance Scenarios**:

1. **Given** a failed transform run, **When** the designer opens that step, **Then** they can read why the script failed and edit the script in place.
2. **Given** the designer saves a corrected script, **When** they run the workflow again, **Then** the new run uses the corrected script.
3. **Given** an earlier failed run, **When** the designer opens it after the fix, **Then** that historical run still shows the old failure.

---

### Edge Cases

- The incoming value is missing: the script may receive an empty value, and if the script assumes a field that is absent, the step fails with a script error rather than inventing data.
- The script returns no value: the step fails closed and does not pass a silent empty success to the next step.
- The script tries to change the incoming value’s stored history: the next step sees only the returned value, and prior steps’ recorded results stay as they were.
- Two transform steps in a row: each sees the previous step’s returned value, in order.
- A very short infinite loop: the time limit stops the step and the studio stays responsive.
- The designer saves an empty script: validation blocks the run and asks for a script.
- Live mode shows the transform step as running, succeeded, or failed like other steps.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The workflow palette MUST include a Transform step that designers can add, connect, save, and reopen like other steps.
- **FR-002**: A Transform step MUST run a designer-authored script over the value arriving at that step and MUST make the script’s returned value the step result that following steps can use.
- **FR-003**: The same script and the same incoming value MUST yield the same returned value.
- **FR-004**: Running a Transform step MUST NOT call a model and MUST NOT invoke tools or agents.
- **FR-005**: The script MUST NOT be able to reach the network, credentials, the file system, another organization, or data other than the value given to that step.
- **FR-006**: The product MUST enforce a time limit and a result size limit. Exceeding either MUST fail that step.
- **FR-007**: A script error, a missing return, a denied unsafe action, or a limit breach MUST fail the step with a designer-readable reason and MUST NOT be reported as success.
- **FR-008**: An empty script MUST be rejected at validation before run.
- **FR-009**: Designers MUST be able to edit the script on the step and have the next run use the saved script. Earlier runs MUST keep the outcome they already recorded.
- **FR-010**: Operators MUST see the transform step’s running, succeeded, or failed state, and the failure reason, on the workflow run.
- **FR-011**: A transform failure in one organization MUST NOT affect another organization’s workflows or data.
- **FR-012**: Existing step types and workflows that do not use a Transform step MUST keep their current behavior.

### Key Entities

- **Transform Step**: A canvas step whose job is to turn the incoming value into a new value by script, without a model call.
- **Step Script**: The saved script belonging to one transform step.
- **Step Result**: The value the script returned, available to following steps and visible on the run.
- **Script Failure**: A denied action, limit breach, empty script, or script error recorded against that step and that run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a guided task, at least 4 of 5 designers add a transform between two steps and deliver a reshaped value to the following step in under 5 minutes, without using a model for that step.
- **SC-002**: 100% of release-checklist scripts that attempt network access, credential access, file access, or another organization’s data fail the step and leave other organizations unchanged.
- **SC-003**: 100% of over-time and over-size checklist cases fail the transform step and do not continue the workflow as a success.
- **SC-004**: For a fixed sample of inputs, repeated runs of an unchanged script match exactly in 100% of cases.
- **SC-005**: After a failed run, a designer can correct the script and produce a successful result on a new run in under 5 minutes in at least 4 of 5 trials, while the original failed run still shows the failure.

## Assumptions

- The first release offers one authoring language in the step: a small function that receives the incoming value and returns a new value. The audit’s example is JavaScript, and that is the assumed authoring language designers type. It is not a requirement to build the studio in any particular language. Python and extra authoring languages are later work.
- The script receives the value the workflow already passes into the step. It does not gain a new way to browse the whole run unless a later data-mapping feature supplies that value as the step input.
- Time and size limits are mandatory. Exact numeric ceilings are a planning choice as long as they are finite, visible in the failure, and tight enough that one script cannot monopolize the studio.
- No package installation and no reusable script library ship in this feature. The script is stored on the step.
- Credential isolation, tenant isolation, and untrusted-worker isolation already in the product remain in force. This step must not be a way around them.
- Transform steps participate in the same run status display as other steps.
