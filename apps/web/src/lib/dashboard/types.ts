/**
 * Dashboard view-model types shared between the dashboard query hook and
 * presentation components. These are derived views over authoritative
 * RunStore/StudioStore data served by the execution server — never a source
 * of truth themselves.
 */

export type TimeFilter = "today" | "week" | "month";
export type DashboardItemSource = "task" | "run";

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
  source: DashboardItemSource;
  period: TimeFilter;
  timestamp: number;
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
  source: DashboardItemSource;
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
  period: TimeFilter;
  source: DashboardItemSource;
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
