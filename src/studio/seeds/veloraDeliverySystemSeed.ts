import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";
import {
  createEdge,
  createEmptyDefinition,
  createHierarchicalSupervisorConfig,
  createNode,
  createRecursionGuard,
  type AgentRecord,
  type ToolRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";

if (process.env.NODE_ENV !== "test" && !process.env.JEST_WORKER_ID) {
  dotenv.config({ path: path.resolve(".env") });
  dotenv.config({ path: path.resolve("apps/server/.env") });
}

// Runtime validator
function getWorkflowValidator(): ((workflow: any, agents: any, options: any, tools?: any) => any[]) | undefined {
  try {
    const serverValidationPath = "../../../apps/server/src/compiler/validation";
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require(serverValidationPath) as { validateWorkflow?: any }).validateWorkflow;
  } catch {
    return undefined;
  }
}

export const VELORA_TENANT_ID = "org-building-gap";
export const VELORA_PROJECT_ID = "project-velora-delivery";
export const VELORA_PROJECT_NAME = "Velora Building Management Delivery (2026-11-03 Plan)";
export const VELORA_WORKSPACE_ID = "ws-velora-building-management";
export const VELORA_WORKSPACE_NAME = "Building Management Core Workspace";
export const BUILDING_MANAGEMENT_ROOT = "/home/hossein/Desktop/projects/building-management";

export const VELORA_SUBPHASE_WORKFLOW_ID = "velora-subphase-speckit-converge-qa";
export const VELORA_MASTER_WORKFLOW_ID = "velora-delivery-plan-master-orchestrator";

const now = new Date().toISOString();

// ---------------------------------------------------------------------------
// 1. Studio Tools
// ---------------------------------------------------------------------------

export const veloraStudioTools: ToolRecord[] = [
  {
    id: "studio_task_tool",
    name: "studio_task_tool",
    category: "function",
    description: "Programmatic task board management: query, get, create, bulk_create, update_status, assign, add_comment.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configuration: {},
    enabled: true,
    impact: "write",
    executionPolicy: {
      requiresApproval: false,
      idempotency: "optional",
      retryable: true,
    },
    metadata: { tenant: VELORA_TENANT_ID, system: true },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "delivery_plan_reader_tool",
    name: "delivery_plan_reader_tool",
    category: "function",
    description: "Reads delivery plan schedule, discovers 14 phases, 72 work packages, dependencies, and phase subphase prompt manifests.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configuration: {
      kind: "delivery-plan-reader",
      projectRoot: BUILDING_MANAGEMENT_ROOT,
    },
    enabled: true,
    impact: "read-only",
    executionPolicy: {
      requiresApproval: false,
      idempotency: "required",
      retryable: true,
    },
    metadata: { tenant: VELORA_TENANT_ID },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "employer_requirements_extractor_tool",
    name: "employer_requirements_extractor_tool",
    category: "function",
    description: "Extracts full employer/client requirements, subphase prompt markdown, acceptance criteria, personas, and module access matrices.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configuration: {
      kind: "employer-requirements-extractor",
      projectRoot: BUILDING_MANAGEMENT_ROOT,
    },
    enabled: true,
    impact: "read-only",
    executionPolicy: {
      requiresApproval: false,
      idempotency: "required",
      retryable: true,
    },
    metadata: { tenant: VELORA_TENANT_ID },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "speckit_workspace_tool",
    name: "speckit_workspace_tool",
    category: "function",
    description: "Inspects SpecKit artifacts (spec.md, plan.md, tasks.md) and checks task convergence status with deterministic verdict.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configuration: {
      kind: "speckit-workspace-inspector",
      projectRoot: BUILDING_MANAGEMENT_ROOT,
    },
    enabled: true,
    impact: "read-only",
    executionPolicy: {
      requiresApproval: false,
      idempotency: "required",
      retryable: true,
    },
    metadata: { tenant: VELORA_TENANT_ID },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "browser_qa_probe_tool",
    name: "browser_qa_probe_tool",
    category: "function",
    description: "Loopback SSRF-safe probe for frontend (:5173), backend (:8000), Playwright/Chrome readiness, and browser audit history.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configuration: {
      kind: "browser-qa-probe",
      projectRoot: BUILDING_MANAGEMENT_ROOT,
      frontendUrl: "http://127.0.0.1:5173",
      backendUrl: "http://127.0.0.1:8000",
    },
    enabled: true,
    impact: "read-only",
    executionPolicy: {
      requiresApproval: false,
      idempotency: "required",
      retryable: true,
    },
    metadata: { tenant: VELORA_TENANT_ID },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "repo_verification_tool",
    name: "repo_verification_tool",
    category: "function",
    description: "Runs non-destructive repo checks and git diff inspections to guarantee no unauthorized mutations.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configuration: {
      kind: "repo-checks",
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      checks: "diff",
    },
    enabled: true,
    impact: "read-only",
    executionPolicy: {
      requiresApproval: false,
      idempotency: "required",
      retryable: true,
    },
    metadata: { tenant: VELORA_TENANT_ID },
    createdAt: now,
    updatedAt: now,
  },
];

