import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAgentRecord,
  createToolRecord,
  nowIso,
  type AgentRecord,
  type AgentSessionState,
  type ToolRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import type { RunStoreContract } from "../../apps/server/src/runtime/runStore";
import type { AgentRuntime } from "../../src/agents/runtime/agentRuntime";
import type { AgentExecutionEvent, AgentExecutionInput } from "../../src/agents/runtime/types";
import type { WorkerLaunchSecrets } from "../../src/agents/runtime/workerCredentials";
import type { WorkerHandle, WorkerResult, WorkerRuntime, WorkerSpec } from "../../src/agents/runtime/workerRuntime";
import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
} from "../../src/auth/internalPrincipal";

export const VELORA_TARGET_REPO_ROOT = "/home/hossein/Desktop/projects/building-management";
export const AGENTIC_VELORA_ORG_ID = "4cc4a715-3ac8-42d4-84ad-83bbdc45f03a";
export const TEST_AUTH_SECRET = "velora-e2e-internal-principal-secret-32b";

export const PRINCIPAL_ALPHA: AuthenticatedPrincipal = {
  userId: "velora-alpha-user",
  tenantId: "tenant-agentic-velora",
};

export const PRINCIPAL_BETA: AuthenticatedPrincipal = {
  userId: "velora-beta-user",
  tenantId: "tenant-foreign-org",
};

export const REQUIRED_VELORA_AGENT_ROLES = [
  "Orchestrator",
  "Discovery & Knowledge Analyst",
  "Per-Requirement End-User QA Agent",
  "Complexity-Adaptive SpecKit Prompt Architect",
  "Stateful SpecKit Executor",
  "SpecKit Supervisor/Reviewer",
  "SpecKit Implementer",
  "Post-QA Defect Fixer",
  "Semantic Knowledge & Graphify Updater",
] as const;

export interface VeloraGitSnapshot {
  head: string;
  statusPorcelain: string;
}

export function snapshotVeloraGitState(repoRoot = VELORA_TARGET_REPO_ROOT): VeloraGitSnapshot {
  const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const statusPorcelain = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" });
  return { head, statusPorcelain };
}

export function assertVeloraGitStateUnchanged(before: VeloraGitSnapshot, repoRoot = VELORA_TARGET_REPO_ROOT): void {
  const after = snapshotVeloraGitState(repoRoot);
  expect(after.head).toBe(before.head);
  expect(after.statusPorcelain).toBe(before.statusPorcelain);
}

export function authHeaders(principal?: AuthenticatedPrincipal, secret = TEST_AUTH_SECRET): HeadersInit {
  if (!principal) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    "X-Multi-Agent-Principal": createInternalPrincipalAssertion(principal, secret),
  };
}

export function resolveTestPrincipal(secret = TEST_AUTH_SECRET) {
  return (request: Request): AuthenticatedPrincipal | null => {
    const token = request.headers.get("X-Multi-Agent-Principal");
    if (!token) return null;
    try {
      return verifyInternalPrincipalAssertion(token, secret);
    } catch {
      return null;
    }
  };
}

