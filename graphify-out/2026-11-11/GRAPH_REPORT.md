# Graph Report - apps  (2026-11-11)

## Corpus Check
- 324 files · ~175,790 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2189 nodes · 5383 edges · 120 communities (96 shown, 24 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 347 edges (avg confidence: 0.81)
- Token cost: 1,250 input · 850 output

## Community Hubs (Navigation)
- Run Api Service Get
- Validation Scaffold Autonomous Swarm
- Organization Store Run
- Dashboard Dashboard Page
- Archetype Forms Workflow Edge
- Postgres Run Store
- Run Executor Cancel
- Punycode Url
- Server Hono
- Workspace Service Api Error
- Live Canvas Types Build
- Organization Retire
- Agent Configuration Sections
- Validation Auto Arrange Edge
- Project Service Create
- Composition Close
- Run Organization Access Branch
- Docs Lucide React
- Dashboard Service Belongs To
- Organization Context Register Organization
- In Memory Run Store
- Projects Workspaces Dynamic
- Invitations Dashboard Payload
- Live Canvas Types Org
- Tsconfig **/*Mts
- Authorization Run Variables
- Workflow Compiler Abort Error
- Task Board View Task
- Workflow Service Request
- Tsconfig Compiler Options
- Organization Purge Worker Register
- Route Dynamic
- [Slug] Doc Page
- Contracts Stream Run Events
- Task Board Dynamic
- Workspace Working Copy Service
- Task Service Bounded Text
- Agent Service List
- Run Budget Controller Settle
- Run Organization Access Schedule
- Routines Translations
- Task Fields Create Task
- Task Service Fingerprint Answers
- Budget Store Alerts
- Live Approval Actions Active
- Contracts Listener
- Organization Organization Settings
- Web @Playwright/Test
- Org Provider Agent Registry
- Task Status Status Actions
- Run Timeline Canvas Status
- Web Class Variance Authority
- Routine Scheduler Register Routine
- Approval Manager Agent Execution
- Trigger Outbox Processor Is
- Tsconfig Dist
- Route Dynamic
- Create Workflow Dialog Archetype
- Workflow Nodes Live Workflow
- Memory All Scopes
- Canvas Routing Handles Workflow
- Punycode Punycodejs
- Punycode Es6 Punycodees6Js
- Route Dynamic
- Run Executor Recover Interrupted
- Route Dynamic
- Lang Graph Event Adapter
- Webhook Auth Create Inbound
- Execution Timeline Decode Escaped
- Use Tasks Query Create
- Appearance Helpers @Playwright/Test
- Appearance Appearance Toggle
- Clarification Build Clarification Package
- Web Package Manager
- Layout Metadata
- Org Feature Flags Roles
- Subgraph Runner Apply Input
- Organization Store Goal From
- Route Dynamic
- Route Dynamic
- Route Dynamic
- Route Dynamic
- Agents Nextjs Breaking Changes
- Bootstrap Bounded Number
- Route Dynamic
- Webhook Auth Replay Protector
- Agent Detail Journeys Spec
- Auth Edge { Auth
- Require Punycode Require Punycodecjs
- Readme Punycodejs Converter
- Readme Nextjs Logo Svg
- Fa Cards
- Studio Lifecycle Spec Credentials
- Organization Gate Gate State
- Web Bcryptjs
- Web Clsx
- Next Config
- Next Env D Note:
- Web Next Auth
- Eslint Config Eslintconfigmjs
- Next Config
- Web React
- Web React Dom
- Web Zustand
- Postcss Config Postcssconfigmjs
- Pnpm Workspace Web Workspace
- Icon Svg
- Globe Globe Icon Svg
- Window Window Icon Svg
- Route { Get, Post

## God Nodes (most connected - your core abstractions)
1. `RequestPrincipal` - 145 edges
2. `RunExecutor` - 60 edges
3. `RunStoreContract` - 58 edges
4. `cn()` - 57 edges
5. `scopedApiPath()` - 53 edges
6. `PostgresRunStore` - 52 edges
7. `useWorkflowStore` - 50 edges
8. `useOrgPath()` - 48 edges
9. `Button` - 48 edges
10. `InMemoryRunStore` - 41 edges

## Surprising Connections (you probably didn't know these)
- `Next.js Agent Rules (Web)` --semantically_similar_to--> `Next.js Agent Rules (Docs)`  [INFERRED] [semantically similar]
  web/AGENTS.md → docs/AGENTS.md
- `Next.js Logo SVG` --conceptually_related_to--> `Next.js Web Application`  [INFERRED]
  web/public/next.svg → web/README.md
- `createRunsRouter()` --indirect_call--> `respondWithApiError()`  [INFERRED]
  server/src/api/runs.ts → server/src/api/shared/http.ts
- `fetchHeartbeat()` --calls--> `scopedApiPath()`  [EXTRACTED]
  web/src/components/agents/AgentHeartbeatPanel.tsx → web/src/lib/orgRoute.ts
- `TaskCardProps` --references--> `Task`  [EXTRACTED]
  web/src/components/tasks/TaskCard.tsx → web/src/lib/taskStatus.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Web Public Brand & UI Icons** — web_public_file_icon, web_public_globe_icon, web_public_next_logo, web_public_vercel_logo, web_public_window_icon [INFERRED 0.85]
- **Monorepo Next.js Agent Guidelines** — docs_agents_rules, docs_claude_instructions, web_agents_rules, web_claude_instructions [INFERRED 0.95]

## Communities (120 total, 24 thin omitted)

### Community 0 - "Run Api Service Get"
Cohesion: 0.07
Nodes (23): feedbackLedger, integer(), MemoryApiService, namespaceFromUrl(), visible(), assertApprovalDecisionAuthorized(), DEFAULT_ALLOWED_DECISIONS, extractGateAuthorization() (+15 more)

### Community 1 - "Validation Scaffold Autonomous Swarm"
Cohesion: 0.07
Nodes (43): scaffoldAutonomousSwarm(), scaffoldEvaluatorOptimizer(), scaffoldHierarchicalSupervisor(), normalizeWorkflowName(), stampWorkflowArchetype(), WorkflowService, NODE_VALIDATORS, NodeValidator (+35 more)

### Community 2 - "Organization Store Run"
Cohesion: 0.08
Nodes (22): OrganizationCleanupUnavailableError, OrganizationPurgeDependencies, PurgeResult, bodyObject(), registerOrganizationRoutes(), OrganizationService, roles, statuses (+14 more)

### Community 3 - "Dashboard Dashboard Page"
Cohesion: 0.11
Nodes (34): DashboardPage(), CompletedAndCostSection(), GraphAgentNodeData, graphNodeTypes, EDGE_COLORS, NODE_ICONS, workflowToGraph(), GraphFlowPreview() (+26 more)

### Community 4 - "Archetype Forms Workflow Edge"
Cohesion: 0.13
Nodes (41): WorkflowEdgeComponent(), ARCHETYPE_ORDER, ArchetypeSection(), AutonomousSwarmForm(), clampInteger(), conditionBranchKeys(), EvaluatorOptimizerForm(), fallbackOptions() (+33 more)

### Community 6 - "Run Executor Cancel"
Cohesion: 0.13
Nodes (3): asCredentialPrincipal(), classifyRunFailure(), RunExecutor

### Community 7 - "Punycode Url"
Cohesion: 0.04
Nodes (44): codecov, mocha, nyc, dns, domain, idn, idna, LICENSE-MIT.txt (+36 more)

### Community 8 - "Server Hono"
Cohesion: 0.05
Nodes (39): hono, @hono/node-server, @langchain/core, @langchain/langgraph, @langchain/langgraph-checkpoint-postgres, @langfuse/otel, @langfuse/tracing, @opentelemetry/sdk-node (+31 more)

### Community 9 - "Workspace Service Api Error"
Cohesion: 0.13
Nodes (15): ApiError, PrincipalVariables, extractMentions(), registerTaskCommentRoutes(), registerWorkflowRoutes(), registerWorkspaceRoutes(), WorkspaceImport, WorkspaceService (+7 more)

### Community 10 - "Live Canvas Types Build"
Cohesion: 0.09
Nodes (27): ReadableContent(), CanvasNodeLiveStatus, EditorMode, LiveCanvasRunActions, LiveRunTrayModel, LiveStreamStatus, LiveTrayEventFilter, LiveWorkflowEdgeDataFields (+19 more)

### Community 11 - "Organization Retire"
Cohesion: 0.08
Nodes (34): Alert, Budget, BudgetData, BudgetsPage(), Agent, Goal, GoalTask, Line (+26 more)

### Community 12 - "Agent Configuration Sections"
Cohesion: 0.14
Nodes (23): AgentBackendPanel(), ExecutionPolicyPanel(), AgentDetail(), sections, AgentExecutionHistory(), Field(), fieldClass, Section() (+15 more)

### Community 13 - "Validation Auto Arrange Edge"
Cohesion: 0.09
Nodes (24): AutoArrangeEdgeInput, AutoArrangeNodeInput, computeAutoArrangePositions(), archetypeCycleNodes(), canReachAny(), canReachTerminalExit(), collectCyclicBranchKeys(), findCycles() (+16 more)

### Community 14 - "Project Service Create"
Cohesion: 0.14
Nodes (14): registerProjectRoutes(), normalizeDescription(), normalizeName(), normalizeSettings(), parseStatusFilter(), persistWorkspaceRecord(), ProjectService, resolveInitialRepos() (+6 more)

### Community 15 - "Composition Close"
Cohesion: 0.13
Nodes (21): createDashboardRouter(), createMemoriesRouter(), isOwnershipError(), requireOrganizationContext(), requirePrincipal(), respondWithApiError(), createStudioRouter(), createToolsRouter() (+13 more)

### Community 16 - "Run Organization Access Branch"
Cohesion: 0.08
Nodes (20): BranchRoutingError, NodeOutcomeError, UnsupportedPhase4NodeError, WorkflowStepLimitError, assertRunAccessTenant(), RunAccessChecker, RunAccessCheckInput, RunAccessCheckpoint (+12 more)

### Community 17 - "Docs Lucide React"
Cohesion: 0.06
Nodes (31): dependencies, lucide-react, next, react, react-dom, devDependencies, eslint, eslint-config-next (+23 more)

### Community 18 - "Dashboard Service Belongs To"
Cohesion: 0.16
Nodes (17): belongsToAgent(), DashboardService, DEFAULT_AGENTS(), DEFAULT_MODEL(), duration(), metadataNumber(), periodOf(), AgentInstance (+9 more)

### Community 19 - "Organization Context Register Organization"
Cohesion: 0.11
Nodes (13): registerOrganizationMembershipRoutes(), object(), OrganizationMembershipService, role(), CacheEntry, OrganizationContextDeniedError, OrganizationContextResolver, OrganizationContextResolverOptions (+5 more)

### Community 21 - "Projects Workspaces Dynamic"
Cohesion: 0.12
Nodes (26): dynamic, dynamic, dynamic, GET(), POST(), dynamic, GET(), PATCH() (+18 more)

### Community 22 - "Invitations Dashboard Payload"
Cohesion: 0.09
Nodes (20): Invitation, Invitations(), EntityRow, DashboardPayload, RepoRow, WorkspaceRow, roles, ProjectRow (+12 more)

### Community 23 - "Live Canvas Types Org"
Cohesion: 0.10
Nodes (15): EditorToolbar(), ToolButton(), isDesignMutationAllowed(), LiveCanvasController, StudioLiveQuery, useLiveCanvasSession(), NodePalette(), PALETTE_ICON (+7 more)

### Community 24 - "Tsconfig **/*Mts"
Cohesion: 0.07
Nodes (28): **/*.mts, compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib (+20 more)

### Community 25 - "Authorization Run Variables"
Cohesion: 0.15
Nodes (18): RunVariables, ToolTestRequest, ToolTestService, authorizePersonalResource(), authorizeTenantResource(), authorizeToolOrAgent(), isOwner(), isSameTenant() (+10 more)

### Community 26 - "Workflow Compiler Abort Error"
Cohesion: 0.14
Nodes (21): auditorOutcomeLacksEvidence(), branchCarrierField(), CompiledWorkflow, compileWorkflow(), enforceNodeInput(), evaluateParallelJoinResult(), isGapAuditorNode(), resolveAgentToolsForRuntime() (+13 more)

### Community 27 - "Task Board View Task"
Cohesion: 0.16
Nodes (25): TaskBoardPage(), TaskFilterBar(), TaskFilterBarProps, TaskFilterEmptyState(), TaskFilterEmptyStateProps, ActiveFilterChip, countActiveFilters(), DEFAULT_TASK_BOARD_FILTERS (+17 more)

### Community 28 - "Workflow Service Request"
Cohesion: 0.12
Nodes (18): executionApiBase(), publicAgent(), ApiRequestError, requestJson(), request(), RunListQuery, tasksAction(), toolService (+10 more)

### Community 29 - "Tsconfig Compiler Options"
Cohesion: 0.07
Nodes (27): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+19 more)

### Community 30 - "Organization Purge Worker Register"
Cohesion: 0.13
Nodes (8): registerOrganizationProfileRoutes(), normalizeConfig(), normalizeDescription(), normalizeName(), normalizeSlug(), OrganizationProfileService, OrganizationPurgeWorker, TenantCredentialCleanup

### Community 31 - "Route Dynamic"
Cohesion: 0.13
Nodes (18): dynamic, POST(), dynamic, POST(), loadMembershipContext(), OrganizationLayout(), AuthenticatedHomePage(), TopLevelTasksRedirectPage() (+10 more)

### Community 32 - "[Slug] Doc Page"
Cohesion: 0.10
Nodes (12): DocPage(), sections, metadata, DocsShell(), faGroups, faLabels, DocPage, docPages (+4 more)

### Community 33 - "Contracts Stream Run Events"
Cohesion: 0.09
Nodes (3): streamRunEvents(), DurableMemoryJobEnqueuer, RunStoreContract

### Community 34 - "Task Board Dynamic"
Cohesion: 0.19
Nodes (23): dynamic, dynamic, GET(), POST(), TaskActionBody, cancelTask(), createTask(), CreateTaskInput (+15 more)

### Community 35 - "Workspace Working Copy Service"
Cohesion: 0.17
Nodes (22): applyWorkspaceMembership(), maybeDeriveProjectNameFromTask(), maybeDeriveWorkspaceNameFromTask(), truncateDerivedName(), uniquifyName(), WorkspaceCreateBody, ensureWorkspaceRepoDurableState(), markWorkspaceRepoDirty() (+14 more)

### Community 36 - "Task Service Bounded Text"
Cohesion: 0.18
Nodes (14): boundedText(), hasDependencyCycle(), normalizeId(), TASK_PRIORITIES, TASK_STATUSES, taskStatusForCompletedRun(), truncate(), validateMetadata() (+6 more)

### Community 37 - "Agent Service List"
Cohesion: 0.21
Nodes (7): registerAgentRoutes(), AgentService, registerToolRoutes(), StudioToolService, object(), requireCredentialMutationPermission(), RequestPrincipal

### Community 38 - "Run Budget Controller Settle"
Cohesion: 0.12
Nodes (8): BudgetedAgentRuntime, BudgetScope, BudgetStore, number(), Rate, rates(), RunBudgetController, tokens()

### Community 39 - "Run Organization Access Schedule"
Cohesion: 0.12
Nodes (4): OrganizationAccessStore, RunOrganizationAccess, HeartbeatScheduler, RoutineScheduler

### Community 40 - "Routines Translations"
Cohesion: 0.14
Nodes (19): Routine, RoutineHistoryItem, RoutinesPage(), translations, translations, WebhookDeliveryItem, WebhookTrigger, WebhookTriggersPage() (+11 more)

### Community 41 - "Task Fields Create Task"
Cohesion: 0.16
Nodes (18): CreateTaskModalProps, DependencyEditor(), DependencyEditorProps, LastErrorCard(), LinkedRunCard(), ProjectOption, TaskFields(), TaskFieldsProps (+10 more)

### Community 42 - "Task Service Fingerprint Answers"
Cohesion: 0.25
Nodes (3): fingerprintAnswers(), registerTaskRoutes(), TaskService

### Community 43 - "Budget Store Alerts"
Cohesion: 0.16
Nodes (7): BudgetAlert, currentPeriodView(), decode(), InMemoryBudgetStore, key(), month(), PostgresBudgetStore

### Community 44 - "Live Approval Actions Active"
Cohesion: 0.15
Nodes (15): ACTIVE_RUN_STATUSES, RunPage(), ApprovalCard(), ApprovalPanel(), ApprovalPanelProps, ApprovalGateModal(), ApprovalGateModalProps, approvalAllowedDecisions() (+7 more)

### Community 45 - "Contracts Listener"
Cohesion: 0.23
Nodes (13): Listener, MemoryOwner, RunEntry, RunListFilters, asIso(), boundedEventCount(), matchesFilters(), redactApproval() (+5 more)

### Community 46 - "Organization Organization Settings"
Cohesion: 0.13
Nodes (16): OrganizationSettings(), DEFAULT_CONFIG, Draft, loadDraft(), OrganizationOnboardingPage(), onSubmit(), AppHeader(), AppSidebar() (+8 more)

### Community 47 - "Web @Playwright/Test"
Cohesion: 0.10
Nodes (21): @playwright/test, tailwindcss, @tailwindcss/postcss, @types/bcryptjs, devDependencies, eslint, eslint-config-next, @playwright/test (+13 more)

### Community 48 - "Org Provider Agent Registry"
Cohesion: 0.18
Nodes (14): AgentRegistry(), ToolRegistry(), OrgContext, OrgContextValue, OrgProvider(), useOptionalOrg(), useOrgPath(), ClarificationPanel() (+6 more)

### Community 49 - "Task Status Status Actions"
Cohesion: 0.18
Nodes (14): StatusActions(), StatusActionsProps, COLUMN_ICONS, TaskBoardColumn(), TaskBoardColumnProps, CardActionButton(), TaskCard(), TaskCardProps (+6 more)

### Community 50 - "Run Timeline Canvas Status"
Cohesion: 0.18
Nodes (16): CANVAS_STATUS_COMMIT_MS, CanvasStatusSnapshot, createStatusSource(), sameItems(), selectSnapshot(), isStatusChangingEvent(), applyRunEvent(), applyTerminalEvent() (+8 more)

### Community 51 - "Web Class Variance Authority"
Cohesion: 0.11
Nodes (19): class-variance-authority, eventsource-parser, react-markdown, tailwind-merge, @tanstack/react-query, dependencies, class-variance-authority, eventsource-parser (+11 more)

### Community 52 - "Routine Scheduler Register Routine"
Cohesion: 0.16
Nodes (11): registerRoutineRoutes(), requireRoutineTarget(), createCredentialComposition(), CredentialComposition, log, LogContext, HeartbeatSchedulerOptions, computeNextRun() (+3 more)

### Community 53 - "Approval Manager Agent Execution"
Cohesion: 0.16
Nodes (10): AgentExecutionEvent, RuntimeState, ApprovalManager, ApprovalManagerDependencies, PausedContext, CompiledResult, GraphRunner, bounded() (+2 more)

### Community 54 - "Trigger Outbox Processor Is"
Cohesion: 0.20
Nodes (7): assertRoutineDispatchTarget(), assertRoutineTargetAccessible(), routineActor(), RoutineTargetAccessError, RoutineTargetType, TriggerOutboxProcessor, TriggerOutboxProcessorOptions

### Community 55 - "Tsconfig Dist"
Cohesion: 0.11
Nodes (17): dist, node, src/**/*, ../../tsconfig.json, compilerOptions, baseUrl, esModuleInterop, incremental (+9 more)

### Community 56 - "Route Dynamic"
Cohesion: 0.15
Nodes (14): dynamic, POST(), dynamic, GET(), DELETE, dynamic, GET, handle() (+6 more)

### Community 57 - "Create Workflow Dialog Archetype"
Cohesion: 0.17
Nodes (15): ARCHETYPE_ORDER, CreateWorkflowDialog(), submit(), CreateWorkflowDialogProps, CreateWorkflowDialogSubmitPayload, focusableElements(), validateWorkflowName(), archetypeImportError() (+7 more)

### Community 58 - "Workflow Nodes Live Workflow"
Cohesion: 0.19
Nodes (17): LiveWorkflowNodeDataFields, AgentNodeComponent(), ApprovalNodeComponent(), ConditionNodeComponent(), InputNodeComponent(), liveClasses, LiveStatusBadge(), MemoryNodeComponent() (+9 more)

### Community 59 - "Memory All Scopes"
Cohesion: 0.18
Nodes (12): ALL_SCOPES, KINDS, MemoryExplorer(), readToken(), initialStatus(), RunsHistoryContent(), STATUSES, formatDateTime() (+4 more)

### Community 60 - "Canvas Routing Handles Workflow"
Cohesion: 0.18
Nodes (13): workflowEdgeTypes, EMPTY_LIVE_DEFINITION, FlowCanvas(), useCanvasStatusSnapshot(), workflowNodeTypes, edgeLiveStyle(), APPROVAL_HANDLE_AFFORDANCES, APPROVAL_OUTCOME_HANDLES (+5 more)

### Community 61 - "Punycode Punycodejs"
Cohesion: 0.22
Nodes (13): adapt(), basicToDigit(), decode(), digitToBasic(), encode(), error(), errors, RFC-3492 (+5 more)

### Community 62 - "Punycode Es6 Punycodees6Js"
Cohesion: 0.22
Nodes (13): adapt(), basicToDigit(), decode(), digitToBasic(), encode(), error(), errors, RFC-3492 (+5 more)

### Community 63 - "Route Dynamic"
Cohesion: 0.18
Nodes (12): dynamic, GET(), POST(), DELETE, GET, PATCH, POST, PUT (+4 more)

### Community 64 - "Run Executor Recover Interrupted"
Cohesion: 0.29
Nodes (4): recoverInterruptedRuns(), recoverInterruptedRunsDurable(), recoverInterruptedRunsInMemory(), assertMemoryAccessMatchesRun()

### Community 65 - "Route Dynamic"
Cohesion: 0.23
Nodes (12): dynamic, dynamic, GET(), PATCH(), dynamic, GET(), POST(), getAuthenticatedPrincipal() (+4 more)

### Community 66 - "Lang Graph Event Adapter"
Cohesion: 0.23
Nodes (10): isSensitiveKey(), isWorkingMemoryKey(), LangGraphEventAdapter, redact(), redactUrls(), redactWorkingMemory(), summarizeWorkingMemoryEntry(), write() (+2 more)

### Community 67 - "Webhook Auth Create Inbound"
Cohesion: 0.31
Nodes (12): createInboundWebhookRouter(), readBoundedRequestBody(), registerWebhookTriggerRoutes(), decryptWebhookSecret(), DEFAULT_TIMESTAMP_TOLERANCE_SECONDS, defaultReplayProtector, encryptWebhookSecret(), generateWebhookSecret() (+4 more)

### Community 68 - "Execution Timeline Decode Escaped"
Cohesion: 0.25
Nodes (13): decodeEscapedNewlines(), DetailView, durationFor(), eventLabel(), eventStatus(), ExecutionTimeline(), extractText(), formatValue() (+5 more)

### Community 69 - "Use Tasks Query Create"
Cohesion: 0.18
Nodes (11): CreateTaskModal(), ProjectOption, WorkspaceOption, CreateTaskInput, DependencyBlocker, fetchBoard(), postTaskAction(), TaskRequestError (+3 more)

### Community 70 - "Appearance Helpers @Playwright/Test"
Cohesion: 0.32
Nodes (7): meanColorChannel(), meanStyle(), openRegister(), registerAndOpenOrganization(), registerOnly(), lockedBackgroundMean(), meanOf()

### Community 71 - "Appearance Appearance Toggle"
Cohesion: 0.36
Nodes (9): AppearanceToggle(), applyAppearance(), AppShell(), Appearance, APPEARANCE_STORAGE_KEY, parseAppearance(), readAppearance(), toggleAppearance() (+1 more)

### Community 72 - "Clarification Build Clarification Package"
Cohesion: 0.27
Nodes (9): buildClarificationPackage(), BuildClarificationPackageInput, canonicalizeAnswers(), extractLegacyClarificationQuestions(), LEGACY_CLARIFICATION_OUTPUT, questionsFromNeedsHuman(), redactClarificationValue(), serializeOutputText() (+1 more)

### Community 73 - "Web Package Manager"
Cohesion: 0.18
Nodes (10): name, packageManager, private, scripts, build, dev, lint, start (+2 more)

### Community 74 - "Layout Metadata"
Cohesion: 0.27
Nodes (6): metadata, AuthProvider(), QueryProvider(), Toaster(), ToastItem(), useToastStore

### Community 75 - "Org Feature Flags Roles"
Cohesion: 0.29
Nodes (8): roles, OrgFeatureFlags, orgFeatureFlagsFromEnvironment(), OrgMembershipEnforcement, OrgRlsMode, parseBool(), parseMembership(), parseRls()

### Community 76 - "Subgraph Runner Apply Input"
Cohesion: 0.36
Nodes (9): applyInputMappings(), applyOutputMappings(), assertSafeNesting(), collectSubgraphRefs(), createStudioSubgraphRunner(), readPath(), SubgraphMapping, SubgraphRunnerDeps (+1 more)

### Community 78 - "Route Dynamic"
Cohesion: 0.36
Nodes (7): dynamic, dynamic, GET(), PATCH(), getProject(), getProjectDashboard(), patchProject()

### Community 79 - "Route Dynamic"
Cohesion: 0.36
Nodes (7): dynamic, dynamic, GET(), POST(), createProject(), listProjects(), retireProject()

### Community 80 - "Route Dynamic"
Cohesion: 0.39
Nodes (6): dynamic, dynamic, GET(), POST(), createProjectWorkspace(), listProjectWorkspaces()

### Community 81 - "Route Dynamic"
Cohesion: 0.32
Nodes (5): dynamic, dynamic, PUT(), putWorkspaceRepositories(), StudioEntityError

### Community 82 - "Agents Nextjs Breaking Changes"
Cohesion: 0.33
Nodes (6): Next.js Breaking Changes Rationale, Next.js Agent Rules (Docs), Claude Agent Config (Docs), Next.js Web Breaking Changes Rationale, Next.js Agent Rules (Web), Claude Agent Config (Web)

### Community 83 - "Bootstrap Bounded Number"
Cohesion: 0.53
Nodes (4): boundedNumber(), createObservabilityRuntime(), ObservabilityRuntime, parseCaptureMode()

### Community 84 - "Route Dynamic"
Cohesion: 0.47
Nodes (4): dynamic, DELETE(), dynamic, removeProjectRepository()

### Community 87 - "Auth Edge { Auth"
Cohesion: 0.50
Nodes (3): { auth }, authEdgeConfig, config

### Community 88 - "Require Punycode Require Punycodecjs"
Cohesion: 0.50
Nodes (3): Module, path, punycodeEntry

### Community 89 - "Readme Punycodejs Converter"
Cohesion: 0.50
Nodes (4): Punycode.js Converter, Punycode MIT License, RFC 3492 Specification, RFC 5891 Specification

### Community 90 - "Readme Nextjs Logo Svg"
Cohesion: 0.50
Nodes (4): Next.js Logo SVG, Vercel Logo SVG, Next.js Web Application, Geist Font Optimization

## Knowledge Gaps
- **429 isolated node(s):** `nextConfig`, `name`, `version`, `private`, `dev` (+424 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RequestPrincipal` connect `Agent Service List` to `Run Api Service Get`, `Validation Scaffold Autonomous Swarm`, `Organization Store Run`, `Postgres Run Store`, `Run Executor Cancel`, `Workspace Service Api Error`, `Project Service Create`, `Run Organization Access Branch`, `Dashboard Service Belongs To`, `Organization Context Register Organization`, `In Memory Run Store`, `Authorization Run Variables`, `Organization Purge Worker Register`, `Contracts Stream Run Events`, `Workspace Working Copy Service`, `Task Service Bounded Text`, `Task Service Fingerprint Answers`, `Contracts Listener`, `Lang Graph Event Adapter`, `Org Feature Flags Roles`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Why does `RunStoreContract` connect `Contracts Stream Run Events` to `Run Executor Recover Interrupted`, `Organization Store Run`, `Agent Service List`, `Run Budget Controller Settle`, `Run Executor Cancel`, `Postgres Run Store`, `Contracts Listener`, `Composition Close`, `Run Organization Access Branch`, `Dashboard Service Belongs To`, `In Memory Run Store`, `Approval Manager Agent Execution`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `RunExecutor` connect `Run Executor Cancel` to `Run Api Service Get`, `Contracts Stream Run Events`, `Organization Store Run`, `Run Executor Recover Interrupted`, `Task Service Bounded Text`, `Run Organization Access Schedule`, `Workspace Service Api Error`, `Task Service Fingerprint Answers`, `Composition Close`, `Run Organization Access Branch`, `Dashboard Service Belongs To`, `Routine Scheduler Register Routine`, `Approval Manager Agent Execution`, `Trigger Outbox Processor Is`, `Authorization Run Variables`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `nextConfig`, `name`, `version` to the rest of the system?**
  _429 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Run Api Service Get` be split into smaller, more focused modules?**
  _Cohesion score 0.07344632768361582 - nodes in this community are weakly interconnected._
- **Should `Validation Scaffold Autonomous Swarm` be split into smaller, more focused modules?**
  _Cohesion score 0.06654567453115548 - nodes in this community are weakly interconnected._
- **Should `Organization Store Run` be split into smaller, more focused modules?**
  _Cohesion score 0.07686932215234102 - nodes in this community are weakly interconnected._