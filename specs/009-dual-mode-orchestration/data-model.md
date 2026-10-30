# Data Model: Dual-Mode Multi-Agent Orchestration

**Feature**: `009-dual-mode-orchestration`  
**Date**: 2026-10-22  
**Spec**: [spec.md](./spec.md)  
**Status**: Completed  

---

## 1. Workflow Archetype Domain Model (`@multi-agent/types`)

Represents the structural archetype classification and topology constraints governing workflow validation, compilation, and UI presentation:

```typescript
/**
 * Core workflow archetype category.
 * - "linear-pipeline": Sequential, acyclic execution (DAG) with direct node handoffs.
 * - "hierarchical-supervisor": Hub-and-spoke supervisor graph with dynamic condition routing,
 *   feedback remediation loops, and bi-directional Kanban board synchronization.
 */
export type WorkflowArchetypeCategory = "linear-pipeline" | "hierarchical-supervisor";

export interface WorkflowRecursionGuardConfig {
  /** Maximum iterations allowed for a cyclical feedback route (e.g. 3 for QA remediation loops). */
  maxIterations: number;
  /** Route or edge key monitored by this guard. */
  routeKey: string;
  /** Fallback branch taken when recursion limit is exceeded (e.g. "escalate_to_human" or "loop_limit_exceeded"). */
  fallbackBranch: string;
}

export interface WorkflowArchetypeConfig {
  /** Declared archetype category. */
  category: WorkflowArchetypeCategory;
  /** Primary supervisor hub node id (required for hierarchical-supervisor). */
  supervisorHubNodeId?: string;
  /** Server-level maximum step limit override (optional, defaults to 1,000). */
  maxExecutionSteps?: number;
  /** Granular recursion guards for cyclic routes. */
  recursionGuards?: WorkflowRecursionGuardConfig[];
  /** Whether the workflow incorporates a mandatory human approval gate before mutating code. */
  humanApprovalGateRequired?: boolean;
}

/** Extended WorkflowDefinition supporting archetype metadata */
export interface WorkflowDefinition {
  id: string;
  schemaVersion?: number;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  updatedAt: string;
  ownerId?: string;
  tenantId?: string;
  /** Archetype metadata */
  archetype?: WorkflowArchetypeCategory;
  archetypeConfig?: WorkflowArchetypeConfig;
}
```

---

## 2. Supervisor Outcome Envelope & Dynamic Routing

Defines the structured envelope returned by the Lead Orchestrator and specialist agents to drive dynamic condition routing in LangGraph:

```typescript
export type SupervisorActionRoute =
  | "audit_spec"
  | "consolidate"
  | "await_approval"
  | "implement_spec"
  | "qa_verify"
  | "complete"
  | "loop_limit_exceeded"
  | "fail";

export interface IdentifiedGap {
  specCode: string;
  title: string;
  severity: "critical" | "major" | "minor";
  description: string;
  missingFiles?: string[];
  suggestedFix?: string;
}

export interface SpecAuditResultPayload {
  taskId: string;
  userStoryCode: string;
  completenessScore: number; // 0.0 to 100.0
  passedChecks: number;
  totalChecks: number;
  identifiedGaps: IdentifiedGap[];
  inspectedFiles: string[];
  auditTimestamp: string;
}

export interface ConsolidatedGapReport {
  totalUserStories: number;
  auditedCount: number;
  averageCompletenessScore: number;
  criticalGapsCount: number;
  allGaps: IdentifiedGap[];
  remediationPlanSummary: string;
  estimatedEffortHours: number;
  preparedAt: string;
}

export interface QAVerificationResult {
  taskId: string;
  testsPassed: boolean;
  totalTests: number;
  failedTestsCount: number;
  failureOutput?: string;
  iterationCount: number;
  verifiedFiles: string[];
}

export interface SupervisorOutcomeEnvelope {
  /** Target routing decision driving LangGraph conditional edge selection */
  nextAction: SupervisorActionRoute;
  /** Active task ID being processed */
  taskId?: string;
  /** Current iteration count for this task's remediation loop */
  iterationCount?: number;
  /** Spec audit outcome */
  auditResult?: SpecAuditResultPayload;
  /** Consolidated audit outcome across all queued stories */
  consolidatedReport?: ConsolidatedGapReport;
  /** QA verification output */
  qaResult?: QAVerificationResult;
  /** Human-readable status message for logging and UI telemetry */
  statusMessage: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}
```