// ---------------------------------------------------------------------------
// 2. Specialist Agents
// ---------------------------------------------------------------------------

export const veloraSpecialistAgents: AgentRecord[] = [
  // 1. Delivery Plan & Schedule Orchestrator (Goal #1)
  {
    id: "agent-delivery-plan-orchestrator",
    name: "Velora Delivery Plan & Schedule Orchestrator",
    description: "Master Delivery Plan Orchestrator driving WBS phases (R.0 to A.12) and dispatching subphase execution per delivery-plan-2026-11-03.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "read-only"],
    },
    systemPrompt: `You are the Velora Delivery Plan & Schedule Orchestrator.
Your goal is to guide the multi-agent system through the delivery plan at /home/hossein/Desktop/projects/building-management/output/delivery-plan-2026-11-03.
1. Read the schedule and phases using delivery_plan_reader_tool.
2. Track dependencies across phases: R.0 -> A.6 -> A.7 -> A.1 -> A.8 -> A.2 -> A.3 -> A.4 -> A.9 -> A.3.C -> A.5 -> A.10 -> A.11 -> A.12.
3. For each ready phase, decide whether to decompose it into subphases (decompose_phase) or dispatch a ready subphase (dispatch_subphase).
4. Update the Kanban task board using studio_task_tool so project progress is fully transparent.`,
    tools: ["delivery_plan_reader_tool", "studio_task_tool"],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      allowedCommands: ["codex", "git", "pnpm", "node"],
    },
    metadata: { role: "orchestrator", tenant: VELORA_TENANT_ID },
    ownerId: "dev-user",
    tenantId: VELORA_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },

  // 2. Phase-to-Subphase Decomposer & Prompt Architect (Goal #2)
  {
    id: "agent-phase-subphase-architect",
    name: "Phase-to-Subphase Decomposer & Prompt Architect",
    description: "Decomposes delivery phases into structured subphases (<PHASE>-P1..Pn) and crafts complete standalone SpecKit prompt documents.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "read-only"],
    },
    systemPrompt: `You are the Phase-to-Subphase Decomposer & Prompt Architect.
Modeled on the standard established in /home/hossein/Desktop/projects/building-management/output/a6-requirements-2026-11-04:
1. Decompose the assigned delivery phase into ordered, self-contained subphases.
2. For each subphase, author a complete standalone prompt containing:
   - Target Scope & Requirements
   - Explicit Acceptance Criteria
   - Module Access Matrix & Personas
   - Verification Scenarios (positive, negative, edge cases)
3. Produce implementation-phases.json, acceptance.md, and prompts/manifest.json.
4. Return nextAction: "dispatch_subphase" with subphase payload.`,
    tools: ["delivery_plan_reader_tool", "employer_requirements_extractor_tool", "studio_task_tool"],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      allowedCommands: ["codex", "git", "pnpm", "node"],
    },
    metadata: { role: "architect", tenant: VELORA_TENANT_ID },
    ownerId: "dev-user",
    tenantId: VELORA_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },

  // 3. SpecKit Specify & Clarify Specialist (Goal #3 Steps 1-2)
  {
    id: "agent-speckit-specifier",
    name: "SpecKit Specify & Clarify Specialist",
    description: "Extracts subphase prompt requirements and executes speckit-specify and speckit-clarify to produce unambiguous spec.md.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "read-only"],
    },
    systemPrompt: `You are the SpecKit Specify & Clarify Specialist.
1. Extract requirements and acceptance criteria from employer_requirements_extractor_tool.
2. Formulate clear, testable user stories and technical boundaries.
3. Identify underspecified areas, resolve ambiguities with targeted clarification, and generate spec.md.`,
    tools: ["employer_requirements_extractor_tool", "speckit_workspace_tool"],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      allowedCommands: ["codex", "git", "node"],
    },
    metadata: { role: "specifier", tenant: VELORA_TENANT_ID },
    ownerId: "dev-user",
    tenantId: VELORA_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },

  // 4. SpecKit Plan & Tasks Architect (Goal #3 Steps 3-4)
  {
    id: "agent-speckit-planner",
    name: "SpecKit Plan & Tasks Architect",
    description: "Architects implementation plan (plan.md) and actionable dependency-ordered task breakdown (tasks.md).",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "read-only"],
    },
    systemPrompt: `You are the SpecKit Plan & Tasks Architect.
1. Read spec.md and architecture context.
2. Generate plan.md with technology decisions, module contracts, and verification plans.
3. Break implementation down into numbered, dependency-ordered tasks in tasks.md with checklist items [ ] format.`,
    tools: ["speckit_workspace_tool", "employer_requirements_extractor_tool"],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      allowedCommands: ["codex", "git", "node"],
    },
    metadata: { role: "planner", tenant: VELORA_TENANT_ID },
    ownerId: "dev-user",
    tenantId: VELORA_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },

  // 5. SpecKit Cross-Artifact Consistency Analyzer (Goal #3 Step 5)
  {
    id: "agent-speckit-analyzer",
    name: "SpecKit Cross-Artifact Consistency Analyzer",
    description: "Performs non-destructive quality and consistency analysis across spec.md, plan.md, and tasks.md (speckit-analyze).",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "read-only"],
    },
    systemPrompt: `You are the SpecKit Cross-Artifact Consistency Analyzer.
1. Inspect spec.md, plan.md, and tasks.md using speckit_workspace_tool.
2. Verify coverage: every requirement in spec.md must map to tasks in tasks.md.
3. If inconsistencies are found, return { nextAction: "remediate_spec_artifacts", issues: [...] }.
4. If consistent and complete, return { nextAction: "ready_for_implement" }.`,
    tools: ["speckit_workspace_tool"],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      allowedCommands: ["codex", "git"],
    },
    metadata: { role: "analyzer", tenant: VELORA_TENANT_ID },
    ownerId: "dev-user",
    tenantId: VELORA_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },

  // 6. SpecKit Implementation Engineer [Session-Persistent] (Goal #3 Step 6 & Goal #4)
  {
    id: "agent-speckit-implementer",
    name: "SpecKit Implementation Engineer",
    description: "Autonomous Implementation Engineer executing tasks in tasks.md. Operates with persistent session across Converge and QA review loops.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "read-only"],
    },
    systemPrompt: `You are the SpecKit Implementation Engineer.
You execute the implementation tasks defined in tasks.md.
When resumed in an existing session after Converge review or Browser QA feedback:
1. Examine the feedback and newly appended convergence or defect remediation tasks.
2. Complete the pending tasks in the exact same execution context and session.
3. Mark completed tasks [x] in tasks.md and verify all constraints.`,
    tools: ["speckit_workspace_tool", "repo_verification_tool"],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      allowedCommands: ["codex", "git", "pnpm", "node", "pytest", "python3"],
    },
    metadata: { role: "implementer", tenant: VELORA_TENANT_ID },
    ownerId: "dev-user",
    tenantId: VELORA_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },

  // 7. SpecKit Converge Review Agent [Append-Only tasks.md] (Goal #4)
  {
    id: "agent-speckit-converge-reviewer",
    name: "SpecKit Converge Review Agent",
    description: "Read-only reviewer on code/spec/plan, append-only on tasks.md. Evaluates completeness and triggers session-resumed implementation loop.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "read-only"],
    },
    systemPrompt: `You are the SpecKit Converge Review Agent.
You execute the speckit-converge review workflow:
1. Compare current codebase and deliverables against spec.md, plan.md, and tasks.md using speckit_workspace_tool.
2. You are strictly READ-ONLY on code files, spec.md, and plan.md.
3. If unbuilt work or gaps remain:
   - Append new remediation tasks to tasks.md under a '## Phase N: Convergence' heading.
   - Return { verdict: "continue_implement", remainingTasksCount: N, message: "Tasks appended to tasks.md" }.
4. If 100% of requirements are met and all tasks are verified:
   - Return { verdict: "converged", message: "All requirements converged successfully" }.`,
    tools: ["speckit_workspace_tool", "repo_verification_tool"],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      allowedCommands: ["codex", "git"],
    },
    metadata: { role: "converge_reviewer", tenant: VELORA_TENANT_ID },
    ownerId: "dev-user",
    tenantId: VELORA_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },

  // 8. End-User Browser Verification & Employer Acceptance Agent (Goal #5)
  {
    id: "agent-browser-enduser-qa",
    name: "End-User Browser Verification & Employer Acceptance Agent",
    description: "Acts as a real end user via browser automation. Tests employer requirements, role boundaries, reload persistence, and zero-defect acceptance.",
    backend: {
      type: "cli",
      provider: "codex",
      executable: "codex",
      args: ["--sandbox", "read-only"],
    },
    systemPrompt: `You are the End-User Browser Verification & Employer Acceptance Agent.
Your duty is to act as the real end user in the browser to ensure the client will find ZERO defects or missing requirements.
1. Extract all employer requirements, acceptance criteria, and user personas using employer_requirements_extractor_tool.
2. Probe local application readiness (:5173 frontend, :8000 backend) using browser_qa_probe_tool.
3. Execute real browser interactions (positive workflows, negative validation, role-based boundary isolation, page-reload persistence, bilingual FA/EN labels).
4. If any defect or regression is found:
   - Return { verdict: "remediate_browser_defects", defects: [...], feedback: "Detailed reproduction steps" } so the implementation agent resumes in the same session.
5. If all scenarios pass without flaw:
   - Return { verdict: "qa_passed", auditSummary: "All acceptance criteria verified in browser" }.`,
    tools: ["browser_qa_probe_tool", "employer_requirements_extractor_tool", "speckit_workspace_tool"],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: BUILDING_MANAGEMENT_ROOT,
      allowedCommands: ["codex", "playwright", "npx", "google-chrome", "chromium", "node"],
    },
    metadata: { role: "browser_qa", tenant: VELORA_TENANT_ID },
    ownerId: "dev-user",
    tenantId: VELORA_TENANT_ID,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  },
];

