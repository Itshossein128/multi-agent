import path from "node:path";
import dotenv from "dotenv";
import { Pool } from "pg";
import type { AgentRecord, WorkflowDefinition, WorkflowNode, WorkflowEdge } from "@multi-agent/types";
import { validateWorkflow } from "../apps/server/src/compiler/validation";

dotenv.config({ path: path.resolve(".env") });
dotenv.config({ path: path.resolve("apps/server/.env") });

const pool = new Pool({
  connectionString: process.env.MEMORY_DATABASE_URL ?? "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory",
});

const now = new Date().toISOString();
const TARGET_WORKSPACE_ROOT = "/home/hossein/Desktop/projects/building-management";
const DOCS_ROOT = "/home/hossein/Desktop/projects/building-management/reports_documentation";

const readPolicy: AgentRecord["executionPolicy"] = {
  shell: "restricted",
  filesystem: "read",
  network: true,
  workspaceRoot: TARGET_WORKSPACE_ROOT,
  allowedCommands: ["codex", "claude", "agy"],
};

const writePolicy: AgentRecord["executionPolicy"] = {
  shell: "full",
  filesystem: "read-write",
  network: true,
  workspaceRoot: TARGET_WORKSPACE_ROOT,
  allowedCommands: ["codex", "claude", "agy", "pnpm", "pytest", "python", "git"],
};

const agentsToCreate: Array<{
  id: string;
  name: string;
  role: string;
  description: string;
  policy: AgentRecord["executionPolicy"];
  prompt: string;
}> = [
  {
    id: "spec-triage-lead",
    name: "Spec Triage & Task Orchestrator",
    role: "Orchestrator Lead",
    description: "Parses documentation directories, extracts atomic specs and user-stories, creates Studio tasks, and coordinates parallel evaluation.",
    policy: readPolicy,
    prompt: `You are the Lead AI Spec Architect and Task Orchestrator for the Building Management project.
Your primary role:
1. Scan and parse all specification and user story documents in the provided documentation directory (${DOCS_ROOT}).
2. Extract all atomic specifications (e.g., SPEC-01 to SPEC-05, spec_007, spec_009, spec_001_warehouse) and atomic user stories (e.g., US-DR-01, US-DR-02, acceptance criteria).
3. For each spec/user-story, structure an evaluation task containing: title, spec id, reference file, acceptance criteria, expected models, and expected endpoints.
4. Output a structured JSON envelope with status "success" and the complete list of tasks ready for parallel or sequential codebase auditing.
Never fabricate requirements; extract only what is documented in the source specifications.`,
  },
  {
    id: "spec-code-auditor",
    name: "Spec vs Codebase Verification Specialist",
    role: "Deep Code Auditor",
    description: "Deeply compares specs and user-story acceptance criteria against the actual Django API and Next.js frontend code, computing implementation % and detailed gaps.",
    policy: readPolicy,
    prompt: `You are an expert Software Auditor and Verification Engineer inspecting the Building Management repository (${TARGET_WORKSPACE_ROOT}).
Your role:
1. For each assigned spec/user-story, thoroughly inspect both backend (apps/api/core/) and frontend (apps/web/):
   - Data models & database schema (Django models, migrations, fields, constraints, nullability, unique indexes).
   - API endpoints & serializers (Django REST views, serializers, URL patterns, permission classes, business logic).
   - Frontend UI & state (Next.js pages, React components, forms, validation, optimistic updates).
   - Acceptance Criteria coverage (evaluate each scenario individually).
2. Measure:
   - Implementation percentage (0% to 100%).
   - Implementation correctness score (PASS, PARTIAL, FAIL, NOT_IMPLEMENTED).
   - Specific Gaps: missing fields/columns, missing endpoints, missing validations, missing UI components, or logic discrepancies.
3. Return evidence-backed findings in structured JSON format with exact file paths and line references.`,
  },
  {
    id: "gap-report-consolidator",
    name: "Gap Analysis & Release Planner",
    role: "Reporting & Planning Specialist",
    description: "Consolidates all audit findings into a comprehensive executive Gap Analysis Report and prepares the prioritized remediation plan for human review.",
    policy: readPolicy,
    prompt: `You are the Executive Gap Consolidator and Release Planner for the Multi-Agent Organization.
Your role:
1. Collect all spec/user-story audit findings from the Verification Specialists.
2. Synthesize an authoritative, executive-ready Gap Analysis Report:
   - Executive Summary with overall implementation completeness %.
   - Per-spec and per-user-story breakdown table (Spec ID, Title, Status, Implementation %, Gaps, Severity).
   - Category Breakdown (Data Models, APIs & Business Logic, Frontend UI/UX, Acceptance Criteria).
   - Concrete, step-by-step Prioritized Implementation Plan for remediation.
3. Save the report to ${DOCS_ROOT}/GAP_ANALYSIS_REPORT.md.
4. Package the findings and route them to the Human Approval Gate for explicit user sign-off before any implementation begins.`,
  },
  {
    id: "gap-implementation-engineer",
    name: "Autonomous Remediation Engineer",
    role: "Implementation Specialist",
    description: "Implements the missing models, API endpoints, business logic, and UI components in building-management strictly after human approval.",
    policy: writePolicy,
    prompt: `You are the Implementation Engineer in the Building Management Multi-Agent Organization.
CRITICAL CONSTRAINT: You are executed ONLY after human approval has been formally granted.
Your role:
1. Take the approved Gap Analysis Report and prioritized remediation tasks.
2. Implement missing features, models, endpoints, and UI components in ${TARGET_WORKSPACE_ROOT}:
   - Follow existing patterns in apps/api/core and apps/web.
   - Maintain clean architecture, type safety, and proper migrations.
   - Respect business rules and validation constraints defined in the specifications.
3. Keep changes bounded, focused, and verified with local tests.
4. Return a summary of all modified paths, created files, and test outcomes.`,
  },
  {
    id: "delivery-qa-verifier",
    name: "Delivery QA & Acceptance Verifier",
    role: "QA & Verification Lead",
    description: "Independently validates the implemented code against all acceptance criteria, runs typechecks and suites, and produces the final release verification report.",
    policy: writePolicy,
    prompt: `You are the Independent QA and Verification Lead.
Your role:
1. Inspect the codebase changes made by the Implementation Engineer.
2. Validate every acceptance criterion from the original specifications.
3. Run relevant checks (e.g., pytest, pnpm typecheck, linter) in ${TARGET_WORKSPACE_ROOT}.
4. Verify that no regressions were introduced and that all gaps identified in the report have been fully closed.
5. Produce a final sign-off report with exact test outputs, exit codes, and delivery status (PASS/FAIL).`,
  },
];