---

## 3. Studio Task Management Tool (`src/tools/`) Contracts

Defines the parameters and response schemas for the programmatic `studio_task_tool` used by the Lead Orchestrator:

```typescript
export type StudioTaskToolAction =
  | "query_tasks"
  | "update_task_status"
  | "assign_task"
  | "add_task_comment";

export interface StudioTaskQueryInput {
  status?: TaskStatus;
  projectId?: string;
  workspaceId?: string;
  assignedAgent?: string;
  limit?: number;
  offset?: number;
}

export interface StudioTaskUpdateStatusInput {
  taskId: string;
  newStatus: TaskStatus;
  reason?: string;
}

export interface StudioTaskAssignInput {
  taskId: string;
  assignedAgent: string;
  assignedAgents?: string[];
}

export interface StudioTaskAddCommentInput {
  taskId: string;
  content: string;
  authorRole?: "agent" | "system" | "user";
  authorAgentId?: string;
  metadata?: {
    completenessScore?: number;
    gapsCount?: number;
    iteration?: number;
    reportRef?: string;
    [key: string]: unknown;
  };
}

export type StudioTaskToolInput =
  | { action: "query_tasks"; params: StudioTaskQueryInput }
  | { action: "update_task_status"; params: StudioTaskUpdateStatusInput }
  | { action: "assign_task"; params: StudioTaskAssignInput }
  | { action: "add_task_comment"; params: StudioTaskAddCommentInput };

export interface StudioTaskToolSuccessResponse<T = unknown> {
  success: true;
  action: StudioTaskToolAction;
  data: T;
  timestamp: string;
}

export interface StudioTaskToolErrorResponse {
  success: false;
  action: StudioTaskToolAction;
  error: {
    code:
      | "TASK_NOT_FOUND"
      | "INVALID_STATUS_TRANSITION"
      | "TENANT_ISOLATION_VIOLATION"
      | "INVALID_INPUT"
      | "DEPENDENCY_BLOCKED";
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export type StudioTaskToolOutput = StudioTaskToolSuccessResponse | StudioTaskToolErrorResponse;
```

---

## 4. Human Approval Gate Schema & Interruption Payload

Defines the contract for the pause-and-resume approval gate:

```typescript
export interface HumanApprovalGateConfig {
  message: string;
  approvalType: "required";
  timeoutSeconds: number; // e.g., 86400 (24h)
  requiredRoles: Array<"admin" | "project_manager" | "lead_architect">;
  onTimeout: "fail_closed";
  allowedDecisions: Array<"approved" | "rejected" | "needs_clarification">;
}

export interface HumanApprovalInterruptContext {
  gateId: string;
  runId: string;
  nodeId: string;
  consolidatedGapReport: ConsolidatedGapReport;
  requestedAt: string;
  timeoutAt: string;
  message: string;
}

export interface HumanApprovalDecisionPayload {
  decision: "approved" | "rejected" | "needs_clarification";
  reviewerId: string;
  reviewerRole: string;
  decisionNotes?: string;
  decidedAt: string;
}
```

---

## 5. Sandboxed Execution Boundary & Security Isolation Model

Defines the isolation rules and error structures preventing write operations outside the designated sandbox:

```typescript
export interface SandboxExecutionPolicy {
  /** Canonical directory where agent read/write/exec operations are confined */
  canonicalSandboxRoot: string; // e.g. "/absolute/path/to/workspaces/building-management-sandbox"
  /** Explicitly forbidden host paths (read/write forbidden) */
  forbiddenHostPaths: string[]; // e.g. ["/home/hossein/Desktop/projects/building-management"]
  /** Allowed command binaries in the sandbox */
  allowedExecutables: string[]; // e.g. ["git", "pnpm", "npm", "pytest", "node", "python3"]
  /** Maximum execution duration per process (ms) */
  processTimeoutMs: number;
}

export class SandboxHostProtectionViolationError extends Error {
  constructor(public readonly targetPath: string, public readonly attemptedAction: string) {
    super(`Security policy violation: Agent attempted ${attemptedAction} on protected host path "${targetPath}"`);
    this.name = "SandboxHostProtectionViolationError";
  }
}

export class SandboxBoundaryViolationError extends Error {
  constructor(public readonly targetPath: string, public readonly sandboxRoot: string) {
    super(`Security policy violation: Path "${targetPath}" resolves outside sandbox root "${sandboxRoot}"`);
    this.name = "SandboxBoundaryViolationError";
  }
}
```