export async function readJsonResponse<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function waitForCondition(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function assertRunCompletedOrDump(
  runStore: RunStoreContract,
  runId: string,
  expectedStatuses: ReadonlyArray<string> = ["completed"],
  timeoutMs = 15_000,
) {
  const terminalOrWait = new Set([...expectedStatuses, "completed", "failed", "cancelled", "waiting_for_human"]);
  await waitForCondition(() => {
    const status = runStore.get(runId)?.run.status;
    return Boolean(status && terminalOrWait.has(status));
  }, timeoutMs);

  const record = runStore.get(runId);
  if (!record || !expectedStatuses.includes(record.run.status)) {
    const events = runStore.events(runId).map((e) => ({
      seq: e.sequence,
      type: e.type,
      nodeId: e.nodeId,
      agentId: e.agentId,
      payload: e.payload,
    }));
    throw new Error(
      `Unexpected run state for ${runId}: status=${record?.run.status ?? "missing"}, error=${record?.run.error ?? "none"}\nEvents:\n${JSON.stringify(events, null, 2)}`,
    );
  }
  return record;
}

export interface IsolatedVeloraMirror {
  root: string;
  outputDir: string;
  knowledgeDir: string;
  progressFile: string;
  specifyDir: string;
  featureDir: string;
  cleanup: () => void;
}

export function createIsolatedVeloraMirror(options: {
  featureDir?: string;
  specExists?: boolean;
  planExists?: boolean;
  tasksContent?: string;
  progressJson?: Record<string, unknown> | string;
} = {}): IsolatedVeloraMirror {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "velora-e2e-"));
  const outputDir = path.join(root, "output");
  const knowledgeDir = path.join(root, ".knowledge");
  const specifyDir = path.join(root, ".specify");
  const featureRel = options.featureDir ?? "specs/057-a1-phase";
  const featureDir = path.join(root, featureRel);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.mkdirSync(specifyDir, { recursive: true });
  fs.mkdirSync(featureDir, { recursive: true });
  fs.mkdirSync(path.join(root, "graphify-out"), { recursive: true });
  fs.mkdirSync(path.join(root, "apps", "web", "src", "app", "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts", "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(outputDir, "delivery-plan-2026-11-03"), { recursive: true });

  fs.writeFileSync(
    path.join(specifyDir, "feature.json"),
    JSON.stringify({ feature_directory: featureRel }, null, 2),
    "utf8",
  );

  if (options.specExists !== false) {
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Feature A.1 Specification\n\n- A.1.01 Resident Portal\n", "utf8");
  }
  if (options.planExists !== false) {
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Implementation Plan\n\n## Phase 1: Backend\n## Phase 2: Frontend\n", "utf8");
  }
  if (options.tasksContent !== undefined) {
    fs.writeFileSync(path.join(featureDir, "tasks.md"), options.tasksContent, "utf8");
  }

  fs.writeFileSync(
    path.join(root, "apps", "web", "src", "app", "data", "delivery-plan.ts"),
    [
      "export const deliveryPhases = [",
      '  { wbs: "R.0", title: "Foundation", status: "implemented" },',
      '  { wbs: "A.6", title: "Financial Core", status: "implemented" },',
      '  { wbs: "A.7", title: "Delivery Acceptance", status: "implemented" },',
      '  { wbs: "A.1", title: "Core Operations", status: "remaining", items: ["A.1.01", "A.1.02", "A.1.03", "A.1.04"] },',
      "];",
    ].join("\n"),
    "utf8",
  );

  fs.writeFileSync(
    path.join(outputDir, "delivery-plan-2026-11-03", "schedule.json"),
    JSON.stringify(
      {
        version: 1,
        phases: [
          { wbs: "R.0", name: "Foundation", likely: 40 },
          { wbs: "A.6", name: "Financial Core", likely: 60 },
          { wbs: "A.7", name: "Delivery Acceptance", likely: 50 },
          {
            wbs: "A.1",
            name: "Core Operations",
            likely: 48,
            subtasks: [
              { id: "A.1.01", title: "Resident Onboarding" },
              { id: "A.1.02", title: "Unit Directory" },
              { id: "A.1.03", title: "Role Access Control" },
              { id: "A.1.04", title: "Audit Log Stream" },
            ],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const progressFile = path.join(knowledgeDir, "index.progress.json");
  if (options.progressJson !== undefined) {
    fs.writeFileSync(
      progressFile,
      typeof options.progressJson === "string"
        ? options.progressJson
        : JSON.stringify(options.progressJson, null, 2),
      "utf8",
    );
  }

  return {
    root,
    outputDir,
    knowledgeDir,
    progressFile,
    specifyDir,
    featureDir,
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function cursorStreamJsonFixture(opts: {
  sessionId: string;
  thinking?: string;
  assistantText?: string;
  resultText: string;
}): string {
  const lines: string[] = [JSON.stringify({ type: "system", session_id: opts.sessionId })];
  if (opts.thinking) {
    lines.push(JSON.stringify({ type: "thinking", subtype: "delta", text: opts.thinking }));
  }
  if (opts.assistantText) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: opts.assistantText }] },
      }),
    );
  }
  lines.push(JSON.stringify({ type: "result", session_id: opts.sessionId, result: opts.resultText }));
  return lines.join("\n");
}

export function codexJsonlFixture(opts: {
  threadId: string;
  reasoning?: string;
  message: string;
}): string {
  const lines: string[] = [JSON.stringify({ type: "thread.started", thread_id: opts.threadId })];
  if (opts.reasoning) {
    lines.push(JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: opts.reasoning } }));
  }
  lines.push(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: opts.message } }));
  return lines.join("\n");
}