async function main() {
  console.log("Connecting to PostgreSQL...");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Ensure organizations exist
    console.log("Setting up organizations...");
    await client.query(`
      INSERT INTO studio_organizations (id, name, description, config, owner_id, status, slug, created_by, created_at, updated_at)
      VALUES (
        'org-building-management',
        'Building Management Spec & Gap Delivery Org',
        'Autonomous Multi-Agent Organization for Spec-to-Code Gap Analysis, Quality Verification, and Remediation',
        '{}'::jsonb,
        'hierarchical-admin',
        'active',
        'building-gap',
        'hierarchical-admin',
        now(),
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now()
    `);

    // Memberships for both org-building-management and dev-org
    const orgs = ["dev-org", "org-building-management"];
    const users = ["hierarchical-admin", "dev-user"];

    for (const orgId of orgs) {
      for (const userId of users) {
        await client.query(`
          INSERT INTO studio_organization_memberships (organization_id, user_id, role, status, invited_by, version, created_at, updated_at)
          VALUES ($1, $2, 'owner', 'active', 'system', 1, now(), now())
          ON CONFLICT DO NOTHING
        `, [orgId, userId]);
      }
    }

    // 2. Ensure Project exists
    console.log("Setting up project in studio_projects...");
    for (const tenantId of ["dev-org", "org-building-management"]) {
      await client.query(`
        INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, owner_id, created_at, updated_at)
        VALUES (
          $1,
          $2,
          'Building Management System',
          'Target repository for civil construction daily field reports, periodic progress, and gap remediation',
          'active',
          jsonb_build_object('repository', '${TARGET_WORKSPACE_ROOT}'),
          'hierarchical-admin',
          now(),
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          settings = EXCLUDED.settings,
          updated_at = now()
      `, [`project-building-management-${tenantId}`, tenantId]);
    }

    // 3. Ensure Workspace exists
    console.log("Setting up workspace in studio_workspaces...");
    for (const tenantId of ["dev-org", "org-building-management"]) {
      await client.query(`
        INSERT INTO studio_workspaces (id, tenant_id, project_id, name, description, status, settings, owner_id, created_at, updated_at)
        VALUES (
          $1,
          $2,
          $3,
          'Spec Gap Analysis & Implementation Workspace',
          'Workspace for inspecting reports documentation, analyzing implementation gaps in building-management, and remediating upon approval',
          'active',
          jsonb_build_object('docsRoot', '${DOCS_ROOT}', 'repository', '${TARGET_WORKSPACE_ROOT}'),
          'hierarchical-admin',
          now(),
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          settings = EXCLUDED.settings,
          updated_at = now()
      `, [`workspace-spec-gap-${tenantId}`, tenantId, `project-building-management-${tenantId}`]);
    }

    // 4. Register Agents
    console.log("Setting up agents in studio_agents...");
    const createdAgentRecords: AgentRecord[] = [];

    for (const agentDef of agentsToCreate) {
      for (const tenantId of ["dev-org", "org-building-management"]) {
        const fullAgentId = `${agentDef.id}-${tenantId}`;
        const record: AgentRecord = {
          id: fullAgentId,
          name: agentDef.name,
          description: agentDef.description,
          role: agentDef.role,
          systemPrompt: agentDef.prompt,
          backend: {
            type: "cli",
            provider: "codex",
            executable: "codex",
            args: [
              "--add-dir",
              TARGET_WORKSPACE_ROOT,
              "--sandbox",
              agentDef.policy.filesystem === "read-write" ? "workspace-write" : "workspace-read",
              "-c",
              "sandbox_workspace_write.network_access=true",
              "-c",
              'approval_policy="never"',
              "-c",
              'model_reasoning_effort="medium"',
            ],
          },
          tools: [],
          metadata: {
            role: agentDef.role,
            tenant: tenantId,
          },
          executionPolicy: agentDef.policy,
          context: {
            system: agentDef.prompt,
            history: { maxEntries: 20 },
            longTermMemory: { enabled: true },
            workingMemory: { enabled: true },
          },
          enabled: true,
          modelSettings: {
            temperature: 0.2,
          },
          ownerId: "hierarchical-admin",
          tenantId,
          isSystem: false,
          createdAt: now,
          updatedAt: now,
        };

        createdAgentRecords.push(record);

        await client.query(`
          INSERT INTO studio_agents (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'hierarchical-admin', false, now(), now())
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            record = EXCLUDED.record,
            updated_at = now()
        `, [fullAgentId, tenantId, agentDef.name, JSON.stringify(record)]);
      }
    }

    // 5. Build and validate Workflow Definition
    console.log("Constructing multi-agent gap analysis workflow...");
    for (const tenantId of ["dev-org", "org-building-management"]) {
      const p = (id: string) => `${id}-${tenantId}`;

      const workflowDefinition: WorkflowDefinition = {
        id: `spec-gap-delivery-workflow-${tenantId}`,
        name: "Spec Gap Analysis, Human Gate & Implementation Workflow",
        description: "Autonomous multi-agent workflow that inspects specifications, audits the building-management codebase for completeness and correctness, compiles an executive gap report, waits for human approval, and executes implementation upon confirmation.",
        tenantId,
        ownerId: "hierarchical-admin",
        createdAt: now,
        updatedAt: now,
        nodes: [
          {
            id: "intake-docs-input",
            type: "input",
            name: "Documentation Intake Directive",
            position: { x: 100, y: 200 },
            config: {
              inputKey: "docs_path",
              description: "Target directory containing specs and user stories to audit",
            },
          },
          {
            id: "node-spec-triage",
            type: "agent",
            name: "Spec Triage & Task Decomposer",
            position: { x: 350, y: 200 },
            config: {
              agentId: p("spec-triage-lead"),
            },
          },
          {
            id: "node-spec-auditor",
            type: "agent",
            name: "Codebase & Acceptance Auditor",
            position: { x: 600, y: 200 },
            config: {
              agentId: p("spec-code-auditor"),
            },
          },
          {
            id: "node-gap-consolidator",
            type: "agent",
            name: "Gap Consolidator & Release Planner",
            position: { x: 850, y: 200 },
            config: {
              agentId: p("gap-report-consolidator"),
            },
          },
          {
            id: "human-implementation-approval",
            type: "approval",
            name: "Human Approval Gate: Confirm Gap Report & Authorize Implementation",
            position: { x: 1100, y: 200 },
            config: {
              message: "Please review the generated Gap Analysis Report and approve implementation of missing requirements in building-management.",
              approvalType: "manual",
              timeoutSeconds: 86400,
            },
          },
          {
            id: "node-approval-decision",
            type: "condition",
            name: "Evaluate Human Approval Decision",
            position: { x: 1350, y: 200 },
            config: {
              branches: [{ key: "approved" }, { key: "rejected" }],
              valueField: "decision",
              valueSource: "last_value",
              unknownRoute: "rejected",
            },
          },
          {
            id: "node-implementation",
            type: "agent",
            name: "Autonomous Remediation Engineer",
            position: { x: 1600, y: 150 },
            config: {
              agentId: p("gap-implementation-engineer"),
            },
          },
          {
            id: "node-qa-verification",
            type: "agent",
            name: "Delivery QA & Acceptance Verifier",
            position: { x: 1850, y: 150 },
            config: {
              agentId: p("delivery-qa-verifier"),
            },
          },
          {
            id: "workflow-delivery-output",
            type: "output",
            name: "Final Gap Analysis & Delivery Packet",
            position: { x: 2100, y: 200 },
            config: {
              outputKey: "delivery_packet",
              description: "Final audited deliverables, verified criteria, and closed gaps",
            },
          },
        ],
        edges: [
          {
            id: "edge-in-to-triage",
            kind: "normal",
            label: "Documentation Path & Directives",
            source: "intake-docs-input",
            target: "node-spec-triage",
            branchKey: "",
          },
          {
            id: "edge-triage-to-auditor",
            kind: "normal",
            label: "Atomic Specs & User Stories",
            source: "node-spec-triage",
            target: "node-spec-auditor",
            branchKey: "",
          },
          {
            id: "edge-auditor-to-consolidator",
            kind: "normal",
            label: "Codebase Audit Evidence",
            source: "node-spec-auditor",
            target: "node-gap-consolidator",
            branchKey: "",
          },
          {
            id: "edge-consolidator-to-gate",
            kind: "normal",
            label: "Consolidated Gap Report",
            source: "node-gap-consolidator",
            target: "human-implementation-approval",
            branchKey: "",
          },
          {
            id: "edge-gate-to-decision",
            kind: "conditional",
            label: "Decision: approved",
            source: "human-implementation-approval",
            target: "node-approval-decision",
            branchKey: "approved",
          },
          {
            id: "edge-gate-reject-to-decision",
            kind: "conditional",
            label: "Decision: rejected",
            source: "human-implementation-approval",
            target: "node-approval-decision",
            branchKey: "rejected",
          },
          {
            id: "edge-decision-to-impl",
            kind: "conditional",
            label: "Approved -> Begin Implementation",
            source: "node-approval-decision",
            target: "node-implementation",
            branchKey: "approved",
          },
          {
            id: "edge-decision-to-out-rejected",
            kind: "conditional",
            label: "Rejected -> End with Gap Report",
            source: "node-approval-decision",
            target: "workflow-delivery-output",
            branchKey: "rejected",
          },
          {
            id: "edge-impl-to-qa",
            kind: "normal",
            label: "Code Deliverables",
            source: "node-implementation",
            target: "node-qa-verification",
            branchKey: "",
          },
          {
            id: "edge-qa-to-out",
            kind: "normal",
            label: "Verified Release Package",
            source: "node-qa-verification",
            target: "workflow-delivery-output",
            branchKey: "",
          },
        ],
      };

      // Validate workflow against compiler rules
      const issues = validateWorkflow(workflowDefinition, createdAgentRecords, {}, []);
      const errors = issues.filter(i => i.level === "error");
      if (errors.length > 0) {
        console.error("Workflow validation failed for", tenantId, errors);
        throw new Error(`Workflow validation errors: ${JSON.stringify(errors)}`);
      }
      console.log(`Workflow for ${tenantId} validated cleanly with 0 errors!`);

      await client.query(`
        INSERT INTO studio_workflows (id, tenant_id, name, definition, owner_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'hierarchical-admin', now(), now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          definition = EXCLUDED.definition,
          updated_at = now()
      `, [
        workflowDefinition.id,
        tenantId,
        workflowDefinition.name,
        JSON.stringify(workflowDefinition),
      ]);
    }

    await client.query("COMMIT");
    console.log("Successfully created organization, projects, workspaces, agents, and workflows!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error setting up organization:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("Setup script failed:", err);
  process.exit(1);
});
