# Feature Specification: Prompt Step

**Feature Branch**: `018-prompt-llm-node`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Remaining work from the visual platform audit, Finding 7: add a Prompt / LLM step that runs one prompt template for translation, formatting, or extraction without creating or editing an agent in the registry."

---

## Architectural Context & Feature Boundary

### Current Gap
A designer who wants a single model reply — translate this text, format this result, extract a label — must place an agent step. That pulls in a shared agent record, tools, and step configuration that the task does not need. Simple model calls are heavier than the job, and editing them in the wrong place can change a shared agent.

### Scope of This Feature
Add a **Prompt** step that:

1. Holds its own prompt text and model choice on the workflow step.
2. Sends one model request when the step runs and stores the reply as that step’s result.
3. Does not create, edit, or require an agent registry record.
4. Uses the same organization model access and credential rules as other model calls.
5. Fails visibly when the model, permission, or credential is unavailable.

### Out of Scope
- Multi-step tool use, autonomous tool loops, or assigning tools to the prompt step.
- Editing agent persona, shared agent instructions, or the agent registry.
- A sandboxed data-reshaping script (the Transform step).
- Semantic memory search (the Retrieval step).
- New model providers or a new credential system.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run One Prompt Without an Agent (Priority: P1)

A designer adds a Prompt step, writes the instruction, chooses a model their organization may use, and runs the workflow. The step’s result is the model reply. No agent record is created or changed. A second step can use that reply the same way it uses any other step result.

**Why this priority**: One bounded model call, without registry side effects, is the product gap.

**Independent Test**: Add a prompt step that translates a fixed input, run it, and confirm the reply is that step’s result. Confirm the agent list is unchanged before and after the edit and the run.

**Acceptance Scenarios**:

1. **Given** the step palette, **When** the designer adds a Prompt step, **Then** they can write prompt text and choose an allowed model on that step alone.
2. **Given** a saved prompt step with an allowed model, **When** the workflow runs, **Then** the step result is the model reply and following steps can use it.
3. **Given** the designer saves or runs a prompt step, **When** they review the agent registry, **Then** no agent was created or modified by that action.
4. **Given** the same prompt, model, and incoming value, **When** nothing else about the step has changed, **Then** a later edit to an unrelated agent does not change this step’s saved prompt or model.

---

### User Story 2 - See Why a Prompt Step Did Not Run (Priority: P1)

A designer chooses a model they cannot use, leaves the prompt empty, or hits a credential or provider failure. The workflow does not pretend the step succeeded. The studio names the problem on that step. Shared agents remain unchanged.

**Why this priority**: A prompt step that fails open, or that fails by mutating an agent, would be worse than not having the step.

**Independent Test**: Attempt to run with an empty prompt, with a disallowed model, and with a simulated provider failure. Confirm each case blocks or fails the step with a specific message and leaves the agent registry unchanged.

**Acceptance Scenarios**:

1. **Given** an empty prompt, **When** the designer validates or runs, **Then** the product asks for prompt text and does not call a model.
2. **Given** a model the organization is not allowed to use, **When** the designer validates or runs, **Then** the step is rejected with a message that names the model choice.
3. **Given** an allowed model whose credential or provider call fails, **When** the step runs, **Then** the step fails with a visible reason and does not produce a fake reply.
4. **Given** any of those failures, **When** the designer inspects agents, **Then** agent records are unchanged.

---

### User Story 3 - Use the Incoming Value in the Prompt (Priority: P2)

The designer writes a prompt that includes the text or result arriving at the step, such as “translate the incoming text into French.” On a run, the model sees that incoming value together with the instruction. The designer does not need an agent, a tool, or a hand-copied memory key to do this.

**Why this priority**: A prompt step that cannot see the previous result cannot format or translate real workflow data. It still depends on the single-shot behavior from the first story, so it follows that story.

**Independent Test**: Feed a known sentence into a prompt step whose instruction says to uppercase or translate that incoming value. Confirm the reply reflects that sentence and not a blank prompt.

