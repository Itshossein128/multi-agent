import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createHierarchicalSupervisorConfig,
  createNode,
  createRecursionGuard,
  createToolRecord,
  nowIso,
  type AgentNodeConfig,
  type AgentRecord,
  type DynamicFanoutNodeConfig,
  type ToolRecord,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@multi-agent/types";

export const AGENTIC_VELORA_ORG_ID = "4cc4a715-3ac8-42d4-84ad-83bbdc45f03a";
export const AGENTIC_VELORA_ORG_SLUG = "agentic-velora";
export const VELORA_WORKING_MEMORY_INSTRUCTIONS = [
  "Working memory for this run: when you have a verified decision, finding, constraint, or open question that a later step needs, record up to three concise entries. Include the relevant requirement or artifact reference. Exclude secrets, raw transcripts, and unsupported claims.",
  'For a response with entries, use a final fenced JSON object shaped as {"output": <the complete response the step requires>, "workingMemoryUpdates": [{"op": "add", "scope": "workflow", "kind": "finding", "content": "<concise evidence and reference>"}]}. Preserve the required step fields inside output and use the matching kind for each entry. Mark agent-private scratch notes with scope "agent".',
  'For confirmed facts or tested procedures that will remain useful in future runs, optionally add a top-level "memoryCandidates" array to that same envelope. Use {"kind":"semantic","subject":"<topic>","content":"<verified fact and evidence reference>"} or a procedural entry with title, trigger, procedure and content. Use an empty workingMemoryUpdates array for durable candidates only. Keep drafts, pending employer decisions, and unverified observations in run memory.',
  "If there is no material update, use the step's ordinary response format.",
].join("\n");
export const VELORA_PROJECT_ROOT = "/home/hossein/Desktop/projects/building-management";
export const VELORA_OUTPUT_DIR = "/home/hossein/Desktop/projects/building-management/output";
export const VELORA_DELIVERY_PLAN_URL = "http://localhost:5173/delivery-plan";
const A1_PROMPT_DIR = `${VELORA_OUTPUT_DIR}/a1-requirements-2026-11-18/speckit-prompts`;
const A1_WORK_PACKAGES = [
  ["B01", "01-b01-data-contract.md"],
  ["B02", "02-b02-version-integrity.md"],
  ["B03", "03-b03-reference-parity.md"],
  ["B04", "04-b04-filters-totals.md"],
  ["B05", "05-b05-independent-reconciliation.md"],
  ["B06", "06-b06-delivery-acceptance.md"],
].map(([id, file]) => ({ id, promptPath: `${A1_PROMPT_DIR}/${file}` }));

export function createAgenticVeloraTools(): ToolRecord[] {
  const stamp = nowIso();

  const mkTool = (spec: {
    id: string;
    name: string;
    description: string;
    impact: "read-only" | "write";
    kind: string;
    configuration?: Record<string, string | number | boolean>;
  }): ToolRecord => ({
    ...createToolRecord({
      name: spec.name,
      category: "function",
      description: spec.description,
      impact: spec.impact,
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      configuration: {
        kind: spec.kind,
        projectRoot: VELORA_PROJECT_ROOT,
        outputDir: VELORA_OUTPUT_DIR,
        deliveryPlanUrl: VELORA_DELIVERY_PLAN_URL,
        ...(spec.configuration ?? {}),
      },
      executionPolicy: {
        requiresApproval: false,
        idempotency: "optional",
        retryable: spec.impact === "read-only",
      },
    }),
    id: spec.id,
    enabled: true,
    tenantId: AGENTIC_VELORA_ORG_ID,
    createdAt: stamp,
    updatedAt: stamp,
  });

  return [
    mkTool({
      id: "delivery_plan_reader_tool",
      name: "delivery_plan_reader_tool",
      description:
        "Reads Velora delivery-plan.ts live status (http://localhost:5173/delivery-plan) and schedule.json to identify the next remaining delivery phase and its work packages.",
      impact: "read-only",
      kind: "delivery-plan-reader",
    }),
    mkTool({
      id: "employer_requirements_extractor_tool",
      name: "employer_requirements_extractor_tool",
      description:
        "Extracts employer requirements, user stories, acceptance criteria, and RBAC persona matrix for the target Velora delivery phase.",
      impact: "read-only",
      kind: "employer-requirements-extractor",
    }),
    mkTool({
      id: "speckit_workspace_tool",
      name: "speckit_workspace_tool",
      description:
        "Inspects Velora .specify/feature.json (feature_directory) and specs/<feature>/{spec.md,plan.md,tasks.md} convergence status.",
      impact: "read-only",
      kind: "speckit-workspace-inspector",
    }),
    mkTool({
      id: "velora_knowledge_tool",
      name: "velora_knowledge_tool",
      description:
        "Executes Velora scripts/knowledge/cli.py (status, context, query, and index --semantic with active-job PID guard per AGENTS.md).",
      impact: "write",
      kind: "velora-knowledge",
    }),
    mkTool({
      id: "velora_graphify_tool",
      name: "velora_graphify_tool",
      description:
        "Queries and updates Velora's graphify knowledge graph (graphify query, explain, path, update, and semantic extract).",
      impact: "write",
      kind: "velora-graphify",
    }),
    mkTool({
      id: "velora_output_report_tool",
      name: "velora_output_report_tool",
      description:
        "Reads, lists, and writes structured gap analysis, per-requirement End-User QA reports, and SpecKit prompts strictly inside /home/hossein/Desktop/projects/building-management/output.",
      impact: "write",
      kind: "velora-output-report",
    }),
    mkTool({
      id: "delegate_subagents",
      name: "delegate_subagents",
      description:
        "Dynamically fans out N verification or implementation sub-agent invocations with bounded concurrency and aggregates their verdicts.",
      impact: "read-only",
      kind: "delegate-subagents",
    }),
    mkTool({
      id: "browser_qa_probe_tool",
      name: "browser_qa_probe_tool",
      description:
        "Probes live Velora web (http://localhost:5173) and Django API (http://localhost:8000) endpoints for end-user QA verification.",
      impact: "read-only",
      kind: "browser-qa-probe",
    }),
  ];
}

