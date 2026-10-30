# Implementation Plan: Dual-Mode Multi-Agent Orchestration (Linear Pipeline & Hierarchical Supervisor with Board Sync)

**Branch**: `009-dual-mode-orchestration` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  

---

## Summary

Deliver first-class dual-mode multi-agent orchestration enabling side-by-side coexistence, visual inspection, and reliable execution of two core archetypes in Studio:
1. **Linear Spec-to-Code Pipeline (`linear-pipeline`)**: Preserved acyclic sequential delivery pipeline for deterministic batch execution.
2. **Hierarchical Supervisor & Board-Driven Orchestrator (`hierarchical-supervisor`)**: Cyclic hub-and-spoke multi-agent delivery system with dynamic condition routing, bi-directional Studio Kanban board synchronization, iterative QA feedback loops with recursion guards (max 3 iterations), and a mandatory Human Approval Gate before code modification.

The feature introduces:
- Reusable archetype schemas and outcome envelope definitions in `@multi-agent/types`.
- A programmatic Studio Task Management tool in `src/tools/` supporting querying, status transitions, agent assignment, and structured comment logging with tenant isolation.
- Seamless workflow coexistence and URL deep-linking in `WorkflowSwitcher.tsx` and `WorkflowEditor.tsx`.
- Strict sandboxed workspace isolation (`workspaces/building-management-sandbox`) and host repository protection (`/home/hossein/Desktop/projects/building-management`).
- Database registration and seeding of organization `org-building-gap`, 5 specialist agent personas, both workflow archetypes, and all 42 building management user stories.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: LangGraph (`@langchain/langgraph`), Hono 4.x, Next.js 16 (App Router), React 19, `@xyflow/react` (React Flow), `@tanstack/react-query`, PostgreSQL (`pg`), Zod  
**Storage**: PostgreSQL (`studio_memory`) with `StudioStore` and `RunStore` (in-memory test store fallback)  
**Testing**: Jest (`pnpm test --runInBand`), Playwright (E2E)  
**Target Platform**: Linux server / Node runtime + modern web browsers  
**Project Type**: Monorepo full-stack application (types, shared tools, runtime compiler, server API, web UI)  
**Performance Goals**:
- Workflow switching in Studio UI <100ms without page reloads.
- Programmatic task tool operations <15ms.
- LangGraph conditional edge routing <50ms per step.
- 100% write isolation compliance (zero host repo writes).  
**Constraints**:
- Complete backward compatibility: existing linear pipelines execute identically with zero regression.
- Mandatory Human Approval Gate fail-closed: zero code modifications permitted without explicit human approval.
- Loop termination guarantee: maximum 3 remediation iterations on QA failure before escalating.
- Strict tenant isolation: agents cannot query or mutate tasks outside their authenticated tenant.
- Host repo immutability: `/home/hossein/Desktop/projects/building-management` must remain untouched.  
**Scale/Scope**: 1 shared types package, 1 tool executor, 1 security barrier, compiler/runtime extensions, 2 UI components, 1 seed module, 3 test suites, 42 tasks in `org-building-gap`.

---

## Constitution Check

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | All task tool queries and mutations enforce `tenant_id = principal.tenantId`. Cross-tenant operations fail closed with `TENANT_ISOLATION_VIOLATION`. |
| **Host Repository Protection** | PASS | Canonical path evaluation enforces that all writes and subprocesses are restricted to `workspaces/building-management-sandbox`. The host directory `/home/hossein/Desktop/projects/building-management` is strictly blocked. |
| **Human Governance Gate** | PASS | LangGraph `interrupt()` suspends execution before any code-modifying agent node. Downstream nodes cannot execute without human approval. Rejection halts cleanly without source mutations. |
| **Recursion Bounding** | PASS | Per-route recursion guards enforce a maximum of 3 loop iterations for QA failure remediation, preventing infinite loops and runaway token costs. |
| **Test-First & Coverage** | PASS | Full unit and integration coverage for compiler cycle handling, task tool operations, sandbox boundaries, and workflow coexistence. |
| **Simplicity & Compatibility** | PASS | Extends existing LangGraph `StateGraph`, `@multi-agent/types`, and `WorkflowSwitcher.tsx` without introducing redundant execution engines or breaking existing workflows. |

---

## Project Structure

### Documentation (this feature)

