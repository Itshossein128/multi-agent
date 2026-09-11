import { Hono } from "hono";
import type { RunStoreContract } from "../runtime/runStore";
import type { StudioStore } from "../../../../src/studio/contracts";
import type { RunExecutor } from "../runtime/runExecutor";
import { type PrincipalResolver, type RequestPrincipal } from "../auth/principal";
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
export declare function createDashboardRouter(runStore: RunStoreContract, studioStore?: StudioStore, executor?: RunExecutor, resolvePrincipal?: PrincipalResolver): Hono<{
    Variables: {
        principal: RequestPrincipal;
    };
}, import("hono/types").BlankSchema, "/">;