export function createAgenticVeloraAgents(): AgentRecord[] {
  const stamp = nowIso();

  const buildCliAgent = (spec: {
    id: string;
    name: string;
    description: string;
    provider: "codex" | "agy" | "cursor";
    model?: string;
    executable?: string;
    args?: string[];
    filesystem: "read" | "read-write";
    network?: boolean;
    tools: string[];
    shortTermMaxTokens: number;
    longTermKinds: Array<"semantic" | "episodic" | "procedural">;
    longTermMaxMemories: number;
    longTermMaxTokens: number;
    writableScope: "organization" | "agent";
    systemPrompt: string;
  }): AgentRecord => ({
    ...createAgentRecord({
      name: spec.name,
      description: spec.description,
      systemPrompt: `${spec.systemPrompt}\n\n${VELORA_WORKING_MEMORY_INSTRUCTIONS}`,
      tools: spec.tools,
      memory: {
        enabled: true,
        type: "run",
        scope: "agent",
        mode: "read_write",
        maxEntries: 30,
        shortTerm: {
          enabled: true,
          maxTokens: spec.shortTermMaxTokens,
        },
        longTerm: {
          enabled: true,
          readableNamespaces: [
            { scope: "organization", id: AGENTIC_VELORA_ORG_ID },
            { scope: "agent", id: spec.id },
          ],
          writableNamespace:
            spec.writableScope === "agent"
              ? { scope: "agent", id: spec.id }
              : { scope: "organization", id: AGENTIC_VELORA_ORG_ID },
          kinds: spec.longTermKinds,
          retrieval: {
            maxMemories: spec.longTermMaxMemories,
            maxTokens: spec.longTermMaxTokens,
            minScore: 0.25,
          },
          writeMode: "background",
          required: false,
        },
      },
      backend: {
        type: "cli",
        provider: spec.provider,
        ...(spec.model ? { model: spec.model } : {}),
        ...(spec.executable ? { executable: spec.executable } : {}),
        ...(spec.args ? { args: spec.args } : {}),
      },
      executionPolicy: {
        filesystem: spec.filesystem,
        shell: "restricted",
        network: spec.network ?? true,
        workspaceRoot: VELORA_PROJECT_ROOT,
        allowedCommands: [
          spec.executable ?? (spec.provider === "cursor" ? "agent" : spec.provider),
          "python3",
          "git",
          "pnpm",
          "npx",
          "graphify",
        ],
      },
    }),
    id: spec.id,
    enabled: true,
    tenantId: AGENTIC_VELORA_ORG_ID,
    metadata: {
      targetRepository: VELORA_PROJECT_ROOT,
      outputDirectory: VELORA_OUTPUT_DIR,
      deliveryPlanUrl: VELORA_DELIVERY_PLAN_URL,
    },
    createdAt: stamp,
    updatedAt: stamp,
  });

  return [
    buildCliAgent({
      id: "agent-velora-orchestrator",
      name: "Velora Lead Orchestrator",
      description:
        "Coordinates the 8-stage autonomous Velora delivery lifecycle, partitions tasks.md execution phases, triggers speckit-converge, and enforces exception-only HITL.",
      provider: "codex",
      model: "gpt-6-luna",
      args: ["-s", "read-only", "--json", "-c", "model_reasoning_effort=\"low\""],
      filesystem: "read",
      shortTermMaxTokens: 4096,
      longTermKinds: ["semantic", "episodic", "procedural"],
      longTermMaxMemories: 6,
      longTermMaxTokens: 1536,
      writableScope: "organization",
      tools: [
        "delivery_plan_reader_tool",
        "speckit_workspace_tool",
        "delegate_subagents",
        "velora_output_report_tool",
      ],
      systemPrompt: [
        "You are the Velora Lead Orchestrator operating on /home/hossein/Desktop/projects/building-management.",
        "Responsibilities:",
        "1. Coordinate the 8-stage delivery pipeline from Stage 1 discovery through Stage 8 semantic knowledge sync, consulting long-term procedural/episodic memory and run-scoped Working Memory.",
        "2. In Stage 4, partition generated SpecKit tasks.md into ordered execution phases, dispatch the SpecKit Implementer, and trigger speckit-converge until all requirements in spec.md, plan.md, and tasks.md are satisfied.",
        "3. Proceed 100% autonomously unless an unresolvable high-impact employer requirement ambiguity requires a structured needs_human clarification envelope.",
        "4. Always end Stage 4.3 converge evaluations with a fenced ```json block containing {\"verdict\": \"converged\" | \"continue_implement\", \"remainingTasks\": [...], \"summary\": \"...\"}.",
      ].join("\n"),
    }),
    buildCliAgent({
      id: "agent-velora-discovery",
      name: "Discovery & Knowledge Analyst",
      description:
        "Stage 1 analyst using graphify, embedded knowledge base (scripts/knowledge/cli.py context), and http://localhost:5173/delivery-plan to identify gaps and fan out per-requirement QA.",
      provider: "codex",
      model: "gpt-reserve",
      args: [
        "-s",
        "workspace-write",
        "--json",
        "-c",
        "sandbox_workspace_write.network_access=true",
        "-c",
        "model_reasoning_effort=\"low\"",
      ],
      filesystem: "read-write",
      shortTermMaxTokens: 4096,
      longTermKinds: ["semantic", "episodic"],
      longTermMaxMemories: 8,
      longTermMaxTokens: 2048,
      writableScope: "organization",
      tools: [
        "delivery_plan_reader_tool",
        "employer_requirements_extractor_tool",
        "velora_knowledge_tool",
        "velora_graphify_tool",
        "delegate_subagents",
        "velora_output_report_tool",
      ],
      systemPrompt: [
        "You are the Stage 1 Discovery & Knowledge Analyst for Velora (/home/hossein/Desktop/projects/building-management).",
        "1. Follow AGENTS.md: read knowledge/agent-instructions.md, query graphify-out/ via graphify query/explain/path, and run `python3 scripts/knowledge/cli.py context`.",
        "2. Inspect the next remaining delivery phase from http://localhost:5173/delivery-plan (apps/web/src/app/data/delivery-plan.ts and schedule.json) and any existing audit files in /home/hossein/Desktop/projects/building-management/output/.",
        "3. Extract every user story, employer requirement, or work package for the phase so the downstream dynamic_fanout node invokes the Per-Requirement End-User QA Agent for each item.",
        "4. Save the consolidated gap and inspection report to /home/hossein/Desktop/projects/building-management/output/.",
        "5. CRITICAL OUTPUT CONTRACT: Your final response MUST end with a valid fenced ```json block with the exact top-level key `requirements` as a non-empty JSON array of objects, e.g.:",
        "```json",
        "{\"phase\": \"A.1\", \"requirements\": [{\"id\": \"B01\", \"title\": \"...\", \"acceptance\": \"...\"}], \"summary\": \"...\"}",
        "```",
      ].join("\n"),
    }),
    buildCliAgent({
      id: "agent-velora-per-req-qa",
      name: "Per-Requirement End-User QA Agent",
      description:
        "Acts as both QA Engineer and End-User to verify each individual requirement/user story in Stage 1 and full post-implementation software verification in Stage 5.",
      provider: "agy",
      model: "gemini-3.8-flash-low",
      filesystem: "read",
      network: true,
      shortTermMaxTokens: 2048,
      longTermKinds: ["semantic", "episodic"],
      longTermMaxMemories: 5,
      longTermMaxTokens: 1024,
      writableScope: "agent",
      tools: [
        "browser_qa_probe_tool",
        "employer_requirements_extractor_tool",
        "velora_output_report_tool",
      ],
      systemPrompt: [
        "You are the Per-Requirement End-User QA Agent for Velora (http://localhost:5173 and http://localhost:8000).",
        "1. In Stage 1 (per-requirement fan-out), act as an end-user and QA engineer for the assigned user story or requirement, verifying whether it is completely implemented or documenting exact defects, missing flows, RBAC gaps, or bilingual FA/EN issues.",
        "2. In Stage 5 (post-implementation QA), test the implemented software end-to-end as a real end-user across all required personas (using prior episodic defect history from memory) and end your response with a fenced ```json block containing {\"qaStatus\": \"qa_passed\" | \"qa_failed\", \"defects\": [...], \"summary\": \"...\"}.",
        "3. Persist structured QA verification evidence under /home/hossein/Desktop/projects/building-management/output.",
      ].join("\n"),
    }),
    buildCliAgent({
      id: "agent-velora-prompt-architect",
      name: "Complexity-Adaptive SpecKit Prompt Architect",
      description:
        "Stage 2 architect that reads Stage 1 QA & gap reports from /home/hossein/Desktop/projects/building-management/output and generates 1 or N complexity-adapted speckit-specify prompts.",
      provider: "codex",
      model: "gpt-6.2-sol",
      args: ["-s", "workspace-write", "--json", "-c", "model_reasoning_effort=\"low\""],
      filesystem: "read-write",
      shortTermMaxTokens: 4096,
      longTermKinds: ["semantic", "procedural"],
      longTermMaxMemories: 6,
      longTermMaxTokens: 1536,
      writableScope: "organization",
      tools: [
        "velora_output_report_tool",
        "delivery_plan_reader_tool",
        "velora_knowledge_tool",
      ],
      systemPrompt: [
        "You are the Stage 2 Complexity-Adaptive SpecKit Prompt Architect for Velora.",
        "1. Read all Stage 1 gap and per-requirement QA reports from /home/hossein/Desktop/projects/building-management/output (including /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18: README.md, remaining-work.md packages B01..B06, scope-decisions.md C01..C08, requirements-and-delivery.md, atomic-coverage.md, and employer-summary.md).",
        "2. Assess architectural complexity and domain coupling: emit a single cohesive speckit-specify prompt (`granularity: 'single'`) for simple phases, or decompose complex multi-domain phases (such as A.1 work packages B01 -> B06) into ordered sequential sub-stage prompts (`granularity: 'multi'`) with a 100% requirement coverage matrix.",
        "3. Save the generated prompts and coverage.json to /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18/speckit-prompts/ (and /home/hossein/Desktop/projects/building-management/output/speckit-prompts/).",
      ].join("\n"),
    }),
    buildCliAgent({
      id: "agent-velora-speckit-executor",
      name: "Stateful SpecKit Executor",
      description:
        "Stage 3 stateful agent executing speckit-specify, speckit-plan, speckit-tasks, and dynamic auxiliary speckit-* skills in a single continuous shared session (speckit-main).",
      provider: "codex",
      model: "gpt-6.2-sol",
      args: ["--sandbox", "workspace-write", "--json", "-c", 'model_reasoning_effort="medium"'],
      filesystem: "read-write",
      shortTermMaxTokens: 8192,
      longTermKinds: ["semantic", "procedural"],
      longTermMaxMemories: 6,
      longTermMaxTokens: 1536,
      writableScope: "organization",
      tools: [
        "speckit_workspace_tool",
        "velora_knowledge_tool",
        "velora_graphify_tool",
      ],
      systemPrompt: [
        "You are the Stage 3 Stateful SpecKit Executor operating in a single shared session (`sessionKey: 'speckit-main'`) on /home/hossein/Desktop/projects/building-management.",
        "1. Execute the requested SpecKit skill (`.agents/skills/speckit-specify/SKILL.md`, `speckit-plan`, `speckit-tasks`, or auxiliary skills `speckit-clarify`, `speckit-analyze`, `speckit-checklist`, `speckit-constitution`) using Velora's `.venv/bin/python .specify/scripts/python/*.py`.",
        "2. Reuse semantic architecture memory and procedural SpecKit playbooks retrieved into your context, and pause after each SpecKit stage so the SpecKit Supervisor/Reviewer can inspect your output, answer questions, or route to an auxiliary SpecKit skill before continuing in the exact same session.",
        "3. Only emit a `needs_human` clarification envelope if an employer requirement remains genuinely ambiguous after Supervisor consultation.",
      ].join("\n"),
    }),
    buildCliAgent({
      id: "agent-velora-speckit-supervisor",
      name: "SpecKit Supervisor/Reviewer",
      description:
        "Stage 3 governance supervisor that reviews each SpecKit stage output, answers SpecKit Executor questions from the knowledge base, and dynamically routes across speckit-* skills.",
      provider: "codex",
      model: "gpt-reserve",
      args: ["-s", "read-only", "--json", "-c", "model_reasoning_effort=\"low\""],
      filesystem: "read",
      shortTermMaxTokens: 4096,
      longTermKinds: ["semantic", "episodic", "procedural"],
      longTermMaxMemories: 8,
      longTermMaxTokens: 2048,
      writableScope: "organization",
      tools: [
        "speckit_workspace_tool",
        "velora_knowledge_tool",
        "velora_graphify_tool",
        "employer_requirements_extractor_tool",
      ],
      systemPrompt: [
        "You are the Stage 3 SpecKit Supervisor/Reviewer for Velora.",
        "1. After each SpecKit stage (`specify`, `plan`, `tasks`, or auxiliary skills), review the generated artifacts against Velora's constitution (`.specify/memory/constitution.md`), `graphify-out/`, `scripts/knowledge/cli.py context`, and long-term semantic/episodic/procedural memory.",
        "2. Answer any clarification questions raised by the Stateful SpecKit Executor so it can resume in the same session.",
        "3. CRITICAL OUTPUT CONTRACT: Always end your response with a fenced ```json block specifying the routing field `next`, e.g. `{\"next\": \"proceed\", \"answers\": [...], \"notes\": \"...\"}` (allowed values depend on the gate: `proceed`, `revise_specify`, `clarify`, `constitution`, `revise_plan`, `revise_tasks`, `checklist`, `analyze`).",
      ].join("\n"),
    }),
    buildCliAgent({
      id: "agent-velora-speckit-implementer",
      name: "SpecKit Implementer",
      description:
        "Stage 4 write-enabled implementation agent executing speckit-implement and speckit-converge across orchestrated task phases.",
      provider: "codex",
      model: "gpt-6.2-sol",
      args: ["--approve-for-me", "--json", "-c", "model_reasoning_effort=\"medium\""],
      filesystem: "read-write",
      shortTermMaxTokens: 8192,
      longTermKinds: ["semantic", "episodic", "procedural"],
      longTermMaxMemories: 8,
      longTermMaxTokens: 2048,
      writableScope: "organization",
      tools: [
        "speckit_workspace_tool",
        "velora_knowledge_tool",
        "velora_graphify_tool",
      ],
      systemPrompt: [
        "You are the Stage 4 SpecKit Implementer for Velora (/home/hossein/Desktop/projects/building-management).",
        "1. Execute `.agents/skills/speckit-implement/SKILL.md` across the orchestrated task phases from `tasks.md`, respecting Django 4.2.11, React Router 7, bilingual FA/EN, server-enforced RBAC rules, and retrieved procedural/episodic lessons.",
        "2. Run `.agents/skills/speckit-converge/SKILL.md` when triggered by the Orchestrator to verify the codebase against `spec.md`, `plan.md`, and `tasks.md` and complete any remaining work until converged.",
      ].join("\n"),
    }),
    buildCliAgent({
      id: "agent-velora-post-qa-fixer",
      name: "Post-QA Defect Fixer",
      description:
        "Stage 6 direct remediation specialist using Cursor CLI (agent) to fix post-implementation QA defects directly without re-entering the SpecKit pipeline.",
      provider: "cursor",
      model: "sonnet-4",
      executable: "agent",
      args: ["--force"],
      filesystem: "read-write",
      shortTermMaxTokens: 8192,
      longTermKinds: ["semantic", "episodic", "procedural"],
      longTermMaxMemories: 6,
      longTermMaxTokens: 1536,
      writableScope: "agent",
      tools: [
        "browser_qa_probe_tool",
        "velora_graphify_tool",
        "velora_output_report_tool",
      ],
      systemPrompt: [
        "You are the Stage 6 Post-QA Defect Fixer for Velora (/home/hossein/Desktop/projects/building-management).",
        "1. When Stage 5 End-User QA reports remaining defects (`qa_failed`), use episodic/procedural defect memory to resolve the root cause directly in the codebase and verify with targeted pytest/Playwright checks.",
        "2. Do NOT re-run the SpecKit (`specify` -> `plan` -> `tasks`) pipeline; return control directly to the Post-Implementation End-User QA Agent for re-verification.",
      ].join("\n"),
    }),
    buildCliAgent({
      id: "agent-velora-knowledge-updater",
      name: "Semantic Knowledge & Graphify Updater",
      description:
        "Stage 8 knowledge synchronization agent that updates Velora's graphify knowledge graph semantically and runs scripts/knowledge/cli.py index --semantic with active-job PID safety.",
      provider: "codex",
      model: "gpt-6-luna",
      args: ["--approve-for-me", "--json", "-c", "model_reasoning_effort=\"low\""],
      filesystem: "read-write",
      shortTermMaxTokens: 2048,
      longTermKinds: ["semantic", "procedural"],
      longTermMaxMemories: 5,
      longTermMaxTokens: 1024,
      writableScope: "organization",
      tools: [
        "velora_graphify_tool",
        "velora_knowledge_tool",
        "velora_output_report_tool",
      ],
      systemPrompt: [
        "You are the Stage 8 Semantic Knowledge & Graphify Updater for Velora (/home/hossein/Desktop/projects/building-management).",
        "1. Upon completion of all implementation and QA stages, update Velora's `graphify` knowledge graph (`velora_graphify_tool` update/extract).",
        "2. Check `python3 scripts/knowledge/cli.py status` and `.knowledge/index.progress.json` PID liveness per `AGENTS.md`, then run `python3 scripts/knowledge/cli.py index --semantic` (`velora_knowledge_tool` action: 'index', semantic: true) without ever downgrading the hybrid index to lexical.",
      ].join("\n"),
    }),
  ];
}

