# Feature Specification: Project & Workspace Lists and Dashboards

**Feature Branch**: `001-project-workspace-dashboards`

**Created**: 2026-09-29

**Status**: Implemented (revised 2026-10-07)

**Input**: User description: "Projects workspaces should be shown in their lists. Each task is related to a specific workspace and one or more project(s). Projects should have a list and a dashboard to show project's related tasks, workspaces, configurations, etc. Do the same for workspaces."

## Revision Note (2026-10-07)

This spec has been revised to match `specs/006-project-workspace-hierarchy`, which defines the hierarchy *Organization → Project → (optional) Workspace → Task*. The revision changes these rules:

- A task is linked to **exactly one** project. It was previously one or more.
- Choosing a workspace for a task is **optional**. A project with no explicit workspaces runs its tasks in an implicit **default workspace**, which isn't listed. Once a project has explicit workspaces, every new task must be assigned to one of them.
- Each workspace **belongs to exactly one project**. Related projects and workspaces are now defined by this parent–child link, not worked out from task links.
- Workspaces have their own configuration. It inherits the project's settings unless overridden, and contains a chosen set of the project's repositories.

The `plan.md`, `data-model.md`, `contracts/`, and `tasks.md` in this folder describe the original implementation, which follows the old rules (required workspace, multi-project tasks, workspaces not tied to a project). The code changes needed for the revised rules, including data migration, will be planned and delivered under `006-project-workspace-hierarchy`. Where the two specs differ, `006` takes precedence.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse projects and workspaces in dedicated lists (Priority: P1)

A signed-in organization member opens the Projects list and sees every project they're allowed to access, with enough summary information to recognize and open the right one. They can also see the explicit workspaces of each project (or of all accessible projects) in a Workspaces list. From either list they can open the matching dashboard.

**Why this priority**: Without lists people can find things in, projects and workspaces can't be used for navigation, and the context around tasks stays hidden.

**Independent Test**: Seed several projects, some with explicit workspaces and some without, for one user. Check that both lists show the expected items, that projects without explicit workspaces add no workspace entries, and that selecting an item opens its dashboard.

**Acceptance Scenarios**:

1. **Given** the user belongs to an organization with several projects, **When** they open the Projects list, **Then** they see every project they're allowed to access and no projects from other organizations.
2. **Given** projects in the organization have explicit workspaces, **When** the user opens the Workspaces list, **Then** they see every accessible explicit workspace with its parent project, and no workspaces from other organizations.
3. **Given** a project has no explicit workspaces, **When** the user opens the Workspaces list, **Then** that project's default workspace isn't listed as a separate entry.
4. **Given** the Projects list or the Workspaces list is empty for the current user, **When** they open it, **Then** they see a clear empty state explaining that nothing is there yet, and how to create one if they're allowed to.
5. **Given** a project or workspace appears in its list, **When** the user selects it, **Then** they're taken to its dashboard.

---

### User Story 2 - Associate each task with one project and, optionally, one workspace (Priority: P1)

When creating or editing a task, the user links it to exactly one project. If that project has explicit workspaces, the user also assigns the task to one of them. Otherwise the task runs in the project's default workspace. Existing tasks always show these links, so lists and dashboards can group work correctly.

**Why this priority**: Linking tasks to projects and workspaces is what every dashboard in this feature is built on.

**Independent Test**: Create and edit tasks with valid and invalid links, in projects with and without explicit workspaces. Confirm valid links are saved and invalid ones are rejected with clear feedback.

**Acceptance Scenarios**:

1. **Given** a user is creating a task in a project with no explicit workspaces, **When** they save it with that project, **Then** the task is saved with that project, uses the default workspace, and appears under that project.
2. **Given** a user is creating a task in a project with explicit workspaces, **When** they save it with that project and one of its active workspaces, **Then** the task is saved and appears under both the project and that workspace.
3. **Given** a user is creating or editing a task, **When** they try to save it without a project, or with a project that has explicit workspaces but no workspace chosen, **Then** the system blocks the save and explains what's needed.
4. **Given** a user is creating or editing a task, **When** they try to link it to more than one project, **Then** the system doesn't allow it.
5. **Given** an existing task, **When** the user changes its project and/or workspace, **Then** the chosen workspace must belong to the chosen project, and the new links show up right away in the relevant lists and dashboards.

---

### User Story 3 - Project dashboard for related work and configuration (Priority: P2)

From a project, the user opens a dashboard that summarizes it: its tasks, its explicit workspaces (or a note that it uses the default workspace), its repositories, and its configuration. They can understand and manage the project from one place.

**Why this priority**: A list isn't enough on its own. Operators need a single overview of a project's work and settings.

**Independent Test**: Open a project that has tasks and explicit workspaces, and another that has neither. Check that each dashboard section shows the correct items, configuration summary, or empty state.

