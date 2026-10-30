# Quickstart & Validation Guide: Dual-Mode Multi-Agent Orchestration

**Feature**: `009-dual-mode-orchestration`  
**Date**: 2026-10-22  
**Spec**: [spec.md](./spec.md)  
**Status**: Ready for Validation  

---

## 1. Overview & Prerequisites

This quickstart guides developers and QA engineers through end-to-end automated and manual validation of **Dual-Mode Multi-Agent Orchestration** in Studio:
1. **Linear Spec-to-Code Pipeline** (`linear-spec-pipeline`): Acyclic, sequential batch pipeline.
2. **Hierarchical Supervisor & Board-Driven Orchestrator** (`supervisor-gap-delivery-workflow`): Hub-and-spoke supervisor with dynamic condition routing, QA remediation feedback loops, and bi-directional Kanban board synchronization.

### Prerequisites
- **Node.js**: v20.x or higher
- **pnpm**: v9.x or higher
- **PostgreSQL**: Running on `localhost:5432` or `localhost:55432` (with database `studio_memory`)
- **Sandbox Workspace**: `workspaces/building-management-sandbox` populated with the building management codebase and atomic specifications.
- **Host Repository**: `/home/hossein/Desktop/projects/building-management` (must remain 100% pristine and unmodified).

---

## 2. Environment Setup

From the repository root (`/home/hossein/Desktop/projects/multi-agent`):

```bash
# 1. Install dependencies and build shared packages
pnpm install
pnpm --filter @multi-agent/types build

# 2. Run migrations for Studio store
pnpm --filter server run db:migrate

# 3. Seed organization 'org-building-gap', 42 user stories, and both workflow archetypes
pnpm ts-node src/studio/seeds/buildingGapOrgSeed.ts
```

---

## 3. Automated Test Suite Validation

Run the dedicated dual-mode orchestration test suites covering contracts, supervisor loop guardrails, task tool operations, sandbox boundaries, and approval gates:

```bash
# Run all dual-mode orchestration unit and integration tests
pnpm test tests/dualModeOrchestration.test.ts tests/studioTaskTool.test.ts tests/sandboxExecutionBarrier.test.ts
```

### Expected Output
```text
PASS tests/dualModeOrchestration.test.ts
  Workflow Archetypes
    ✓ compiles linear-pipeline as an acyclic graph
    ✓ compiles hierarchical-supervisor with cyclic feedback routes
    ✓ enforces recursion limit guardrails at max 3 iterations on QA failure
    ✓ suspends execution at Human Approval Gate before remediation node
  Supervisor Loop & Board Sync
    ✓ supervisor queries queued tasks from Studio Task Board
    ✓ transitions task status across lifecycle: queued -> in_progress -> in_review -> done
    ✓ appends structured audit findings and completeness score to task comments
  Workflow Switcher Coexistence
    ✓ loads both linear and supervisor workflows in org-building-gap
    ✓ switches active workflow definition without state pollution

PASS tests/studioTaskTool.test.ts
  StudioTaskToolExecutor
    ✓ queries tasks with tenant isolation filter
    ✓ rejects cross-tenant task update attempts (fail-closed)
    ✓ updates task status following canonical transition rules
    ✓ appends structured comments with agent attribution

PASS tests/sandboxExecutionBarrier.test.ts
  SandboxExecutionBarrier
    ✓ permits reads and writes inside workspaces/building-management-sandbox
    ✓ rejects write operations targeting /home/hossein/Desktop/projects/building-management
    ✓ blocks path traversal attacks (e.g., ../../ escapes)
    ✓ confirms host repository git status is 100% clean post-execution

Test Suites: 3 passed, 3 total
Tests:       24 passed, 24 total
```

---

## 4. End-to-End Validation Scenarios

### Scenario 1: Workflow Switcher Coexistence (`/o/building-gap/org`)

**Objective**: Verify seamless UI coexistence, canvas rendering, and deep-linking between both archetypes.

1. Start the web and server dev servers:
   ```bash
   pnpm dev
   ```
2. Navigate to: `http://localhost:3060/o/building-gap/org`
3. Click the **Workflow Switcher** dropdown in the top editor bar.
4. Verify both options appear:
   - `Linear Spec-to-Code Pipeline`
   - `Hierarchical Supervisor Workflow`
5. Select `Hierarchical Supervisor Workflow`:
   - Canvas immediately renders the hub-and-spoke layout: `Spec Delivery Lead Orchestrator` hub connected via conditional edges to `Spec & Code Gap Auditor`, `Gap Report Consolidator`, `Human Approval Gate`, `Gap Implementation Engineer`, and `Delivery QA Verifier`.
   - Browser URL updates to: `http://localhost:3060/o/building-gap/org?workflowId=supervisor-gap-delivery-workflow`.