```text
specs/009-dual-mode-orchestration/
├── plan.md              # This implementation plan
├── research.md          # Phase 0: Technical decisions, LangGraph cycle handling, sandbox barrier
├── data-model.md        # Phase 1: Archetypes, outcome envelopes, task tool contracts, seed models
├── quickstart.md        # Phase 1: Automated test suites and end-to-end verification scenarios
├── contracts/           # Phase 1: Schemas and API specifications
│   ├── workflow-archetype.schema.json
│   ├── studio-task-tool.openapi.yaml
│   └── supervisor-outcome.schema.json
└── checklists/
    └── requirements.md  # Specification quality checklist
```

### Source Code Architecture

```text
packages/types/src/
├── index.ts                     # Export archetype types and extended WorkflowDefinition
├── archetype.ts                 # New: WorkflowArchetypeCategory and WorkflowArchetypeConfig
├── supervisorOutcome.ts         # New: SupervisorOutcomeEnvelope and Gap schemas
└── approval.ts                  # HumanApprovalGateConfig and interrupt schemas

src/
├── tools/
│   ├── index.ts                 # Export StudioTaskToolExecutor
│   ├── types.ts                 # Tool execution input/output contracts
│   ├── studioTaskToolExecutor.ts# New: Programmatic task board operations
│   └── toolExecutorFactory.ts   # Tool factory wiring for studio_task_tool
├── security/
│   └── sandboxExecutionBarrier.ts# New: Canonical path confinement and host protection barrier
└── studio/seeds/
    └── buildingGapOrgSeed.ts    # New: Seed org-building-gap, agents, workflows, and 42 tasks

apps/server/src/
├── compiler/
│   ├── workflowCompiler.ts      # Extended: Archetype compilation, recursion guardrails, loop state
│   └── validation.ts            # Extended: Archetype-aware graph and cycle validation
└── runtime/
    ├── graphRunner.ts           # StateGraph execution with interrupt and recursion handling
    └── runExecutor.ts           # Execution lifecycle, approval resumption, and event emissions

apps/web/src/
├── components/workflow/
│   ├── WorkflowSwitcher.tsx     # Extended: Multi-workflow dropdown, unsaved dirty prompt, deep link
│   └── WorkflowEditor.tsx       # Archetype layout loading, React Flow canvas synchronization
└── services/
    └── workflowService.ts       # Workflow CRUD and tenant-scoped retrieval

tests/
├── dualModeOrchestration.test.ts # Archetype compilation, supervisor loops, recursion bounds, approval
├── studioTaskTool.test.ts       # Task queries, lifecycle transitions, comments, tenant isolation
└── sandboxExecutionBarrier.test.ts # Sandbox path confinement, host protection, traversal rejection
```

---

## Phase 0: Outline & Research Summary

All research unknowns and technical decisions have been resolved in [`research.md`](./research.md):
- **Decision 1**: Explicit workflow archetype categorization (`linear-pipeline` vs `hierarchical-supervisor`) in `@multi-agent/types`.
- **Decision 2**: Per-route recursion guardrails in LangGraph `StateGraph` conditional routing bounding QA remediation loops to maximum 3 iterations.
- **Decision 3**: In-process `StudioTaskToolExecutor` operating via `StudioStore` and `taskService` with strict tenant isolation.
- **Decision 4**: Canonical path barrier (`SandboxExecutionBarrier`) strictly confining file I/O to `workspaces/building-management-sandbox` and blocking host repository mutation.
- **Decision 5**: LangGraph `interrupt()` integration for the Human Approval Gate positioned prior to code mutation.
- **Decision 6**: Client-side URL synchronization (`?workflowId=...`) in `WorkflowSwitcher.tsx` with dirty-state confirmation.
- **Decision 7**: Automated seed script configuring `org-building-gap`, 5 agent personas, both workflows, and 42 queued tasks.

---

## Phase 1: Design & Contracts Summary

All data models, interface contracts, and validation procedures have been established:
- **Data Model**: Documented in [`data-model.md`](./data-model.md), covering `WorkflowArchetypeConfig`, `SupervisorOutcomeEnvelope`, `StudioTaskToolInput`, `HumanApprovalGateConfig`, and `SandboxExecutionPolicy`.
- **Interface Contracts**:
  - [`contracts/workflow-archetype.schema.json`](./contracts/workflow-archetype.schema.json): Formal JSON schema for workflow definitions with archetype metadata and recursion limits.
  - [`contracts/studio-task-tool.openapi.yaml`](./contracts/studio-task-tool.openapi.yaml): OpenAPI 3.1 specification for the Studio Task Tool operations (`query_tasks`, `update_task_status`, `assign_task`, `add_task_comment`).
  - [`contracts/supervisor-outcome.schema.json`](./contracts/supervisor-outcome.schema.json): JSON schema for supervisor outcome envelopes driving conditional routing.
