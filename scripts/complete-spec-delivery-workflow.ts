/** One-time repair of the user-owned Spec-to-Software workflow in live Studio. */
import path from "node:path";
import { access, writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { Pool } from "pg";
import type { AgentRecord, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@multi-agent/types";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { assertExecutionPolicy } from "../src/agents/runtime/executionPolicy";

dotenv.config({ path: path.resolve("apps/server/.env") });

const workflowId = "wf-mutcpwwh-rxq8nu";
const workspaceRoot = "E:/hossein/ai_agent/multi-agent/workspaces";
const now = new Date().toISOString();
const apply = process.argv.includes("--apply");
const pool = new Pool({ connectionString: process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL });

type Role = { id: string; name: string; description: string; sourceId: string; prompt: string; policy: AgentRecord["executionPolicy"]; useCodex?: boolean };
const readPolicy: AgentRecord["executionPolicy"] = {
  shell: "restricted", filesystem: "read", network: true, workspaceRoot,
  allowedCommands: ["codex", "codex.exe"],
};
const writePolicy: AgentRecord["executionPolicy"] = {
  shell: "full", filesystem: "read-write", network: true, workspaceRoot,
};
const developerPolicy: AgentRecord["executionPolicy"] = {
  shell: "full", filesystem: "read-write", network: true, workspaceRoot,
};
const qaPolicy: AgentRecord["executionPolicy"] = {
  shell: "restricted", filesystem: "read-write", network: true, workspaceRoot,
  allowedCommands: ["codex", "codex.exe"],
};

const roles: Role[] = [
  {
    id: "agent-spec-honest-review-v1", name: "Software Engineer — Honest Spec Review",
    description: "Independently challenge the specification and decide whether implementation can begin.",
    sourceId: "9ab9e590-b071-48e5-8cd2-5bbcd8d03b2c", policy: readPolicy,
    prompt: `You are the independent software engineer reviewing the supplied specification. Give your honest technical opinion, including explicit agreement or disagreement with reasons. Do not flatter the author or silently accept an infeasible design. Inspect available repository evidence read-only. Identify contradictions, missing repository or base ref, unclear acceptance criteria, unsafe assumptions, architecture risks, missing interfaces, tests, deployment target, and documentation obligations. Offer concrete improvements and the smallest questions needed to make implementation safe. A disagreement about a material requirement must route to clarification; minor suggestions may accompany a ready verdict. Do not edit code or docs. Return only a valid JSON result envelope with status "success", branch "ready" or "clarification", and value containing assessment ("agree", "disagree", or "revise"), rationale, questions, suggestions, and verifiedInputs (repository, baseRef, acceptanceCriteria). Use branch ready only when the spec is actionable and its material risks are resolved. Otherwise use clarification. Never invent missing facts.`,
  },
  {
    id: "agent-spec-technical-plan-v1", name: "Spec Technical Planner",
    description: "Convert the reviewed spec into bounded implementation and verification steps.",
    sourceId: "9ab9e590-b071-48e5-8cd2-5bbcd8d03b2c", policy: readPolicy,
    prompt: `Plan the reviewed software project from the original spec, engineer review, and available repository evidence. Respect the stated repository, immutable base ref, constraints, and acceptance criteria. Divide work into backend, frontend, documentation, QA, and security responsibilities. Define interfaces, ordering, affected paths, expected checks, and a task-owned branch/worktree plan. Reuse existing code and conventions. Surface unresolved inputs with a structured needs_human or blocked result; do not send unready work to developers. Do not edit files. Return a concise JSON result envelope with status success and value containing scope, implementation steps, path ownership, acceptance mapping, test commands, docs targets, risks, and assumptions.`,
  },
  {
    id: "agent-spec-backend-dev-v1", name: "Spec Backend Developer",
    description: "Implement the backend and integration parts of the approved plan.",
    sourceId: "768c6ccd-9298-4051-ad0b-789dd441c4af", policy: developerPolicy, useCodex: true,
    prompt: `Implement only the backend, API, data, infrastructure, and integration work assigned by the reviewed spec and technical plan. Work in the approved repository and task-owned branch/worktree; verify base ref and path ownership before changing files. Reuse existing contracts. Make bounded code changes and appropriate focused tests. If the plan has no backend work, report an explicit no-op with evidence and leave files unchanged. Do not deploy, publish, merge, change credentials, or claim checks ran unless they did. If repository, permissions, dependencies, or acceptance criteria are unavailable, return a structured blocked result with precise missing evidence. On success return a JSON result envelope with changed paths, revision/branch, commands and actual outcomes, open risks, and handoff to frontend.`,
  },
  {
    id: "agent-spec-frontend-dev-v1", name: "Spec Frontend Developer",
    description: "Implement the frontend and user interface parts of the approved plan.",
    sourceId: "8698a0f9-0d33-4154-aa19-0d9aa165ccf1", policy: developerPolicy, useCodex: true,
    prompt: `Implement the frontend and user-facing work assigned by the reviewed spec and technical plan, including integration with the backend changes already made. Use the same approved repository and task-owned branch/worktree. Respect existing design, accessibility, responsive behavior, and API contracts. Make bounded code changes and focused tests. If the plan has no frontend work, report an explicit no-op with evidence. Do not deploy, publish, merge, change credentials, or claim checks ran unless they did. If blocked, return a structured blocked result with precise missing evidence. On success return a JSON result envelope with changed paths, revision/branch, commands and actual outcomes, residual risks, and handoff to documentation.`,
  },
  {
    id: "agent-spec-docs-writer-v1", name: "Project Documentation Engineer",
    description: "Update project documents and the project's apps/docs after implementation.",
    sourceId: "95e08a39-c0bb-43ca-b68b-4be3aba32c90", policy: writePolicy,
    prompt: `After implementation, update the target project's documentation to reflect actual behavior and decisions. Update relevant README, architecture, setup, operations, API, and user documents, and update the target repository's apps/docs when that directory exists. Inspect the implementation and existing documentation first; do not create inaccurate promises or claim unverified features. Keep docs aligned with the implemented code, configuration, examples, and limitations. If apps/docs is absent, report that fact and update the appropriate existing docs path from the spec. Do not deploy or publish externally. Return a JSON result envelope with changed documentation paths, what was verified against code, commands actually run, and remaining documentation gaps. Block if the target repository or implementation evidence is missing.`,
  },
  {
    id: "agent-spec-independent-qa-v1", name: "Independent Project QA",
    description: "Verify code and documentation against every acceptance criterion.",
    sourceId: "2c005661-9fab-4850-a976-2b0902d1bdd8", policy: qaPolicy, useCodex: true,
    prompt: `Independently verify the final implementation and documentation against every acceptance criterion in the original spec and reviewed plan. Inspect the final revision, run the required focused and integration checks in the approved non-production environment, and check apps/docs and other changed docs for accuracy. Record exact commands, exit codes, observed results, revision/SHA, and unrun checks. Do not modify product code to make a failure disappear; only generated test artifacts are allowed. Return a valid JSON envelope with status success to indicate that the review itself ran, and a value containing verdict PASS, FAIL, or NEEDS_VERIFICATION, criterion-by-criterion evidence, reproducible blockers, and unrun checks. A build or completed workflow alone is not delivery proof. Never report PASS without evidence.`,
  },
  {
    id: "agent-spec-security-review-v1", name: "Independent Project Security Review",
    description: "Review the final implementation for security and privacy regressions.",
    sourceId: "480c3c39-e514-4629-9283-cce3c8cdb8fd", policy: readPolicy,
    prompt: `Independently review the final code and documentation changes for authentication, authorization, data exposure, injection, secrets, dependency, network, and operational risks relevant to the spec. Use read-only inspection and cite concrete files/revisions. Do not edit code or docs. Return a valid JSON envelope with status success to indicate that the review itself ran, and a value containing verdict PASS, FAIL, or NEEDS_VERIFICATION, concrete findings, severity, evidence, and residual risks. Missing final revision/evidence or an unresolved high-severity issue must never be labeled PASS. Do not infer security approval from a completed run.`,
  },
  {
    id: "agent-spec-completion-advisor-v1", name: "Project Completion Advisor",
    description: "Summarize delivery evidence and suggest prioritized next steps.",
    sourceId: "9ab9e590-b071-48e5-8cd2-5bbcd8d03b2c", policy: readPolicy,
    prompt: `Prepare the final user-facing project report from the original spec, engineer opinion, implementation handoffs, documentation changes, independent QA, and security review. State what was implemented, changed paths, final revision/PR when available, checks actually run and outcomes, acceptance criteria status, and remaining risks. Suggest a short prioritized list of concrete steps to complete or improve the project. Mark delivery COMPLETE only when QA and security both have evidence-backed PASS verdicts and every acceptance criterion is satisfied; otherwise mark it NEEDS_WORK or NEEDS_VERIFICATION and surface the blocking findings. Never invent a PR, SHA, test result, deployment, or documentation update. Return a JSON result envelope with status success and a concise structured value.`,
  },
];

function node(id: string, type: WorkflowNode["type"], x: number, y: number, config: WorkflowNode["config"]): WorkflowNode {
  return { id, type, position: { x, y }, config };
}
function edge(source: string, target: string, kind: WorkflowEdge["kind"] = "normal", branchKey = ""): WorkflowEdge {
  return { id: `edge-spec-${source}-${target}`.slice(0, 190), source, target, kind, branchKey, label: "" };
}

async function main() {
  const client = await pool.connect();
  try {
    const current = await client.query("SELECT definition, owner_id, tenant_id FROM studio_workflows WHERE id=$1", [workflowId]);
    if (current.rowCount !== 1) throw new Error(`Workflow ${workflowId} is missing`);
    const prior = current.rows[0].definition as WorkflowDefinition;
    const ownerId = String(current.rows[0].owner_id);
    const tenantId = String(current.rows[0].tenant_id);
    if (!ownerId || !tenantId || ownerId === "null" || tenantId === "null") throw new Error("Workflow ownership is incomplete");
    const originals = await client.query("SELECT record FROM studio_agents WHERE id=ANY($1::text[])", [roles.map(r => r.sourceId)]);
    const sources = new Map<string, AgentRecord>(originals.rows.map(row => [row.record.id, row.record]));
    const agents: AgentRecord[] = roles.map(role => {
      const source = sources.get(role.sourceId);
      if (!source) throw new Error(`Agent template ${role.sourceId} is missing`);
      const agent: AgentRecord = {
        ...source, id: role.id, name: role.name, description: role.description, systemPrompt: role.prompt,
        tools: [], executionPolicy: role.policy, metadata: { workflowId, role: role.id },
        backend: role.useCodex ? { type: "cli", provider: "codex", model: "gpt-5.6-luna" } : source.backend,
        enabled: true, createdAt: now, updatedAt: now, ownerId, tenantId, isSystem: false,
      };
      assertExecutionPolicy(agent);
      return agent;
    });
    const N = {
      input: "spec-input", review: "spec-engineer-review", route: "spec-readiness-route",
      plan: "spec-technical-plan", backend: "spec-backend-implementation", frontend: "spec-frontend-implementation",
      docs: "spec-documentation-update", qa: "spec-independent-qa", security: "spec-security-review",
      advice: "spec-completion-advice", output: "spec-delivery-output",
    };
    const definition: WorkflowDefinition = {
      ...prior, schemaVersion: 2, name: "Spec-to-Software Delivery Workflow", updatedAt: now,
      nodes: [
        { ...node(N.input, "input", 80, 100, { inputKey: "input", description: "Paste a non-empty project specification with repository location, base ref, acceptance criteria, constraints, and documentation targets into Run input. JSON text is also accepted." }), contract: { version: 1, inputSchema: { type: "object", required: ["input"], properties: { input: { type: "string", minLength: 1 } } }, captureEvidence: true } },
        { ...node(N.review, "agent", 390, 100, { agentId: roles[0].id }), contract: { version: 1, captureEvidence: true } },
        node(N.route, "condition", 700, 100, { branches: [{ key: "ready", label: "Ready to build" }, { key: "clarification", label: "Clarification needed" }], valueSource: "last_value", unknownRoute: "clarification", errorRoute: "clarification" }),
        { ...node(N.plan, "agent", 1010, 100, { agentId: roles[1].id }), contract: { version: 1, captureEvidence: true } },
        { ...node(N.backend, "agent", 1010, 390, { agentId: roles[2].id }), contract: { version: 1, captureEvidence: true } },
        { ...node(N.frontend, "agent", 700, 390, { agentId: roles[3].id }), contract: { version: 1, captureEvidence: true } },
        { ...node(N.docs, "agent", 390, 390, { agentId: roles[4].id }), contract: { version: 1, captureEvidence: true } },
        { ...node(N.qa, "agent", 80, 390, { agentId: roles[5].id }), contract: { version: 1, captureEvidence: true } },
        { ...node(N.security, "agent", 80, 680, { agentId: roles[6].id }), contract: { version: 1, captureEvidence: true } },
        { ...node(N.advice, "agent", 390, 680, { agentId: roles[7].id }), contract: { version: 1, captureEvidence: true } },
        node(N.output, "output", 700, 680, { outputKey: "delivery_report", inputMode: "last_value", description: "Return the honest engineer assessment or the verified implementation report, documentation updates, and prioritized suggestions." }),
      ],
      edges: [
        edge(N.input, N.review), edge(N.review, N.route),
        edge(N.route, N.plan, "conditional", "ready"), edge(N.route, N.output, "conditional", "clarification"),
        edge(N.plan, N.backend), edge(N.backend, N.frontend), edge(N.frontend, N.docs), edge(N.docs, N.qa),
        edge(N.qa, N.security), edge(N.security, N.advice), edge(N.advice, N.output),
      ],
    };
    const issues = validateWorkflow(definition, agents);
    if (issues.length) throw new Error(`Validation failed: ${JSON.stringify(issues.map(i => ({ code: i.code, message: i.message, nodeId: i.nodeId })))}`);
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", workflowId, agents: agents.length, nodes: definition.nodes.length, edges: definition.edges.length, issues: issues.length }));
    if (!apply) return;
    await client.query("BEGIN");
    const backupPath = path.resolve("workspaces/spec-delivery-workflow-before-repair.json");
    if (!(await access(backupPath).then(() => true, () => false))) {
      await writeFile(backupPath, `${JSON.stringify(prior, null, 2)}\n`, { flag: "wx" });
    }
    for (const agent of agents) {
      const existing = await client.query("SELECT owner_id, tenant_id, is_system FROM studio_agents WHERE id=$1", [agent.id]);
      if (existing.rowCount && (existing.rows[0].is_system || existing.rows[0].owner_id !== ownerId || existing.rows[0].tenant_id !== tenantId)) throw new Error(`Agent id collision: ${agent.id}`);
      await client.query(`INSERT INTO studio_agents (id,name,record,created_at,updated_at,owner_id,tenant_id,is_system)
        VALUES ($1,$2,$3::jsonb,$4::timestamptz,$5::timestamptz,$6,$7,false)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,record=EXCLUDED.record,updated_at=EXCLUDED.updated_at`,
      [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt, ownerId, tenantId]);
    }
    await client.query("UPDATE studio_workflows SET name=$2, definition=$3::jsonb, updated_at=$4::timestamptz WHERE id=$1 AND owner_id=$5 AND tenant_id=$6", [workflowId, definition.name, JSON.stringify(definition), now, ownerId, tenantId]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ saved: true, backupPath }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
