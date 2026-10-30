import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { Pool } from "pg";
import type { AgentRecord, WorkflowDefinition } from "@multi-agent/types";
import { validateWorkflow } from "../apps/server/src/compiler/validation";

dotenv.config({ path: path.resolve(".env") });
dotenv.config({ path: path.resolve("apps/server/.env") });

const pool = new Pool({
  connectionString: process.env.MEMORY_DATABASE_URL ?? "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory",
});

const ORG_ID = "org-building-gap";
const ORG_SLUG = "building-gap";
const SANDBOX_ROOT = "/home/hossein/Desktop/projects/multi-agent/workspaces/building-management-sandbox";
const DOCS_ROOT = path.join(SANDBOX_ROOT, "reports_documentation");
const now = new Date().toISOString();

const readSandboxPolicy: AgentRecord["executionPolicy"] = {
  shell: "restricted",
  filesystem: "read",
  network: true,
  workspaceRoot: SANDBOX_ROOT,
  allowedCommands: ["codex", "claude", "agy"],
};

const writeSandboxPolicy: AgentRecord["executionPolicy"] = {
  shell: "full",
  filesystem: "read-write",
  network: true,
  workspaceRoot: SANDBOX_ROOT,
  allowedCommands: ["codex", "claude", "agy", "pnpm", "pytest", "python", "git"],
};

const agentsToRegister: Array<{
  id: string;
  name: string;
  role: string;
  description: string;
  policy: AgentRecord["executionPolicy"];
  prompt: string;
}> = [
  {
    id: "orchestrator-lead",
    name: "Spec Delivery Lead Orchestrator",
    role: "Lead Orchestrator",
    description: "Executive orchestrator that inspects atomic specifications, breaks down requirements into structured tasks, assigns them to subordinate specialized agents, and monitors delivery.",
    policy: readSandboxPolicy,
    prompt: `You are the Lead Systems Architect and Orchestrator Agent for the Building Management delivery hierarchy.
Your core mandates:
1. Read all atomic specifications (SPEC-01 through SPEC-11) and individual user stories in ${DOCS_ROOT}.
2. Decompose each requirement into discrete, actionable tasks on the Task Board.
3. Assign each task to the appropriate specialized subordinate agent:
   - "spec-code-auditor" for auditing existing code in ${SANDBOX_ROOT} against specs and finding implementation gaps.
   - "gap-implementation-engineer" for coding missing features and bugfixes inside the sandbox after human authorization.
   - "delivery-qa-verifier" for validating acceptance criteria and running automated regression suites.
   - "gap-report-consolidator" for compiling the comprehensive gap report.
4. Establish clear dependency graphs between tasks and set priorities (critical, high, medium).
5. Enforce sandbox boundary: NO agent may touch /home/hossein/Desktop/projects/building-management; all work must remain inside ${SANDBOX_ROOT}.
6. Enforce human governance: Do not trigger autonomous implementation until explicit user sign-off is received.`,
  },
  {
    id: "spec-code-auditor",
    name: "Spec vs Codebase Verification Specialist",
    role: "Code Auditor",
    description: "Deeply compares specs and user-story acceptance criteria against the actual Django API and Next.js frontend code in the sandbox, computing implementation % and detailed gaps.",
    policy: readSandboxPolicy,
    prompt: `You are an expert Software Auditor and Verification Specialist inspecting the isolated sandbox workspace (${SANDBOX_ROOT}).
Your role:
1. For each assigned spec/user-story task, thoroughly inspect both backend (apps/api/core/) and frontend (apps/web/):
   - Data models & database schema (Django models, migrations, fields, constraints, nullability, unique indexes).
   - API endpoints & serializers (Django REST views, serializers, URL patterns, permission classes, business logic).
   - Frontend UI & state (Next.js pages, React components, forms, validation, optimistic updates).
   - Acceptance Criteria coverage (evaluate each scenario individually).
2. Measure:
   - Implementation percentage (0% to 100%).
   - Implementation correctness score (PASS, PARTIAL, FAIL, NOT_IMPLEMENTED).
   - Specific Gaps: missing fields/columns, missing endpoints, missing validations, missing UI components, or logic discrepancies.
3. Record evidence-backed findings in structured JSON format with exact file paths and line references inside ${SANDBOX_ROOT}.`,
  },
  {
    id: "gap-report-consolidator",
    name: "Gap Analysis & Release Planner",
    role: "Reporting & Planning Specialist",
    description: "Consolidates all audit findings into a comprehensive executive Gap Analysis Report and prepares the prioritized remediation plan for human review.",
    policy: readSandboxPolicy,
    prompt: `You are the Executive Gap Consolidator and Release Planner for the Multi-Agent Organization.
Your role:
1. Collect all spec/user-story audit findings from the Verification Specialists.
2. Synthesize an authoritative, executive-ready Gap Analysis Report:
   - Executive Summary with overall implementation completeness %.
   - Per-spec and per-user-story breakdown table (Spec ID, Title, Status, Implementation %, Gaps, Severity).
   - Category Breakdown (Data Models, APIs & Business Logic, Frontend UI/UX, Acceptance Criteria).
   - Concrete, step-by-step Prioritized Implementation Plan for remediation in the sandbox.
3. Save the report to ${DOCS_ROOT}/GAP_ANALYSIS_REPORT.md.
4. Package the findings and route them to the Human Approval Gate for explicit user sign-off before any implementation begins.`,
  },
  {
    id: "gap-implementation-engineer",
    name: "Autonomous Remediation Engineer",
    role: "Implementation Specialist",
    description: "Implements the missing models, API endpoints, business logic, and UI components strictly inside the isolated sandbox after human approval.",
    policy: writeSandboxPolicy,
    prompt: `You are the Implementation Engineer in the Building Management Multi-Agent Organization.
CRITICAL CONSTRAINTS:
1. You are executed ONLY after human approval has been formally granted.
2. You operate STRICTLY inside the isolated sandbox workspace: ${SANDBOX_ROOT}.
Your role:
1. Take the approved Gap Analysis Report and prioritized remediation tasks.
2. Implement missing features, models, endpoints, and UI components in ${SANDBOX_ROOT}:
   - Follow existing patterns in apps/api/core and apps/web.
   - Maintain clean architecture, type safety, and proper migrations.
   - Respect business rules and validation constraints defined in the specifications.
3. Keep changes bounded, focused, and verified with local tests in the sandbox.
4. Return a summary of all modified paths, created files, and test outcomes.`,
  },
  {
    id: "delivery-qa-verifier",
    name: "Delivery QA & Acceptance Verifier",
    role: "QA & Verification Lead",
    description: "Independently validates the implemented code against all acceptance criteria, runs typechecks and suites in the sandbox, and produces the final release verification report.",
    policy: writeSandboxPolicy,
    prompt: `You are the Independent QA and Verification Lead operating in ${SANDBOX_ROOT}.
Your role:
1. Inspect the codebase changes made by the Implementation Engineer.
2. Validate every acceptance criterion from the original specifications.
3. Run relevant checks (e.g., pytest, pnpm typecheck, linter) in ${SANDBOX_ROOT}.
4. Verify that no regressions were introduced and that all gaps identified in the report have been fully closed.
5. Produce a final sign-off report with exact test outputs, exit codes, and delivery status (PASS/FAIL).`,
  },
];

