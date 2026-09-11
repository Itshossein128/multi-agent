import { Hono } from "hono";
import type { RunStoreContract } from "../runtime/runStore";
import type { StudioStore, StudioTask } from "../../../../src/studio/contracts";
import type { RunExecutor } from "../runtime/runExecutor";
import { resolveRequestPrincipal, type PrincipalResolver, type RequestPrincipal } from "../auth/principal";
import { nowIso, uid } from "@multi-agent/types";

export type TimeFilter = "today" | "week" | "month";

export interface AgentInstance {
  id: string;
  name: string;
  role: string;
  status: "running" | "idle" | "error";
  currentTask?: string;
  uptimeSeconds: number;
  tokensUsed: number;
  cost: number | null;
  model: string;
}

export interface QueuedTask {
  id: string;
  title: string;
  agentRole: string;
  priority: "high" | "medium" | "low";
  queuedAt: string;
  estimatedTokens: number;
}

export interface CompletedTask {
  id: string;
  title: string;
  agent: string;
  completedAt: string;
  duration: string;
  tokens: number;
  cost: number | null;
  period: "today" | "week" | "month";
  timestamp: number;
}

export interface FailedTask {
  id: string;
  title: string;
  agent: string;
  error: string;
  failedAt: string;
  retryCount: number;
  recoverable: boolean;
  timestamp: number;
}

export interface TokenMetrics {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  budgetUsd: number;
  providerBreakdown: {
    provider: string;
    model: string;
    tokens: number;
    cost: number;
  }[];
}

export interface StudioDashboardData {
  agents: AgentInstance[];
  queue: QueuedTask[];
  completedTasks: CompletedTask[];
  failedTasks: FailedTask[];
  tokenMetrics: TokenMetrics;
  lastUpdated: string;
}

function getPeriod(isoOrTimestamp: string | number): "today" | "week" | "month" {
  const time = typeof isoOrTimestamp === "number" ? isoOrTimestamp : new Date(isoOrTimestamp).getTime();
  if (isNaN(time)) return "month";
  const diffMs = Date.now() - time;
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * oneDayMs;

  if (diffMs <= oneDayMs) return "today";
  if (diffMs <= sevenDaysMs) return "week";
  return "month";
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return "—";
  const diffSec = (end - start) / 1000;
  return `${diffSec.toFixed(1)}s`;
}

const DEFAULT_AGENTS = [
  {
    id: "agent-orchestrator",
    name: "Orchestrator Agent",
    role: "Intent Classification & Task Decomposer",
    model: process.env.LLM_MODEL || "gemini-3.6-flash",
  },
  {
    id: "agent-developer",
    name: "Developer Agent",
    role: "Code Generator & Version Control",
    model: process.env.LLM_MODEL || "gemini-3.6-flash",
  },
  {
    id: "agent-doc-generator",
    name: "Doc Generator Agent",
    role: "BookStack Chapter & Specification Author",
    model: process.env.LLM_MODEL || "gemini-3.6-flash",
  },
];

const serverStartTime = Date.now();

