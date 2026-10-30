# Research & Technical Decisions: Dual-Mode Multi-Agent Orchestration

**Feature**: `009-dual-mode-orchestration`  
**Date**: 2026-10-22  
**Spec**: [spec.md](./spec.md)  
**Status**: Completed  

---

## 1. Workflow Archetype Categorization & Topology Specification (`@multi-agent/types`)

### Context & Problem
The system currently treats all workflows as generic directed graphs of nodes (`agent`, `tool`, `approval`, `condition`, `input`, `output`). To support both simple batch pipelines and autonomous multi-agent delivery teams, the platform needs to distinguish between two fundamental architectural models:
1. **Linear Spec-to-Code Pipeline (`linear-pipeline`)**: Directed Acyclic Graph (DAG) with sequential node handoffs suitable for deterministic batch processing.
2. **Hierarchical Supervisor & Board-Driven Orchestrator (`hierarchical-supervisor`)**: Cyclic hub-and-spoke graph with a Lead Orchestrator agent acting as supervisor, dynamic condition routing, feedback loops, and bi-directional Kanban board synchronization.

### Decision
- Extend `@multi-agent/types` with explicit archetype definitions:
  ```typescript
  export type WorkflowArchetypeCategory = "linear-pipeline" | "hierarchical-supervisor";

  export interface WorkflowArchetypeConfig {
    category: WorkflowArchetypeCategory;
    supervisorHubNodeId?: string;
    maxRecursionSteps?: number;
    allowedLoopRoutes?: string[];
    humanApprovalRequired?: boolean;
  }
  ```
- Add optional `archetype?: WorkflowArchetypeCategory` and `archetypeConfig?: WorkflowArchetypeConfig` to `WorkflowDefinition`. For backward compatibility, legacy definitions with undefined archetype default to `"linear-pipeline"`.
- Archetype-specific compiler and validation rules:
  - `"linear-pipeline"`: Requires acyclic topology (cycles emit `UNSAFE_CYCLE` or warning if unconfigured); sequential handoffs.
  - `"hierarchical-supervisor"`: Allows designated cyclic routes through the supervisor hub node; requires at least one condition routing node connected to the hub; requires explicit recursion guard configuration; requires a human approval gate before code-modifying nodes.

### Rationale
- Explicit archetype categorization makes intent unambiguous to compilers, visual canvas renderers, and runtime monitors.
- Prevents accidental infinite cycles while legitimizing controlled feedback remediation loops.
- 100% backward-compatible with existing workflow schemas and definitions.

### Alternatives Considered
- **Pure topological inference without archetype metadata**: Inspecting graph structure at compile-time to detect cycles and guess whether it's a supervisor. Rejected because incomplete draft graphs or malformed linear pipelines could be misclassified, hiding configuration bugs.
- **Separate graph engines**: Using completely separate execution engines for linear vs supervisor workflows. Rejected because LangGraph `StateGraph` natively supports both DAGs and cyclic graphs with conditional routing; maintaining two engines would duplicate runtime code and drift.

---

## 2. LangGraph StateGraph Cycle Handling & Recursion Guardrails

### Context & Problem
LangGraph's `StateGraph` supports cyclic edges, but autonomous multi-agent remediation loops (Supervisor -> Implementer -> QA -> Supervisor) risk infinite loops if defects persist or agents get stuck in unresolvable feedback cycles. Requirement FR-003 and SC-005 require strict recursion guardrails (maximum 3 iterations for QA remediation loops).

### Decision
- **Loop State Tracking**:
  Extend `RuntimeState` with loop iteration tracking:
  ```typescript
  export interface LoopIterationState {
    cycleCounts: Record<string, number>; // key: `${sourceNodeId}->${targetNodeId}` or route key
    maxIterations: Record<string, number>;
  }
  ```
- **Cycle Guard Evaluation**:
  In `workflowCompiler.ts`, wrap conditional edge evaluation for cyclic feedback routes with a recursion limiter:
  ```typescript
  const routeExecutionGuard = (sourceId: string, targetId: string, state: RuntimeState, maxAllowed = 3): boolean => {
    const loopKey = `${sourceId}->${targetId}`;
    const current = state.loopIterations?.[loopKey] ?? 0;
    if (current >= maxAllowed) {
      return false; // loop limit exceeded
    }
    return true;
  };
  ```