export function createAgenticVeloraMasterWorkflow(): WorkflowDefinition {
  const stamp = nowIso();

  const nInput = createNode("input", { x: 0, y: 260 }, {
    inputKey: "input",
    description: "Target Velora delivery phase (defaults to next remaining phase from http://localhost:5173/delivery-plan)",
  });
  nInput.id = "node-input";

  // Stage 1: Knowledge-Backed Discovery & Per-Requirement End-User QA Fan-Out
  const nDiscovery = createNode("agent", { x: 240, y: 260 }, {
    agentId: "agent-velora-discovery",
    sessionMode: "stateless",
    taskInstruction:
      "Stage 1.1: Inspect http://localhost:5173/delivery-plan, graphify-out/, and scripts/knowledge/cli.py context to extract all requirements and user stories for the next delivery phase. End your response with a fenced ```json block containing {\"phase\": \"A.1\", \"requirements\": [...], \"summary\": \"...\"}.",
  });
  nDiscovery.id = "node-stage1-discovery";

  const nQaFanout: WorkflowNode = {
    ...createNode("dynamic_fanout", { x: 500, y: 260 }),
    id: "node-stage1-qa-fanout",
    config: {
      label: "Per-Requirement End-User QA Fan-Out",
      targetAgentId: "agent-velora-per-req-qa",
      itemsField: "requirements",
      maxConcurrency: 4,
      maxItems: 100,
      failFast: false,
      sessionMode: "node",
      itemPromptTemplate:
        "Verify requirement {{index}} as End-User & QA against Velora (:5173/:8000) and report implementation status or gaps: {{item}}",
      taskInstruction:
        "Stage 1.2: Verify this requirement from an End-User and QA perspective and persist structured findings to /home/hossein/Desktop/projects/building-management/output.",
    } satisfies DynamicFanoutNodeConfig,
  };

  // Workflow State Memory Node 1: Snapshot Stage 1 Discovery + QA Fan-Out Results
  const nMemStage1Audit = createNode("memory", { x: 640, y: 260 }, {
    mode: "write",
    key: "stage1_audit_snapshot",
    writeSource: "node_results",
  });
  nMemStage1Audit.id = "node-mem-stage1-audit";

  // Stage 2: Complexity-Adaptive SpecKit Prompt Architect
  const nPromptArchitect = createNode("agent", { x: 820, y: 260 }, {
    agentId: "agent-velora-prompt-architect",
    sessionMode: "stateless",
    taskInstruction:
      "Stage 2: Read Stage 1 gap and QA reports from /home/hossein/Desktop/projects/building-management/output (and state.memory.stage1_audit_snapshot) and generate complexity-adapted speckit-specify prompt(s).",
  });
  nPromptArchitect.id = "node-stage2-prompt-architect";

  // Workflow State Memory Node 2: Persist Stage 2 SpecKit Prompts for downstream Stage 3 & 4
  const nMemStage2Prompts = createNode("memory", { x: 960, y: 260 }, {
    mode: "write",
    key: "stage2_speckit_prompts",
    writeSource: "last_value",
  });
  nMemStage2Prompts.id = "node-mem-stage2-prompts";

  // Stage 3: Stateful Multi-Turn SpecKit Pipeline (same sessionKey: 'speckit-main') + Supervisor Governance
  const mkSpecKitNode = (id: string, x: number, y: number, instruction: string): WorkflowNode => {
    const node = createNode("agent", { x, y }, {
      agentId: "agent-velora-speckit-executor",
      sessionMode: "shared",
      sessionKey: "speckit-main",
      resumePromptMode: "delta",
      reinvokeOnClarification: true,
      shortTermMemoryMaxTokens: 32768,
      taskInstruction: instruction,
    } as AgentNodeConfig);
    node.id = id;
    return node;
  };

  const nSpecSpecify = mkSpecKitNode(
    "node-speckit-specify",
    1040,
    260,
    "Stage 3.1: Execute speckit-specify for the Stage 2 prompt specification and stop for Supervisor review.",
  );
  const nSpecClarify = mkSpecKitNode(
    "node-speckit-clarify",
    1040,
    40,
    "Stage 3 (Auxiliary): Execute speckit-clarify in the same speckit-main session to resolve specification ambiguities.",
  );
  const nSpecConstitution = mkSpecKitNode(
    "node-speckit-constitution",
    1040,
    480,
    "Stage 3 (Auxiliary): Execute speckit-constitution in the same speckit-main session to align with Velora constitution principles.",
  );

  const nSupAfterSpecify = createNode("agent", { x: 1300, y: 260 }, {
    agentId: "agent-velora-speckit-supervisor",
    sessionMode: "stateless",
    reinvokeOnClarification: true,
    taskInstruction:
      "Review speckit-specify output, answer questions from the knowledge base, and set next='proceed' (or 'clarify' / 'constitution' / 'revise_specify').",
  } as AgentNodeConfig);
  nSupAfterSpecify.id = "node-supervisor-after-specify";

  const nGateAfterSpecify = createNode("condition", { x: 1540, y: 260 }, {
    valueSource: "last_value",
    valueField: "next",
    unknownRoute: "escalate_human",
    branches: [
      { key: "proceed", label: "Approve Specify -> Plan" },
      { key: "revise_specify", label: "Revise Specify" },
      { key: "clarify", label: "Run speckit-clarify" },
      { key: "constitution", label: "Run speckit-constitution" },
      { key: "escalate_human", label: "Escalate to Human" },
    ],
  });
  nGateAfterSpecify.id = "node-gate-after-specify";

  const nSpecPlan = mkSpecKitNode(
    "node-speckit-plan",
    1800,
    260,
    "Stage 3.2: Resume the same speckit-main session and execute speckit-plan, then stop for Supervisor review.",
  );

  const nSupAfterPlan = createNode("agent", { x: 2040, y: 260 }, {
    agentId: "agent-velora-speckit-supervisor",
    sessionMode: "stateless",
    reinvokeOnClarification: true,
    taskInstruction:
      "Review speckit-plan output against Velora architecture, answer questions, and set next='proceed' (or 'revise_plan' / 'clarify'). If blocked by unresolved human decisions, emit status='needs_human'.",
  } as AgentNodeConfig);
  nSupAfterPlan.id = "node-supervisor-after-plan";

  const nGateAfterPlan = createNode("condition", { x: 2280, y: 260 }, {
    valueSource: "last_value",
    valueField: "next",
    unknownRoute: "escalate_human",
    branches: [
      { key: "proceed", label: "Approve Plan -> Tasks" },
      { key: "revise_plan", label: "Revise Plan" },
      { key: "clarify", label: "Back to speckit-clarify" },
      { key: "escalate_human", label: "Escalate to Human" },
    ],
  });
  nGateAfterPlan.id = "node-gate-after-plan";

  const nSpecTasks = mkSpecKitNode(
    "node-speckit-tasks",
    2540,
    260,
    "Stage 3.3: Resume the same speckit-main session and execute speckit-tasks, then stop for Supervisor verification.",
  );
  const nSpecChecklist = mkSpecKitNode(
    "node-speckit-checklist",
    2540,
    40,
    "Stage 3 (Auxiliary): Execute speckit-checklist in the same speckit-main session.",
  );
  const nSpecAnalyze = mkSpecKitNode(
    "node-speckit-analyze",
    2540,
    480,
    "Stage 3 (Auxiliary): Execute speckit-analyze in the same speckit-main session to verify cross-artifact consistency across spec.md, plan.md, and tasks.md.",
  );

  const nSupAfterTasks = createNode("agent", { x: 2800, y: 260 }, {
    agentId: "agent-velora-speckit-supervisor",
    sessionMode: "stateless",
    reinvokeOnClarification: true,
    taskInstruction:
      "Verify speckit-tasks output and set next='proceed' to enter Stage 4 implementation (or 'checklist' / 'analyze' / 'revise_tasks' / 'clarify'). If blocked by unresolved human decisions, emit status='needs_human'.",
  } as AgentNodeConfig);
  nSupAfterTasks.id = "node-supervisor-after-tasks";

  const nGateAfterTasks = createNode("condition", { x: 3040, y: 260 }, {
    valueSource: "last_value",
    valueField: "next",
    unknownRoute: "escalate_human",
    branches: [
      { key: "proceed", label: "Approve Tasks -> Stage 4 Implement" },
      { key: "revise_tasks", label: "Revise Tasks" },
      { key: "checklist", label: "Run speckit-checklist" },
      { key: "analyze", label: "Run speckit-analyze" },
      { key: "clarify", label: "Back to speckit-clarify" },
      { key: "escalate_human", label: "Escalate to Human" },
    ],
  });
  nGateAfterTasks.id = "node-gate-after-tasks";

  // Workflow State Memory Node 3: Persist Approved Stage 3 SpecKit Handoffs (spec/plan/tasks)
  const nMemStage3SpecKit = createNode("memory", { x: 3180, y: 260 }, {
    mode: "write",
    key: "stage3_approved_speckit",
    writeSource: "handoffs",
  });
  nMemStage3SpecKit.id = "node-mem-stage3-speckit";

  // Stage 4: Orchestrated Implementation & Convergence
  const nStage4Orchestrator = createNode("agent", { x: 3400, y: 260 }, {
    agentId: "agent-velora-orchestrator",
    sessionMode: "node",
    reinvokeOnClarification: true,
    taskInstruction:
      "Stage 4.1: Partition tasks.md into execution phases (using state.memory.stage3_approved_speckit) and dispatch the SpecKit Implementer. If plan.md or tasks.md are missing, emit status='needs_human'.",
  } as AgentNodeConfig);
  nStage4Orchestrator.id = "node-stage4-orchestrator";

  const nSpecImplement = createNode("agent", { x: 3540, y: 260 }, {
    agentId: "agent-velora-speckit-implementer",
    sessionMode: "node",
    mutatesCode: true,
    reinvokeOnClarification: true,
    taskInstruction:
      "Stage 4.2: Execute speckit-implement for the current execution phase. If prerequisites (plan.md/tasks.md) are missing or human decisions are required, emit status='needs_human'.",
  } as AgentNodeConfig);
  nSpecImplement.id = "node-speckit-implement";

  const nSpecConverge = createNode("agent", { x: 3780, y: 260 }, {
    agentId: "agent-velora-orchestrator",
    sessionMode: "node",
    reinvokeOnClarification: true,
    taskInstruction:
      "Stage 4.3: Run speckit-converge assessment against spec.md, plan.md, and tasks.md; emit verdict='converged' when complete, 'continue_implement' if tasks remain, or status='needs_human' if blocked on missing plan/tasks or human decisions.",
  } as AgentNodeConfig);
  nSpecConverge.id = "node-speckit-converge";

  const nGateConverge = createNode("condition", { x: 4020, y: 260 }, {
    valueSource: "last_value",
    valueField: "verdict",
    unknownRoute: "escalate_human",
    branches: [
      { key: "converged", label: "Converged -> Stage 5 End-User QA" },
      { key: "continue_implement", label: "Continue Implementation Phase" },
      { key: "escalate_human", label: "Blocked / Escalate to Human" },
    ],
  });
  nGateConverge.id = "node-gate-converge";

  // Stage 5 & 6: Post-Implementation End-User QA & Direct Defect Fixer Loop (Bypassing SpecKit)
  const nPostImplQa = createNode("agent", { x: 4280, y: 260 }, {
    agentId: "agent-velora-per-req-qa",
    sessionMode: "node",
    taskInstruction:
      "Stage 5: Test the live Velora software as an end-user to verify all requirements are implemented; emit qaStatus='qa_passed' or 'qa_failed' with defect details.",
  });
  nPostImplQa.id = "node-stage5-post-qa";

  const nGatePostQa = createNode("condition", { x: 4520, y: 260 }, {
    valueSource: "last_value",
    valueField: "qaStatus",
    unknownRoute: "escalate_human",
    branches: [
      { key: "qa_passed", label: "QA Passed -> Stage 8 Semantic Sync" },
      { key: "qa_failed", label: "Defects Found -> Stage 6 Direct Fixer" },
      { key: "escalate_human", label: "QA Loop Exhausted -> Human Review" },
    ],
  });
  nGatePostQa.id = "node-gate-post-qa";

  const nPostQaFixer = createNode("agent", { x: 4520, y: 480 }, {
    agentId: "agent-velora-post-qa-fixer",
    sessionMode: "node",
    mutatesCode: true,
    taskInstruction:
      "Stage 6: Directly resolve all remaining defects reported by Stage 5 End-User QA without re-running SpecKit, then return to Stage 5 QA.",
  });
  nPostQaFixer.id = "node-stage6-defect-fixer";

  const escalations = [
    { router: nGateAfterSpecify, review: nSupAfterSpecify, stage: "specification" },
    { router: nGateAfterPlan, review: nSupAfterPlan, stage: "planning" },
    { router: nGateAfterTasks, review: nSupAfterTasks, stage: "task verification" },
    { router: nGateConverge, review: nSpecConverge, stage: "implementation convergence" },
    { router: nGatePostQa, review: nPostImplQa, stage: "post-implementation QA" },
  ].map(({ router, review, stage }) => {
    const approval = createNode("approval", { x: router.position.x, y: 720 }, {
      message: `Human review required during ${stage}. Review the latest stage output and record a decision. Approval returns this run to ${stage} for re-evaluation.`,
      approvalType: "manual",
      timeoutSeconds: 0,
      requireFreshApproval: true,
    });
    approval.id = router.id.replace("node-gate-", "node-human-escalation-");
    const config = review.config as AgentNodeConfig;
    config.inputMode = "last_value";
    config.taskInstruction += " When returning from human escalation, apply the recorded reviewer notes to the previous stage findings and re-evaluate the blocker. Follow the normal routing criteria.";
    return { router, review, approval };
  });

  // Workflow State Memory Node 4: Persist Complete Delivery Run Report before Stage 8 Knowledge Sync
  const nMemFinalReport = createNode("memory", { x: 4680, y: 260 }, {
    mode: "write",
    key: "velora_delivery_run_report",
    writeSource: "run_report",
  });
  nMemFinalReport.id = "node-mem-final-report";

  // Stage 8: Post-Cycle Semantic Graphify & Knowledge Embedding Refresh
  const nStage8KnowledgeSync = createNode("agent", { x: 4920, y: 260 }, {
    agentId: "agent-velora-knowledge-updater",
    sessionMode: "stateless",
    taskInstruction:
      "Stage 8: Update Velora graphify semantically and run `python3 scripts/knowledge/cli.py index --semantic` after verifying no active embedding job PID is running.",
  });
  nStage8KnowledgeSync.id = "node-stage8-knowledge-sync";

  const nOutput = createNode("output", { x: 5180, y: 260 }, {
    outputKey: "output",
    description: "Completed Velora delivery phase summary, QA verification reports, and semantic index status",
    inputMode: "last_value",
  });
  nOutput.id = "node-output";

  return {
    ...createEmptyDefinition("Velora Autonomous 8-Stage Delivery Pipeline"),
    id: "wf-agentic-velora-master",
    tenantId: AGENTIC_VELORA_ORG_ID,
    episodicMemoryScope: "organization",
    updatedAt: stamp,
    archetype: "hierarchical-supervisor",
    archetypeConfig: createHierarchicalSupervisorConfig("node-stage4-orchestrator", {
      humanApprovalGateRequired: false,
      maxExecutionSteps: 120,
      recursionGuards: [
        createRecursionGuard("node-gate-after-specify->revise_specify", "escalate_human", 3),
        createRecursionGuard("node-gate-after-specify->clarify", "escalate_human", 2),
        createRecursionGuard("node-gate-after-specify->constitution", "escalate_human", 2),
        createRecursionGuard("node-gate-after-plan->revise_plan", "escalate_human", 3),
        createRecursionGuard("node-gate-after-plan->clarify", "escalate_human", 2),
        createRecursionGuard("node-gate-after-tasks->revise_tasks", "escalate_human", 3),
        createRecursionGuard("node-gate-after-tasks->checklist", "escalate_human", 2),
        createRecursionGuard("node-gate-after-tasks->analyze", "escalate_human", 2),
        createRecursionGuard("node-gate-after-tasks->clarify", "escalate_human", 2),
        createRecursionGuard("node-gate-converge->continue_implement", "escalate_human", 5),
        createRecursionGuard("node-gate-post-qa->qa_failed", "escalate_human", 4),
      ],
    }),
    nodes: [
      nInput,
      nDiscovery,
      nQaFanout,
      nMemStage1Audit,
      nPromptArchitect,
      nMemStage2Prompts,
      nSpecSpecify,
      nSpecClarify,
      nSpecConstitution,
      nSupAfterSpecify,
      nGateAfterSpecify,
      nSpecPlan,
      nSupAfterPlan,
      nGateAfterPlan,
      nSpecTasks,
      nSpecChecklist,
      nSpecAnalyze,
      nSupAfterTasks,
      nGateAfterTasks,
      nMemStage3SpecKit,
      nStage4Orchestrator,
      nSpecImplement,
      nSpecConverge,
      nGateConverge,
      nPostImplQa,
      nGatePostQa,
      nPostQaFixer,
      ...escalations.map(({ approval }) => approval),
      nMemFinalReport,
      nStage8KnowledgeSync,
      nOutput,
    ],
    edges: [
      createEdge({ source: nInput.id, target: nDiscovery.id }),
      createEdge({ source: nDiscovery.id, target: nQaFanout.id }),
      createEdge({ source: nQaFanout.id, target: nMemStage1Audit.id }),
      createEdge({ source: nMemStage1Audit.id, target: nPromptArchitect.id }),
      createEdge({ source: nPromptArchitect.id, target: nMemStage2Prompts.id }),
      createEdge({ source: nMemStage2Prompts.id, target: nSpecSpecify.id }),

      // Stage 3.1: specify + supervisor + auxiliary clarify/constitution
      createEdge({ source: nSpecSpecify.id, target: nSupAfterSpecify.id }),
      createEdge({ source: nSupAfterSpecify.id, target: nGateAfterSpecify.id }),
      createEdge({
        source: nGateAfterSpecify.id,
        target: nSpecPlan.id,
        kind: "conditional",
        branchKey: "proceed",
        label: "proceed",
      }),
      createEdge({
        source: nGateAfterSpecify.id,
        target: nSpecSpecify.id,
        kind: "conditional",
        branchKey: "revise_specify",
        label: "revise_specify",
      }),
      createEdge({
        source: nGateAfterSpecify.id,
        target: nSpecClarify.id,
        kind: "conditional",
        branchKey: "clarify",
        label: "clarify",
      }),
      createEdge({ source: nSpecClarify.id, target: nSupAfterSpecify.id }),
      createEdge({
        source: nGateAfterSpecify.id,
        target: nSpecConstitution.id,
        kind: "conditional",
        branchKey: "constitution",
        label: "constitution",
      }),
      createEdge({ source: nSpecConstitution.id, target: nSupAfterSpecify.id }),

      // Stage 3.2: plan + supervisor
      createEdge({ source: nSpecPlan.id, target: nSupAfterPlan.id }),
      createEdge({ source: nSupAfterPlan.id, target: nGateAfterPlan.id }),
      createEdge({
        source: nGateAfterPlan.id,
        target: nSpecTasks.id,
        kind: "conditional",
        branchKey: "proceed",
        label: "proceed",
      }),
      createEdge({
        source: nGateAfterPlan.id,
        target: nSpecPlan.id,
        kind: "conditional",
        branchKey: "revise_plan",
        label: "revise_plan",
      }),
      createEdge({
        source: nGateAfterPlan.id,
        target: nSpecClarify.id,
        kind: "conditional",
        branchKey: "clarify",
        label: "clarify",
      }),

      // Stage 3.3: tasks + supervisor + auxiliary checklist/analyze
      createEdge({ source: nSpecTasks.id, target: nSupAfterTasks.id }),
      createEdge({ source: nSupAfterTasks.id, target: nGateAfterTasks.id }),
      createEdge({
        source: nGateAfterTasks.id,
        target: nMemStage3SpecKit.id,
        kind: "conditional",
        branchKey: "proceed",
        label: "proceed",
      }),
      createEdge({ source: nMemStage3SpecKit.id, target: nStage4Orchestrator.id }),
      createEdge({
        source: nGateAfterTasks.id,
        target: nSpecTasks.id,
        kind: "conditional",
        branchKey: "revise_tasks",
        label: "revise_tasks",
      }),
      createEdge({
        source: nGateAfterTasks.id,
        target: nSpecChecklist.id,
        kind: "conditional",
        branchKey: "checklist",
        label: "checklist",
      }),
      createEdge({ source: nSpecChecklist.id, target: nSupAfterTasks.id }),
      createEdge({
        source: nGateAfterTasks.id,
        target: nSpecAnalyze.id,
        kind: "conditional",
        branchKey: "analyze",
        label: "analyze",
      }),
      createEdge({ source: nSpecAnalyze.id, target: nSupAfterTasks.id }),
      createEdge({
        source: nGateAfterTasks.id,
        target: nSpecClarify.id,
        kind: "conditional",
        branchKey: "clarify",
        label: "clarify",
      }),

      // Stage 4: Orchestrator -> Implementer -> Converge loop
      createEdge({ source: nStage4Orchestrator.id, target: nSpecImplement.id }),
      createEdge({ source: nSpecImplement.id, target: nSpecConverge.id }),
      createEdge({ source: nSpecConverge.id, target: nGateConverge.id }),
      createEdge({
        source: nGateConverge.id,
        target: nSpecImplement.id,
        kind: "conditional",
        branchKey: "continue_implement",
        label: "continue_implement",
      }),
      createEdge({
        source: nGateConverge.id,
        target: nPostImplQa.id,
        kind: "conditional",
        branchKey: "converged",
        label: "converged",
      }),

      // Stage 5 & 6: Post-Implementation QA <-> Direct Fixer Loop
      createEdge({ source: nPostImplQa.id, target: nGatePostQa.id }),
      createEdge({
        source: nGatePostQa.id,
        target: nPostQaFixer.id,
        kind: "conditional",
        branchKey: "qa_failed",
        label: "qa_failed",
      }),
      createEdge({ source: nPostQaFixer.id, target: nPostImplQa.id }),
      createEdge({
        source: nGatePostQa.id,
        target: nMemFinalReport.id,
        kind: "conditional",
        branchKey: "qa_passed",
        label: "qa_passed",
      }),
      ...escalations.flatMap(({ router, approval, review }) => [
        createEdge({ source: router.id, target: approval.id, kind: "conditional", branchKey: "escalate_human", label: "escalate_human" }),
        createEdge({ source: approval.id, target: review.id, kind: "conditional", branchKey: "approved", label: "approved" }),
        createEdge({ source: approval.id, target: nOutput.id, kind: "conditional", branchKey: "rejected", label: "rejected" }),
      ]),
      createEdge({ source: nMemFinalReport.id, target: nStage8KnowledgeSync.id }),

      // Stage 8 -> Output
      createEdge({ source: nStage8KnowledgeSync.id, target: nOutput.id }),
    ],
  };
}