**Acceptance Scenarios**:

1. **Given** a project with tasks, **When** the user opens its dashboard, **Then** they see those tasks and no tasks from other projects.
2. **Given** a project with explicit workspaces, **When** the user opens its dashboard, **Then** they see those workspaces as the project's child workspaces.
3. **Given** a project with no explicit workspaces, **When** the user opens its dashboard, **Then** they see that the project is using its default workspace, with a way to create a workspace if they're allowed to.
4. **Given** a project has configuration values, **When** the user opens its dashboard, **Then** they can view that configuration, and edit it if they're allowed to.
5. **Given** a project has no tasks yet, **When** the user opens its dashboard, **Then** empty sections show clear empty states, not errors.

---

### User Story 4 - Workspace dashboard for related work and configuration (Priority: P2)

From an explicit workspace, the user opens a dashboard that summarizes it: its tasks, its parent project, the repositories and branches it contains, and its configuration, including which settings it inherits from the project and which it overrides.

**Why this priority**: Workspaces are where work actually happens, so they need their own overview of tasks and setup.

**Independent Test**: Open a workspace that has tasks, a subset of its project's repositories, and one overridden setting. Check that each dashboard section shows the correct items and labels each setting as inherited or overridden.

**Acceptance Scenarios**:

1. **Given** a workspace with tasks assigned to it, **When** the user opens its dashboard, **Then** they see those tasks and only those tasks.
2. **Given** any explicit workspace, **When** the user opens its dashboard, **Then** they see its parent project and can open it.
3. **Given** a workspace has configuration values, **When** the user opens its dashboard, **Then** they can view that configuration, edit it if they're allowed to, and see which settings are inherited from the project and which are overridden.
4. **Given** a workspace has no tasks yet, **When** the user opens its dashboard, **Then** empty sections show clear empty states, not errors.

---

### User Story 5 - Create and maintain projects and workspaces (Priority: P3)

Authorized users can create, rename, and retire projects, and create, rename, and retire workspaces inside a project, so the lists and dashboards stay accurate over time.

**Why this priority**: The lists and dashboards need a way to add and maintain entries, but day-to-day value still comes first from browsing and linking (P1–P2).

**Independent Test**: Create, rename, and retire a project, and a workspace inside it. Confirm that list contents and dashboard availability update to match.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they create a project, or a workspace inside a project, **Then** it appears in the matching list and has a dashboard they can open. Workspaces always appear under their parent project.
2. **Given** an existing project or workspace, **When** an authorized user renames it, **Then** the new name appears in the lists, the dashboards, and the related task views.
3. **Given** an existing project or workspace, **When** an authorized user retires it, **Then** it's no longer in the default active list, and new tasks can't be assigned to it.

---

### Edge Cases

- What happens when a user opens a project or workspace they no longer have permission to access? They see a clear access-denied or not-found result, without revealing more about whether it exists than the organization's rules allow.
- What happens when a related task, project, or workspace is deleted or retired while another dashboard still points to it? Related sections leave out retired or deleted items, or mark them as unavailable, without breaking the page.
- What happens to tasks when their project is retired? Existing tasks stay visible under the project and its workspaces. Editing such a task means moving it to an active project, and to one of that project's workspaces if it has any.
- What happens when a workspace is retired? Its existing tasks stay viewable. New tasks must use another active workspace in the same project. A project's last active explicit workspace can't be retired while it still has active tasks.
- What happens to tasks in the default workspace when the project's first explicit workspace is created? They move to the explicit workspace named "Default" (see `006`).
- What happens if list or dashboard data fails to load? The user sees an error state with a way to retry. Dashboard sections can fail independently without blanking the whole page.
- How are very long lists handled? Lists support pagination (or something equivalent), so users can reach every item without one unusable page.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a Projects list that shows all projects the current user is permitted to access within their organization.
- **FR-002**: System MUST provide a Workspaces list that shows all explicit workspaces the current user is permitted to access within their organization, each labeled with its parent project. Default workspaces MUST NOT be listed.
- **FR-003**: Each list item MUST show enough to identify it (at minimum a name, plus a stable identifier or something equivalent) so the user can pick the right one.
- **FR-004**: Users MUST be able to open a dedicated dashboard for a selected project and for a selected explicit workspace from the respective lists.
- **FR-005**: Every task MUST be linked to exactly one project.
- **FR-006**: A task MUST be assigned to one active explicit workspace of its project when that project has explicit workspaces. Otherwise the task MUST use the project's default workspace. A task's workspace MUST always belong to the task's project.
- **FR-007**: System MUST reject creating or updating a task that has no project, has more than one project, lacks a workspace when its project has explicit workspaces, or names a workspace outside its project. The rejection MUST come with a clear validation message.
- **FR-008**: A project dashboard MUST show sections for related tasks, child workspaces (or the default workspace state), repositories, and project configuration.
- **FR-009**: A workspace dashboard MUST show sections for related tasks, the parent project, the repositories and branches it contains, and workspace configuration.
- **FR-010**: Related-task sections MUST include only the tasks linked to that project or assigned to that workspace.
- **FR-011**: The workspace section of a project dashboard MUST list exactly the project's child workspaces (explicit workspaces whose parent is that project).
- **FR-012**: A workspace dashboard MUST show its single parent project.
- **FR-013**: Configuration sections MUST let authorized users view the project-level or workspace-level settings for that entity. Workspace configuration MUST show which settings are inherited from the project and which are overridden. Unauthorized users MUST see only what their role allows, or a clear restricted state.
- **FR-014**: Authorized users MUST be able to create projects, and to create workspaces inside a project, so the lists can be filled.
- **FR-015**: Authorized users MUST be able to rename active projects and workspaces.
- **FR-016**: Authorized users MUST be able to retire projects and workspaces, which removes them from the default active lists and stops new tasks from being assigned to them.
- **FR-017**: Lists and dashboards MUST follow existing organization membership and access rules. Users MUST NOT see entities from outside their organization.
- **FR-018**: Empty lists and empty dashboard sections MUST show explicit empty states, not blank or error screens.
- **FR-019**: The task board and other existing task views MUST show the task's project and, when it has one, its explicit workspace, so the links stay visible outside the new dashboards.
- **FR-020**: After create, update, and retire actions, System MUST keep lists, dashboards, and task link views consistent, with no manual refresh needed beyond normal navigation.