- **Quickstart Guide**: Documented in [`quickstart.md`](./quickstart.md), providing commands and step-by-step validation scenarios for automated testing, switcher coexistence, board sync, sandboxing, approval gates, and recursion loops.

---

## Phase 2: Implementation Breakdown & Work Packages

The implementation phase will execute the following modular work packages:

### Package 1: Shared Types & Archetype Schemas (`@multi-agent/types`)
- Create `packages/types/src/archetype.ts` defining `WorkflowArchetypeCategory`, `WorkflowRecursionGuardConfig`, `WorkflowArchetypeConfig`.
- Create `packages/types/src/supervisorOutcome.ts` defining `SupervisorOutcomeEnvelope`, `IdentifiedGap`, `ConsolidatedGapReport`, `QAVerificationResult`.
- Update `packages/types/src/index.ts` to export new models and extend `WorkflowDefinition`.
- Rebuild `@multi-agent/types`.

### Package 2: Security & Sandbox Execution Barrier (`src/security/`)
- Implement `SandboxExecutionBarrier` in `src/security/sandboxExecutionBarrier.ts`.
- Enforce canonical path checks via `fs.realpathSync.native` against `workspaces/building-management-sandbox`.
- Implement explicit blocklist guard for `/home/hossein/Desktop/projects/building-management`.
- Wire barrier into `executionPolicy.ts` and `LocalProcessWorkerRuntime`.
- Author unit tests in `tests/sandboxExecutionBarrier.test.ts`.

### Package 3: Studio Task Management Tool (`src/tools/`)
- Implement `StudioTaskToolExecutor` in `src/tools/studioTaskToolExecutor.ts`.
- Wire `studio_task_tool` into `toolExecutorFactory.ts` and `ToolRuntime`.
- Support operations: `query_tasks`, `update_task_status`, `assign_task`, `add_task_comment`.
- Enforce strict tenant isolation using `credentialPrincipal.tenantId`.
- Author unit tests in `tests/studioTaskTool.test.ts`.

### Package 4: Compiler, LangGraph Cycle Routing & Recursion Guards (`apps/server/src/compiler/`)
- Extend `validation.ts` to validate archetype-specific constraints (DAG for linear, supervisor hub + routing for supervisor).
- Extend `workflowCompiler.ts` with `loopIterations` state tracking and per-route recursion guards (max 3 loops).
- Implement routing fallback when loop limit is hit (`loop_limit_exceeded`).
- Verify LangGraph `interrupt()` pause/resume for the Human Approval Gate before remediation nodes.
- Author unit tests in `tests/dualModeOrchestration.test.ts`.

### Package 5: Organization & Story Seeding (`org-building-gap`)
- Implement `src/studio/seeds/buildingGapOrgSeed.ts`.
- Seed tenant `org-building-gap`, project `project-building-gap`, workspace `workspaces/building-management-sandbox`.
- Seed 5 specialist agent personas (`Spec Delivery Lead Orchestrator`, `Spec & Code Gap Auditor`, `Gap Report Consolidator`, `Gap Implementation Engineer`, `Delivery QA Verifier`).
- Seed both workflow definitions (`linear-spec-pipeline`, `supervisor-gap-delivery-workflow`).
- Seed all 42 building management user stories in `queued` status.

### Package 6: Studio UI Coexistence (`WorkflowSwitcher.tsx` & `WorkflowEditor.tsx`)
- Enhance `WorkflowSwitcher.tsx` to display archetype badges/labels alongside workflow names.
- Ensure URL query parameter `?workflowId=` synchronizes smoothly without page reloads.
- Verify dirty-state confirmation before switching.
- Verify React Flow canvas renders both sequential pipelines and hub-and-spoke topologies cleanly.

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| *None* | No architectural violations or external libraries introduced. Uses existing LangGraph `StateGraph`, `@xyflow/react`, and PostgreSQL store. | N/A |