/** Schedule the generated A.1 prompts sequentially through the existing package lifecycle. */
export function withVeloraA1WorkPackageSequence(workflow: WorkflowDefinition): WorkflowDefinition {
  const sequence = createNode("condition", { x: 790, y: 80 }, {
    branches: [
      { key: "next_package", label: "Start next work package" },
      { key: "packages_complete", label: "Selected work packages complete" },
    ],
    workPackages: A1_WORK_PACKAGES,
  });
  sequence.id = "node-a1-work-package-sequence";
  if (workflow.nodes.some((node) => node.id === sequence.id)) return workflow;
  const nodes = workflow.nodes.map((node) => {
    if (node.id === "node-speckit-specify") {
      const config = node.config as AgentNodeConfig;
      return { ...node, config: {
        ...config,
        stepPrompt: "Read the exact generated prompt for the current work package from the path supplied by the workflow. Run speckit-specify for that package and stop at the Supervisor review. Use existing feature artifacts for that package if present. Verify the previous package's contract and handoff before treating a dependency as satisfied.",
        taskInstruction: "Execute speckit-specify for the current work package and hand off its actual feature paths for review. On retry, check whether that package already has a spec.md and quality checklist. If they satisfy the source prompt, reuse them and return a concise handoff with the paths instead of creating another feature.",
      } };
    }
    if (node.id === "node-stage8-knowledge-sync") {
      const config = node.config as AgentNodeConfig;
      return { ...node, config: {
        ...config,
        taskInstruction: `${config.taskInstruction ?? ""} Once the current package's QA and knowledge sync have completed, return a final fenced JSON object containing status="completed", workPackage set to the current package ID, and references to the completed feature artifacts and verification evidence. Report blockers explicitly and do not emit a completion receipt if verification or sync is incomplete.`,
      } };
    }
    return node;
  });
  const entryId = nodes.some((node) => node.id === "node-mem-stage2-prompts") ? "node-mem-stage2-prompts" : "node-input";
  return {
    ...workflow,
    updatedAt: nowIso(),
    nodes: [...nodes, sequence],
    edges: [
      ...workflow.edges.map((edge) =>
        (edge.source === entryId && edge.target === "node-speckit-specify") ||
        (edge.source === "node-stage8-knowledge-sync" && edge.target === "node-output")
          ? { ...edge, target: sequence.id }
          : edge),
      createEdge({ source: sequence.id, target: "node-speckit-specify", kind: "conditional", branchKey: "next_package" }),
      createEdge({ source: sequence.id, target: "node-output", kind: "conditional", branchKey: "packages_complete" }),
    ],
  };
}