- **Fallback on Loop Limit Exceeded**:
  When a cyclic route reaches the maximum iteration threshold (e.g. 3 attempts for QA feedback remediation):
  1. The compiler's conditional routing function intercepts the decision and diverts execution to an escalation branch (`loop_limit_exceeded` or terminal output).
  2. The supervisor updates the task on the board to `failed` or `paused` with detailed diagnostic comments.
  3. Emits `node.loop_limit_reached` event on the execution event stream.
  4. Execution halts safely without exceeding server-level step limits (`guardrails.maxWorkflowSteps: 1000`).

### Rationale
- Per-route loop bounding provides localized, fast termination (<3 attempts) instead of exhausting the broad 1,000-step workflow quota.
- Preserves predictable execution costs and prevents runaway LLM token expenditure.
- Cleanly integrates into LangGraph's native `addConditionalEdges` destination mapping.

### Alternatives Considered
- **Relying solely on `maxWorkflowSteps: 1000`**: Rejected because a single failing test loop could cycle hundreds of times before hitting 1,000 steps, wasting substantial LLM tokens and API quota.
- **Client-side loop counting**: Rejected because server-side runtime execution must be authoritative and tamper-proof.

---

## 3. Studio Task Management Tool (`src/tools/`) Architecture

### Context & Problem
Lead Orchestrator agents need programmatic tools to inspect the Studio Kanban board, query queued tasks, claim and assign tasks to specialist sub-agents, update task statuses across the lifecycle (`queued` -> `in_progress` -> `in_review` -> `done`), and post structured audit findings as task comments. The tool must operate securely with strict tenant isolation.

### Decision
- Implement `StudioTaskToolExecutor` in `src/tools/studioTaskToolExecutor.ts` implementing `ToolExecutor`.
- Register the tool as `studio_task_tool` with category `function` (or dedicated executor in `ToolExecutorFactory`).
- Supported Actions:
  1. `query_tasks`: Query tasks filtered by `status`, `assignedAgent`, `projectId`, `workspaceId`, `limit`, and `offset`.
  2. `update_task_status`: Update task lifecycle status (`queued`, `in_progress`, `in_review`, `done`, `failed`, `paused`). Validates transitions against `canTransitionStatus`.
  3. `assign_task`: Assign or reassign a task to a designated specialist agent ID.
  4. `add_task_comment`: Append a structured comment with author role `agent`, referencing the active agent ID, completeness score, identified gaps, and modified files.
- **Tenant Isolation Enforcement**:
  - The tool execution input supplies `credentialPrincipal: { tenantId, principalId }` or run execution context.
  - All queries filter by `tenant_id = principal.tenantId`.
  - All mutations verify that the target task's `tenant_id` matches the caller's `tenantId`.
  - Any cross-tenant access attempt throws `TenantIsolationViolationError` and fails closed.
  - Invalid task IDs return `TaskNotFoundError` with safe error envelopes without exposing foreign tenant data.

### Rationale
- Direct in-process execution via `StudioStore` and `taskService` ensures sub-millisecond execution without HTTP networking overhead or external secret distribution.
- Strict reuse of the existing canonical `canTransitionStatus` state machine in `@multi-agent/types` guarantees board integrity.
- Structured comments provide transparent audit trails directly visible on the Kanban UI for human supervisors.

### Alternatives Considered
- **Direct SQL queries from agent nodes**: Violates security boundaries, bypasses data validation, and risks SQL injection.
- **HTTP REST calls to `/api/tasks` via `HttpToolExecutor`**: Requires generating and refreshing bearer tokens for internal agents, introduces network round-trips, and complicates local test runners.

---

## 4. Sandboxed Execution Barrier & Host Repository Protection

### Context & Problem
Agents performing code gap audits, running test suites, or implementing fixes must operate strictly within `workspaces/building-management-sandbox`. The primary host development repository at `/home/hossein/Desktop/projects/building-management` must be protected from any accidental modification, write, or deletion.