### Key Entities

- **Project**: A named group of related work in one organization. It has configuration and repositories, appears in the Projects list, and has its own dashboard. It owns its tasks, and owns zero or more explicit workspaces. While it has none, it runs tasks in its default workspace.
- **Default Workspace**: The implicit working area of a project with no explicit workspaces. It isn't listed, has no dashboard of its own, and follows the project's configuration completely. It's defined in detail in `006`.
- **Workspace**: An explicit, isolated working area that belongs to exactly one project. It has a configuration that inherits from the project unless overridden, and contains a chosen set of the project's repositories. It appears in the Workspaces list, has its own dashboard, and contains tasks.
- **Task**: A unit of work linked to exactly one project. It's assigned to one of that project's explicit workspaces, or to its default workspace if it has none. Tasks appear on the task board and in the related-tasks sections of their project and workspace.
- **Configuration**: The settings of a specific project or workspace (for example display name, description, operational defaults). It's summarized, and can be edited, on that entity's dashboard. Workspace settings that aren't overridden follow the project's settings.
- **Organization member**: An authenticated user whose access to projects, workspaces, and tasks is limited to their organization and role permissions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability checks, at least 90% of participants can open the Projects list, find a named project, and reach its dashboard within 30 seconds without help.
- **SC-002**: In usability checks, at least 90% of participants can open the Workspaces list, find a named workspace, and reach its dashboard within 30 seconds without help.
- **SC-003**: In acceptance testing, 100% of new tasks are saved only when they're linked to exactly one project and, if that project has explicit workspaces, to one of its workspaces. Invalid saves are blocked every time.
- **SC-004**: For a seeded project with known tasks and child workspaces, the project dashboard shows 100% of them and none from other projects in verification checks.
- **SC-005**: For a seeded workspace with known tasks, the workspace dashboard shows 100% of them and its correct parent project, with no unrelated items, in verification checks.
- **SC-006**: After the acting user creates, renames, or retires a project or workspace, the updated list is visible to them within 5 seconds of completing the action (or when they return to the list, if they have to navigate).
- **SC-007**: In access-control verification, users never see an organization's projects or workspaces in lists or dashboards unless they have access to that organization.

## Assumptions

- "Projects workspaces should be shown in their lists" means projects and workspaces each get their own list view, not one combined list.
- Projects and workspaces are organization-scoped, first-class entities alongside existing Studio concepts (tasks, agents, workflows, runs). Workspaces always belong to exactly one project.
- The hierarchy, the default workspace, naming, repositories, and workspace configuration inheritance are specified in `006-project-workspace-hierarchy`. This spec covers the lists and dashboards on top of that hierarchy.
- The dashboard configuration sections cover the entity's identity and the operational settings that already matter to Studio users. Deep analytics, billing, and credential vault management are out of scope.
- Creating, renaming, and retiring are in scope so the lists stay usable. Permissions beyond "authorized member" reuse the existing organization permission patterns.
- The existing task board stays. This feature adds project and workspace lists and dashboards, and requires task views to show the new links.
- Mobile-optimized layouts are nice to have. The main experience targets the existing web Studio shell.
- Search and filtering on lists may come later. v1 requires complete, browsable lists with clear empty and error states.