export function agyStreamJsonFixture(opts: {
  conversationId: string;
  thinking?: string;
  response: string;
}): string {
  const lines: string[] = [];
  if (opts.thinking) {
    lines.push(JSON.stringify({ event: "thinking", conversation_id: opts.conversationId, thinking: opts.thinking }));
  }
  lines.push(
    JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: opts.response,
        conversation_id: opts.conversationId,
      },
    }),
  );
  return lines.join("\n");
}

export interface RecordedWorkerCall {
  workerId: string;
  spec: WorkerSpec;
  input?: string;
  launchSecrets?: WorkerLaunchSecrets;
  aborted: boolean;
}

export interface MockWorkerTurnResponse {
  code?: number;
  stdout?: string;
  stderr?: string;
  reason?: WorkerResult["reason"];
  error?: string;
  streamChunks?: Array<{ stream: "stdout" | "stderr"; data: string }>;
}

export function createRecordingWorkerRuntime(
  respond: (call: RecordedWorkerCall, callIndex: number) => MockWorkerTurnResponse | Promise<MockWorkerTurnResponse>,
): WorkerRuntime & { calls: RecordedWorkerCall[]; cleanedUp: string[] } {
  const calls: RecordedWorkerCall[] = [];
  const cleanedUp: string[] = [];
  const results = new Map<string, MockWorkerTurnResponse>();

  return {
    calls,
    cleanedUp,
    async start(spec: WorkerSpec, signal?: AbortSignal, input?: string, launchSecrets?: WorkerLaunchSecrets): Promise<WorkerHandle> {
      const workerId = `mock-worker-${calls.length + 1}`;
      const call: RecordedWorkerCall = {
        workerId,
        spec,
        input,
        launchSecrets,
        aborted: Boolean(signal?.aborted),
      };
      if (signal) {
        signal.addEventListener("abort", () => {
          call.aborted = true;
        });
      }
      const idx = calls.length;
      calls.push(call);
      const response = await respond(call, idx);
      results.set(workerId, response);
      return { workerId, runId: spec.runId };
    },
    async *stream(workerId: string) {
      const res = results.get(workerId);
      if (res?.streamChunks) {
        for (const chunk of res.streamChunks) {
          yield { type: chunk.stream, data: chunk.data, timestamp: nowIso() };
        }
      } else if (res?.stdout) {
        for (const line of res.stdout.split("\n")) {
          if (line) yield { type: "stdout" as const, data: `${line}\n`, timestamp: nowIso() };
        }
      }
    },
    async wait(workerId: string): Promise<WorkerResult> {
      const res = results.get(workerId);
      const call = calls.find((c) => c.workerId === workerId);
      if (call?.aborted) {
        return { code: null, stdout: res?.stdout ?? "", stderr: res?.stderr ?? "", reason: "cancelled" };
      }
      return {
        code: res?.code ?? 0,
        stdout: res?.stdout ?? "",
        stderr: res?.stderr ?? "",
        reason: res?.reason ?? "completed",
        error: res?.error,
      };
    },
    async cancel(workerId: string) {
      const call = calls.find((c) => c.workerId === workerId);
      if (call) call.aborted = true;
    },
    async cleanup(workerId: string) {
      cleanedUp.push(workerId);
    },
  };
}

export interface ScriptableRuntimeController {
  runtime: Pick<AgentRuntime, "execute">;
  calls: AgentExecutionInput[];
  getPeakConcurrency: () => number;
  getCurrentConcurrency: () => number;
}

