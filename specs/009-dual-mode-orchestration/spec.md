# Feature Specification: Dual-Mode Multi-Agent Orchestration (Linear Pipeline & Hierarchical Supervisor with Board Sync)

**Feature Branch**: `009-dual-mode-orchestration`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Dual-Mode Multi-Agent Orchestration (Linear Pipeline & Hierarchical Supervisor with Board Sync) supporting core reusable workflow archetypes in @multi-agent/types, Studio task management tool in src/tools/, workflow switcher coexistence in Studio UI (WorkflowSwitcher.tsx), registration and testing in org-building-gap, sandboxed execution barrier (workspaces/building-management-sandbox), and human approval gates."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Workflow Switcher Coexistence & Archetype Selection (Priority: P1)

An organization administrator or workflow operator navigating the Studio Organization interface (`/o/building-gap/org`) needs to inspect and select between two distinct multi-agent orchestration archetypes:
1. The **Linear Spec-to-Code Pipeline** (an end-to-end sequential pipeline suitable for straightforward, batch delivery with direct node handoffs).
2. The **Hierarchical Supervisor & Board-Driven Orchestrator** (a hub-and-spoke supervisor architecture capable of dynamic task dispatch, feedback remediation loops, and bi-directional Kanban board synchronization).

The operator selects between these workflows via the existing workflow switcher UI component. The interface immediately switches the visual canvas, active nodes, and runtime configuration to the chosen workflow archetype without data collisions, state corruption, or disruption to existing workflows.

**Why this priority**: Coexistence is essential to guarantee business continuity. Existing linear operations must remain 100% stable while introducing advanced hierarchical orchestration in parallel within the same tenant.

**Independent Test**: Can be tested by opening `/o/building-gap/org`, selecting the Linear Pipeline from the switcher dropdown, verifying all linear nodes and edges render properly, switching to the Hierarchical Supervisor workflow, verifying its hub-and-spoke topology and approval gates render cleanly, and verifying that deep-linking via URL query parameters (`?workflowId=...`) reliably loads the exact target workflow.

**Acceptance Scenarios**:

1. **Given** both "Linear Spec-to-Code Pipeline" and "Hierarchical Supervisor Workflow" are registered under organization `org-building-gap`, **When** an operator navigates to `/o/building-gap/org`, **Then** both workflow options appear in the workflow switcher dropdown.
2. **Given** an operator selects "Hierarchical Supervisor Workflow", **When** the canvas loads, **Then** the supervisor hub node, auditor node, consolidator node, human approval gate, implementation engineer, and QA verifier nodes are visibly arranged with their corresponding condition routing edges.
3. **Given** an operator has made unsaved modifications on the current workflow canvas, **When** they attempt to switch workflows, **Then** the system prompts for confirmation before discarding changes, preventing accidental loss.
4. **Given** a direct URL containing `?workflowId=linear-spec-pipeline` or `?workflowId=supervisor-gap-delivery-workflow`, **When** the operator loads or shares the link, **Then** the page automatically selects and displays the specified workflow.
5. **Given** the Linear Spec-to-Code Pipeline is active, **When** its graph definition is retrieved, **Then** its original linear topology, node bindings, and execution parameters are completely identical to the pre-existing baseline.

---

### User Story 2 - Supervisor Orchestration with Bi-directional Studio Task Board Sync (Priority: P1)

When executing large-scale multi-feature delivery (such as the 42 building management user stories in `org-building-gap`), the Lead Orchestrator agent acts as a supervisor: querying queued tasks from the organization's Studio Task Board, dispatching tasks to specialized sub-agents (e.g., Spec & Code Auditor), synchronizing task statuses (`queued` -> `in_progress` -> `in_review` -> `done`), and posting detailed audit reports and gap evidence into task comments.

**Why this priority**: Autonomous multi-agent systems must provide end-to-end transparency. Stakeholders and managers rely on the Kanban board to track progress, inspect audit findings, and observe real-time status transitions without digging into raw agent execution logs.

**Independent Test**: Can be tested by seeding queued tasks on the organization board, triggering the supervisor orchestrator with access to the Studio Task Management tool, and verifying that tasks transition across lifecycle states while audit findings, percentage completeness, and identified gaps appear chronologically in task comments.

**Acceptance Scenarios**:

1. **Given** queued tasks on the organization board (`/o/building-gap/tasks`), **When** the Supervisor Lead Orchestrator initiates an execution cycle, **Then** it queries and retrieves the list of pending tasks and their associated metadata.
2. **Given** a task selected for audit, **When** the supervisor dispatches the task to the Spec & Code Auditor, **Then** the task's status on the board transitions to `in_progress` and its assigned agent reflects the active auditor.
3. **Given** an auditor finishes evaluating a specification against the codebase, **When** the audit result envelope is returned, **Then** the supervisor automatically appends a structured comment to the task detailing completeness score, identified gaps, and referenced files.
4. **Given** audit findings have been recorded on a task, **When** the task awaits remediation or human sign-off, **Then** its status updates to `in_review`.
5. **Given** an audited task where remediation has completed, **When** the QA verification stage confirms all tests pass, **Then** the task status updates to `done` and completion timestamps are recorded.
6. **Given** an invalid task ID or unauthorized task modification attempt, **When** the orchestrator tool executes, **Then** the operation fails closed with a structured error without corrupting board state.

---

### User Story 3 - Sandboxed Workspace Isolation & Host Repository Protection (Priority: P1)

All file operations, code inspections, automated testing, and code remediation performed by agents in either workflow mode must execute strictly within an isolated sandbox environment (`workspaces/building-management-sandbox`). The host production repository (`/home/hossein/Desktop/projects/building-management`) must be strictly protected from any write access, modification, or deletion.

**Why this priority**: Preventing host repository contamination or inadvertent overwrites is an absolute safety requirement for autonomous agent code generation and execution.

**Independent Test**: Can be tested by launching agent tasks that attempt file reads and writes inside the designated sandbox directory, verifying they succeed, and simultaneously attempting writes or path traversals targeting the host repository directory, verifying they are blocked fail-closed with security violations.

**Acceptance Scenarios**:

1. **Given** an agent executing in the delivery workflow, **When** it creates, edits, or inspects files, **Then** all file paths resolve strictly inside `workspaces/building-management-sandbox`.
2. **Given** any agent operation attempting to write to or modify files in the host repository (`/home/hossein/Desktop/projects/building-management`), **When** the operation is evaluated, **Then** the execution barrier blocks the operation immediately and logs a security policy violation.
3. **Given** an agent attempting path traversal (e.g., `../../` escapes), **When** canonical path resolution occurs, **Then** any path resolving outside the designated sandbox root is rejected.
4. **Given** a complete workflow execution run, **When** the host repository directory is checked post-run, **Then** its `git status` confirms zero uncommitted changes, zero untracked files, and zero modified timestamps.

---

### User Story 4 - Mandatory Human Approval Gate Before Code Mutation (Priority: P1)

Before any remediation engineer agent can apply code changes, generate patches, or alter files in the sandbox workspace, the supervisor consolidates all audit findings and halts workflow progression at a mandatory Human Approval Gate. The human operator reviews the proposed remediation plan and must explicitly approve or reject the run.

**Why this priority**: Human-in-the-loop governance guarantees that automated agents never introduce unsolicited or dangerous code modifications without stakeholder review.

**Independent Test**: Can be tested by executing the supervisor workflow through intake, audit, and consolidation, verifying the workflow suspends at the Human Approval Gate with pending approval status, and confirming that remediation nodes remain unexecuted until an operator explicitly submits an approval signal.

**Acceptance Scenarios**:

1. **Given** the audit consolidation phase has completed, **When** the workflow reaches the approval node, **Then** workflow execution pauses and emits an approval request containing the consolidated gap summary.
2. **Given** an approval gate in `pending` status, **When** inspecting the downstream remediation and QA nodes, **Then** none of them have been scheduled, queued, or executed.
3. **Given** a human operator submits an "Approved" decision, **When** the approval is recorded, **Then** the workflow resumes execution and transitions into the remediation phase.
4. **Given** a human operator submits a "Rejected" decision with feedback, **When** the rejection is recorded, **Then** the workflow halts cleanly, records the rejection rationale, and transitions tasks to a paused/reviewed state without touching code.
5. **Given** an approval gate timeout or expired decision window, **When** the timeout threshold is reached, **Then** the workflow fails closed and does not proceed to code modification.

---

### User Story 5 - Adaptive QA Feedback & Remediation Loop with Recursion Guards (Priority: P2)

When code remediation is implemented in the sandbox, the Delivery QA Verifier node executes test suites against the changes. If tests fail or discrepancies are found, the Supervisor receives structured failure evidence and dynamically routes execution back to the remediation engineer for targeted fixes, up to a configurable maximum loop limit.

**Why this priority**: Real-world software delivery requires iterative correction. A rigid linear pipeline fails completely on the first test failure, whereas a hierarchical supervisor can self-correct within safety boundaries.

