# Feature Specification: Agent Thinking Visibility

**Feature Branch**: `023-agent-thinking-visibility`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "While an agent is working, it would show some texts as its thinkings. In this application, they are not accessible or visible through the app's UI. I need to make it visible, so I could have more control on what agent is gonna do or what it thinks."

---

## Architectural Context & Feature Boundary

### Current Gap
While an agent step is working, it can produce thinking: the working text it uses to decide what to do next, separate from the answer it hands to the workflow. An operator watching a run cannot reliably read that text. On the live workflow canvas, thinking is not presented as its own visible area. When any of it was saved at all, it sits behind a closed control labeled in technical language, so it is easy to miss while the agent is still working. The run review does not present thinking as its own readable account either. Without it, the operator cannot tell what the agent is considering in time to let the run continue, stop it, withhold a decision, or change the workflow before the next run.

### Scope of This Feature
1. While an agent step is working, the thinking it shares is shown in a labeled Thinking area on that step, in the order it was produced.
2. Thinking stays distinct from the answer, from tool activity, and from errors.
3. The same thinking remains readable after the step completes, is stopped, or fails, including on a later review of that run.
4. When no thinking was shared, or when an older run has none stored, the product says so in plain language.
5. Reading thinking does not change the answer later steps receive, the tools the agent calls, or who is allowed to see the run.

### Out of Scope
- Editing, deleting, or inserting thinking, or sending new instructions into an agent that is already thinking.
- A new pause that stops the agent on every thought. Stopping a run and answering an existing human decision stay as they are today.
- Forcing an agent to produce thinking when it does not share any.
- Showing thinking to someone who cannot already view that run, or adding a separate redaction or export product for thinking.
- Changing how an agent decides, which tools it may use, or what counts as its answer.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read Thinking While the Agent Works (Priority: P1)

An operator starts a workflow and stays with the run. They open the agent step that is working. A Thinking area on that step shows the working text the agent shares, in order, and new text appears while they watch. They do not reload the page, leave the run, or open a raw data view.

**Why this priority**: Seeing the thinking during the work is the reason for the feature. Without it, the operator still cannot tell what the agent is about to do.

**Independent Test**: Run a workflow whose agent shares thinking before it finishes. Open that step while it is working and confirm the Thinking area shows the text in order and updates without a reload.

**Acceptance Scenarios**:

1. **Given** an agent step is working and has shared thinking, **When** the operator opens that step on the live workflow canvas, **Then** a labeled Thinking area shows that thinking in the order it was produced.
2. **Given** the operator is watching that Thinking area, **When** the agent shares more thinking, **Then** the new text appears without a reload and without leaving the run.
3. **Given** the agent thinks, uses a tool, then thinks again, **When** the operator reads the step, **Then** they can follow that sequence and tell each stretch of thinking from the tool activity.
4. **Given** several agent steps are in one run, **When** the operator opens one of them, **Then** its Thinking area contains only that step's thinking.

---

### User Story 2 - Keep Thinking Separate from the Answer (Priority: P1)

The operator can tell, at a glance, what the agent was considering and what it actually answered. The answer that later steps receive is unchanged by making the thinking visible.

**Why this priority**: If thinking is mixed into the answer, the operator can mistake a draft consideration for the result, and the rest of the workflow can change without anyone intending it.

**Independent Test**: Complete an agent step that shares both thinking and an answer. Confirm the two are labeled separately, and confirm the next step still receives the same answer it would have received before this feature.

**Acceptance Scenarios**:

1. **Given** an agent step has shared thinking and an answer, **When** the operator views the step, **Then** the thinking and the answer are in separate labeled areas.
2. **Given** thinking is visible, **When** the workflow continues to the next step, **Then** that next step receives the agent's answer and does not receive the thinking as its input.
3. **Given** the operator is skimming the step, **When** they look at the Thinking area, **Then** it is identified as thinking, not as the step result.

---

### User Story 3 - Review Thinking After the Step Ends (Priority: P1)

After the agent finishes, the operator can still read what it thought. The same is true if they stop the run after reading the thinking, or if the step fails. A later opening of that run shows the same thinking, on both the workflow canvas and the run review, without a raw data view.