export function createAgenticVeloraStage2To8Workflow(): WorkflowDefinition {
  const master = createAgenticVeloraMasterWorkflow();
  const stage1NodeIds = new Set(["node-stage1-discovery", "node-stage1-qa-fanout", "node-mem-stage1-audit"]);

  const nodes = master.nodes
    .filter((n) => !stage1NodeIds.has(n.id))
    .map((n) => {
      if (n.id === "node-stage2-prompt-architect") {
        const cfg = n.config as AgentNodeConfig;
        return {
          ...n,
          config: {
            ...cfg,
            stepPrompt: [
              "Stage 1 audit for Phase A.1 is already complete at /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18.",
              "Read README.md, remaining-work.md (packages B01..B06), scope-decisions.md (C01..C08), requirements-and-delivery.md, atomic-coverage.md (42 atomic stories), and employer-summary.md.",
              "Generate dependency-ordered speckit-specify prompts for B01 through B06 with a 100% requirement coverage matrix, save them under /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18/speckit-prompts/, and pass the ordered prompt specification to Stage 3 (speckit-specify).",
            ].join("\n"),
          },
        };
      }
      return n;
    });

  const edges = [
    createEdge({ source: "node-input", target: "node-stage2-prompt-architect" }),
    ...master.edges.filter(
      (e) =>
        !stage1NodeIds.has(e.source) &&
        !stage1NodeIds.has(e.target) &&
        !(e.source === "node-input" && e.target === "node-stage1-discovery"),
    ),
  ];

  return withVeloraA1WorkPackageSequence({
    ...master,
    id: "wf-agentic-velora-a1-stage2-to-8",
    name: "Velora A.1 Delivery — Generate and Execute B01–B06 in Order",
    nodes,
    edges,
  });
}