// ---------------------------------------------------------------------------
// 3. Workflows
// ---------------------------------------------------------------------------

/**
 * Workflow 1: velora-subphase-speckit-converge-qa
 * Implements Goal #3 (SpecKit stages), Goal #4 (Converge Loop with session continuation),
 * and Goal #5 (End-User Browser QA Loop).
 */
export function createVeloraSubphaseWorkflow(): WorkflowDefinition {
  const input = createNode("input", { x: 50, y: 300 });
  input.id = "subphase-input";
  input.config = {
    inputKey: "subphase_spec_payload",
    description: "Subphase specification payload, prompt path, and requirement references",
  };

  const reqExtractor = createNode("tool", { x: 260, y: 300 });
  reqExtractor.id = "node-requirements-extractor";
  reqExtractor.config = {
    toolId: "employer_requirements_extractor_tool",
  };

  const specify = createNode("agent", { x: 470, y: 300 });
  specify.id = "node-specify";
  specify.config = {
    agentId: "agent-speckit-specifier",
    sessionMode: "shared",
    sessionKey: "subphase-spec-session",
    taskInstruction: "Execute speckit-specify to define feature scope, boundaries, and acceptance tests.",
  };

  const clarify = createNode("agent", { x: 680, y: 300 });
  clarify.id = "node-clarify";
  clarify.config = {
    agentId: "agent-speckit-specifier",
    sessionMode: "shared",
    sessionKey: "subphase-spec-session",
    taskInstruction: "Execute speckit-clarify to eliminate ambiguities and produce validated spec.md.",
  };

  const plan = createNode("agent", { x: 890, y: 300 });
  plan.id = "node-plan";
  plan.config = {
    agentId: "agent-speckit-planner",
    sessionMode: "shared",
    sessionKey: "subphase-plan-session",
    taskInstruction: "Execute speckit-plan to draft architectural plan (plan.md).",
  };

  const tasks = createNode("agent", { x: 1100, y: 300 });
  tasks.id = "node-tasks";
  tasks.config = {
    agentId: "agent-speckit-planner",
    sessionMode: "shared",
    sessionKey: "subphase-plan-session",
    taskInstruction: "Execute speckit-tasks to generate dependency-ordered tasks.md with checklist items.",
  };

  const analyze = createNode("agent", { x: 1310, y: 300 });
  analyze.id = "node-analyze";
  analyze.config = {
    agentId: "agent-speckit-analyzer",
    taskInstruction: "Execute speckit-analyze for cross-artifact consistency.",
  };

  const analyzeGate = createNode("condition", { x: 1520, y: 300 });
  analyzeGate.id = "node-analyze-gate";
  analyzeGate.config = {
    valueSource: "last_value",
    valueField: "nextAction",
    branches: [
      { key: "ready_for_implement", label: "Artifacts Consistent" },
      { key: "remediate_spec_artifacts", label: "Remediate Artifacts" },
      { key: "loop_limit_exceeded", label: "Loop Limit Exceeded" },
    ],
    unknownRoute: "ready_for_implement",
  };

  const remediatePlan = createNode("agent", { x: 1520, y: 150 });
  remediatePlan.id = "node-remediate-plan";
  remediatePlan.config = {
    agentId: "agent-speckit-planner",
    sessionMode: "shared",
    sessionKey: "subphase-plan-session",
    resumePromptMode: "delta",
    taskInstruction: "Remediate inconsistencies in plan.md and tasks.md surfaced by analyze.",
  };

  const implement = createNode("agent", { x: 1750, y: 300 });
  implement.id = "node-implement";
  implement.config = {
    agentId: "agent-speckit-implementer",
    sessionMode: "shared",
    sessionKey: "subphase-implementer-session",
    resumePromptMode: "delta",
    inputMode: "last_value",
    taskInstruction: "Execute implementation tasks defined in tasks.md, continuing previous session when resumed.",
  };

  const convergeReview = createNode("agent", { x: 1980, y: 300 });
  convergeReview.id = "node-converge-review";
  convergeReview.config = {
    agentId: "agent-speckit-converge-reviewer",
    taskInstruction: "Execute speckit-converge. If unbuilt work remains, append tasks and return continue_implement.",
  };

  const convergeGate = createNode("condition", { x: 2200, y: 300 });
  convergeGate.id = "node-converge-gate";
  convergeGate.config = {
    valueSource: "last_value",
    valueField: "verdict",
    branches: [
      { key: "converged", label: "Converged (100% Tasks Complete)" },
      { key: "continue_implement", label: "Continue Implementation" },
      { key: "loop_limit_exceeded", label: "Loop Limit Exceeded" },
    ],
    unknownRoute: "continue_implement",
  };

  const browserQa = createNode("agent", { x: 2430, y: 300 });
  browserQa.id = "node-browser-qa";
  browserQa.config = {
    agentId: "agent-browser-enduser-qa",
    taskInstruction: "Act as real end user in browser. Verify all scenarios. Return remediate_browser_defects if defects found.",
  };

  const browserQaGate = createNode("condition", { x: 2650, y: 300 });
  browserQaGate.id = "node-browser-qa-gate";
  browserQaGate.config = {
    valueSource: "last_value",
    valueField: "verdict",
    branches: [
      { key: "qa_passed", label: "QA Accepted (0 Defects)" },
      { key: "remediate_browser_defects", label: "Remediate Browser Defects" },
      { key: "loop_limit_exceeded", label: "Loop Limit Exceeded" },
    ],
    unknownRoute: "qa_passed",
  };

  const report = createNode("memory", { x: 2870, y: 300 });
  report.id = "node-delivery-report";
  report.config = {
    memoryType: "short_term",
    mode: "write",
    key: "subphase_delivery_report",
  };

  const output = createNode("output", { x: 3080, y: 300 });
  output.id = "subphase-output";
  output.config = {
    outputKey: "subphase_delivery_summary",
    description: "Completed subphase deliverable, verified by Converge and End-User Browser QA",
  };

  const edges = [
    // Standard linear flow
    createEdge({ source: input.id, target: reqExtractor.id }),
    createEdge({ source: reqExtractor.id, target: specify.id }),
    createEdge({ source: specify.id, target: clarify.id }),
    createEdge({ source: clarify.id, target: plan.id }),
    createEdge({ source: plan.id, target: tasks.id }),
    createEdge({ source: tasks.id, target: analyze.id }),
    createEdge({ source: analyze.id, target: analyzeGate.id }),

    // Analyze Gate branches
    createEdge({ source: analyzeGate.id, target: implement.id, kind: "conditional", branchKey: "ready_for_implement", label: "Artifacts Consistent" }),
    createEdge({ source: analyzeGate.id, target: remediatePlan.id, kind: "conditional", branchKey: "remediate_spec_artifacts", label: "Remediate Artifacts" }),
    createEdge({ source: analyzeGate.id, target: output.id, kind: "conditional", branchKey: "loop_limit_exceeded", label: "Loop Limit Exceeded" }),
    createEdge({ source: remediatePlan.id, target: analyze.id }), // Loop back to analyze

    // Implement -> Converge Review
    createEdge({ source: implement.id, target: convergeReview.id }),
    createEdge({ source: convergeReview.id, target: convergeGate.id }),

    // Converge Gate branches (Goal #4)
    createEdge({ source: convergeGate.id, target: browserQa.id, kind: "conditional", branchKey: "converged", label: "Converged" }),
    createEdge({ source: convergeGate.id, target: implement.id, kind: "conditional", branchKey: "continue_implement", label: "Continue Implementation" }), // Loop back to implement (same session!)
    createEdge({ source: convergeGate.id, target: output.id, kind: "conditional", branchKey: "loop_limit_exceeded", label: "Loop Limit Exceeded" }),

    // Browser QA Gate branches (Goal #5)
    createEdge({ source: browserQa.id, target: browserQaGate.id }),
    createEdge({ source: browserQaGate.id, target: report.id, kind: "conditional", branchKey: "qa_passed", label: "QA Accepted" }),
    createEdge({ source: browserQaGate.id, target: implement.id, kind: "conditional", branchKey: "remediate_browser_defects", label: "Remediate Defects" }), // Loop back to implement (same session!)
    createEdge({ source: browserQaGate.id, target: output.id, kind: "conditional", branchKey: "loop_limit_exceeded", label: "Loop Limit Exceeded" }),

    // Report -> Output
    createEdge({ source: report.id, target: output.id }),
  ];

  return {
    ...createEmptyDefinition("Velora Subphase SpecKit + Converge + Browser QA"),
    id: VELORA_SUBPHASE_WORKFLOW_ID,
    name: "Velora Subphase SpecKit + Resumed Converge + End-User Browser QA",
    schemaVersion: 2,
    archetype: "hierarchical-supervisor",
    archetypeConfig: createHierarchicalSupervisorConfig(convergeReview.id, {
      humanApprovalGateRequired: false,
      recursionGuards: [
        createRecursionGuard("analyze_gate->remediate_spec_artifacts", "loop_limit_exceeded", 4),
        createRecursionGuard("converge_gate->continue_implement", "loop_limit_exceeded", 10),
        createRecursionGuard("browser_qa_gate->remediate_browser_defects", "loop_limit_exceeded", 8),
      ],
    }),
    tenantId: VELORA_TENANT_ID,
    ownerId: "dev-user",
    nodes: [
      input,
      reqExtractor,
      specify,
      clarify,
      plan,
      tasks,
      analyze,
      analyzeGate,
      remediatePlan,
      implement,
      convergeReview,
      convergeGate,
      browserQa,
      browserQaGate,
      report,
      output,
    ],
    edges,
  };
}

