# Feature Specification: In-Canvas Live Execution & Observability

**Feature Branch**: `011-canvas-live-observability`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Implement In-Canvas Live Execution & Observability Mode in the Workflow Editor so that running a workflow keeps the user on the visual canvas with live status, inspection, human approval, and run controls instead of redirecting to a separate non-visual run page."

---

## Architectural Context & Feature Boundary

### Current Gap
Today, starting a run from the workflow editor immediately navigates the operator away from the visual graph onto a dedicated run page that shows topology as a simplified text/grid layout. That break in spatial context prevents operators from watching which path the run took, inspecting step results on the graph itself, or approving human gates without leaving the design surface.

### Scope of This Feature
Unify **design** and **live observability** in the workflow editor:

1. **Dual modes**: Editor stays in Design mode by default; Run switches the same canvas into Live Observability mode without leaving the page.
2. **Live visual feedback**: Nodes and connections reflect real-time execution state (active, waiting, completed, failed, skipped) while the run progresses.
3. **In-place step inspection**: Operators can open a side inspector on any node to see inputs, timing, streaming output, tool activity, results, and errors.
4. **In-canvas human decisions**: Approval and clarification requests can be reviewed and answered from the canvas.
5. **Run control tray**: Compact status, elapsed time, step budget, cancel/retry, and a filterable event feed remain available without leaving Live mode.
6. **Deep links & compatibility**: Existing or historical runs can be opened onto the canvas via URL; bookmarks to the standalone run experience continue to work.

### Out of Scope
- Changing execution engine semantics, step budgets, or approval policy rules beyond presenting existing capabilities on the canvas.
- Replacing or removing the standalone run page’s core usefulness (it must remain reachable or gracefully land operators on the studio with the same run).
- Offline or disconnected replay authoring tools beyond loading an existing run’s observed state onto the canvas.
- Mobile-native redesign of the editor.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run Without Leaving the Canvas (Priority: P1)

An operator editing a workflow clicks **Run**. The system starts the run, keeps them on the same visual canvas, and enters Live Observability mode. They can exit Live mode and return to Design mode at any time without losing the workflow they were editing. They can also open an existing or historical run onto the canvas using a shared URL that includes the workflow and run identifiers.

**Why this priority**: Ending the redirect is the core value; without it, none of the in-canvas observability features are reachable from the primary authoring path.

**Independent Test**: Start a run from the editor toolbar, confirm the URL stays on the studio/editor surface with a run identifier available, confirm Live mode is active, then exit Live mode and resume editing.

**Acceptance Scenarios**:

1. **Given** a valid runnable workflow is open in Design mode, **When** the operator clicks Run, **Then** a new run starts and the canvas switches to Live mode without navigating to a separate non-visual run page.
2. **Given** Live mode is active, **When** the operator chooses Exit Live Mode / Back to Editor, **Then** the canvas returns to Design mode and editing controls are available again.
3. **Given** a shared studio URL that includes both workflow and run identifiers, **When** an authorized operator opens it, **Then** the matching workflow loads on the canvas in Live Observability mode for that run.
4. **Given** an operator has a bookmark or link to the standalone run page, **When** they open it, **Then** they can still view that run (standalone page remains usable, or they are landed on the studio canvas with the same run loaded).

---

### User Story 2 - See Live Path and Node Status on the Graph (Priority: P1)

While a run is live (or while reviewing a loaded run), the operator sees which connections have been taken and which nodes are idle, running, waiting for a human, completed, failed, or skipped—using clear visual cues that preserve the graph layout they designed.

**Why this priority**: Restoring spatial awareness during execution is the primary reason to keep operators on the canvas.

**Independent Test**: Run a multi-step workflow with at least one conditional branch; verify traversed connections animate/highlight and node shells update through active → completed (and failed/skipped where applicable) without leaving the canvas.

**Acceptance Scenarios**:

1. **Given** Live mode is attached to an in-progress run, **When** a connection is traversed, **Then** that connection becomes visually active (animated/glowing) using the branch’s theme affordance (e.g., normal vs conditional).
2. **Given** a node has not started, **When** the operator views the canvas, **Then** it shows a neutral idle/queued appearance.
3. **Given** a node or nested tool step is actively executing, **When** the corresponding start event is observed, **Then** the node shows a distinct active/running appearance (e.g., pulsing ring with activity indicator).
4. **Given** the run is waiting on human approval, **When** that pause is observed, **Then** the relevant approval node shows a distinct waiting appearance (e.g., amber warning treatment).
5. **Given** a node completes successfully, **When** completion is observed, **Then** the node shows a clear success appearance (e.g., solid success ring with checkmark).
6. **Given** a node fails, **When** failure is observed, **Then** the node shows a clear failure appearance including an alert affordance and available error code/summary cue.
7. **Given** a branch is skipped, **When** skip is observed, **Then** affected nodes appear dimmed with a skipped indicator.

---

### User Story 3 - Inspect a Node’s Execution In Place (Priority: P1)

