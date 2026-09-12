import { nowIso, uid, type AgentRecord, type Run } from "@multi-agent/types";
import type { StudioStore, StudioTask } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import type { RunExecutor } from "../../runtime/runExecutor";
import type { RunStoreContract } from "../../runtime/runStore";
import { ApiError } from "../shared/http";
import type { AgentInstance, CompletedTask, DashboardCommand, FailedTask, QueuedTask, StudioDashboardData, TimeFilter, TokenMetrics } from "./models";

const DEFAULT_MODEL = () => process.env.LLM_MODEL || "gemini-3.6-flash";
const DEFAULT_AGENTS = () => [
  { id: "agent-orchestrator", name: "Orchestrator Agent", role: "Intent Classification & Task Decomposer", model: DEFAULT_MODEL() },
  { id: "agent-developer", name: "Developer Agent", role: "Code Generator & Version Control", model: DEFAULT_MODEL() },
  { id: "agent-doc-generator", name: "Doc Generator Agent", role: "BookStack Chapter & Specification Author", model: DEFAULT_MODEL() },
];

function periodOf(value: string | number): TimeFilter {
  const time = typeof value === "number" ? value : new Date(value).getTime();
  if (Number.isNaN(time)) return "month";
  const age = Date.now() - time;
  if (age <= 24 * 60 * 60 * 1000) return "today";
  if (age <= 7 * 24 * 60 * 60 * 1000) return "week";
  return "month";
}

function duration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return "—";
  const elapsed = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? `${(elapsed / 1000).toFixed(1)}s` : "—";
}

function metadataNumber(run: Run, primary: string, fallback?: string): number {
  const value = run.metadata?.[primary];
  if (typeof value === "number") return value;
  const alternate = fallback ? run.metadata?.[fallback] : undefined;
  return typeof alternate === "number" ? alternate : 0;
}

function belongsToAgent(run: Run, agent: { id: string; name: string }): boolean {
  return run.metadata?.agentId === agent.id || run.metadata?.agentName === agent.name;
}