**Acceptance Scenarios**:

1. **Given** a prompt step whose instruction refers to the incoming step value, **When** the workflow runs, **Then** the model request includes both the instruction and that incoming value.
2. **Given** the designer marked the incoming value as required and there is no incoming value, **When** the step runs, **Then** the model is not called and the step explains that the incoming value is missing.

---

### Edge Cases

- A very long incoming value or prompt: the step fails with a size limit message instead of sending an unbounded request.
- The model returns an empty reply: the step is shown as empty or failed according to the designer’s “reply required” choice, and it is not labeled as a successful substantive result when a reply was required.
- The designer changes the prompt while a run is already in progress: the in-progress run keeps the prompt it started with.
- Two prompt steps in one workflow: each uses its own prompt and model choice.
- The organization has no allowed model: the step cannot be run, and the message tells the designer that model access is missing.
- Live mode shows the prompt step as running, succeeded, or failed, and the operator can read the reply or the error on that step.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The workflow palette MUST include a Prompt step with its own prompt text and model choice, saved on the workflow.
- **FR-002**: Running a Prompt step MUST make one model request and MUST store the reply as that step’s result.
- **FR-003**: A Prompt step MUST NOT create, update, or delete an agent registry record.
- **FR-004**: A Prompt step MUST NOT call tools and MUST NOT start an autonomous tool-using loop.
- **FR-005**: The model list MUST be limited to models the organization is allowed to use. A disallowed model MUST block the run with a message that identifies the choice.
- **FR-006**: An empty prompt MUST block the run before a model call.
- **FR-007**: Credential, permission, and provider failures MUST fail the step with a visible reason and MUST NOT invent a reply.
- **FR-008**: The model request MUST be able to include the value arriving at the step. When the designer requires that value and it is missing, the step MUST NOT call the model with a silent blank.
- **FR-009**: Prompt text and model choice MUST be preserved when the workflow is reopened, and an in-progress run MUST keep the prompt and model it started with.
- **FR-010**: Operators MUST be able to see the prompt step’s status and its reply or failure reason on the run.
- **FR-011**: Prompt steps MUST honor existing organization, quota, and credential limits for model calls. This feature MUST NOT introduce a bypass.
- **FR-012**: Workflows that do not use a Prompt step MUST keep their current behavior, including existing agent steps.

### Key Entities

- **Prompt Step**: A canvas step that owns one prompt and one model choice and produces one model reply.
- **Prompt Text**: The instruction saved on that step, optionally including the incoming step value.
- **Model Choice**: The model selected for that step, constrained by what the organization may use.
- **Prompt Reply**: The model’s reply recorded as the step result for that run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 4 of 5 designers add a prompt step, run it, and obtain a reply on that step in under 3 minutes without creating or editing an agent.
- **SC-002**: 100% of checklist edits and runs of prompt steps leave the agent registry unchanged.
- **SC-003**: 100% of checklist cases with an empty prompt, a disallowed model, or a failed provider call fail or block before a successful result is shown, with a message that names the cause.
- **SC-004**: In a guided formatting task, at least 4 of 5 designers get a reply that reflects the incoming step value on the first successful run.
- **SC-005**: An in-progress run continues to show the prompt it started with after the designer edits the step, in 100% of checklist cases.

## Assumptions

- The prompt step is a single model request. Tool use stays on agent steps and tool steps.
- Model access, quotas, and credentials already enforced for agent model calls apply unchanged to this step.
- “Allowed model” means a model the same designer could already select for an agent in that organization. This feature does not expand who may call a model.
- The incoming step value is included when the designer’s prompt uses it. Named references to arbitrary earlier steps are provided by the data-mapping feature when that feature is present, and are not required to ship this step.
- Empty model replies fail the step when the designer requires a reply. The default is that a reply is required.
- Size limits follow the product’s existing model-input limits. Oversized prompts fail the step with an explanation.
- Streaming a reply into the live step view is desirable and should follow the studio’s existing live step display, without a separate observability product.