**Why this priority**: Control includes looking back. A thought that disappears when the step ends cannot be used to decide what to change next time.

**Independent Test**: Finish one agent step, stop a second run while the agent is still sharing thinking, and fail a third. Reopen each run and confirm the thinking produced up to that point is still readable and matched to the outcome.

**Acceptance Scenarios**:

1. **Given** an agent step completed after sharing thinking, **When** the operator reviews that run later, **Then** the full thinking from that step is still readable and labeled with the completed outcome.
2. **Given** the operator stops the run while an agent step is sharing thinking, **When** they review the stopped run, **Then** the thinking produced before the stop remains readable and is labeled as stopped.
3. **Given** an agent step fails after sharing thinking, **When** the operator reviews the failure, **Then** the thinking produced before the failure remains readable and is labeled as failed.
4. **Given** a stored run with thinking, **When** the operator opens it on the workflow canvas or in the run review, **Then** they can read that thinking in both places without opening a raw data view.
5. **Given** an agent step ran more than once, **When** the operator reviews it, **Then** each attempt's thinking is identifiable as belonging to that attempt.

---

### User Story 4 - Follow Along Without Losing Your Place (Priority: P2)

While thinking is arriving, the view keeps the latest text in sight if the operator is following it. If they scroll back to read an earlier passage, new thinking does not pull them away from that passage. They can still reach the latest text when they choose.

**Why this priority**: Live thinking is only useful if a long passage can be read. It is secondary to showing the text at all.

**Independent Test**: Watch a long thinking passage, scroll up to an earlier paragraph while more text arrives, confirm the view stays on that paragraph, then move to the latest text and confirm it is all still there.

**Acceptance Scenarios**:

1. **Given** the operator is following the latest thinking, **When** more thinking arrives, **Then** the latest text stays in view.
2. **Given** the operator has scrolled to an earlier part of the thinking, **When** more thinking arrives, **Then** the view stays where they were reading.
3. **Given** a long thinking passage, **When** the operator reads it, **Then** they can reach the beginning and the end. No part is permanently cut off.

---

### User Story 5 - Know When Thinking Is Missing (Priority: P2)

If the agent did not share thinking, the operator sees that stated. If they open an older run that never stored thinking, they see that thinking is unavailable for that run. The two messages are different, and the product does not invent a thought in either case.

**Why this priority**: A blank area can be read as "the agent decided nothing" or as a broken screen. The distinction matters, but only after real thinking is visible.

**Independent Test**: Run an agent that shares no thinking and confirm the explicit "no thinking was shared" message. Open an older run that has no stored thinking and confirm the different "unavailable" message.

**Acceptance Scenarios**:

1. **Given** an agent step finishes without sharing thinking, **When** the operator views that step, **Then** the product says that no thinking was shared.
2. **Given** a past run has no stored thinking, **When** the operator reviews it, **Then** the product says thinking is unavailable for that run.
3. **Given** either of those cases, **When** the step is shown, **Then** the product does not invent thinking text.
4. **Given** the only thinking text is empty or whitespace, **When** the operator views the step, **Then** it is treated as no thinking shared.

---

### Edge Cases