export function createAgenticVeloraStage3To8Workflow(): WorkflowDefinition {
  const master = createAgenticVeloraMasterWorkflow();
  const skippedNodeIds = new Set([
    "node-stage1-discovery",
    "node-stage1-qa-fanout",
    "node-mem-stage1-audit",
    "node-stage2-prompt-architect",
    "node-mem-stage2-prompts",
  ]);

  const nodes = master.nodes
    .filter((n) => !skippedNodeIds.has(n.id))
    .map((n) => {
      if (n.id === "node-speckit-specify") {
        const cfg = n.config as AgentNodeConfig;
        return {
          ...n,
          config: {
            ...cfg,
            stepPrompt: [
              "Stages 1 and 2 for Phase A.1 are ALREADY COMPLETE.",
              "Read the generated ordered SpecKit prompts from /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18/speckit-prompts/ (README.md, 01-b01-data-contract.md through 06-b06-delivery-acceptance.md, and coverage.json).",
              "Start with the requested work package (or B01 first if not specified in Run input), execute `speckit-specify` in this shared `speckit-main` session, and stop for Supervisor review.",
            ].join("\n"),
          },
        };
      }
      return n;
    });

  const edges = [
    createEdge({ source: "node-input", target: "node-speckit-specify" }),
    ...master.edges.filter(
      (e) =>
        !skippedNodeIds.has(e.source) &&
        !skippedNodeIds.has(e.target) &&
        !(e.source === "node-input" && e.target === "node-stage1-discovery"),
    ),
  ];

  return withVeloraA1WorkPackageSequence({
    ...master,
    id: "wf-agentic-velora-a1-stage3-to-8",
    name: "Velora A.1 Delivery — Execute Generated Prompts in Order",
    nodes,
    edges,
  });
}