### Decision
- Create `SandboxExecutionBarrier` in `src/security/sandboxExecutionBarrier.ts`:
  ```typescript
  export class SandboxExecutionBarrier {
    private readonly canonicalSandboxRoot: string;
    private readonly forbiddenPaths: string[];

    constructor(sandboxRoot: string, forbiddenPaths: string[] = []) {
      this.canonicalSandboxRoot = path.resolve(fs.realpathSync.native(sandboxRoot));
      this.forbiddenPaths = forbiddenPaths.map((p) => path.resolve(fs.realpathSync.native(p)));
    }

    assertPathAllowed(targetPath: string, mode: "read" | "write"): void {
      const canonicalTarget = path.resolve(targetPath);
      // 1. Explicit forbidden path check
      for (const forbidden of this.forbiddenPaths) {
        if (canonicalTarget === forbidden || canonicalTarget.startsWith(forbidden + path.sep)) {
          throw new HostRepositoryProtectionViolationError(
            `Access to host repository path "${targetPath}" is strictly forbidden.`
          );
        }
      }
      // 2. Write operations must resolve strictly inside sandbox root
      if (mode === "write") {
        if (
          canonicalTarget !== this.canonicalSandboxRoot &&
          !canonicalTarget.startsWith(this.canonicalSandboxRoot + path.sep)
        ) {
          throw new SandboxBoundaryViolationError(
            `Write operation targeted outside sandbox root: "${targetPath}". Allowed root: "${this.canonicalSandboxRoot}"`
          );
        }
      }
    }
  }
  ```
- **Integration Points**:
  - `executionPolicy.ts`: When `agent.executionPolicy.workspaceRoot` is set, validate it through `SandboxExecutionBarrier`.
  - `WorkerRuntime` / `LocalProcessWorkerRuntime`: CLI processes (like `git`, `npm test`, `pytest`) have `cwd` forced to `workspaces/building-management-sandbox`.
  - Host Git Status Verification: Automated test suites verify that the host repository `/home/hossein/Desktop/projects/building-management` has zero modified, untracked, or deleted files before and after any execution run.

### Rationale
- Canonical path resolution using `realpathSync.native` prevents bypasses via symlinks, relative traversal (`../../`), or path normalization quirks.
- Dual-barrier approach (explicit host path denial + strict sandbox write confinement) guarantees host repo safety.
- Fail-closed security architecture blocks unauthorized I/O immediately before filesystem operations.

### Alternatives Considered
- **Filesystem OS permissions (chmod -w)**: Modifying file permissions on the developer's host repository risks disrupting developer workflows, IDE file watchers, and git index locks.
- **Docker volume mounting exclusively**: Docker provides strong isolation, but requires Docker daemon availability which is not guaranteed in all local development and CI testing environments. The software-level canonical barrier guarantees safety across both local process and container runtimes.

---

## 5. Human Approval Gate & LangGraph `interrupt()` Lifecycle

### Context & Problem
Autonomous code generation poses risks if modifications are applied without human review. Requirement FR-021 through FR-023 mandate a Human Approval Gate positioned strictly between gap report consolidation and any code implementation.

### Decision
- The workflow graph places an `approval` node directly after the `Gap Report Consolidator` node and before the `Gap Implementation Engineer` node:
  ```
  [Intake / Tasks] -> [Spec & Code Gap Auditor] -> [Gap Report Consolidator]
                                                                |
                                                                v
                                                     [Human Approval Gate]
                                                    /                     \
                                            (approved)                 (rejected)
                                                /                           \
                           [Gap Implementation Engineer]              [Clean Halt & Audit Log]
                                        |
                                        v
                              [Delivery QA Verifier]
                                 /              \
                           (tests pass)      (tests fail)
                               /                  \
                        [Package Output]   (loop back to Implementer <= 3)
  ```
- **LangGraph Interruption**:
  - When the compiler encounters the approval node, it invokes LangGraph's `interrupt()` function with the consolidated gap payload, reviewer roles (`admin`, `project_manager`), and timeout bounds (default 24h).
  - The runtime catches the interrupt, updates the run status to `paused` / `waiting_for_human`, and persists the checkpoint in `RunStore`.