async function main() {
  const client = await pool.connect();

  try {
    console.log("=============================================================");
    console.log("🚀 Initializing Orchestrator Agent & Isolated Sandbox Workspace");
    console.log(`🔒 Sandbox Workspace: ${SANDBOX_ROOT}`);
    console.log(`📁 Specs Source: ${DOCS_ROOT}`);
    console.log("=============================================================\n");

    await client.query("BEGIN");

    // 1. Update Project to point to Sandbox
    console.log("1. Updating studio_projects to point to isolated sandbox...");
    await client.query(`
      INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, owner_id, created_at, updated_at)
      VALUES (
        'project-building-management',
        $1,
        'Building Management System (Isolated Sandbox)',
        'Civil construction field reporting system running in an isolated sandbox clone',
        'active',
        jsonb_build_object(
          'repository', '${SANDBOX_ROOT}',
          'originalSource', '/home/hossein/Desktop/projects/building-management',
          'sandboxMode', true
        ),
        'dev-user',
        now(),
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        settings = EXCLUDED.settings,
        status = 'active',
        updated_at = now()
    `, [ORG_ID]);

    // 2. Update Workspace to point to Sandbox
    console.log("2. Updating studio_workspaces to point to isolated sandbox...");
    await client.query(`
      INSERT INTO studio_workspaces (id, tenant_id, project_id, name, description, status, settings, owner_id, created_at, updated_at)
      VALUES (
        'workspace-building-gap',
        $1,
        'project-building-management',
        'Building Gap Analysis Sandbox Workspace',
        'Isolated workspace for inspecting specs and verifying implementation without touching the developer root repository',
        'active',
        jsonb_build_object(
          'workspaceRoot', '${SANDBOX_ROOT}',
          'docsRoot', '${DOCS_ROOT}',
          'isolated', true
        ),
        'dev-user',
        now(),
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        project_id = EXCLUDED.project_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        settings = EXCLUDED.settings,
        status = 'active',
        updated_at = now()
    `, [ORG_ID]);

    // 3. Register Agents with sandbox policy
    console.log("3. Registering Orchestrator Lead and subordinate agents...");
    const createdAgents: AgentRecord[] = [];

    for (const agentDef of agentsToRegister) {
      const record: AgentRecord = {
        id: agentDef.id,
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
            SANDBOX_ROOT,
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
          tenant: ORG_ID,
          isolatedSandbox: SANDBOX_ROOT,
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
        ownerId: "dev-user",
        tenantId: ORG_ID,
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      };

      createdAgents.push(record);

      await client.query(`
        INSERT INTO studio_agents (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'dev-user', false, now(), now())
        ON CONFLICT (id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          name = EXCLUDED.name,
          record = EXCLUDED.record,
          updated_at = now()
      `, [agentDef.id, ORG_ID, agentDef.name, JSON.stringify(record)]);
    }

    // 4. Register Orchestrated Workflow
    console.log("4. Validating and registering orchestrated delivery workflow...");
    const workflowDefinition: WorkflowDefinition = {
      id: "spec-gap-delivery-workflow",
      name: "Orchestrated Spec-to-Code Delivery Workflow",
      description: "Hierarchical multi-agent workflow led by Lead Orchestrator, executing in an isolated sandbox with human approval gate.",
      tenantId: ORG_ID,
      ownerId: "dev-user",
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
            description: "Directory containing specs to decompose and audit",
          },
        },
        {
          id: "lead-orchestrator-node",
          type: "agent",
          name: "Spec Delivery Lead Orchestrator",
          position: { x: 350, y: 200 },
          config: {
            agentId: "orchestrator-lead",
          },
        },
        {
          id: "node-spec-auditor",
          type: "agent",
          name: "Codebase & Acceptance Auditor",
          position: { x: 600, y: 200 },
          config: {
            agentId: "spec-code-auditor",
          },
        },
        {
          id: "node-gap-consolidator",
          type: "agent",
          name: "Gap Consolidator & Release Planner",
          position: { x: 850, y: 200 },
          config: {
            agentId: "gap-report-consolidator",
          },
        },
        {
          id: "human-implementation-approval",
          type: "approval",
          name: "Human Approval Gate: Review Gap Report & Authorize Implementation",
          position: { x: 1100, y: 200 },
          config: {
            message: "Review the consolidated gap report and approve implementation in the sandbox workspace.",
            approvalType: "manual",
            timeoutSeconds: 86400,
          },
        },
        {
          id: "node-approval-decision",
          type: "condition",
          name: "Evaluate Approval Decision",
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
          name: "Autonomous Remediation Engineer (Sandbox)",
          position: { x: 1600, y: 150 },
          config: {
            agentId: "gap-implementation-engineer",
          },
        },
        {
          id: "node-qa-verification",
          type: "agent",
          name: "Delivery QA & Acceptance Verifier (Sandbox)",
          position: { x: 1850, y: 150 },
          config: {
            agentId: "delivery-qa-verifier",
          },
        },
        {
          id: "workflow-delivery-output",
          type: "output",
          name: "Final Delivery Package",
          position: { x: 2100, y: 200 },
          config: {
            outputKey: "delivery_packet",
            description: "Audited deliverables and verified sandbox test report",
          },
        },
      ],
      edges: [
        {
          id: "edge-in-to-orch",
          kind: "normal",
          label: "Intake Directive",
          source: "intake-docs-input",
          target: "lead-orchestrator-node",
          branchKey: "",
        },
        {
          id: "edge-orch-to-auditor",
          kind: "normal",
          label: "Assigned Task Package",
          source: "lead-orchestrator-node",
          target: "node-spec-auditor",
          branchKey: "",
        },
        {
          id: "edge-auditor-to-consolidator",
          kind: "normal",
          label: "Audit Findings",
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
          label: "Approved -> Sandbox Remediation",
          source: "node-approval-decision",
          target: "node-implementation",
          branchKey: "approved",
        },
        {
          id: "edge-decision-to-out-rejected",
          kind: "conditional",
          label: "Rejected -> Stop",
          source: "node-approval-decision",
          target: "workflow-delivery-output",
          branchKey: "rejected",
        },
        {
          id: "edge-impl-to-qa",
          kind: "normal",
          label: "Candidate Code in Sandbox",
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

    const issues = validateWorkflow(workflowDefinition, createdAgents, {}, []);
    const errors = issues.filter(i => i.level === "error");
    if (errors.length > 0) {
      throw new Error(`Workflow validation errors: ${JSON.stringify(errors)}`);
    }

    await client.query(`
      INSERT INTO studio_workflows (id, tenant_id, name, definition, owner_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'dev-user', now(), now())
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        name = EXCLUDED.name,
        definition = EXCLUDED.definition,
        updated_at = now()
    `, [
      workflowDefinition.id,
      ORG_ID,
      workflowDefinition.name,
      JSON.stringify(workflowDefinition),
    ]);

    // 5. Orchestrator: Decompose Specs into Structured Tasks on Task Board (in 'queued' / To Do status!)
    console.log("5. Orchestrator decomposing specifications into structured tasks (To Do state)...");
    const atomicSpecsDir = path.join(DOCS_ROOT, "atomic-specs");
    const specFiles = fs.readdirSync(atomicSpecsDir).filter(f => f.startsWith("SPEC-") && f.endsWith(".md"));
    specFiles.sort();

    let createdTaskCount = 0;

    for (const file of specFiles) {
      const fullPath = path.join(atomicSpecsDir, file);
      const content = fs.readFileSync(fullPath, "utf8");
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const specTitle = titleMatch ? titleMatch[1].trim() : file;
      const specId = file.replace(/\.md$/, "");

      const storyBlocks = content.split(/###\s+داستان کاربری\s+/);
      for (let i = 1; i < storyBlocks.length; i++) {
        const block = storyBlocks[i];
        const headerLine = block.split("\n")[0] || "";
        const codeMatch = headerLine.match(/[`*_]?(US-[A-Z]+-\d+)[`*_]?:\s*(.+)/);
        const code = codeMatch ? codeMatch[1].trim() : `US-${specId}-${i}`;
        const title = codeMatch ? codeMatch[2].replace(/[`*_]/g, "").trim() : headerLine.trim();

        const roleMatch = block.match(/به عنوان\s+\*\*([^*]+)\*\*/);
        const role = roleMatch ? roleMatch[1].trim() : "کاربر سیستم";

        const acMatches = [...block.matchAll(/\*\*سناریو\s+\d+\s*\(([^)]+)\)\s*:\*\*/g)].map(m => m[1]);

        const taskId = `task-${code.toLowerCase()}`;
        const taskTitle = `[${specId}] ${code}: ${title}`;
        const taskDescription = `### 🎯 داستان کاربری: ${code} - ${title}
**نقش ذینفع:** ${role}  
**سند فنی مبنا:** \`${file}\`  
**محیط اجرا:** \`Sandbox Workspace\` (${SANDBOX_ROOT})  
**ایجنت مسئول بازرسی:** \`spec-code-auditor\`  
**ایجنت مسئول پیاده‌سازی:** \`gap-implementation-engineer\` (پس از تأیید)

#### 📝 معیارهای پذیرش استخراج‌شده:
${acMatches.map((ac, idx) => `${idx + 1}. ${ac}`).join("\n") || "بررسی انطباق عمومی با نیازمندی‌های این داستان کاربری"}
`;

        const priority = ["SPEC-01", "SPEC-02", "SPEC-03", "SPEC-06"].includes(specId) ? "high" : "medium";

        // Assign to the Auditor subordinate agent, status = 'queued' (To Do column)
        await client.query(`
          INSERT INTO studio_tasks (
            id, tenant_id, owner_id, title, description, priority, status,
            assigned_agent, workflow_id, workspace_id, project_id, dependencies,
            retry_count, paused, metadata, output, created_at, updated_at
          )
          VALUES (
            $1, $2, 'dev-user', $3, $4, $5, 'queued',
            'spec-code-auditor', 'spec-gap-delivery-workflow', 'workspace-building-gap', 'project-building-management',
            '[]'::jsonb, 0, false, $6, null, now(), now()
          )
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            priority = EXCLUDED.priority,
            status = 'queued',
            assigned_agent = 'spec-code-auditor',
            metadata = EXCLUDED.metadata,
            output = null,
            updated_at = now()
        `, [
          taskId,
          ORG_ID,
          taskTitle,
          taskDescription,
          priority,
          JSON.stringify({
            specId,
            storyCode: code,
            sourceDoc: `reports_documentation/atomic-specs/${file}`,
            orchestratedBy: "orchestrator-lead",
            assignedAgent: "spec-code-auditor",
            sandboxRoot: SANDBOX_ROOT,
            status: "ready_to_start",
          }),
        ]);

        createdTaskCount++;
      }
    }

    await client.query("COMMIT");

    console.log(`\n✅ Setup Complete!`);
    console.log(`📋 Orchestrator decomposed and registered ${createdTaskCount} tasks in the 'To Do' column.`);
    console.log(`🛡️ Isolated Sandbox is configured at: ${SANDBOX_ROOT}`);
    console.log(`🛑 All agents are IDLE. No agent execution has been started (Awaiting Human Approval).\n`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Setup failed:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