export function createAgenticVeloraStage2OnlyWorkflow(): WorkflowDefinition {
  const base = createEmptyDefinition();
  const stamp = nowIso();

  const nInput = createNode("input", { x: 80, y: 220 }, {
    inputKey: "input",
    description:
      "Path or instructions for Stage 1 audit directory (default: /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18)",
  });
  nInput.id = "node-input";

  const nPromptArchitect = createNode("agent", { x: 380, y: 220 }, {
    agentId: "agent-velora-prompt-architect",
    sessionMode: "stateless",
    stepPrompt: [
      "Read the completed Phase A.1 audit at /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18:",
      "- README.md",
      "- remaining-work.md (work packages B01, B02, B03, B04, B05, B06)",
      "- scope-decisions.md (decisions C01..C08)",
      "- requirements-and-delivery.md & atomic-coverage.md (42 atomic stories)",
      "- employer-summary.md",
      "Generate a dependency-ordered sequence of speckit-specify prompts covering B01 through B06 (`granularity: 'multi'`) along with coverage.json, and write them to /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18/speckit-prompts/.",
    ].join("\n"),
    taskInstruction:
      "Stage 2 Only: Generate speckit-specify prompts for Phase A.1 (B01–B06) from /home/hossein/Desktop/projects/building-management/output/a1-requirements-2026-11-18.",
  } as AgentNodeConfig);
  nPromptArchitect.id = "node-stage2-prompt-architect";

  const nOutput = createNode("output", { x: 680, y: 220 }, {
    outputKey: "output",
    description: "Generated A.1 SpecKit prompts (B01–B06) and requirement coverage matrix",
  });
  nOutput.id = "node-output";

  return {
    ...base,
    id: "wf-agentic-velora-a1-stage2-prompts",
    name: "Velora A.1 Stage 2 Only — Generate SpecKit Prompts (B01–B06)",
    tenantId: AGENTIC_VELORA_ORG_ID,
    episodicMemoryScope: "organization",
    updatedAt: stamp,
    nodes: [nInput, nPromptArchitect, nOutput],
    edges: [
      createEdge({ source: nInput.id, target: nPromptArchitect.id }),
      createEdge({ source: nPromptArchitect.id, target: nOutput.id }),
    ],
  };
}