export function createScriptableAgentRuntime(
  handler: (input: AgentExecutionInput, helpers: { callIndex: number; sessionId?: string; turnCount: number }) => Promise<unknown> | unknown,
): ScriptableRuntimeController {
  const calls: AgentExecutionInput[] = [];
  let currentConcurrency = 0;
  let peakConcurrency = 0;

  const runtime: Pick<AgentRuntime, "execute"> = {
    async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
      input.signal?.throwIfAborted();
      const callIndex = calls.length;
      calls.push(input);
      currentConcurrency += 1;
      if (currentConcurrency > peakConcurrency) {
        peakConcurrency = currentConcurrency;
      }

      const provider =
        input.agent.backend.type === "cli" || input.agent.backend.type === "api"
          ? input.agent.backend.provider
          : input.agent.backend.type;
      const sessionEnabled = input.sessionMode === "node" || input.sessionMode === "shared";
      const effectiveKey =
        input.sessionMode === "shared"
          ? input.sessionKey?.trim() || `${input.runId}:${input.agent.id}:${input.nodeId}`
          : input.sessionMode === "node"
            ? `${input.nodeId}`
            : undefined;
      const priorSession = input.resumeSession;
      const nextTurnCount = (priorSession?.turnCount ?? 0) + 1;
      const resolvedSessionId = sessionEnabled
        ? (priorSession?.sessionId ?? `sess-${effectiveKey ?? input.nodeId}-${randomUUID().slice(0, 8)}`)
        : undefined;

      yield {
        type: "agent.started",
        timestamp: nowIso(),
        agentId: input.agent.id,
        nodeId: input.nodeId,
        runId: input.runId,
        payload: { provider },
      };

      try {
        const result = await handler(input, {
          callIndex,
          sessionId: resolvedSessionId,
          turnCount: nextTurnCount,
        });
        input.signal?.throwIfAborted();

        if (sessionEnabled && resolvedSessionId && effectiveKey) {
          const updated: AgentSessionState = {
            sessionId: resolvedSessionId,
            sessionKey: effectiveKey,
            provider,
            agentId: input.agent.id,
            nodeId: input.nodeId,
            turnCount: nextTurnCount,
            createdAt: priorSession?.createdAt ?? nowIso(),
            updatedAt: nowIso(),
          };
          input.onSessionUpdate?.(updated);
        }

        if (input.onShortTermUpdate && sessionEnabled) {
          const histKey = JSON.stringify([input.runId, input.sessionMode === "shared" ? "shared-session" : input.agent.id, effectiveKey ?? input.nodeId]);
          input.onShortTermUpdate({
            [histKey]: {
              entries: [
                {
                  id: `turn-${nextTurnCount}-${callIndex}`,
                  input: input.input,
                  output: result,
                },
              ],
              maxEntries: 20,
              maxTokens: input.shortTermMemoryMaxTokens ?? 16384,
            },
          });
        }

        yield {
          type: "agent.output",
          timestamp: nowIso(),
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          payload: { content: result, thinkingStatus: "none" },
        };
        yield {
          type: "agent.completed",
          timestamp: nowIso(),
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          payload: {
            content: result,
            thinkingStatus: "none",
            ...(resolvedSessionId ? { sessionId: resolvedSessionId, sessionTurn: nextTurnCount } : {}),
          },
        };
      } catch (err) {
        yield {
          type: "agent.failed",
          timestamp: nowIso(),
          agentId: input.agent.id,
          nodeId: input.nodeId,
          runId: input.runId,
          payload: { error: err instanceof Error ? err.message : String(err) },
        };
        throw err;
      } finally {
        currentConcurrency -= 1;
      }
    },
  };

  return {
    runtime,
    calls,
    getPeakConcurrency: () => peakConcurrency,
    getCurrentConcurrency: () => currentConcurrency,
  };
}

export interface AgenticVeloraSeedPackage {
  agents: AgentRecord[];
  tools: ToolRecord[];
  workflows: WorkflowDefinition[];
  rawModule: Record<string, unknown>;
}

/**
 * Dynamically loads M3's `src/studio/seeds/agenticVeloraOrgSeed` without a static TypeScript import,
 * so `pnpm run typecheck:tests` succeeds before M3 lands and fails closed at runtime if missing.
 */