- Thinking arrives only at the end of the step, not while it is working. It is still shown, labeled as thinking, and kept separate from the answer. The product does not present it as if it had been visible earlier.
- The operator stops the run or the step fails in the middle of a thought. The partial text remains readable and is labeled with that outcome.
- The same step is retried. Thinking from the failed attempt and the later attempt are both readable and tied to the correct attempt.
- Two agents work in one run. Opening one never shows the other's thinking.
- A tool runs between two stretches of thinking. The tool stays with tool activity, and each stretch stays in Thinking, in order.
- Thinking is very long. The operator can read all of it. Following the latest text does not discard the earlier text.
- The operator scrolled back to reread. Incoming thinking does not jump the view.
- An older run has no stored thinking. The message says unavailable. It does not say the agent shared nothing.
- A person who cannot view the run tries to open it. They still cannot view the run, and they do not gain a new path to its thinking.
- Making thinking visible does not change whether the run succeeds, which tools are called, or the answer later steps receive.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While an agent step is working, the product MUST show the thinking that step shares, in the order it was produced, in a labeled Thinking area for that step.
- **FR-002**: New thinking MUST appear on the open step without a reload and without leaving the run.
- **FR-003**: Thinking MUST be labeled and presented separately from the agent's answer, from tool activity, and from errors.
- **FR-004**: The answer passed to later steps MUST be the agent's answer. Thinking MUST NOT be added to that answer or shown as the step result.
- **FR-005**: Showing thinking MUST NOT change which tools the agent calls or whether the run succeeds.
- **FR-006**: Thinking produced before a step completes, is stopped, or fails MUST remain readable on that run and MUST be labeled with that outcome.
- **FR-007**: The operator MUST be able to read a run's stored thinking both on the live workflow canvas and in the run review, without opening a raw data view.
- **FR-008**: When a step runs more than once, each attempt's thinking MUST be identifiable as belonging to that attempt.
- **FR-009**: One step's Thinking area MUST contain only that step's thinking.
- **FR-010**: The operator MUST be able to read the full thinking text, from beginning to end. The product MUST NOT permanently hide or cut off part of it.
- **FR-011**: While the operator is following the latest thinking, the latest text MUST stay in view as more thinking arrives. While they are reading an earlier part, incoming thinking MUST NOT move the view away from that part.
- **FR-012**: When an agent step shares no thinking, including thinking that is empty or whitespace only, the product MUST say that no thinking was shared and MUST NOT invent any.
- **FR-013**: When a past run has no stored thinking, the product MUST say that thinking is unavailable for that run. That message MUST be distinct from the message used when an agent shared no thinking.
- **FR-014**: A person who can view a run MUST be able to view its thinking. A person who cannot view the run MUST NOT gain access to its thinking through this feature.
- **FR-015**: The Thinking area MUST be visible as part of the step. The operator MUST NOT have to open a closed technical disclosure or a raw data view to discover that thinking exists.

### Key Entities

- **Agent step**: One agent's work within a workflow run. It can share thinking, call tools, and produce an answer. It may be attempted more than once.
- **Thinking**: The working text an agent shares while deciding what to do. It is ordered, belongs to one step and one attempt, and is not the answer.
- **Answer**: The result the agent hands to the rest of the workflow. Later steps consume the answer, not the thinking.
- **Run review**: The operator's view of a run after opening it again, on the workflow canvas or in the run's own review, including completed, stopped, and failed runs.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: During a live agent step that shares thinking, an operator who has that step open can read the latest thinking within 5 seconds of it being produced, without reloading and without opening a raw data view.
- **SC-002**: For completed, stopped, and failed agent steps that shared thinking, all of that thinking is still readable afterward and is labeled separately from the answer, on both the workflow canvas and the run review.
- **SC-003**: In a review of 10 sample agent steps that contain both thinking and an answer, operators correctly identify which text is thinking and which is the answer on at least 9 of the 10 steps at first look.
- **SC-004**: An operator who reads live thinking and then stops the run still sees the thinking that had already appeared, labeled as stopped, when they reopen that run.
- **SC-005**: Steps that shared no thinking, and older runs with no stored thinking, each show their own explicit message. In a paired check of both cases, reviewers do not confuse one message with the other.

---

## Assumptions

- The operator is someone who can already view the workflow run. This feature does not widen who may see a run.
- "Thinking" means working text the agent shares with the application. Internal deliberation that the agent never shares cannot be shown. The product says no thinking was shared in that case and does not invent any.
- Some agents share thinking only when the step ends. It is still shown then, separate from the answer. The product does not claim it was visible while the step was still working.
- Stopping a run and answering an existing human decision remain the operator's controls. This feature makes thinking readable in time to use those controls. It does not add a way to rewrite a thought or to type new instructions into a running agent.
- Runs that finished before this feature, and never stored thinking, can only report that thinking is unavailable. New runs store the thinking the agent shares so it can be reviewed later.
- Thinking is kept for as long as the rest of that run's visible record is kept, and it is removed with that run. No separate retention period is introduced.
- Empty or whitespace-only thinking is treated as no thinking shared.
- The workflow canvas during a live or reopened run, and the run review, are the two places operators already watch an agent. Both show thinking. No third viewing surface is required.
