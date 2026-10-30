# Feature 009: Dual-Mode Multi-Agent Orchestration

## Overview

Feature `009-dual-mode-orchestration` introduces dual-mode workflow archetypes, programmatic Kanban board synchronization, sandboxed workspace confinement, human approval gates, and adaptive QA feedback loops to the Multi-Agent Studio platform.

Target Organization: **`org-building-gap`** (Building Gap Delivery Org)  
Target Project: **`project-building-gap`** (Building Management Delivery Project)  
Sandbox Workspace: **`workspaces/building-management-sandbox`**  
Host Protected Repository: **`/home/hossein/Desktop/projects/building-management`** (strictly protected with 0 mutations).

---

## Key Capabilities & Architecture

### 1. Dual Workflow Archetypes

| Dimension | Linear Spec Pipeline (`linear-pipeline`) | Hierarchical Supervisor (`hierarchical-supervisor`) |
|---|---|---|
| **Topology** | Acyclic Directed Acyclic Graph (DAG) | Hub-and-Spoke with cyclic feedback routes |
| **Orchestration** | Static sequential pipeline | Dynamic board-driven supervisor dispatch |
| **Validation** | Cycles strictly forbidden (`LINEAR_PIPELINE_CYCLE_FORBIDDEN`) | Requires `supervisorHubNodeId`, router nodes, and recursion guards |
| **Use Case** | End-to-end atomic spec delivery | Complex gap remediation with iterative QA feedback loops |

### 2. Studio Task Tool & Bi-Directional Board Sync (`studio_task_tool`)

Specialist agents and the Lead Orchestrator interact programmatically with the Studio Kanban board:
- **`query_tasks`**: Query tasks by status (`queued`, `in_progress`, `in_review`, `done`, `paused`, `failed`).
- **`update_task_status`**: Update task status following the canonical transition state machine.
- **`assign_task`**: Assign specialist agents (`agent-gap-auditor`, `agent-gap-consolidator`, `agent-gap-engineer`, `agent-qa-verifier`).
- **`add_task_comment`**: Log structured audit findings with completeness scores and author role attribution (`agent`, `system`, `user`).
- **Multi-tenant Isolation**: Strict enforcement of `task.tenant_id === context.credentialPrincipal.tenantId`. Violations fail closed with `TENANT_ISOLATION_VIOLATION`.

### 3. Sandboxed Workspace Confinement & Host Protection

The `SandboxExecutionBarrier` guarantees complete isolation between agent code operations and host files:
- All file reads, writes, and worker subprocess commands are confined to `workspaces/building-management-sandbox`.
- Host repository `/home/hossein/Desktop/projects/building-management` is strictly forbidden for write access (`SandboxHostProtectionViolationError`).
- Path traversals (`../../`) and escaping symlinks throw `SandboxBoundaryViolationError`.
- Host repository Git status remains 100% clean (0 changes) post-execution.

### 4. Mandatory Human Approval Gate

Halt autonomous workflow progression prior to code remediation in the sandbox:
- Uses LangGraph `interrupt()` with `HumanApprovalInterruptContext`.
- Pauses run execution in state `waiting_for_human`.
- Downstream remediation nodes remain strictly unexecuted until explicit authorization.
- Resumption with `approved` executes remediation; `rejected` executes clean termination and marks the task `paused`.

### 5. Adaptive QA Feedback & Recursion Guards

When code changes fail QA verification:
- QA verifier returns structured failure evidence (`QAVerificationResult`) and `SupervisorOutcomeEnvelope`.
- Dynamic conditional router routes back to the remediation engineer for cycles 1 and 2.
- Upon reaching the recursion limit (default: 3 iterations), execution routes to `fallbackBranch` (`"loop_limit_exceeded"`).
- The task is paused on the Kanban board, diagnostic logs are recorded as task comments, and telemetry event `node.loop_limit_reached` is emitted.

---

## Seed Data (`src/studio/seeds/buildingGapOrgSeed.ts`)

- **Tenant**: `org-building-gap`
- **Project**: `project-building-gap`
- **Workspace**: `ws-building-sandbox`
- **Specialist Agents**:
  1. `Spec Delivery Lead Orchestrator` (`agent-lead-orchestrator`)
  2. `Spec & Code Gap Auditor` (`agent-gap-auditor`)
  3. `Gap Report Consolidator` (`agent-gap-consolidator`)
  4. `Gap Implementation Engineer` (`agent-gap-engineer`)
  5. `Delivery QA Verifier` (`agent-qa-verifier`)
- **Workflows**:
  1. `linear-spec-pipeline` (`Linear Spec-to-Code Pipeline`)
  2. `supervisor-gap-delivery-workflow` (`Hierarchical Supervisor Workflow`)
- **Tasks**: 42 Queued User Stories (37 Atomic Specs + 5 Decision Framework Tasks).

---

## Verification & Test Suites

```bash
# 1. Run dual-mode orchestration integration tests
pnpm test tests/dualModeOrchestration.test.ts

# 2. Run adaptive QA feedback loop tests
pnpm test tests/adaptiveQALoop.test.ts

# 3. Run Studio task tool tests
pnpm test tests/studioTaskTool.test.ts

# 4. Run sandbox execution barrier tests
pnpm test tests/sandboxExecutionBarrier.test.ts

# 5. Run full test suite in-band
pnpm test --runInBand
```