export function createDashboardRouter(
  runStore: RunStoreContract,
  studioStore?: StudioStore,
  executor?: RunExecutor,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
) {
  const app = new Hono<{ Variables: { principal: RequestPrincipal } }>();

  app.use("/*", async (c, next) => {
    const principal = await resolvePrincipal(c.req.raw);
    if (!principal) return c.json({ error: "Authentication required." }, 401);
    c.set("principal", principal);
    await next();
  });

  app.get("/", async (c) => {
    const principal = c.get("principal");
    const runs = runStore.list({}, principal);
    const tasks = studioStore ? await studioStore.listTasks(principal) : [];
    const studioAgents = studioStore ? await studioStore.listAgents(principal) : [];

    // 1. Agents list & running status aggregation
    const activeRuns = runs.filter((r) => r.status === "running");
    const activeTasks = tasks.filter((t) => t.status === "in_progress" && !t.paused);
    const agentUptime = Math.floor((Date.now() - serverStartTime) / 1000);

    const baseAgents = studioAgents.length > 0
      ? studioAgents.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.description || a.name,
          model: a.backend?.model || process.env.LLM_MODEL || "gemini-3.6-flash",
        }))
      : DEFAULT_AGENTS;

    const agents: AgentInstance[] = baseAgents.map((agent) => {
      const activeRun = activeRuns.find((r) => r.metadata?.agentId === agent.id || r.metadata?.agentName === agent.name);
      const activeTask = activeTasks.find((t) => t.assignedAgent === agent.name || t.assignedAgent === agent.id);
      const isRunning = Boolean(activeRun || activeTask);

      let status: AgentInstance["status"] = isRunning ? "running" : "idle";
      if (!isRunning) {
        const latestAgentRun = runs.find((r) => r.metadata?.agentId === agent.id || r.metadata?.agentName === agent.name);
        if (latestAgentRun?.status === "failed") {
          status = "error";
        }
      }

      // Aggregate provider-reported tokens and cost for this agent from completed runs
      let tokensUsed = 0;
      let costSum = 0;
      let hasReportedCost = false;

      for (const run of runs) {
        if (run.metadata?.agentId === agent.id || run.metadata?.agentName === agent.name) {
          const t = typeof run.metadata?.totalTokens === "number" ? run.metadata.totalTokens : (typeof run.metadata?.tokens === "number" ? run.metadata.tokens : 0);
          tokensUsed += t;
          if (typeof run.metadata?.cost === "number") {
            costSum += run.metadata.cost;
            hasReportedCost = true;
          }
        }
      }

      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status,
        currentTask: activeTask?.title || (activeRun?.metadata?.name as string) || (isRunning ? "Executing active workflow" : undefined),
        uptimeSeconds: agentUptime,
        tokensUsed,
        cost: hasReportedCost ? Number(costSum.toFixed(4)) : null,
        model: agent.model,
      };
    });

    // 2. Queue aggregation (authoritative from Studio tasks + queued runs)
    const queue: QueuedTask[] = [];
    const queuedTaskIds = new Set<string>();

    for (const task of tasks) {
      if (task.status === "todo" || task.status === "planning") {
        queuedTaskIds.add(task.id);
        queue.push({
          id: task.id,
          title: task.title,
          agentRole: task.assignedAgent || "Orchestrator Agent",
          priority: task.priority || "medium",
          queuedAt: task.createdAt || nowIso(),
          estimatedTokens: 8000,
        });
      }
    }

    for (const run of runs) {
      if (run.status === "queued" && (!run.taskId || !queuedTaskIds.has(run.taskId))) {
        queue.push({
          id: run.id,
          title: (run.metadata?.name as string) || (run.metadata?.title as string) || `Workflow Run ${run.id.slice(0, 8)}`,
          agentRole: (run.metadata?.agentName as string) || "Orchestrator Agent",
          priority: "high",
          queuedAt: run.startedAt,
          estimatedTokens: 8000,
        });
      }
    }

    // 3. Completed executions (authoritative from completed runs + completed tasks)
    const completedTasks: CompletedTask[] = [];
    const completedTaskIds = new Set<string>();

    for (const run of runs) {
      if (run.status === "completed") {
        if (run.taskId) completedTaskIds.add(run.taskId);
        const meta = run.metadata || {};
        const tokens = typeof meta.totalTokens === "number" ? meta.totalTokens : (typeof meta.tokens === "number" ? meta.tokens : 0);
        const cost = typeof meta.cost === "number" ? meta.cost : null;
        const timestamp = new Date(run.completedAt || run.startedAt).getTime();

        completedTasks.push({
          id: run.id,
          title: (meta.name as string) || (meta.title as string) || `Workflow Run ${run.id.slice(0, 8)}`,
          agent: (meta.agentName as string) || "Orchestrator Agent",
          completedAt: run.completedAt || run.startedAt,
          duration: formatDuration(run.startedAt, run.completedAt),
          tokens,
          cost,
          period: getPeriod(timestamp),
          timestamp,
        });
      }
    }

    for (const task of tasks) {
      if (task.status === "done" && !completedTaskIds.has(task.id)) {
        const timestamp = new Date(task.updatedAt || task.createdAt).getTime();
        completedTasks.push({
          id: task.id,
          title: task.title,
          agent: task.assignedAgent || "Orchestrator Agent",
          completedAt: task.updatedAt || task.createdAt,
          duration: "—",
          tokens: 0,
          cost: null,
          period: getPeriod(timestamp),
          timestamp,
        });
      }
    }

    completedTasks.sort((a, b) => b.timestamp - a.timestamp);

    // 4. Failed tasks & incidents (authoritative from failed runs + failed tasks)
    const failedTasks: FailedTask[] = [];
    const failedTaskIds = new Set<string>();

    for (const run of runs) {
      if (run.status === "failed") {
        if (run.taskId) failedTaskIds.add(run.taskId);
        const meta = run.metadata || {};
        const timestamp = new Date(run.completedAt || run.startedAt).getTime();
        failedTasks.push({
          id: run.id,
          title: (meta.name as string) || (meta.title as string) || `Workflow Run ${run.id.slice(0, 8)}`,
          agent: (meta.agentName as string) || "Orchestrator Agent",
          error: run.error || "Execution failed during workflow run",
          failedAt: run.completedAt || run.startedAt,
          retryCount: typeof meta.retryCount === "number" ? meta.retryCount : 1,
          recoverable: true,
          timestamp,
        });
      }
    }

    for (const task of tasks) {
      if (task.status === "failed" && !failedTaskIds.has(task.id)) {
        const timestamp = new Date(task.updatedAt || task.createdAt).getTime();
        failedTasks.push({
          id: task.id,
          title: task.title,
          agent: task.assignedAgent || "Orchestrator Agent",
          error: task.output || "Marked as failed during workflow execution",
          failedAt: task.updatedAt || task.createdAt,
          retryCount: task.retryCount || 1,
          recoverable: true,
          timestamp,
        });
      }
    }

    failedTasks.sort((a, b) => b.timestamp - a.timestamp);

    // 5. Token metrics (authoritative from provider-reported run metadata only; no synthetic calculations)
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalCostUsd = 0;
    const providerMap = new Map<string, { provider: string; model: string; tokens: number; cost: number }>();

    for (const run of runs) {
      if (run.status === "completed") {
        const meta = run.metadata || {};
        const t = typeof meta.totalTokens === "number" ? meta.totalTokens : (typeof meta.tokens === "number" ? meta.tokens : 0);
        const pt = typeof meta.promptTokens === "number" ? meta.promptTokens : 0;
        const ct = typeof meta.completionTokens === "number" ? meta.completionTokens : 0;
        const c = typeof meta.cost === "number" ? meta.cost : 0;

        totalTokens += t;
        promptTokens += pt;
        completionTokens += ct;
        totalCostUsd += c;

        const provider = String(meta.provider || process.env.LLM_PROVIDER || "gemini").toUpperCase();
        const model = String(meta.model || process.env.LLM_MODEL || "gemini-3.6-flash");
        const key = `${provider}:${model}`;
        const entry = providerMap.get(key) ?? { provider, model, tokens: 0, cost: 0 };
        entry.tokens += t;
        entry.cost += c;
        providerMap.set(key, entry);
      }
    }

    const activeProvider = (process.env.LLM_PROVIDER || "gemini").toUpperCase();
    const activeModel = process.env.LLM_MODEL || "gemini-3.6-flash";
    const providerBreakdown = providerMap.size > 0
      ? [...providerMap.values()]
      : [{ provider: activeProvider, model: activeModel, tokens: 0, cost: 0 }];

    const dashboardData: StudioDashboardData = {
      agents,
      queue,
      completedTasks,
      failedTasks,
      tokenMetrics: {
        totalTokens,
        promptTokens,
        completionTokens,
        totalCostUsd: Number(totalCostUsd.toFixed(4)),
        budgetUsd: 25.0,
        providerBreakdown,
      },
      lastUpdated: nowIso(),
    };

    return c.json(dashboardData);
  });

  app.post("/", async (c) => {
    const principal = c.get("principal");
    let body: { action?: string; taskId?: string; title?: string; role?: string; priority?: "high" | "medium" | "low" };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { action, taskId, title, role, priority } = body;

    if (action === "retry" && taskId) {
      if (studioStore) {
        const task = await studioStore.getTask(taskId, principal);
        if (task) {
          await studioStore.saveTask(
            {
              ...task,
              status: "todo",
              paused: false,
              retryCount: (task.retryCount || 0) + 1,
              output: null,
              updatedAt: nowIso(),
            },
            principal,
          );
          return c.json({ success: true, message: `Task ${taskId} re-queued` });
        }
      }

      // Check runStore
      const entry = runStore.get(taskId);
      if (entry) {
        const ownerId = entry.run.ownerId ?? entry.memoryOwner?.principalId;
        const tenantId = entry.run.tenantId ?? entry.memoryOwner?.tenantId;
        if (ownerId !== principal.userId || tenantId !== principal.tenantId) {
          return c.json({ error: "Run not found" }, 404);
        }
        runStore.update(taskId, { status: "queued" });
        return c.json({ success: true, message: `Run ${taskId} re-queued` });
      }

      return c.json({ error: `Task ${taskId} not found` }, 404);
    }

    if (action === "cancel" && taskId) {
      let cancelled = false;
      const entry = runStore.get(taskId);
      if (entry) {
        const ownerId = entry.run.ownerId ?? entry.memoryOwner?.principalId;
        const tenantId = entry.run.tenantId ?? entry.memoryOwner?.tenantId;
        if (ownerId !== principal.userId || tenantId !== principal.tenantId) {
          return c.json({ error: "Run not found" }, 404);
        }
        runStore.cancel(taskId);
        executor?.cancel(taskId);
        cancelled = true;
      }

      if (studioStore) {
        const task = await studioStore.getTask(taskId, principal);
        if (task) {
          await studioStore.deleteTask(taskId, principal);
          cancelled = true;
        }
      }

      if (cancelled) {
        return c.json({ success: true, message: `Task ${taskId} cancelled` });
      }
      return c.json({ error: `Task ${taskId} not found` }, 404);
    }

    if (action === "enqueue") {
      if (!title || !title.trim()) {
        return c.json({ error: "Title is required" }, 400);
      }

      const id = uid("task");
      if (studioStore) {
        const task: StudioTask = {
          id,
          title: title.trim(),
          description: "",
          priority: priority || "medium",
          status: "todo",
          assignedAgent: role || null,
          dependencies: [],
          output: null,
          retryCount: 0,
          paused: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          ownerId: principal.userId,
          tenantId: principal.tenantId,
        };
        await studioStore.saveTask(task, principal);
      }
      return c.json({ success: true, id }, 201);
    }

    return c.json({ error: "Invalid action" }, 400);
  });

  return app;
}