In Live mode, clicking a node opens a slide-over inspector without tearing down the canvas. The inspector shows the exact input the step received, timing/attempt metadata, live streaming output and reasoning for agent steps, nested tool calls with arguments and results, the final structured result, and error/contract-violation details when failed.

**Why this priority**: Operators need intermediate evidence without leaving the graph; this replaces the lost context of the dedicated run page for day-to-day debugging.

**Independent Test**: During or after a run, click an agent node that produced streaming output and tool calls; verify the inspector shows input, timing, streamed content, tools, and final result (or error) while the canvas remains visible.

**Acceptance Scenarios**:

1. **Given** Live mode is active, **When** the operator clicks a node, **Then** a Node Execution Inspector opens as a slide-over and the canvas remains mounted and visible.
2. **Given** the inspector is open for a node, **When** execution data is available, **Then** the operator can view the exact input payload for that step.
3. **Given** the inspector is open, **When** timing metadata exists, **Then** the operator can see step index, attempt count, duration, and relevant timestamps.
4. **Given** an agent node is streaming, **When** token/thought/output events arrive, **Then** the inspector updates live without requiring a page reload.
5. **Given** the node invoked tools, **When** the operator expands tool activity, **Then** they see nested tool calls with arguments and return values.
6. **Given** the node finished, **When** viewing the inspector, **Then** the final result envelope (status, value, evidence) is visible.
7. **Given** the node failed, **When** viewing the inspector, **Then** terminal error text, contract-violation details (if any), and retry/attempt count are visible.

---

### User Story 4 - Approve or Clarify Without Leaving the Canvas (Priority: P2)

When a run hits a human approval gate, the operator sees an unobtrusive in-canvas banner and a highlighted approval node. Authorized reviewers can read the consolidated gap report, enter decision notes, and submit Approve, Reject, or Clarification from the canvas so execution resumes or follows the existing decision path without a full page reload.

**Why this priority**: Human-in-the-loop is a blocking path; solving it on-canvas completes the “stay in studio” promise for gated workflows.

**Independent Test**: Run a workflow that requests approval; from Live mode, submit Approve with notes and confirm the run resumes and canvas status updates without navigation away.

**Acceptance Scenarios**:

1. **Given** an approval is requested, **When** Live mode is showing that run, **Then** an in-canvas notification banner appears and the approval node is highlighted.
2. **Given** an authorized reviewer opens the approval UI from the canvas, **When** they review the consolidated gap report, **Then** they can enter decision notes and choose Approve, Reject, or Clarification.
3. **Given** a valid decision is submitted from the canvas, **When** the server accepts it, **Then** the run continues according to existing rules and the canvas reflects the updated status without a full page reload.
4. **Given** a user lacks approval authority, **When** they view the gate, **Then** they can see that action is needed but cannot submit a decision (consistent with existing authorization).

---

### User Story 5 - Control the Run from a Bottom Tray (Priority: P2)

In Live mode, a collapsible bottom tray shows run status, elapsed time, step budget progress, Cancel, Retry (when failed), and a compact filterable event feed (Node / Error / Tool).

**Why this priority**: Operators need continuous run control and a lightweight timeline without abandoning the graph or relying solely on the inspector.

**Independent Test**: Enter Live mode, collapse/expand the tray, cancel a running workflow, and filter the event feed to Errors only.

**Acceptance Scenarios**:

1. **Given** Live mode is active, **When** the tray is visible, **Then** it shows a status badge among: running, waiting_for_human, completed, failed, cancelled (or equivalent existing status labels).
2. **Given** a run is in progress, **When** the operator views the tray, **Then** elapsed runtime and step budget counters update (e.g., step X of the configured maximum).
3. **Given** a run is cancellable, **When** the operator clicks Cancel/Abort, **Then** cancellation is requested through the existing control path and status updates on the canvas/tray.
4. **Given** a run has failed, **When** Retry is available, **Then** the operator can trigger a whole-run retry from the tray.
5. **Given** events are streaming, **When** the operator filters the compact feed by Node, Error, or Tool, **Then** only matching events remain visible in the tray.

---

### Edge Cases

