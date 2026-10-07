# Feature Specification: Organization → Project → Workspace Hierarchy

**Feature Branch**: `006-project-workspace-hierarchy`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Each organization should have some projects. Projects' default name should be resolved from its first task's title. Each Project could have some workspace (creating workspace is optional, if there is no workspaces created, the agent would work on the project's default workspace, in this state, workspace is an abstractive concept and the project seems to be both the project and the workspace, but the workspace is not technically created and stored in DB, since user decides to create workspaces, then the project is parent of workspaces.). Workspaces' default name would be resolved from their first task's title (same as projects). Sample user story: after signing up, a wizard form should appear to make me create my first organization and its configuration and description etc. since my projects and workspaces lists are empty, I have to create a project, if not, while creating a task, I could add a project in the task creation form. Sample user story 2: I created a project. Now I have to work on different branches, so I will create 2 workspaces, the first one with branch a and second one with branch b. Sample user story 3: I have an application composed from several microservices. So I will add those repos to a project and the project would keep all of them, so I could add projects to workspaces and it makes easier to return to that project workspace, so changes and files would be kept in the workspace and won't be lost by interrupting the work or disconnecting internet."

## Relationship to Earlier Specifications

This feature defines the ownership hierarchy *Organization → Project → (optional) Workspace → Task*. It **supersedes** the task-association rules in `specs/001-project-workspace-dashboards` (FR-005, FR-006, FR-007, and the "Workspace" and "Task" entity definitions). That spec required every task to have exactly one explicitly chosen workspace and one or more projects. Under this spec, each task belongs to exactly one project, and choosing a workspace is optional. The lists and dashboards from `001` remain in scope and should be read against the hierarchy defined here.

## Clarifications

### Session 2026-10-07

- Q: In the third sample story, does "add projects to workspaces" mean workspaces hold repositories, and can each workspace be configured on its own? → A: It means "add repositories to workspaces". While a project has no explicit workspaces, its default workspace fully inherits the project's configuration. Once a workspace is created, its configuration and settings can be changed, including which of the project's repositories it contains (for example, one workspace with a single repository, another with all of them).
- Q: Can a task be linked to more than one project? → A: No. Each task is linked to exactly one project.
- Q: When a project gets its first explicit workspace, what happens to the default workspace's tasks and files? → A: The default workspace becomes an explicit workspace named "Default", and its tasks, files, and changes are kept.
- Q: When a repository is added to a project that already has workspaces, what should happen to those workspaces? → A: Existing explicit workspaces don't get it automatically. Users can add it to a workspace's configuration themselves. The default workspace gets it automatically.
- Q: After a workspace is created, should changes to the project's other settings still flow into that workspace? → A: Yes, setting by setting. A workspace keeps following the project for every setting it hasn't overridden. Settings overridden in the workspace stay as they are. Repository membership follows the previous answer instead.
- Q: When the default workspace becomes the "Default" workspace, which settings does it start with? → A: It starts with no overridden settings and keeps following the project. It contains all of the project's repositories at that moment.
- Q: Is there a limit on how many repositories a project or workspace can have, or how many branches can be used? → A: No limit.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-run organization setup wizard (Priority: P1)

Right after signing up, a new user who doesn't belong to any organization is shown a guided wizard. It asks for the organization's name, a description, and basic configuration. They can't reach the rest of the product until the organization exists. When they finish, they land in the new organization, where the empty Projects list invites them to create a first project.

**Why this priority**: Every project, workspace, and task lives inside an organization. Without a first organization, a new user can't do anything.

**Independent Test**: Sign up as a brand-new user, complete the wizard, and confirm the organization exists with the entered details, the user is its owner, and they land on an empty Projects view with a clear call to action.

**Acceptance Scenarios**:

1. **Given** a user has just signed up and belongs to no organization, **When** they first enter the product, **Then** the organization setup wizard opens automatically.
2. **Given** the wizard is open, **When** the user submits a valid name, an optional description, and configuration, **Then** the organization is created, the user becomes its owner, and they are taken into that organization.
3. **Given** the wizard is open, **When** the user tries to leave it or open other product areas without finishing, **Then** they are returned to the wizard. Their progress so far is kept for the session.
4. **Given** a required field is missing or invalid (for example, an empty or overly long name), **When** the user tries to continue, **Then** the wizard blocks that step and explains what to fix.
5. **Given** a user who already belongs to at least one organization (for example, they accepted an invitation), **When** they sign in, **Then** the wizard doesn't appear.
6. **Given** the user finished the wizard and has no projects, **When** they land in the organization, **Then** the Projects list shows an empty state with actions to create a project or create a task.

---

### User Story 2 - Create a project directly or from the task creation form (Priority: P1)

A user can create a project from the Projects list. They can also create one inline while creating a task, without leaving the task form. A project with no explicit name gets its name from the title of its first task. Until the user creates a workspace, the project's tasks run in the project's **default workspace**. This is an implicit working area: it isn't created or listed as a separate workspace, and to the user the project acts as both project and workspace.

**Why this priority**: Tasks can't run without a project. Letting users create one from the task form keeps their first task to a single step.

**Independent Test**: In an organization with no projects, create a task, add a new project from inside the task form, and save. Confirm the project exists, is named after the task's title, contains the task, and has no explicitly created workspaces, and that the task runs against the project's default workspace.

**Acceptance Scenarios**:

1. **Given** an organization with no projects, **When** the user opens the task creation form, **Then** they can create a new project inline, and the task can't be saved until a project is selected or created.
2. **Given** the user creates a project inline from the task form without typing a project name, **When** the task is saved, **Then** the project is named after that task's title.
3. **Given** the user creates a project from the Projects list without a name, **When** it's saved, **Then** it shows a temporary placeholder name, which is replaced by the title of its first task once that task is created.
4. **Given** a project whose name came from a task title, **When** the user renames it, **Then** the new name is kept and is never automatically replaced.
5. **Given** a project with no explicitly created workspaces, **When** a task in that project runs, **Then** it runs in the project's default workspace, and the Workspaces list for that project shows no separate workspace entries.
6. **Given** a project created with an explicit name, **When** its first task is created, **Then** the project name doesn't change.

---

### User Story 3 - Create multiple workspaces in a project for parallel branches (Priority: P2)

A user working on a project needs to work on different branches at the same time. They create two workspaces in the project, one set to branch A and the other to branch B. From then on the project is the parent of these workspaces, and each new task is assigned to one of them. A workspace with no explicit name gets its name from its first task's title, the same way projects do.

**Why this priority**: Isolated parallel work is the main reason workspaces exist. It's P2 because the default workspace already covers single-branch use.

**Independent Test**: In a project that has repositories, create two workspaces set to different branches. Run a task in each and confirm each task sees only its own workspace's branch and files, and changes in one workspace don't appear in the other.

**Acceptance Scenarios**:

1. **Given** a project with no explicit workspaces, **When** the user creates a workspace, **Then** it's created under that project and listed as that project's workspace.
2. **Given** a project with repositories, **When** the user creates a workspace, **Then** they can choose which branch to use for each of the project's repositories.
3. **Given** two workspaces in the same project set to different branches, **When** tasks run in each, **Then** each task works only on its own workspace's branch and files.
4. **Given** a workspace created without a name, **When** its first task is created, **Then** the workspace is named after that task's title, and a later manual rename is never automatically replaced.
5. **Given** a project that already has explicit workspaces, **When** the user creates a task in it, **Then** they must choose one of the project's active workspaces. The default workspace is no longer offered as a separate choice.
6. **Given** a project that ran tasks in its default workspace, **When** the user creates the project's first explicit workspace, **Then** the default workspace's existing tasks, files, and changes are kept and stay reachable. They move into an explicit workspace named "Default" that's listed next to the new one.
7. **Given** a newly created workspace, **When** the user opens its configuration, **Then** it starts with the project's repositories and settings, and the user can change them for this workspace only without affecting the project or other workspaces.
8. **Given** a workspace that overrides one project setting but not another, **When** the project changes both settings, **Then** the workspace picks up the change to the setting it didn't override and keeps its own value for the one it did.
9. **Given** a workspace setting that's overridden, **When** the user clears the override, **Then** the workspace goes back to following the project's current value for that setting.

---

### User Story 4 - Multi-repository projects with configurable, durable workspaces (Priority: P2)

A user's application is made of several microservices, each in its own repository. They add all of these repositories to one project, so the project keeps the whole application together. They then create two workspaces. The first only needs one of the services, so they configure it to contain just that repository. The second needs the whole application, so it keeps all of them. Each workspace holds a working copy of the repositories it contains. Files and changes made in a workspace persist, so the user (or an agent) can come back later and continue, even after interrupted work, a closed browser, or a lost internet connection.

**Why this priority**: Many real applications span several repositories, and agents doing long-running work can't afford to lose progress. This builds on the workspaces from Story 3.

**Independent Test**: Add three repositories to a project. Create one workspace that contains only one of them and another that contains all three, and confirm tasks in each see only that workspace's repositories. Make changes to files through a task, interrupt the session (disconnect or close the client), then come back. Confirm the workspace's repositories and all uncommitted changes are still there and work can continue.

**Acceptance Scenarios**:

1. **Given** a project, **When** the user adds several repositories to it, **Then** the project lists all of them, and each repository can be identified by name and source.
2. **Given** a project with several repositories and no explicit workspaces, **When** a task runs in the default workspace, **Then** the task can access all of the project's repositories.
3. **Given** a project with three repositories, **When** the user configures one workspace to contain one repository and another to contain all three, **Then** tasks in each workspace can access only the repositories that workspace contains.
4. **Given** a workspace with file changes that haven't been saved back to the source repositories, **When** the user's connection drops or the session ends unexpectedly, **Then** the changes are still in the workspace when the user returns.
5. **Given** a user returns to a project, **When** they open one of its workspaces, **Then** they see the workspace's current state (repositories, branches, and changed files) and can start new tasks from there.
6. **Given** a repository is added to a project that already has explicit workspaces, **When** the user opens an existing workspace, **Then** the new repository isn't in it. The user can add it to that workspace's configuration, where it uses the repository's default branch unless they pick another. If the project still uses its default workspace, the new repository is available there right away.
7. **Given** a repository is removed from a project, **When** a workspace still has unsaved changes in that repository, **Then** the user is warned and must confirm before those changes are discarded.

---

### User Story 5 - Navigate the hierarchy (Priority: P3)

A user can move between the levels: from the organization to its projects, from a project to its workspaces and tasks, and from a task back to its workspace and project. Every task shows which project it belongs to and, if it isn't in the default workspace, which workspace.

**Why this priority**: Clear navigation makes the hierarchy usable day to day. The underlying behavior already works without it.

**Independent Test**: Starting from a task, follow links to its workspace and project, then back up to the organization. Confirm each view shows the correct parent and children.

**Acceptance Scenarios**:

1. **Given** a project, **When** the user opens it, **Then** they see its workspaces (or an indication that it uses the default workspace), its repositories, and its tasks.
2. **Given** a task, **When** the user views it, **Then** its project, and its workspace if it has an explicit one, are shown and can be opened.
3. **Given** a user who belongs to several organizations, **When** they switch organization, **Then** only that organization's projects, workspaces, and tasks are shown.

---

### Edge Cases

- **Very long or empty first-task titles**: Derived names are trimmed and cut to the maximum name length. If the title is empty or only whitespace, the placeholder name stays until a task with a usable title is created or the user renames the entity.
- **Duplicate derived names**: Two projects in the same organization, or two workspaces in the same project, can end up with the same derived name. The system adds a short suffix (for example "(2)") so names stay distinguishable within their parent.
- **First task deleted**: If the task a name came from is deleted, the name stays as it is. Names are derived once and are never re-derived from later tasks.
- **Concurrent first tasks**: If two tasks are created in a new, unnamed project or workspace at the same moment, exactly one of them supplies the name, and the result is the same for every viewer.
- **Last explicit workspace retired**: A project can't retire its only remaining active workspace while tasks are assigned to it. The user must keep at least one active workspace, or retire the project itself.
- **Retired project or workspace**: Retired projects and workspaces can't receive new tasks. Their existing tasks and stored files stay viewable until they're deleted under the organization's retention rules.
- **Repository access lost**: If a repository becomes unreachable (credentials revoked, repository deleted), workspaces that contain it show it as unavailable. The other repositories keep working, and changes already stored in the workspace aren't discarded.
- **Branch missing**: If the branch chosen for a workspace no longer exists in the source repository, the workspace keeps its local state, shows a clear warning, and lets the user pick another branch.
- **Wizard interrupted**: If the user closes the browser partway through the wizard, they're returned to the wizard on their next sign-in until the organization is created. Progress from the earlier session doesn't have to be kept.
- **Inline project creation abandoned**: If the user cancels the task form after starting to create a project inline, no project is created.
- **Access boundaries**: Users never see projects, workspaces, repositories, or workspace files from organizations they don't belong to, including through direct links.

## Requirements *(mandatory)*

### Functional Requirements

**Organization onboarding**

- **FR-001**: System MUST show an organization setup wizard to any signed-in user who belongs to no organization, before they can reach any other product area.
- **FR-002**: The wizard MUST collect an organization name (required), a description (optional), and initial organization configuration (optional fields with sensible defaults).
- **FR-003**: When the wizard finishes, System MUST create the organization, make the user its owner, and take them into it.
- **FR-004**: System MUST NOT show the wizard to users who already belong to at least one organization.

**Projects**

- **FR-005**: Every project MUST belong to exactly one organization. An organization can have any number of projects, including none.
- **FR-006**: Users with the right permissions MUST be able to create a project from the Projects list, and inline from the task creation form.
- **FR-007**: A project name is optional when the project is created. If none is given, System MUST show a placeholder name until the project's first task is created, then set the project name to that task's title.
- **FR-008**: When a project is created inline from the task form without a name, System MUST name it after the task being created.
- **FR-009**: Once a user explicitly sets or changes a project's name, System MUST NOT automatically change it again.
- **FR-010**: Users MUST be able to attach one or more source repositories to a project, and to remove them. Each attached repository has a default branch.

**Default workspace**

- **FR-011**: A project with no explicitly created workspaces MUST provide a default workspace. It fully inherits the project's configuration and settings, and tasks run there with access to all of the project's repositories.
- **FR-012**: The default workspace MUST NOT show up as a separate entry in workspace lists or as an independently managed workspace. Users see the project itself as the working area.
- **FR-013**: Files and changes in the default workspace MUST persist across sessions and interruptions just like an explicit workspace (see FR-020).

**Workspaces**

- **FR-014**: Users with the right permissions MUST be able to create workspaces inside a project. Each workspace belongs to exactly one project.
- **FR-015**: A new workspace MUST start with all of the project's repositories and inherit all of the project's settings. Users MUST then be able to change that workspace's configuration on its own, including which of the project's repositories it contains (at least one) and which branch each repository uses. Any repository without a branch choice uses its default branch.
- **FR-015a**: Changing one workspace's configuration MUST NOT change the project's configuration or any other workspace's configuration.
- **FR-015b**: For every setting a workspace hasn't overridden, System MUST use the project's current value, so later project changes reach the workspace. Settings overridden in a workspace MUST keep the workspace's value when the project changes. Users MUST be able to clear an override so the setting follows the project again. Workspace configuration MUST show which settings are inherited and which are overridden. Repository membership is excluded from this rule (see FR-021).
- **FR-016**: A workspace name is optional when the workspace is created. If none is given, System MUST derive it from the workspace's first task title, following the same rules as projects (FR-007, FR-009).
- **FR-017**: When a project's first explicit workspace is created, System MUST keep the default workspace's existing tasks, files, and changes by turning the default workspace into an explicit workspace named "Default" under the same project. The "Default" workspace MUST start with no overridden settings, so it follows the project's settings, and MUST contain all of the project's repositories at that moment. Its name and configuration can be changed later like any other workspace's.
- **FR-018**: Once a project has at least one explicit workspace, System MUST require every new task in that project to be assigned to one of its active workspaces.
- **FR-019**: Each workspace MUST be isolated from the project's other workspaces: changes to files and branches in one workspace MUST NOT appear in another.
- **FR-020**: System MUST keep each workspace's repositories, chosen branches, and uncommitted file changes durably, so they survive client disconnects, closed sessions, interrupted tasks, and a user's lost internet connection.
- **FR-021**: When a repository is added to a project, System MUST make it available right away in the project's default workspace (if the project has no explicit workspaces). System MUST NOT add it to existing explicit workspaces automatically, and MUST let users add it to any explicit workspace's configuration.
- **FR-021a**: System MUST NOT set a product limit on the number of repositories in a project or workspace, the number of workspaces in a project, or the number of distinct branches used across a project's workspaces.
- **FR-022**: Before removing a repository from a project, System MUST warn the user and ask for confirmation if any workspace has unsaved changes in that repository.

**Tasks**

- **FR-023**: Every task MUST be linked to exactly one project. System MUST block saving a task that has no project, MUST NOT allow linking a task to more than one project, and MUST explain what's needed.
- **FR-024**: A task belongs to at most one explicit workspace. If its project has no explicit workspaces, the task uses the project's default workspace.
- **FR-025**: Task views MUST show the task's project and, when it has one, its explicit workspace, as links to those entities.

**Lifecycle, naming, and access**

- **FR-026**: Users with the right permissions MUST be able to rename and retire projects and workspaces. Retired entities MUST NOT accept new tasks.
- **FR-027**: System MUST prevent retiring a project's last active explicit workspace while that project still has active tasks assigned to the workspace.
- **FR-028**: Derived names MUST be trimmed and cut to the maximum allowed name length. Duplicate names within the same parent MUST get a suffix so they can be told apart.
- **FR-029**: Name derivation MUST happen only once per entity, from its first task, and MUST NOT change if that task is later edited or deleted.
- **FR-030**: All projects, workspaces, repositories, workspace files, and tasks MUST be visible only to members of the owning organization, according to their role permissions.

### Key Entities

- **Organization**: The top-level tenant. Has a name, description, and configuration. It's created by the first-run wizard or later by authorized users, and owns projects. Its members have roles that control what they can do.
- **Project**: A named group of related work in one organization. It holds one or more source repositories and owns its tasks. It owns zero or more explicit workspaces, and acts as its own default workspace while it has none. Its name is set explicitly or derived from its first task.
- **Default Workspace**: The implicit working area of a project with no explicit workspaces. It fully inherits the project's configuration and repositories and has no settings of its own. It isn't a separately managed or listed entity, but its files and changes are stored as durably as an explicit workspace's. When the project's first explicit workspace is created, it becomes an explicit workspace named "Default".
- **Workspace**: An explicitly created, isolated working area inside one project. It inherits the project's settings, and any setting can be overridden for this workspace only. That includes which of the project's repositories it contains and the branch for each. It holds a working copy of those repositories plus all file changes made there, survives interruptions, and can be resumed. Its name is set explicitly or derived from its first task.
- **Workspace Configuration**: The settings of one explicit workspace: the repositories it contains (a non-empty subset of the project's repositories), the chosen branch for each, and any project settings it overrides. Every setting that isn't overridden follows the project's current value.
- **Repository**: A source code repository attached to a project, identified by name and source location, with a default branch. It's available in the project's default workspace and in every explicit workspace configured to contain it.
- **Workspace Repository State**: For each workspace and contained repository, the chosen branch and the workspace's current files and uncommitted changes for that repository.
- **Task**: A unit of work linked to exactly one project and runs in either one explicit workspace or the project's default workspace. The first task created in an unnamed project or workspace supplies that entity's name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of new users finish the organization setup wizard and reach their organization in under 3 minutes without help.
- **SC-002**: A new user can go from finishing the wizard to having a first task saved in a new project in under 2 minutes, using only the task creation form.
- **SC-003**: In acceptance testing, 100% of projects and workspaces created without a name end up named after their first task's title, and 0% of manually renamed entities are ever renamed automatically.
- **SC-004**: In acceptance testing, 100% of task saves without a project are blocked, and in projects with explicit workspaces, 100% of task saves without a workspace are blocked.
- **SC-005**: In isolation checks with two workspaces on different branches, 0 file changes made in one workspace appear in the other.
- **SC-006**: After a forced disconnect or session end in the middle of a task, 100% of the workspace's uncommitted changes are still there when the user returns.
- **SC-007**: A user can return to an existing workspace and see its current repositories, branches, and changed files within 10 seconds of opening it.
- **SC-008**: When a project's first explicit workspace is created, 100% of the default workspace's earlier tasks and files are still reachable.
- **SC-009**: In access-control verification, users never see another organization's projects, workspaces, repositories, or workspace files.

## Assumptions

- Each workspace belongs to exactly one project and can't combine repositories from several projects.
- Tasks linked to several projects (allowed by `001`) are no longer supported. During migration, existing multi-project tasks keep their first-linked project as their owner.
- Organization configuration in the wizard covers basic settings meaningful at sign-up (for example display name, description, default preferences). Billing, credential setup, and member invitations can be done after the wizard and are outside this feature.
- Users who arrive through an organization invitation join that organization and never see the wizard. Creating more organizations after the first is available but not part of this feature's flows.
- The maximum name length for organizations, projects, and workspaces is 120 characters. Placeholder names are human-readable (for example "Untitled project").
- Repository connection and credentials reuse the platform's existing integration and credential mechanisms. This feature doesn't define new ways to authenticate to repository hosts.
- "Kept in the workspace" means stored on the platform's side so it survives the user's client going away. Pushing changes back to source repositories stays an explicit user or agent action and isn't automatic.
- Retired workspaces and projects keep their stored files under the organization's normal retention rules. Permanent deletion and storage quotas are out of scope.
- Permissions reuse the existing organization roles. Owners and admins can create, rename, and retire. Members can create projects, workspaces, and tasks unless the organization restricts this.