export class DashboardService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly runStore: RunStoreContract,
    private readonly studioStore?: StudioStore,
    private readonly executor?: Pick<RunExecutor, "cancel">,
  ) { }

  async get(principal: RequestPrincipal): Promise<StudioDashboardData> {
    const runs = this.runStore.list({}, principal);
    const [tasks, studioAgents] = await Promise.all([
      this.studioStore?.listTasks(principal) ?? [],
      this.studioStore?.listAgents(principal) ?? [],
    ]);
    return {
      agents: this.buildAgents(runs, tasks, studioAgents),
      queue: this.buildQueue(runs, tasks),
      completedTasks: this.buildCompleted(runs, tasks),
      failedTasks: this.buildFailures(runs, tasks),
      tokenMetrics: this.buildMetrics(runs),
      lastUpdated: nowIso(),
    };
  }

  async execute(command: DashboardCommand, principal: RequestPrincipal) {
    if (command.action === "retry" && command.taskId) return this.retry(command.taskId, principal);
    if (command.action === "cancel" && command.taskId) return this.cancel(command.taskId, principal);
    if (command.action === "enqueue") return this.enqueue(command, principal);
    throw new ApiError(400, "Invalid action");
  }

  private buildAgents(runs: Run[], tasks: StudioTask[], records: AgentRecord[]): AgentInstance[] {
    const activeRuns = runs.filter((run) => run.status === "running");
    const activeTasks = tasks.filter((task) => (task.status === "in_progress" || task.status === "running") && !task.paused);
    const base = records.length
      ? records.map((agent) => ({ id: agent.id, name: agent.name, role: agent.description || agent.name, model: agent.backend?.model || DEFAULT_MODEL() }))
      : DEFAULT_AGENTS();
    return base.map((agent) => {
      const activeRun = activeRuns.find((run) => belongsToAgent(run, agent));
      const activeTask = activeTasks.find((task) => task.assignedAgent === agent.name || task.assignedAgent === agent.id);
      const matching = runs.filter((run) => belongsToAgent(run, agent));
      const running = Boolean(activeRun || activeTask);
      const hasCost = matching.some((run) => typeof run.metadata?.cost === "number");
      return {
        ...agent,
        status: running ? "running" : matching[0]?.status === "failed" ? "error" : "idle",
        currentTask: activeTask?.title || (activeRun?.metadata?.name as string) || (running ? "Executing active workflow" : undefined),
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
        tokensUsed: matching.reduce((sum, run) => sum + metadataNumber(run, "totalTokens", "tokens"), 0),
        cost: hasCost ? Number(matching.reduce((sum, run) => sum + metadataNumber(run, "cost"), 0).toFixed(4)) : null,
      };
    });
  }

  private buildQueue(runs: Run[], tasks: StudioTask[]): QueuedTask[] {
    const queue: QueuedTask[] = tasks.filter((task) =>
      task.status === "todo" || task.status === "planning" || task.status === "backlog" || task.status === "ready" || task.status === "queued"
    ).map((task) => {
      const timestamp = new Date(task.createdAt || nowIso()).getTime();
      return {
        id: task.id, title: task.title, agentRole: task.assignedAgent || "Orchestrator Agent", priority: task.priority || "medium",
        queuedAt: task.createdAt || nowIso(), estimatedTokens: 8000, source: "task" as const, period: periodOf(timestamp), timestamp,
      };
    });
    const taskIds = new Set(queue.map((task) => task.id));
    for (const run of runs.filter((item) => item.status === "queued" && (!item.taskId || !taskIds.has(item.taskId)))) {
      const timestamp = new Date(run.startedAt).getTime();
      queue.push({
        id: run.id, title: this.runTitle(run), agentRole: (run.metadata?.agentName as string) || "Orchestrator Agent", priority: "high",
        queuedAt: run.startedAt, estimatedTokens: 8000, source: "run", period: periodOf(timestamp), timestamp,
      });
    }
    return queue.sort((a, b) => b.timestamp - a.timestamp);
  }

  private buildCompleted(runs: Run[], tasks: StudioTask[]): CompletedTask[] {
    const completedRuns = runs.filter((run) => run.status === "completed");
    const taskIds = new Set(completedRuns.map((run) => run.taskId).filter(Boolean));
    const result: CompletedTask[] = completedRuns.map((run) => {
      const timestamp = new Date(run.completedAt || run.startedAt).getTime();
      return {
        id: run.id, title: this.runTitle(run), agent: (run.metadata?.agentName as string) || "Orchestrator Agent",
        completedAt: run.completedAt || run.startedAt, duration: duration(run.startedAt, run.completedAt),
        tokens: metadataNumber(run, "totalTokens", "tokens"), cost: typeof run.metadata?.cost === "number" ? run.metadata.cost : null,
        period: periodOf(timestamp), timestamp, source: "run",
      };
    });
    for (const task of tasks.filter((item) => (item.status === "done" || item.status === "completed") && !taskIds.has(item.id))) {
      const timestamp = new Date(task.updatedAt || task.createdAt).getTime();
      result.push({
        id: task.id, title: task.title, agent: task.assignedAgent || "Orchestrator Agent",
        completedAt: task.updatedAt || task.createdAt, duration: "—", tokens: 0, cost: null,
        period: periodOf(timestamp), timestamp, source: "task",
      });
    }
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  private buildFailures(runs: Run[], tasks: StudioTask[]): FailedTask[] {
    const failedRuns = runs.filter((run) => run.status === "failed");
    const taskIds = new Set(failedRuns.map((run) => run.taskId).filter(Boolean));
    const result: FailedTask[] = failedRuns.map((run) => {
      const timestamp = new Date(run.completedAt || run.startedAt).getTime();
      return {
        id: run.id, title: this.runTitle(run), agent: (run.metadata?.agentName as string) || "Orchestrator Agent",
        error: run.error || "Execution failed during workflow run", failedAt: run.completedAt || run.startedAt,
        retryCount: metadataNumber(run, "retryCount") || 1, recoverable: true, timestamp, period: periodOf(timestamp), source: "run",
      };
    });
    for (const task of tasks.filter((item) => item.status === "failed" && !taskIds.has(item.id))) {
      const timestamp = new Date(task.updatedAt || task.createdAt).getTime();
      result.push({
        id: task.id, title: task.title, agent: task.assignedAgent || "Orchestrator Agent",
        error: task.lastError || task.output || "Marked as failed during workflow execution",
        failedAt: task.updatedAt || task.createdAt, retryCount: task.retryCount || 1, recoverable: true,
        timestamp, period: periodOf(timestamp), source: "task",
      });
    }
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  private buildMetrics(runs: Run[]): TokenMetrics {
    const completed = runs.filter((run) => run.status === "completed");
    const providers = new Map<string, { provider: string; model: string; tokens: number; cost: number }>();
    let totalTokens = 0; let promptTokens = 0; let completionTokens = 0; let totalCostUsd = 0;
    for (const run of completed) {
      const tokens = metadataNumber(run, "totalTokens", "tokens"); const cost = metadataNumber(run, "cost");
      totalTokens += tokens; promptTokens += metadataNumber(run, "promptTokens"); completionTokens += metadataNumber(run, "completionTokens"); totalCostUsd += cost;
      const provider = String(run.metadata?.provider || process.env.LLM_PROVIDER || "gemini").toUpperCase();
      const model = String(run.metadata?.model || DEFAULT_MODEL()); const key = `${provider}:${model}`;
      const current = providers.get(key) ?? { provider, model, tokens: 0, cost: 0 }; current.tokens += tokens; current.cost += cost; providers.set(key, current);
    }
    const providerBreakdown = providers.size ? [...providers.values()] : [{ provider: (process.env.LLM_PROVIDER || "gemini").toUpperCase(), model: DEFAULT_MODEL(), tokens: 0, cost: 0 }];
    return { totalTokens, promptTokens, completionTokens, totalCostUsd: Number(totalCostUsd.toFixed(4)), budgetUsd: 25, providerBreakdown };
  }

  private async retry(id: string, principal: RequestPrincipal) {
    const task = await this.studioStore?.getTask(id, principal);
    if (task) {
      await this.studioStore!.saveTask({ ...task, status: "todo", paused: false, retryCount: (task.retryCount || 0) + 1, output: null, updatedAt: nowIso() }, principal);
      return { success: true, message: `Task ${id} re-queued` };
    }
    const entry = this.ownedRun(id, principal);
    if (entry) { this.runStore.update(id, { status: "queued" }); return { success: true, message: `Run ${id} re-queued` }; }
    throw new ApiError(404, `Task ${id} not found`);
  }

  private async cancel(id: string, principal: RequestPrincipal) {
    let cancelled = false;
    if (this.ownedRun(id, principal)) { this.runStore.cancel(id); this.executor?.cancel(id); cancelled = true; }
    const task = await this.studioStore?.getTask(id, principal);
    if (task) { await this.studioStore!.deleteTask(id, principal); cancelled = true; }
    if (!cancelled) throw new ApiError(404, `Task ${id} not found`);
    return { success: true, message: `Task ${id} cancelled` };
  }

  private async enqueue(command: DashboardCommand, principal: RequestPrincipal) {
    if (!command.title?.trim()) throw new ApiError(400, "Title is required");
    const id = uid("task");
    if (this.studioStore) await this.studioStore.saveTask({
      id, title: command.title.trim(), description: "", priority: command.priority || "medium", status: "todo",
      assignedAgent: command.role || null, dependencies: [], output: null, retryCount: 0, paused: false, createdAt: nowIso(), updatedAt: nowIso(), ownerId: principal.userId, tenantId: principal.tenantId
    }, principal);
    return { success: true, id };
  }

  private ownedRun(id: string, principal: RequestPrincipal) {
    const entry = this.runStore.get(id);
    if (!entry) return undefined;
    const ownerId = entry.run.ownerId ?? entry.memoryOwner?.principalId;
    const tenantId = entry.run.tenantId ?? entry.memoryOwner?.tenantId;
    if (ownerId !== principal.userId || tenantId !== principal.tenantId) throw new ApiError(404, "Run not found");
    return entry;
  }

  private runTitle(run: Run) {
    return (run.metadata?.name as string) || (run.metadata?.title as string) || `Workflow Run ${run.id.slice(0, 8)}`;
  }
}
