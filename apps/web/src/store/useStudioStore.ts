import { create } from "zustand";
import {
  AgentInstance,
  QueuedTask,
  CompletedTask,
  FailedTask,
  TokenMetrics,
  StudioDashboardData,
  TimeFilter,
} from "@/lib/runtimeTracker";

export type { TimeFilter, AgentInstance, QueuedTask, CompletedTask, FailedTask, TokenMetrics };

interface StudioState {
  timeFilter: TimeFilter;
  setTimeFilter: (filter: TimeFilter) => void;
  agents: AgentInstance[];
  queue: QueuedTask[];
  completedTasks: CompletedTask[];
  failedTasks: FailedTask[];
  tokenMetrics: TokenMetrics;
  lastUpdated?: string;
  isLive: boolean;

  // Actions
  syncWithBackend: (data: StudioDashboardData) => void;
  setAgents: (agents: AgentInstance[]) => void;
  setQueue: (queue: QueuedTask[]) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  timeFilter: "today",
  setTimeFilter: (filter) => set({ timeFilter: filter }),

  agents: [],
  queue: [],
  completedTasks: [],
  failedTasks: [],
  tokenMetrics: {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalCostUsd: 0,
    budgetUsd: 25.0,
    providerBreakdown: [],
  },
  isLive: false,

  syncWithBackend: (data) =>
    set({
      agents: data.agents,
      queue: data.queue,
      completedTasks: data.completedTasks,
      failedTasks: data.failedTasks,
      tokenMetrics: data.tokenMetrics,
      lastUpdated: data.lastUpdated,
      isLive: true,
    }),

  setAgents: (agents) => set({ agents }),
  setQueue: (queue) => set({ queue }),
}));
