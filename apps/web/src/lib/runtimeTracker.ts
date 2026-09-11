/**
 * Shared runtime state tracker (legacy in-memory mock/helper).
 *
 * NOTE: MultiAgentRuntimeTracker is NOT authoritative for:
 * - run status,
 * - task status,
 * - execution state,
 * - cancellation state,
 * - approval state,
 * - dashboard counters,
 * - dashboard lists,
 * - dashboard summaries.
 *
 * Authoritative operational state is provided by RunStore and StudioStore via the execution server.
 */

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

const serverStartTime = Date.now();

// Global in-memory runtime store preserved during server life
class MultiAgentRuntimeTracker {
  private static instance: MultiAgentRuntimeTracker;

  public agents: AgentInstance[] = [
    {
      id: "agent-orchestrator",
      name: "Orchestrator Agent",
      role: "Intent Classification & Task Decomposer",
      status: "running",
      currentTask: "Listening for workflow requests & routing to LangGraph nodes",
      uptimeSeconds: 0,
      tokensUsed: 0,
      cost: 0,
      model: process.env.LLM_MODEL || "gemini-3.6-flash",
    },
    {
      id: "agent-developer",
      name: "Developer Agent",
      role: "Code Generator & Version Control",
      status: "idle",
      currentTask: "Standing by for approved technical specifications",
      uptimeSeconds: 0,
      tokensUsed: 0,
      cost: 0,
      model: process.env.LLM_MODEL || "gemini-3.6-flash",
    },
    {
      id: "agent-doc-generator",
      name: "Doc Generator Agent",
      role: "BookStack Chapter & Specification Author",
      status: "idle",
      currentTask: "Ready to document immature user requirements",
      uptimeSeconds: 0,
      tokensUsed: 0,
      cost: 0,
      model: process.env.LLM_MODEL || "gemini-3.6-flash",
    },
  ];

  public queue: QueuedTask[] = [];
  public completedTasks: CompletedTask[] = [];
  public failedTasks: FailedTask[] = [];

  public totalTokens: number = 0;
  public promptTokens: number = 0;
  public completionTokens: number = 0;
  public totalCost: number = 0;

  private constructor() {}

  public static getInstance(): MultiAgentRuntimeTracker {
    if (!MultiAgentRuntimeTracker.instance) {
      MultiAgentRuntimeTracker.instance = new MultiAgentRuntimeTracker();
    }
    return MultiAgentRuntimeTracker.instance;
  }

  public recordExecution(options: {
    name: string;
    status: "COMPLETED" | "FAILED";
    agent: string;
    tokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    cost?: number;
    durationMs?: number;
    error?: string;
  }) {
    const now = Date.now();
    const tokens = options.tokens || 1200;
    const pTokens = options.promptTokens || Math.round(tokens * 0.7);
    const cTokens = options.completionTokens || Math.round(tokens * 0.3);
    const cost = options.cost || Number((tokens * 0.000002).toFixed(5));
    const durationStr = options.durationMs ? `${(options.durationMs / 1000).toFixed(1)}s` : "2.4s";

    this.totalTokens += tokens;
    this.promptTokens += pTokens;
    this.completionTokens += cTokens;
    this.totalCost += cost;

    // Update agent stats
    const agent = this.agents.find((a) => a.name.includes(options.agent) || a.role.includes(options.agent));
    if (agent) {
      agent.tokensUsed += tokens;
      agent.cost = (agent.cost ?? 0) + cost;
    }

    if (options.status === "COMPLETED") {
      this.completedTasks.unshift({
        id: `comp-${now}-${Math.random().toString(36).substring(2, 6)}`,
        title: options.name,
        agent: options.agent,
        completedAt: "Just now",
        duration: durationStr,
        tokens,
        cost,
        period: "today",
        timestamp: now,
      });
      if (this.completedTasks.length > 50) this.completedTasks.pop();
    } else {
      this.failedTasks.unshift({
        id: `fail-${now}-${Math.random().toString(36).substring(2, 6)}`,
        title: options.name,
        agent: options.agent,
        error: options.error || "Execution failed during LangGraph node processing",
        failedAt: "Just now",
        retryCount: 1,
        recoverable: true,
        timestamp: now,
      });
      if (this.failedTasks.length > 30) this.failedTasks.pop();
    }
  }

  public getDashboardData(): StudioDashboardData {
    const now = Date.now();
    const uptime = Math.floor((now - serverStartTime) / 1000);

    this.agents.forEach((agent) => {
      agent.uptimeSeconds = uptime;
    });

    const activeModel = process.env.LLM_MODEL || "gemini-3.6-flash";
    const activeProvider = (process.env.LLM_PROVIDER || "gemini").toUpperCase();

    // Query Langfuse / Live aggregation
    return {
      agents: this.agents,
      queue: this.queue,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      tokenMetrics: {
        totalTokens: this.totalTokens,
        promptTokens: this.promptTokens,
        completionTokens: this.completionTokens,
        totalCostUsd: Number(this.totalCost.toFixed(4)),
        budgetUsd: 25.0,
        providerBreakdown: [
          {
            provider: activeProvider,
            model: activeModel,
            tokens: this.totalTokens,
            cost: Number(this.totalCost.toFixed(4)),
          },
        ],
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  public enqueueTask(title: string, role: string, priority: "high" | "medium" | "low" = "medium") {
    const id = `queue-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    this.queue.push({
      id,
      title,
      agentRole: role,
      priority,
      queuedAt: "Just now",
      estimatedTokens: 8000,
    });
    return id;
  }

  public dequeueTask(id: string) {
    this.queue = this.queue.filter((t) => t.id !== id);
  }

  public retryTask(failedTaskId: string) {
    const failed = this.failedTasks.find((t) => t.id === failedTaskId);
    if (failed) {
      this.failedTasks = this.failedTasks.filter((t) => t.id !== failedTaskId);
      this.enqueueTask(failed.title, failed.agent, "high");
    }
  }
}

export const runtimeTracker = MultiAgentRuntimeTracker.getInstance();