/**
 * Workflow 2: velora-delivery-plan-master-orchestrator
 * Implements Goal #1 (Delivery Plan & Schedule Orchestration) and Goal #2 (Phase Decomposition & Subgraph Dispatch).
 */
export function createVeloraMasterWorkflow(): WorkflowDefinition {
  const input = createNode("input", { x: 50, y: 300 });
  input.id = "master-input";
  input.config = {
    inputKey: "delivery_schedule_plan",
    description: "Master delivery plan input and trigger parameters",
  };

  const planReader = createNode("tool", { x: 260, y: 300 });
  planReader.id = "master-plan-reader";
  planReader.config = {
    toolId: "delivery_plan_reader_tool",
  };

  const orchestrator = createNode("agent", { x: 480, y: 300 });
  orchestrator.id = "master-orchestrator";
  orchestrator.config = {
    agentId: "agent-delivery-plan-orchestrator",
    sessionMode: "node",
    inputMode: "last_value",
    taskInstruction: "Orchestrate delivery plan phases (R.0 to A.12). Select ready phase/subphase and determine next routing branch.",
  };

  const phaseRouter = createNode("condition", { x: 720, y: 300 });
  phaseRouter.id = "master-phase-router";
  phaseRouter.config = {
    valueSource: "last_value",
    valueField: "nextAction",
    branches: [
      { key: "decompose_phase", label: "Decompose Phase to Subphases" },
      { key: "dispatch_subphase", label: "Dispatch Subphase Execution" },
      { key: "phase_complete", label: "Phase Completed (Advance)" },
      { key: "delivery_complete", label: "All Phases Delivered" },
      { key: "loop_limit_exceeded", label: "Loop Limit Exceeded" },
    ],
    unknownRoute: "dispatch_subphase",
  };

  const decomposer = createNode("agent", { x: 960, y: 150 });
  decomposer.id = "master-decomposer";
  decomposer.config = {
    agentId: "agent-phase-subphase-architect",
    taskInstruction: "Decompose phase into subphases (<PHASE>-P1..Pn) and generate SpecKit prompt files.",
  };

  const subphaseSubgraph = createNode("subgraph", { x: 960, y: 350 });
  subphaseSubgraph.id = "master-subphase-subgraph";
  subphaseSubgraph.config = {
    workflowId: VELORA_SUBPHASE_WORKFLOW_ID,
    label: "Velora Subphase SpecKit + Converge + QA",
    inputMappings: [
      { source: "subphase", target: "subphase_spec_payload", required: false },
    ],
    outputMappings: [
      { source: "subphase_delivery_summary", target: "lastSubphaseResult", required: false },
    ],
  };

  const output = createNode("output", { x: 1220, y: 300 });
  output.id = "master-output";
  output.config = {
    outputKey: "delivery_plan_progress",
    description: "Master delivery plan execution status, phase deliverables, and acceptance audit",
  };

  const edges = [
    createEdge({ source: input.id, target: planReader.id }),
    createEdge({ source: planReader.id, target: orchestrator.id }),
    createEdge({ source: orchestrator.id, target: phaseRouter.id }),

    // Condition branches
    createEdge({ source: phaseRouter.id, target: decomposer.id, kind: "conditional", branchKey: "decompose_phase", label: "Decompose Phase" }),
    createEdge({ source: phaseRouter.id, target: subphaseSubgraph.id, kind: "conditional", branchKey: "dispatch_subphase", label: "Dispatch Subphase" }),
    createEdge({ source: phaseRouter.id, target: orchestrator.id, kind: "conditional", branchKey: "phase_complete", label: "Phase Completed" }),
    createEdge({ source: phaseRouter.id, target: output.id, kind: "conditional", branchKey: "delivery_complete", label: "Delivery Complete" }),
    createEdge({ source: phaseRouter.id, target: output.id, kind: "conditional", branchKey: "loop_limit_exceeded", label: "Loop Limit Exceeded" }),

    // Loops back to orchestrator
    createEdge({ source: decomposer.id, target: orchestrator.id }),
    createEdge({ source: subphaseSubgraph.id, target: orchestrator.id }),
  ];

  return {
    ...createEmptyDefinition("Velora Delivery Plan 2026-11-03 Master Orchestrator"),
    id: VELORA_MASTER_WORKFLOW_ID,
    name: "Velora Delivery Plan 2026-11-03 Master Phase & Subphase Orchestrator",
    schemaVersion: 2,
    archetype: "hierarchical-supervisor",
    archetypeConfig: createHierarchicalSupervisorConfig(orchestrator.id, {
      humanApprovalGateRequired: false,
      recursionGuards: [
        createRecursionGuard("phase_router->decompose_phase", "loop_limit_exceeded", 6),
        createRecursionGuard("phase_router->dispatch_subphase", "loop_limit_exceeded", 10),
        createRecursionGuard("phase_router->phase_complete", "loop_limit_exceeded", 10),
      ],
    }),
    tenantId: VELORA_TENANT_ID,
    ownerId: "dev-user",
    nodes: [
      input,
      planReader,
      orchestrator,
      phaseRouter,
      decomposer,
      subphaseSubgraph,
      output,
    ],
    edges,
  };
}

