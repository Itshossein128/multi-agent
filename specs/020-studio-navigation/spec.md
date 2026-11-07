# Feature Specification: Studio Navigation for Workflows

**Feature Branch**: `020-studio-navigation`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Remaining work from the visual platform audit, Finding 8 and roadmap Phase 5: rename the visual builder’s navigation entry from Org to Workflows, keep existing links working, and add a Templates section so people can find the builder and start from a starter workflow."

---

## Architectural Context & Feature Boundary

### Current Gap
The visual workflow builder is labeled **Org** and sits beside organization goals and organization settings. New people looking for workflows do not recognize that label. There is also no navigation destination whose job is to start from a known-good starter, so the builder is harder to discover than the product’s main job requires.

### Scope of This Feature
1. Present the visual builder as **Workflows** in primary navigation.
2. Keep every existing builder link working, including bookmarks and in-product links that still use the old Org address.
3. Add a **Templates** destination that lists starter workflows and creates a new workflow from the one the person chooses.
4. Leave Goals, Settings, and other existing destinations on their current jobs and addresses.

### Out of Scope
- A public template marketplace, cross-organization sharing, or template pricing.
- Redesigning the workflow canvas, run experience, or archetype behavior.
- Renaming Goals or Settings.
- Moving tasks, projects, budgets, or routines.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find the Builder Under Workflows (Priority: P1)

A person who wants to create or open a workflow looks at the main navigation, sees **Workflows**, and lands in the visual builder. They do not have to guess that **Org** means the canvas. The page they land on is the same builder they use today.

**Why this priority**: Discoverability of the builder is the defect the audit names. Templates are additional.

**Independent Test**: From a fresh session, use only the sidebar to open the builder. Confirm the label is Workflows and the visual canvas is the destination. Confirm Goals and Settings still open their current pages.

**Acceptance Scenarios**:

1. **Given** the main navigation, **When** a person looks under orchestration, **Then** they see **Workflows** and do not see a primary item labeled **Org** for the builder.
2. **Given** the person chooses **Workflows**, **When** the page opens, **Then** they are in the visual workflow builder.
3. **Given** **Goals** and **Settings**, **When** the person chooses either one, **Then** they reach the same goals and settings destinations as before.
4. **Given** a workflow the person already had, **When** they open **Workflows**, **Then** they can still reach that workflow.

---

### User Story 2 - Old Builder Links Keep Working (Priority: P1)

Someone opens a bookmark, a chat link, or an in-product control that still points at the old Org address for the builder, including addresses that name a workflow or a run. They arrive at the same builder state. The address they see can update to the Workflows address, and the workflow or run they asked for is still selected.

**Why this priority**: Renaming a primary address without preserving links would break shared run and edit URLs the studio already depends on.

**Independent Test**: Open the previous builder address with no query, with a workflow selected, and with a live run selected. Confirm each opens the matching builder state.

**Acceptance Scenarios**:

1. **Given** a bookmark to the old builder address, **When** it is opened, **Then** the visual builder opens.
2. **Given** an old address that selects a workflow, **When** it is opened, **Then** that workflow is selected in the builder.
3. **Given** an old address that selects a workflow and a run, **When** it is opened, **Then** the builder opens on that run the same way it does today.
4. **Given** a new Workflows address for the same workflow and run, **When** it is opened, **Then** the result matches the old address.

---

### User Story 3 - Start From a Template (Priority: P2)

A designer opens **Templates** from navigation or from the workflow area and sees starter workflows with short descriptions of what they are for. Choosing one creates a new workflow they can edit, already shaped as that starter. The new workflow is their own copy. Later edits to the starter do not change workflows already created from it.

**Why this priority**: Once the builder is findable, Templates remove the empty-canvas dead end. The builder rename is still valuable without it.

**Independent Test**: Open Templates, create a workflow from each listed starter, and confirm each new workflow opens in the builder and is a separate copy from the template.

**Acceptance Scenarios**:

1. **Given** primary navigation or the workflow area, **When** the designer looks for starters, **Then** they find a **Templates** destination.
2. **Given** Templates, **When** the list is shown, **Then** each starter has a name and a one-line description of the workflow shape it creates.
3. **Given** a starter, **When** the designer creates from it, **Then** a new editable workflow opens in the builder with that starter’s structure.
4. **Given** a workflow already created from a starter, **When** the product later changes that starter, **Then** the existing workflow is not rewritten.

---

### Edge Cases

- A bookmarked Org address includes an unknown workflow or run: the product shows the same not-found behavior it shows today for a bad Workflows address, not a blank or unrelated page.
- The person lacks permission to create workflows: Templates explains that they cannot create one, and does not create a partial workflow.
- The person lacks permission to open the builder: Workflows is hidden or denied the same way the builder is denied today, and Goals remains available if they may open Goals.
- Two people create from the same starter at the same time: each receives their own workflow.
- Collapsed or narrow navigation still shows a recognizable Workflows entry and does not leave an unlabeled Org icon as the only cue.
- Search or command palette entries that pointed at Org, if any exist, open the builder under the Workflows name.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Primary navigation MUST label the visual workflow builder **Workflows**.
- **FR-002**: Choosing **Workflows** MUST open the visual workflow builder.
- **FR-003**: The primary navigation MUST NOT label that builder **Org**.
- **FR-004**: Existing addresses that open the builder, including those that select a workflow or a run, MUST continue to open that same builder state.
- **FR-005**: New shared addresses for the builder MUST use the Workflows destination and MUST preserve workflow and run selection.
- **FR-006**: **Goals** and **Settings** MUST remain separate destinations with their current purpose.
- **FR-007**: The product MUST offer a **Templates** destination reachable from navigation or from the workflow area.
- **FR-008**: Templates MUST list the product’s starter workflows with a name and a short description.
- **FR-009**: Creating from a template MUST create a new workflow that is an editable copy and MUST open it in the builder.
- **FR-010**: Changing a starter later MUST NOT change workflows already created from it.
- **FR-011**: A person who is not allowed to create workflows MUST NOT get a new workflow from Templates, and MUST see a clear denial.
- **FR-012**: A person who is not allowed to open the builder MUST NOT gain access through the renamed entry or through Templates.

### Key Entities

- **Workflows Entry**: The primary navigation item that opens the visual builder.
- **Legacy Builder Address**: An existing link that used the Org destination and must still open the builder.
- **Template**: A starter workflow description the designer can copy into a new workflow.
- **Workflow Copy**: The new workflow created from a template, independent of later starter changes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a first-visit walkthrough, at least 4 of 5 people open the visual builder from navigation in under 30 seconds, and each of them identifies the entry as Workflows.
- **SC-002**: 100% of checklist bookmarks for the old builder address, with and without a workflow and a run, open the same builder state as the matching Workflows address.
- **SC-003**: 100% of checklist visits to Goals and Settings still land on those destinations and not on the canvas.
- **SC-004**: At least 4 of 5 designers create a workflow from Templates and see an editable copy in the builder in under 1 minute.
- **SC-005**: After a starter is revised, 100% of workflows previously created from it stay unchanged in a regression sample.

## Assumptions

- The builder’s own address reads as Workflows, and the previous Org address opens that same builder. People should be able to tell from the address that they are in Workflows.
- The starter list matches the workflow shapes the product can already create, including the current archetype starters. This feature does not invent new archetype behavior.
- A template copy is a snapshot. It is not a live link to the starter.
- Organization-defined custom templates, cross-organization sharing, and a marketplace are later work. v1 ships product starters only.
- Permission checks already used for opening and creating workflows apply to the renamed entry and to Templates.
- In-product links that target the builder are updated to the Workflows name as part of this feature, while old addresses keep working.
- Narrow and collapsed navigation must still name or otherwise identify Workflows accessibly, not only by an icon with the old Org name.