**Independent Test**: Can be tested by introducing a deliberate failing test in the sandbox, verifying that the QA node reports the failure to the Supervisor, confirming that the Supervisor re-routes to the remediation agent with failure details, and verifying that execution concludes when either tests pass or the recursion bound is reached.

**Acceptance Scenarios**:

1. **Given** an initial remediation attempt produces code that fails QA verification, **When** the QA node completes, **Then** it returns a structured failure envelope containing test output and failing assertions to the Supervisor.
2. **Given** the loop count is below the maximum allowed threshold (e.g., 3 iterations), **When** the Supervisor processes QA failure evidence, **Then** it routes execution back to the remediation node with specific remediation instructions.
3. **Given** a subsequent remediation iteration passes all QA checks, **When** QA reports success, **Then** the Supervisor routes execution to the final package output node and marks the corresponding board task as `done`.
4. **Given** a task that continues to fail after reaching the maximum loop limit, **When** the recursion limit is hit, **Then** the Supervisor terminates the loop, marks the task as `failed` or `paused` on the board, and logs an alert requiring manual developer intervention.

---

### Edge Cases

- **Concurrent Supervisor and Manual Board Updates**: If a human operator manually moves or comments on a task while the Supervisor is running, the Supervisor respects the latest board state via atomic read-modify-write checks and does not overwrite human notes.
- **Malformed or Incomplete Audit Outcomes**: If an auditor agent returns an unparseable response or missing gap evidence, the Supervisor catches the contract violation, flags the task for human review, and avoids corrupting task board comments.
- **Workflow Switcher During Active Run**: If an operator switches views in the UI while a workflow run is actively streaming, the running workflow continues executing server-side without interruption, and switching back restores live stream inspection.
- **Sandbox Workspace File Locking & Process Hangs**: If a test command in the sandbox hangs or exceeds the configured timeout, the execution engine enforces process termination and releases sandbox locks fail-closed.
- **Orphaned Approval Requests**: If a workflow execution is aborted or cancelled while paused at a Human Approval Gate, the approval request is automatically cancelled and marked inactive.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Core Reusable Workflow Archetypes (`@multi-agent/types`)
- **FR-001**: The system MUST define reusable workflow archetype specifications distinguishing `linear-pipeline` (acyclic sequential execution) from `hierarchical-supervisor` (hub-and-spoke with feedback loops and conditional branching).
- **FR-002**: The workflow schema MUST support condition routing nodes with dynamic edge evaluation based on structured supervisor outcome envelopes (e.g., `audit_spec`, `consolidate`, `implement_spec`, `qa_verify`, `complete`).
- **FR-003**: The workflow compiler MUST validate and enforce recursion limit guardrails on cyclic supervisor loops to guarantee termination.
- **FR-004**: The workflow definition MUST support first-class human approval nodes with configurable reviewer roles, timeout bounds, and decision outcomes (`approved`, `rejected`, `needs_clarification`).

#### Core Studio Task Management Tool (`src/tools/`)
- **FR-005**: The system MUST provide an orchestrator task management tool allowing authorized agents to interact with Studio tasks programmatically.
- **FR-006**: The task management tool MUST support querying tasks by status, organization, project, workspace, and assigned agent.
- **FR-007**: The task management tool MUST support updating task status (`queued`, `in_progress`, `in_review`, `done`, `failed`, `paused`) following valid lifecycle transitions.
- **FR-008**: The task management tool MUST support assigning or reassigning tasks to specific specialist agents.
- **FR-009**: The task management tool MUST support appending structured comments and progress evidence to tasks with author attribution (`agent`, `system`, or `user`).
- **FR-010**: All tool operations MUST enforce tenant isolation, ensuring agents can only access and mutate tasks belonging to their assigned organization context.

#### Workflow Switcher Coexistence (`apps/web/src/components/workflow/WorkflowSwitcher.tsx`)
- **FR-011**: The Studio web interface MUST allow users to view and switch between all registered workflows belonging to the current organization via `WorkflowSwitcher`.
- **FR-012**: Switching workflows MUST update the browser URL with the corresponding `?workflowId=` parameter without triggering a full page reload.
- **FR-013**: The UI MUST preserve unsaved changes by prompting confirmation before allowing navigation to a different workflow.
- **FR-014**: Both `linear-spec-pipeline` and `supervisor-gap-delivery-workflow` MUST coexist within the same organization (`org-building-gap`) without naming or identity collisions.