- **Resolution**:
  - The human operator reviews the consolidated gap report on the UI and submits an approval decision via `POST /api/runs/:runId/approve` or rejection via `POST /api/runs/:runId/reject`.
  - If approved: The run resumes from checkpoint with `state.branch = "approved"`, scheduling the implementation engineer.
  - If rejected: The run resumes with `state.branch = "rejected"`, executes the clean halt node, writes audit evidence, and marks the task as `paused` on the board without modifying any code files.
  - If timed out: Fails closed and cancels pending approval requests.

### Rationale
- Reuses existing robust `approvalManager.ts` and `runExecutor.ts` checkpoint restoration mechanics.
- Zero code modification can occur while execution is suspended at the checkpoint.
- Full provenance and decision history is captured for compliance.

---

## 6. Workflow Switcher Coexistence & URL Deep Linking

### Context & Problem
Studio operators on `/o/building-gap/org` need to switch seamlessly between the legacy `Linear Spec-to-Code Pipeline` and the new `Hierarchical Supervisor Workflow` without page reloads, data collisions, or loss of unsaved edits.

### Decision
- **URL Synchronization**:
  - Deep-link parameter `?workflowId=<workflowId>` in `apps/web/src/app/(authenticated)/o/[orgSlug]/org/page.tsx` and `WorkflowEditor.tsx`.
  - `WorkflowSwitcher.tsx` uses `router.push(orgUrl(`/org?workflowId=${encodeURIComponent(id)}`))` for client-side navigation.
  - On initial mount or URL change, `WorkflowEditor` loads the designated workflow definition via `workflowService.getWorkflow(workflowId)` and initializes `useWorkflowStore`.
- **Dirty State Protection**:
  - The switcher checks `useWorkflowStore.getState().isDirty`.
  - If unsaved changes exist, prompts a browser confirmation or dialog (`Discard unsaved workflow changes?`). Navigation proceeds only if confirmed.
- **Tenant Registration**:
  - Both workflows are registered with unique, non-colliding IDs in tenant `org-building-gap`:
    - `linear-spec-pipeline`: Linear Spec-to-Code Pipeline
    - `supervisor-gap-delivery-workflow`: Hierarchical Supervisor & Board-Driven Orchestrator
  - Switching between workflows re-renders React Flow nodes and edges without refreshing browser page state.

### Rationale
- Pure client-side routing preserves application context and reduces switch latency to <100ms.
- Explicit query parameter enables bookmarking, sharing, and consistent browser back/forward navigation.

---

## 7. Organization Registration & Seed Configuration (`org-building-gap`)

### Context & Problem
FR-015 through FR-018 require registering both workflow archetypes, configuring 5 specialist agent personas, and binding all 42 building management user stories to the task board under organization `org-building-gap`.

### Decision
- Create a dedicated registration module `src/studio/seeds/buildingGapOrgSeed.ts`:
  1. Organization Profile: `org-building-gap` ("Building Gap Delivery Org").
  2. Workspace & Project: Project `building-management-project` bound to workspace `workspaces/building-management-sandbox`.
  3. 5 Specialist Agents:
     - `lead-orchestrator`: Spec Delivery Lead Orchestrator (supervisor, task tool access).
     - `gap-auditor`: Spec & Code Gap Auditor (read-only file access, spec gap comparison).
     - `gap-consolidator`: Gap Report Consolidator (aggregates audit findings across tasks).
     - `gap-engineer`: Gap Implementation Engineer (sandboxed write access).
     - `qa-verifier`: Delivery QA Verifier (executes test suites in sandbox).
  4. Tool Registration: `studio_task_tool` registered and assigned to `lead-orchestrator`.
  5. Workflows:
     - `linear-spec-pipeline`: Acyclic linear sequence with direct handoffs.
     - `supervisor-gap-delivery-workflow`: Hub-and-spoke supervisor graph with board sync, approval gate, and QA loop.
  6. 42 Tasks: Seeded from `workspaces/building-management-sandbox/reports_documentation/atomic-specs/INDEX.md` (37 atomic specs + 5 decision engine specs), initialized to status `queued`.

### Rationale
- Fully automated, idempotent seed utility callable from test suites, migration scripts, and development bootstrapping.
- Guarantees immediate out-of-the-box readiness for verification and demonstration.