6. Make an unsaved modification on the canvas and switch back to `Linear Spec-to-Code Pipeline`:
   - System prompts: `"Discard unsaved workflow changes?"`.
   - Clicking **Cancel** preserves edits.
   - Clicking **OK** switches to the linear pipeline layout with direct sequential edges.

---

### Scenario 2: Supervisor Orchestration & Task Board Sync

**Objective**: Verify bi-directional synchronization between the supervisor agent and the Studio Kanban board.

1. Open the organization Kanban board: `http://localhost:3060/o/building-gap/tasks`.
2. Confirm the 42 seeded user stories appear in the **Queued** column (e.g. `US-DR-01`: "ثبت و پایش شرایط آب‌وهوایی و دما").
3. Trigger a delivery run for `US-DR-01`:
   - Supervisor claims task via `studio_task_tool` -> Task card moves to **In Progress** with assigned agent `Spec & Code Gap Auditor`.
   - Auditor analyzes `workspaces/building-management-sandbox/reports_documentation/atomic-specs/SPEC-01-DAILY-HEADER-WEATHER.md` against sandbox codebase.
   - Auditor completes analysis -> Supervisor posts structured comment to the task:
     > **Spec Audit Complete**: Completeness score 78.5%. Passed 11/14 checks.  
     > **Identified Gaps**: Missing weather condition override validation handler.  
     > **Inspected Files**: `apps/web/src/components/daily-reports/WeatherSection.tsx`
   - Task card moves to **In Review**.

---

### Scenario 3: Sandboxed Workspace Isolation & Host Repo Protection

**Objective**: Guarantee that 0 writes occur outside the sandbox and host repository `/home/hossein/Desktop/projects/building-management` remains completely untouched.

1. Inspect host repository status before run:
   ```bash
   cd /home/hossein/Desktop/projects/building-management
   git status --short
   # Must be empty (0 changes)
   ```
2. Execute a test simulation attempting path traversal from agent code:
   ```bash
   pnpm test tests/sandboxExecutionBarrier.test.ts -t "blocks path traversal"
   ```
3. Verify that any write attempt targeting `/home/hossein/Desktop/projects/building-management` throws:
   `SandboxHostProtectionViolationError: Access to host repository path is strictly forbidden.`
4. Re-verify host repository git status:
   ```bash
   cd /home/hossein/Desktop/projects/building-management
   git status --short
   # Verified: Still 0 changes
   ```

---

### Scenario 4: Mandatory Human Approval Gate Before Code Mutation

**Objective**: Confirm that code modifications cannot execute without explicit human approval.

1. Trigger the supervisor workflow across intake, spec audit, and gap report consolidation.
2. Observe run status in Studio UI (`/o/building-gap/runs`):
   - Run transitions to `waiting_for_human` / `paused` at node `Human Approval Gate`.
   - Consolidated Gap Report summary is displayed with proposed remediation actions.
3. Verify that downstream nodes (`Gap Implementation Engineer` and `Delivery QA Verifier`) have not executed.
4. **Test Rejection**:
   - Click **Reject** with note: *"Postponing weather refactoring"*.
   - Run halts cleanly with status `cancelled` / `rejected`. No sandbox files are modified.
5. **Test Approval**:
   - Trigger new run and click **Approve**.
   - Run resumes execution, activating `Gap Implementation Engineer` in the sandbox.

---

### Scenario 5: Adaptive QA Feedback Loop with Recursion Limit

**Objective**: Verify iterative self-correction bounded by a strict 3-loop limit.

1. Introduce an intentional defect in sandbox code causing a test failure.
2. During the QA verification step:
   - `Delivery QA Verifier` returns `testsPassed: false` with failing assertion output.
   - Supervisor intercepts failure envelope and routes back to `Gap Implementation Engineer` (Iteration 1).
   - Engineer applies fix -> QA runs tests again.
3. If tests pass on Iteration 2:
   - Supervisor transitions task on board to `done`.
   - Delivery run concludes successfully.
4. If tests fail across 3 consecutive iterations:
   - Supervisor loop guard intercepts the 4th attempt (`iterationCount >= 3`).
   - Supervisor diverts to `loop_limit_exceeded` fallback.
   - Task on board transitions to `paused` with comment: *"Remediation recursion limit (3) exceeded. Manual intervention required."*
   - Execution terminates safely without infinite loops.