#### Registration & Verification in `org-building-gap`
- **FR-015**: The system MUST register the preserved `Linear Spec-to-Code Pipeline` (`linear-spec-pipeline`) in the database under tenant `org-building-gap`.
- **FR-016**: The system MUST register the new `Hierarchical Supervisor Workflow` (`supervisor-gap-delivery-workflow`) in the database under tenant `org-building-gap`.
- **FR-017**: The organization MUST have all 42 building management user stories bound to the task board with valid initial statuses (`queued`).
- **FR-018**: System prompts and persona definitions for `Spec Delivery Lead Orchestrator`, `Spec & Code Gap Auditor`, `Gap Report Consolidator`, `Gap Implementation Engineer`, and `Delivery QA Verifier` MUST be configured and bound to their respective workflow nodes.

#### Sandboxed Execution Barrier & Human Approval Gate
- **FR-019**: All execution steps involving file inspection, test execution, and code generation MUST be bound to the sandbox directory path (`workspaces/building-management-sandbox`).
- **FR-020**: The system MUST enforce a strict security barrier preventing any agent write or delete access to the primary project repository (`/home/hossein/Desktop/projects/building-management`).
- **FR-021**: The workflow MUST incorporate a Human Approval Gate positioned strictly between gap report consolidation and any code implementation or modification action.
- **FR-022**: Execution of implementation actions MUST be blocked fail-closed until explicit human approval is received.
- **FR-023**: Rejection at the approval gate MUST terminate the delivery run cleanly with full audit logging and without modifying any source files.

---

### Key Entities

- **Workflow Archetype**: Represents the structural topology and execution model of a workflow. Defines whether the graph is an acyclic pipeline or a hierarchical supervisor with cyclic decision routing. Key attributes include archetype category, node definitions, conditional edge rules, and maximum recursion limits.
- **Studio Task Management Tool**: The capability interface exposed to orchestrator agents enabling programmatic discovery, status updates, assignment, and comment creation on Studio tasks. Key attributes include allowed actions (`query`, `update_status`, `assign`, `add_comment`), parameter validation schemas, and tenant context bindings.
- **Task Board Sync Record**: Represents the synchronization payload between an agent's internal execution state and the durable Studio task board. Key attributes include task identifier, previous status, updated status, assigned agent, comment content, and verification evidence payload.
- **Human Approval Gate**: An interception checkpoint within the workflow graph that halts autonomous execution before sensitive actions (such as code mutation) can occur. Key attributes include checkpoint ID, gate status (`pending`, `approved`, `rejected`), consolidated summary payload, reviewer principal, and decision timestamp.
- **Sandbox Execution Boundary**: The security isolation policy governing agent file system and process access. Key attributes include canonical workspace root (`workspaces/building-management-sandbox`), forbidden paths list (including `/home/hossein/Desktop/projects/building-management`), write permission boundaries, and timeout limits.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of registered workflows within `org-building-gap` (both Linear Pipeline and Hierarchical Supervisor) are accessible and switchable via the Studio UI in under 1 second without visual canvas errors.
- **SC-002**: 0 unauthorized file modifications, creations, or deletions occur outside the designated sandbox directory across all test runs (100% host repository write-isolation compliance).
- **SC-003**: 100% of code modification actions are blocked by the Human Approval Gate until explicit human authorization is recorded (zero unapproved code mutations).
- **SC-004**: During supervisor execution, 100% of task status transitions and audit findings for processed user stories are synchronized to the Studio Task Board and visible in task comments in real time.
- **SC-005**: The supervisor loop correctly resolves failing QA tests via feedback loops within a maximum of 3 iterations or halts safely with human notification.
- **SC-006**: Existing baseline Linear Pipeline execution remains 100% backward-compatible and functional with zero regression in existing test suites.

---

## Assumptions

- **Tenant & Organization Context**: The organization `org-building-gap` and its existing 42 task board items already exist and are maintained in the Studio database.
- **Sandbox Repository State**: The sandbox workspace at `workspaces/building-management-sandbox` contains a valid checkout of the building management codebase and specification documents required for audit and remediation.
- **Host Repository Immutability**: The user's primary project repository `/home/hossein/Desktop/projects/building-management` is considered production/pristine and must never be altered by automated agent actions.
- **Security & Authorization**: The Studio Task Management tool uses the internal service principal or authenticated execution context to perform task queries and updates on behalf of the workflow orchestrator.
- **Database Availability**: The Studio PostgreSQL database (`studio_memory`) is available for persisting workflow records, task board updates, and audit comment logs.