export interface AgenticVeloraOrgPackage {
  organizationId: string;
  organizationSlug: string;
  projectRoot: string;
  outputDir: string;
  agents: AgentRecord[];
  tools: ToolRecord[];
  workflows: WorkflowDefinition[];
}

export function buildAgenticVeloraPackage(): AgenticVeloraOrgPackage {
  return {
    organizationId: AGENTIC_VELORA_ORG_ID,
    organizationSlug: AGENTIC_VELORA_ORG_SLUG,
    projectRoot: VELORA_PROJECT_ROOT,
    outputDir: VELORA_OUTPUT_DIR,
    agents: createAgenticVeloraAgents(),
    tools: createAgenticVeloraTools(),
    workflows: [
      createAgenticVeloraMasterWorkflow(),
      createAgenticVeloraStage2To8Workflow(),
      createAgenticVeloraStage3To8Workflow(),
      createAgenticVeloraStage2OnlyWorkflow(),
    ],
  };
}

export const createAgenticVeloraOrgPackage = buildAgenticVeloraPackage;
export const getAgenticVeloraSeed = buildAgenticVeloraPackage;

export async function seedAgenticVeloraOrganization(options?: {
  connectionString?: string;
}): Promise<{
  organizationId: string;
  agentsCount: number;
  toolsCount: number;
  workflowsCount: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg") as typeof import("pg");
  const connectionString =
    options?.connectionString ??
    process.env.MEMORY_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory";

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const pkg = buildAgenticVeloraPackage();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [AGENTIC_VELORA_ORG_ID]);
    await client.query("SELECT set_config('app.principal_kind', 'user', false)");

    const ownerRes = await client.query<{ user_id: string }>(
      `SELECT user_id FROM studio_organization_memberships
       WHERE organization_id = $1 AND status = 'active'
       ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      [AGENTIC_VELORA_ORG_ID],
    );
    const ownerId = ownerRes.rows[0]?.user_id ?? "385da9f5-52d9-4f26-bb09-fc125283cf94";

    // Remove empty unconfigured draft placeholders from agentic-velora
    const seededAgentIds = pkg.agents.map((a) => a.id);
    const seededWorkflowIds = pkg.workflows.map((w) => w.id);
    await client.query(
      `DELETE FROM studio_agents WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`,
      [AGENTIC_VELORA_ORG_ID, seededAgentIds],
    );
    await client.query(
      `DELETE FROM studio_workflows WHERE tenant_id = $1 AND NOT (id = ANY($2::text[]))`,
      [AGENTIC_VELORA_ORG_ID, seededWorkflowIds],
    );

    for (const tool of pkg.tools) {
      const record = { ...tool, ownerId, tenantId: AGENTIC_VELORA_ORG_ID };
      await client.query(
        `INSERT INTO studio_tools (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, false, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           name = EXCLUDED.name,
           record = EXCLUDED.record,
           owner_id = EXCLUDED.owner_id,
           updated_at = now()`,
        [tool.id, AGENTIC_VELORA_ORG_ID, tool.name, JSON.stringify(record), ownerId],
      );
    }

    for (const agent of pkg.agents) {
      const record = { ...agent, ownerId, tenantId: AGENTIC_VELORA_ORG_ID };
      await client.query(
        `INSERT INTO studio_agents (id, tenant_id, name, record, owner_id, is_system, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, false, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           name = EXCLUDED.name,
           record = EXCLUDED.record,
           owner_id = EXCLUDED.owner_id,
           updated_at = now()`,
        [agent.id, AGENTIC_VELORA_ORG_ID, agent.name, JSON.stringify(record), ownerId],
      );
    }

    for (const wf of pkg.workflows) {
      const definition = { ...wf, ownerId, tenantId: AGENTIC_VELORA_ORG_ID };
      await client.query(
        `INSERT INTO studio_workflows (id, tenant_id, name, definition, owner_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           name = EXCLUDED.name,
           definition = EXCLUDED.definition,
           owner_id = EXCLUDED.owner_id,
           updated_at = now()`,
        [wf.id, AGENTIC_VELORA_ORG_ID, wf.name, JSON.stringify(definition), ownerId],
      );
    }

    await client.query("COMMIT");
    return {
      organizationId: AGENTIC_VELORA_ORG_ID,
      agentsCount: pkg.agents.length,
      toolsCount: pkg.tools.length,
      workflowsCount: pkg.workflows.length,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