// ---------------------------------------------------------------------------
// 4. Seed Runner
// ---------------------------------------------------------------------------

export async function seedVeloraDeliverySystem(options?: {
  connectionString?: string;
  client?: PoolClient;
}): Promise<{
  tenantId: string;
  projectId: string;
  workspaceId: string;
  toolsCount: number;
  agentsCount: number;
  workflowsCount: number;
  phasesCount: number;
  subphasesCount: number;
}> {
  const connectionString =
    options?.connectionString ??
    process.env.MEMORY_DATABASE_URL ??
    process.env.MEMORY_TEST_DATABASE_URL ??
    "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory";

  let client = options?.client;
  let ownedPool: Pool | undefined;

  if (!client) {
    ownedPool = new Pool({ connectionString });
    client = await ownedPool.connect();
  }

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [VELORA_TENANT_ID]);
    await client.query("SELECT set_config('app.principal_kind', 'user', false)");

    // 1. Project
    await client.query(
      `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', jsonb_build_object('repository', $5::text), 'dev-user', now(), now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         settings = EXCLUDED.settings,
         updated_at = now()`,
      [
        VELORA_PROJECT_ID,
        VELORA_TENANT_ID,
        VELORA_PROJECT_NAME,
        "Master delivery plan for building-management (2026-11-03 WBS, 14 phases, 72 packages, 664 baseline hours)",
        BUILDING_MANAGEMENT_ROOT,
      ],
    );

    // 2. Workspace
    await client.query(
      `INSERT INTO studio_workspaces (id, tenant_id, project_id, name, description, status, settings, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', jsonb_build_object('storageRoot', $6::text, 'repository', $6::text), 'dev-user', now(), now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         settings = EXCLUDED.settings,
         updated_at = now()`,
      [
        VELORA_WORKSPACE_ID,
        VELORA_TENANT_ID,
        VELORA_PROJECT_ID,
        VELORA_WORKSPACE_NAME,
        "Target workspace for building-management delivery plan execution",
        BUILDING_MANAGEMENT_ROOT,
      ],
    );

    // 3. Tools
    for (const tool of veloraStudioTools) {
      await client.query(
        `INSERT INTO studio_tools (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'dev-user', false, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           record = EXCLUDED.record,
           updated_at = now()`,
        [tool.id, VELORA_TENANT_ID, tool.name, JSON.stringify(tool)],
      );
    }

    // 4. Specialist Agents
    for (const agent of veloraSpecialistAgents) {
      await client.query(
        `INSERT INTO studio_agents (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'dev-user', false, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           record = EXCLUDED.record,
           updated_at = now()`,
        [agent.id, VELORA_TENANT_ID, agent.name, JSON.stringify(agent)],
      );
    }

    // 5. Workflows
    const validator = getWorkflowValidator();

    const subphaseWf = createVeloraSubphaseWorkflow();
    if (validator) {
      const issues = validator(subphaseWf, veloraSpecialistAgents, {}, veloraStudioTools as any);
      const errors = issues.filter((i: any) => i.level === "error" || i.severity === "error");
      if (errors.length > 0) {
        throw new Error(`Subphase workflow validation failed: ${JSON.stringify(errors, null, 2)}`);
      }
    }

    await client.query(
      `INSERT INTO studio_workflows (id, tenant_id, name, definition, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'dev-user', now(), now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         definition = EXCLUDED.definition,
         updated_at = now()`,
      [subphaseWf.id, VELORA_TENANT_ID, subphaseWf.name, JSON.stringify(subphaseWf)],
    );

    const masterWf = createVeloraMasterWorkflow();
    if (validator) {
      const issues = validator(masterWf, veloraSpecialistAgents, {}, veloraStudioTools as any);
      const errors = issues.filter((i: any) => i.level === "error" || i.severity === "error");
      if (errors.length > 0) {
        throw new Error(`Master workflow validation failed: ${JSON.stringify(errors, null, 2)}`);
      }
    }

    await client.query(
      `INSERT INTO studio_workflows (id, tenant_id, name, definition, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'dev-user', now(), now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         definition = EXCLUDED.definition,
         updated_at = now()`,
      [masterWf.id, VELORA_TENANT_ID, masterWf.name, JSON.stringify(masterWf)],
    );

    // 6. Seed Tasks: 14 Delivery Plan Phases from schedule.json
    let phasesCount = 0;
    const scheduleFile = path.join(BUILDING_MANAGEMENT_ROOT, "output/delivery-plan-2026-11-03/schedule.json");
    if (fs.existsSync(scheduleFile)) {
      const scheduleData = JSON.parse(fs.readFileSync(scheduleFile, "utf-8"));
      const phases = Array.isArray(scheduleData.phases) ? scheduleData.phases : [];
      phasesCount = phases.length;

      for (const phase of phases) {
        const phaseSlug = String(phase.wbs || phase.code || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const taskId = `task-phase-${phaseSlug}`;
        const title = `Phase ${phase.wbs}: ${phase.name}`;
        const description = `${phase.work || ""}\n\nAcceptance: ${phase.acceptance || ""}\nBasis: ${phase.basis || ""}`;
        const dependencies = Array.isArray(phase.technical_dependencies)
          ? phase.technical_dependencies.map((d: string) => `task-phase-${d.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)
          : [];

        await client.query(
          `INSERT INTO studio_tasks (
             id, tenant_id, project_id, workspace_id, title, description,
             priority, status, assigned_agent, assigned_agents, dependencies,
             workflow_id, retry_count, paused, metadata, owner_id, created_at, updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6,
             'high', 'queued', 'agent-delivery-plan-orchestrator', '["agent-delivery-plan-orchestrator"]'::jsonb, $7::jsonb,
             $8, 0, false, $9::jsonb, 'dev-user', now(), now()
           )
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             dependencies = EXCLUDED.dependencies,
             workflow_id = EXCLUDED.workflow_id,
             metadata = EXCLUDED.metadata,
             updated_at = now()`,
          [
            taskId,
            VELORA_TENANT_ID,
            VELORA_PROJECT_ID,
            VELORA_WORKSPACE_ID,
            title,
            description,
            JSON.stringify(dependencies),
            VELORA_MASTER_WORKFLOW_ID,
            JSON.stringify({
              wbs: phase.wbs,
              baselineHours: { low: phase.low, likely: phase.likely, high: phase.high },
              subtasksCount: phase.subtasks?.length ?? 0,
              subtasks: phase.subtasks ?? [],
              type: "delivery_phase",
            }),
          ],
        );
      }
    }

    // 7. Seed Tasks: 6 Subphases of A.6 from implementation-phases.json & prompts/manifest.json
    let subphasesCount = 0;
    const a6PhasesFile = path.join(BUILDING_MANAGEMENT_ROOT, "output/a6-requirements-2026-11-04/implementation-phases.json");
    const a6ManifestFile = path.join(BUILDING_MANAGEMENT_ROOT, "output/a6-requirements-2026-11-04/prompts/manifest.json");

    if (fs.existsSync(a6PhasesFile)) {
      const a6PhasesData = JSON.parse(fs.readFileSync(a6PhasesFile, "utf-8"));
      const manifestData = fs.existsSync(a6ManifestFile) ? JSON.parse(fs.readFileSync(a6ManifestFile, "utf-8")) : { prompts: [] };
      const subphases = Array.isArray(a6PhasesData.phases) ? a6PhasesData.phases : [];
      subphasesCount = subphases.length;

      let prevSubphaseTaskId: string | null = null;
      for (const sp of subphases) {
        const subphaseId = String(sp.id || "").toUpperCase();
        const taskId = `task-subphase-${subphaseId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const promptInfo = Array.isArray(manifestData.prompts)
          ? manifestData.prompts.find((p: any) => p.phase === subphaseId)
          : undefined;

        const title = `Subphase ${subphaseId}: ${sp.title || sp.name || ""}`;
        const description = `Subphase prompt: ${promptInfo?.file || "(prompt in manifest)"}\nRequirement IDs: ${(sp.requirements || []).join(", ")}\nAcceptance: ${(sp.acceptance || []).join(", ")}`;
        const dependencies = prevSubphaseTaskId ? [prevSubphaseTaskId] : ["task-phase-r-0"];

        await client.query(
          `INSERT INTO studio_tasks (
             id, tenant_id, project_id, workspace_id, title, description,
             priority, status, assigned_agent, assigned_agents, dependencies,
             parent_task_id, workflow_id, retry_count, paused, metadata, owner_id, created_at, updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6,
             'high', 'queued', 'agent-speckit-implementer', '["agent-speckit-specifier", "agent-speckit-planner", "agent-speckit-implementer", "agent-speckit-converge-reviewer", "agent-browser-enduser-qa"]'::jsonb, $7::jsonb,
             'task-phase-a-6', $8, 0, false, $9::jsonb, 'dev-user', now(), now()
           )
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             dependencies = EXCLUDED.dependencies,
             parent_task_id = EXCLUDED.parent_task_id,
             workflow_id = EXCLUDED.workflow_id,
             metadata = EXCLUDED.metadata,
             updated_at = now()`,
          [
            taskId,
            VELORA_TENANT_ID,
            VELORA_PROJECT_ID,
            VELORA_WORKSPACE_ID,
            title,
            description,
            JSON.stringify(dependencies),
            VELORA_SUBPHASE_WORKFLOW_ID,
            JSON.stringify({
              subphaseId,
              promptPath: promptInfo?.file,
              requirementIds: sp.requirements ?? [],
              acceptanceIds: sp.acceptance ?? [],
              type: "subphase_deliverable",
            }),
          ],
        );

        prevSubphaseTaskId = taskId;
      }
    }

    await client.query("COMMIT");

    return {
      tenantId: VELORA_TENANT_ID,
      projectId: VELORA_PROJECT_ID,
      workspaceId: VELORA_WORKSPACE_ID,
      toolsCount: veloraStudioTools.length,
      agentsCount: veloraSpecialistAgents.length,
      workflowsCount: 2,
      phasesCount,
      subphasesCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownedPool) {
      client.release();
      await ownedPool.end();
    }
  }
}

if (require.main === module) {
  seedVeloraDeliverySystem()
    .then((res) => {
      console.log("Successfully seeded Velora delivery system in org-building-gap:", res);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to seed Velora delivery system:", err);
      process.exit(1);
    });
}
