# Feature Specification: Workflow Releases and Visual Diff

**Feature Branch**: `022-workflow-releases`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Remaining work from the visual platform audit, roadmap Phase 5: add draft and published workflow releases with an immutable published history and a visual diff so designers can see what changed before they publish or restore."

---

## Architectural Context & Feature Boundary

### Current Gap
A workflow is edited and run as one moving definition. Designers cannot publish a known version, keep editing a draft, see a visual difference between the two, or restore an older published workflow without losing history. Shared and automated runs can pick up unfinished edits. The audit calls for draft/publish versioning and visual diffing before the studio is safe to treat as a production authoring surface.

### Scope of This Feature
1. Each workflow has one editable **draft** and zero or more immutable **published releases**.
2. Publishing the draft creates the next release and does not block further draft edits.
3. Designers can view a visual diff between the draft and a release, or between two releases.
4. Routines and other published entry points run the latest release. A run already in progress keeps the release it started with. Editor draft runs stay available and are clearly marked as drafts.
5. Restoring an older release creates a new release with that content and leaves history intact.

### Out of Scope
- Separate development, staging, and production environments, or promotion pipelines between them.
- A second approval board just for publishing.
- Git-style branches or multiple parallel drafts.
- Versioning agent registry records or tool definitions as their own product. A release records the workflow graph and the step settings saved on it.
- Rewriting or deleting historical releases.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish a Release and Keep Editing (Priority: P1)

A designer finishes a workflow and publishes it. The product records a numbered release that will not change. They continue editing the draft. The draft and the latest release can differ. Anyone opening the release still sees the published graph.

**Why this priority**: An immutable published snapshot is the foundation for diff, safe automation, and restore.

**Independent Test**: Publish a two-step workflow, change the draft by adding a step, reopen the latest release, and confirm the release still has two steps while the draft has three.

**Acceptance Scenarios**:

1. **Given** a workflow with unsaved validation errors, **When** the designer tries to publish, **Then** publish is blocked and the errors are shown. No release is created.
2. **Given** a valid draft, **When** the designer publishes, **Then** a new numbered release is saved and identified as the latest release.
3. **Given** a release, **When** the designer edits the canvas afterward, **Then** the draft changes and the release does not.
4. **Given** a person reopening that release, **When** it loads, **Then** they see the steps, connections, and step settings from publish time.

---

### User Story 2 - See What Changed (Priority: P1)

Before publishing, or when reviewing history, a designer opens a visual diff. They can tell which steps and connections were added, removed, or changed, and which step settings changed, without reading a code patch. Comparing the draft to the latest release and comparing two releases both work.

**Why this priority**: Version numbers without a visual diff do not meet the audit and are easy to misread on a canvas product.

**Independent Test**: Change a step’s title, add one step, remove one connection, and open the diff against the latest release. Confirm all three kinds of change are visible and labeled. Then compare two older releases and confirm the diff matches their contents.

**Acceptance Scenarios**:

1. **Given** a draft that differs from the latest release, **When** the designer opens the diff, **Then** they see added, removed, and changed steps and connections in a visual presentation.
2. **Given** a step whose settings changed but whose place on the canvas did not, **When** the diff is open, **Then** that step is marked changed and the designer can read what setting changed.
3. **Given** two releases, **When** the designer compares them, **Then** the diff shows the differences between those releases only.
4. **Given** a draft identical to the latest release, **When** the designer opens the diff, **Then** the product states that there is no difference.

---

### User Story 3 - Run the Release You Meant (Priority: P1)

A routine or a published run uses the latest release, even while the draft has newer edits. A designer can still run the draft from the editor, and that run is labeled a draft run. A run that already started keeps the version it started with after a later publish. If the workflow has never been published, automated and shared published entry points do not run it, and they say that a release is required.

**Why this priority**: Publishing is not real if unfinished draft edits can change production runs.

**Independent Test**: Publish, change the draft, start a routine run, and confirm it follows the release. Start a draft run from the editor and confirm it follows the draft and is labeled draft. Publish again during an in-flight run and confirm that run does not switch versions.

**Acceptance Scenarios**:

1. **Given** a latest release and a different draft, **When** a routine or published entry point starts a run, **Then** the run uses the latest release.
2. **Given** the editor, **When** the designer runs the open draft, **Then** the run uses the draft and is visibly marked as a draft run.
3. **Given** a run already in progress, **When** a newer release is published, **Then** the in-progress run continues on the version it started with.
4. **Given** a workflow that has never been published, **When** someone uses a published entry point, **Then** the run does not start and the message says a release is required.

---

### User Story 4 - Restore an Older Release (Priority: P2)

A designer selects an older release and restores it. The product publishes a new release whose content matches that older release and makes it the latest. The older release remains in history. The current draft is not destroyed without a confirmation that explains it will be replaced by the restored content.

**Why this priority**: Restore is necessary for production use, but only after publish, diff, and run-targeting are true.

**Independent Test**: Publish v1, publish v2 with a visible extra step, restore v1, and confirm the new latest release matches v1, v1 and v2 still exist, and a published run uses the restored content.

**Acceptance Scenarios**:

1. **Given** at least two releases, **When** the designer restores an older one and confirms, **Then** a new latest release matches that older content.
2. **Given** a restore, **When** history is opened, **Then** the older release and every release after it are still present and unchanged.
3. **Given** a draft that differs from the restored content, **When** the designer confirms restore, **Then** the draft becomes a copy of the restored content and the confirmation explained that replacement.
4. **Given** the designer cancels the confirmation, **When** they return, **Then** the draft and the latest release are unchanged.

---

### Edge Cases

- Two designers publish the same draft at the same time: one publish wins as the next number, the other is asked to refresh and diff again, and no release is silently overwritten.
- A release is published with a nested workflow reference: the release records the nested workflow release it should use. Later draft edits inside the nested workflow do not change runs of the already published parent. If the nested workflow has no release, the parent cannot be published until that dependency is published.
- A visual diff of a large workflow: added, removed, and changed items remain listed even if the canvas is crowded, so nothing is only implied by color.
- The draft fails validation after a release already exists: published entry points still use the latest release. A draft run stays blocked while that draft has blocking validation errors.
- Rollback of the only release: restore is unnecessary; history still cannot be deleted.
- A person who is allowed to view a workflow but not edit it can open releases and diffs and cannot publish or restore.
- Past runs still open against the version they used after a restore and after the designer has moved on to a newer draft.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each workflow MUST have one editable draft and a history of immutable published releases.
- **FR-002**: Publishing MUST create the next numbered release from the current valid draft and MUST leave that release unchanged by later draft edits.
- **FR-003**: Publish MUST be blocked while the draft has validation errors that already block a run. No partial release is created.
- **FR-004**: Designers MUST be able to open a visual diff between the draft and a release, and between two releases, showing added, removed, and changed steps and connections, plus changed step settings.
- **FR-005**: An identical comparison MUST say there is no difference.
- **FR-006**: Routines and other published entry points MUST run the latest release.
- **FR-007**: A draft run started from the editor MUST use the draft and MUST be labeled as a draft run everywhere that run is listed or opened.
- **FR-008**: A workflow with no release MUST NOT start from a published entry point, and the denial MUST say that a release is required.
- **FR-009**: A run MUST keep the draft or release it started with for its whole lifetime, including across later publishes.
- **FR-010**: Restoring an older release MUST create a new latest release with the same content and MUST NOT modify or delete any existing release.
- **FR-011**: Restore MUST require confirmation before replacing the current draft, and cancel MUST leave the draft and latest release unchanged.
- **FR-012**: Simultaneous publish attempts MUST NOT overwrite a release. The losing attempt MUST be told to refresh.
- **FR-013**: A published workflow that uses a nested workflow MUST bind to a published release of that nested workflow. Later edits to the nested draft MUST NOT change the parent release. A missing nested release MUST block the parent publish.
- **FR-014**: Past runs MUST remain explainable against the version they used, including after a later restore or after the draft has changed.
- **FR-015**: Designers who cannot edit the workflow MUST NOT publish or restore. Designers who cannot run drafts MUST NOT start a draft run.

### Key Entities

- **Draft**: The single editable workflow definition.
- **Release**: An immutable numbered published snapshot of the draft at publish time, including step settings and nested-workflow release bindings.
- **Visual Diff**: A designer-facing comparison of steps, connections, and step settings between two versions.
- **Draft Run**: An editor-started run that uses the draft and is labeled as such.
- **Published Run**: A run started from a release by a published entry point, bound to that release for its lifetime.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 4 of 5 designers publish a valid workflow, edit the draft, and reopen the previous release unchanged in under 3 minutes.
- **SC-002**: At least 4 of 5 designers correctly identify an added step, a removed connection, and a changed setting from the visual diff alone in under 2 minutes.
- **SC-003**: 100% of checklist routine runs started while a draft differs from the latest release follow the latest release, and 100% of editor draft runs are labeled as drafts.
- **SC-004**: 100% of in-progress runs in the checklist keep their starting version after a later publish.
- **SC-005**: After restore, 100% of checklist cases have a new latest release matching the selected older content, with every prior release still present and unchanged.
- **SC-006**: 100% of publish attempts on an invalid draft or on a parent whose nested workflow has no release are blocked and create no release.

## Assumptions

- One draft per workflow is enough. Parallel private branches are out of scope.
- Release numbers are simple increasing versions (1, 2, 3) visible to designers. The exact format is a planning detail as long as order is obvious and values are never reused.
- “Published entry points” means routines and any non-editor action that starts a workflow for ongoing use. The editor’s Run action remains a draft run so the design-and-run loop stays intact, and it is labeled so nobody confuses it with the release.
- Existing runs that predate this feature are treated as historical runs bound to the definition they already captured, and they do not need to be rewritten.
- Nested workflow binding upgrades today’s “latest saved draft” behavior only for published parent releases. Draft authoring may still follow the draft nested workflow until publish, at which point FR-013 applies.
- Validation errors that already block running also block publishing. This feature does not invent a second rule set.
- Visual diff is a canvas or structured visual summary a designer can read. A text-only patch is not the primary presentation.
- Environment promotion and publish approvals are separate future governance. Any designer who can already edit the workflow can publish, unless an existing role already forbids editing.