- What happens if the operator clicks Run while already in Live mode for another run? Starting a new run replaces the attached live context for the current canvas session after clear confirmation or explicit new-run action; the previous run remains reachable via its URL/run page.
- What happens if the live event stream disconnects mid-run? The canvas shows a recoverable connection state, attempts to reattach using existing authenticated channels, and does not invent missing step outcomes.
- What happens if the operator exits Live mode while a run continues? The run keeps executing server-side; re-entering Live mode (or opening the run URL) reattaches to current observed state.
- What happens if the workflow graph was edited after the run started? Live mode reflects the graph version associated with the run’s execution context; Design mode shows the current draft separately when the operator exits Live mode.
- What happens if a node is clicked in Design mode vs Live mode? Design mode keeps existing property-editing behavior; Live mode opens the execution inspector instead of edit panels.
- What happens under a high volume of streaming tokens? Visual node/edge status updates remain responsive; token text updates are localized so the whole graph does not become unusable.
- What happens for skipped branches with no events yet? Nodes remain idle until skip/complete/fail is observed; no speculative success styling.
- What happens if approval is submitted twice or the gate is already resolved? The UI reflects the terminal decision and blocks duplicate submissions with a clear message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The workflow editor MUST support two explicit operator modes: Design (default) and Live Observability.
- **FR-002**: Choosing Run from the editor MUST start a run through the existing authenticated execution control plane and enter Live mode on the same canvas without redirecting away from the studio surface.
- **FR-003**: Operators MUST be able to exit Live mode and return to Design mode at any time via an explicit toolbar control.
- **FR-004**: The studio MUST support loading an existing/historical run onto the canvas when workflow and run identifiers are provided in the URL.
- **FR-005**: Existing standalone run links MUST continue to work (page remains functional or lands on the studio with the same run loaded).
- **FR-006**: In Live mode, traversed connections MUST update visually to indicate the path taken, distinguishing normal vs conditional branch styling where applicable.
- **FR-007**: In Live mode, each node MUST reflect observed execution state among at least: idle/queued, running/active, waiting for human, completed, failed, and skipped.
- **FR-008**: In Live mode, selecting a node MUST open a Node Execution Inspector slide-over without unmounting or replacing the canvas.
- **FR-009**: The inspector MUST present available step input payload, timing/attempt metadata, streaming agent output/thoughts, nested tool calls (arguments and returns), final result envelope, and failure details when present.
- **FR-010**: When a human approval is requested, Live mode MUST show an in-canvas banner, highlight the approval node, and allow authorized reviewers to submit Approve, Reject, or Clarification with notes using existing authorization and control-plane rules.
- **FR-011**: Live mode MUST provide a collapsible bottom tray with run status, elapsed time, step budget progress, Cancel, Retry-on-failure, and a compact event feed filterable by Node, Error, and Tool.
- **FR-012**: The browser MUST remain a control plane only: event display, status derivation, and approval submissions MUST go through existing authenticated execution channels; the client MUST NOT become an authority for run outcomes.
- **FR-013**: Live mode MUST keep the canvas usable during high-frequency streaming updates (operators can still pan/zoom and select nodes; status feedback remains coherent).
- **FR-014**: Design-mode editing affordances (drag, connect, delete, property edit) MUST be disabled or clearly gated while Live mode is active so operators do not mutate the draft under the impression they are changing the in-flight run.
- **FR-015**: Cancel, Retry, and approval actions from the canvas MUST use the same server-mediated operations already available on the dedicated run experience (no alternate unsigned client authority).

### Key Entities

- **Editor Mode**: Design vs Live Observability; governs which interactions and overlays are available on the shared canvas.
- **Observed Run**: A specific workflow execution attached to the canvas, including status, elapsed time, step budget usage, and event history.
- **Node Execution View**: Per-node observed input, timing, streams, tool calls, result envelope, and errors for inspector display.
- **Traversed Connection**: A graph edge that has been taken during the run and should be visually emphasized.
- **Human Decision Request**: An approval/clarification gate with gap report content, notes, and allowed decision outcomes.
- **Run Control Tray**: Collapsible summary of status, counters, actions, and filtered event feed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability checks, at least 90% of operators who start a run from the editor remain on the visual canvas in Live mode without needing the standalone run page to understand progress.
- **SC-002**: Operators can identify the active node and taken path on a sample multi-branch workflow within 5 seconds of those states occurring, using only on-canvas cues.
- **SC-003**: Operators can open a node inspector and locate input, final result (or error), and at least one tool call (when present) in under 30 seconds without leaving the canvas.
- **SC-004**: Authorized reviewers can complete an Approve/Reject/Clarification decision entirely from Live mode in under 2 minutes for a standard gap report, with the run reflecting the decision without a full page reload.
- **SC-005**: During a run that produces continuous streaming output, operators can still pan, zoom, and select nodes without the canvas becoming unresponsive for more than brief (<1s) stalls in representative test workflows.
- **SC-006**: 100% of previously shared standalone run links either still open a usable run view or land on the studio with the same run attached (no dead bookmarks).
- **SC-007**: At least 80% of pilot operators report that Live mode improved their ability to debug branch choices compared with the prior redirect-only experience (survey or structured interview).

## Assumptions

- Existing run start, cancel, retry, approval submission, and live event streaming capabilities already exist via the authenticated execution control plane; this feature primarily relocates and visualizes them on the editor canvas.
- Authorization for viewing runs and submitting human decisions reuses current organization/run permissions; no new role model is introduced.
- Live mode is observational with respect to graph topology: operators edit the draft only after returning to Design mode.
- Opening a historical/completed run onto the canvas shows final observed statuses and allows inspection; streaming sections simply show completed content.
- Step budget display uses the workflow’s configured maximum (already surfaced elsewhere in the product).
- The standalone run page is retained for compatibility and deep links; primary authoring UX prefers staying in the studio.
- Visual treatments (colors, badges, animation) follow the product’s existing theme language (light/dark) and accessibility contrast expectations.
- “Whole-run Retry” means the same retry action already offered on the dedicated run experience, not a new partial-graph replay engine.