export function loadAgenticVeloraSeedPackage(): AgenticVeloraSeedPackage {
  const seedBase = path.resolve(__dirname, "../../src/studio/seeds/agenticVeloraOrgSeed");
  const candidateTs = `${seedBase}.ts`;
  const candidateJs = `${seedBase}.js`;
  if (!fs.existsSync(candidateTs) && !fs.existsSync(candidateJs)) {
    throw new Error(`M3 deliverable missing: ${candidateTs} does not exist yet.`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(fs.existsSync(candidateTs) ? candidateTs : candidateJs) as Record<string, unknown>;

  const factoryFn =
    (typeof mod.buildAgenticVeloraPackage === "function" && mod.buildAgenticVeloraPackage) ||
    (typeof mod.createAgenticVeloraWorkspacePackage === "function" && mod.createAgenticVeloraWorkspacePackage) ||
    (typeof mod.createAgenticVeloraOrgPackage === "function" && mod.createAgenticVeloraOrgPackage) ||
    (typeof mod.getAgenticVeloraSeed === "function" && mod.getAgenticVeloraSeed);

  if (factoryFn) {
    const pkg = factoryFn() as { agents?: AgentRecord[]; tools?: ToolRecord[]; workflows?: WorkflowDefinition[] };
    if (Array.isArray(pkg?.agents) && Array.isArray(pkg?.tools) && Array.isArray(pkg?.workflows)) {
      return { agents: pkg.agents, tools: pkg.tools, workflows: pkg.workflows, rawModule: mod };
    }
  }

  let agents: AgentRecord[] | undefined;
  let tools: ToolRecord[] | undefined;
  let workflows: WorkflowDefinition[] | undefined;

  for (const val of Object.values(mod)) {
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0] !== null) {
      const sample = val[0] as Record<string, unknown>;
      if ("backend" in sample && "systemPrompt" in sample && !agents) {
        agents = val as AgentRecord[];
      } else if ("category" in sample && "impact" in sample && !tools) {
        tools = val as ToolRecord[];
      } else if ("nodes" in sample && "edges" in sample && !workflows) {
        workflows = val as WorkflowDefinition[];
      }
    }
  }

  if (!workflows) {
    const collected: WorkflowDefinition[] = [];
    for (const [key, val] of Object.entries(mod)) {
      if (typeof val === "function" && /workflow/i.test(key) && val.length === 0) {
        const produced = (val as () => unknown)();
        if (produced && typeof produced === "object" && "nodes" in produced && "edges" in produced) {
          collected.push(produced as WorkflowDefinition);
        }
      }
    }
    if (collected.length > 0) workflows = collected;
  }

  if (!agents || !tools || !workflows) {
    throw new Error(
      `agenticVeloraOrgSeed module loaded (${Object.keys(mod).join(", ")}), but did not export identifiable agents, tools, and workflows arrays.`,
    );
  }

  return { agents, tools, workflows, rawModule: mod };
}

export type VeloraToolName =
  | "delivery_plan_reader_tool"
  | "speckit_workspace_tool"
  | "velora_knowledge_tool"
  | "velora_graphify_tool"
  | "velora_output_report_tool"
  | "delegate_subagents";

export function buildVeloraToolRecord(
  name: VeloraToolName,
  configurationOverrides: Record<string, string | number | boolean> = {},
): ToolRecord {
  // Prefer the real seeded ToolRecord when M3 has landed, keeping opaque-box overrides for temp mirror paths.
  try {
    const pkg = loadAgenticVeloraSeedPackage();
    const seeded = pkg.tools.find((t) => t.name === name || t.id === name);
    if (seeded) {
      return {
        ...seeded,
        configuration: {
          ...seeded.configuration,
          ...configurationOverrides,
        },
      };
    }
  } catch {
    // M3 seed not yet implemented; construct canonical ToolRecord matching ToolExecutorFactory/FunctionToolExecutor contract.
  }

  const kindMap: Record<VeloraToolName, string> = {
    delivery_plan_reader_tool: "delivery-plan-reader",
    speckit_workspace_tool: "speckit-workspace-inspector",
    velora_knowledge_tool: "velora-knowledge",
    velora_graphify_tool: "velora-graphify",
    velora_output_report_tool: "velora-output-report",
    delegate_subagents: "delegate-subagents",
  };
  const writeCapable = name === "velora_output_report_tool" || name === "velora_knowledge_tool" || name === "velora_graphify_tool";

  return {
    ...createToolRecord({
      name,
      category: "function",
      impact: writeCapable ? "write" : "read-only",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      configuration: {
        kind: kindMap[name],
        ...configurationOverrides,
      },
    }),
    id: name,
    enabled: true,
    executionPolicy: {
      requiresApproval: false,
      idempotency: "optional",
      retryable: !writeCapable,
    },
  };
}

export function createCliAgent(
  id: string,
  provider: "cursor" | "codex" | "agy",
  options: {
    executable?: string;
    args?: string[];
    model?: string;
    filesystem?: "read" | "read-write" | "none";
    workspaceRoot?: string;
    systemPrompt?: string;
  } = {},
): AgentRecord {
  const agent = createAgentRecord({
    name: `Agent-${id}`,
    systemPrompt: options.systemPrompt ?? `You are ${id}.`,
    backend: {
      type: "cli",
      provider,
      ...(options.executable ? { executable: options.executable } : {}),
      ...(options.args ? { args: options.args } : {}),
      ...(options.model ? { model: options.model } : {}),
    },
  });
  return {
    ...agent,
    id,
    executionPolicy: {
      shell: "restricted",
      filesystem: options.filesystem ?? "read",
      workspaceRoot: options.workspaceRoot ?? "/workspace",
      allowedCommands: [options.executable ?? (provider === "cursor" ? "agent" : provider)],
    },
  };
}