---

## 6. Seed Configuration Models for `org-building-gap`

Defines the concrete records seeded into the PostgreSQL database / Studio store:

### Organization & Projects
- `OrganizationProfile`:
  - `id`: `"org-building-gap"`
  - `name`: `"Building Gap Delivery Org"`
  - `slug`: `"building-gap"`
  - `ownerId`: `"admin"`
  - `status`: `"active"`
- `StudioProject`:
  - `id`: `"project-building-gap"`
  - `name`: `"Building Management Delivery Project"`
  - `tenantId`: `"org-building-gap"`
- `StudioWorkspace`:
  - `id`: `"ws-building-sandbox"`
  - `name`: `"Building Management Sandbox Workspace"`
  - `tenantId`: `"org-building-gap"`
  - `projectId`: `"project-building-gap"`
  - `settings`: `{ storageRoot: "workspaces/building-management-sandbox" }`

### Specialist Agents (5 Personas)
1. **Spec Delivery Lead Orchestrator (`agent-lead-orchestrator`)**
   - Role: Hub supervisor, orchestrates intake, dispatches audits, requests approval, routes QA remediation.
   - Tools: `studio_task_tool`
   - Model: Claude 3.5 Sonnet / GPT-4o
2. **Spec & Code Gap Auditor (`agent-gap-auditor`)**
   - Role: Compares spec requirements against sandbox codebase, produces completeness scores and gap reports.
   - Tools: Read-only sandbox file inspection.
3. **Gap Report Consolidator (`agent-gap-consolidator`)**
   - Role: Synthesizes individual spec audits into an executive gap matrix and remediation roadmap.
4. **Gap Implementation Engineer (`agent-gap-engineer`)**
   - Role: Writes code, fixes gaps, generates patches inside `workspaces/building-management-sandbox`.
   - Execution Policy: `filesystem: "read-write"`, `workspaceRoot: "workspaces/building-management-sandbox"`.
5. **Delivery QA Verifier (`agent-qa-verifier`)**
   - Role: Runs test suites (`pnpm test`, `pytest`) in sandbox, reports pass/fail evidence back to supervisor.
   - Execution Policy: `shell: "restricted"`, `workspaceRoot: "workspaces/building-management-sandbox"`.

### Workflows (Dual Modes)
1. **Linear Spec-to-Code Pipeline (`linear-spec-pipeline`)**:
   - Nodes: `input` -> `agent-gap-auditor` -> `agent-gap-consolidator` -> `approval-gate` -> `agent-gap-engineer` -> `agent-qa-verifier` -> `output`.
   - Edges: Normal sequential edges without feedback cycles.
   - Archetype: `linear-pipeline`.
2. **Hierarchical Supervisor Workflow (`supervisor-gap-delivery-workflow`)**:
   - Nodes: `input` -> `agent-lead-orchestrator` <-> condition router <-> `agent-gap-auditor`, `agent-gap-consolidator`, `approval-gate`, `agent-gap-engineer`, `agent-qa-verifier` -> `output`.
   - Edges: Conditional edges with recursion limit guardrails (max 3 loops on QA failure).
   - Archetype: `hierarchical-supervisor`.

### 42 Building Management User Stories Mapping
- Total Tasks: 42
- Source: 37 atomic user stories from `reports_documentation/atomic-specs/INDEX.md` (`US-DR-01` to `US-DR-16`, `US-SR-01` to `US-SR-04`, `US-AG-01` to `US-AG-06`, `US-PR-01` to `US-PR-07`, `US-DP-01` to `US-DP-03`, `US-WH-01` to `US-WH-02`, `US-EX-01` to `US-EX-04`) + 5 core decision framework tasks.
- Initial Status: `queued`
- Priority: `high` (for core daily reports), `medium` (for periodic and warehouse reports).
- Project: `project-building-gap`.
- Workspace: `ws-building-sandbox`.
