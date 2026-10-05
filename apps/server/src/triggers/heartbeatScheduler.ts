import { nowIso, uid, type AgentHeartbeatSettings } from "@multi-agent/types";
import type { StudioStore } from "../../../../src/studio/contracts";
import type { RunExecutor } from "../runtime/runExecutor";
import { log } from "../logging";

export interface HeartbeatSchedulerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  claimLimit?: number;
}

/**
 * Periodically checks for due agent heartbeats, claims leases across multi-instance
 * deployments, verifies the agent is not already active, and enqueues wakeup trigger intents.
 */
export class HeartbeatScheduler {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly claimLimit: number;
  private timer?: NodeJS.Timeout;
  private running = false;
  private processing = false;

  constructor(
    private readonly store: StudioStore,
    private readonly executor: RunExecutor,
    options: HeartbeatSchedulerOptions = {},
  ) {
    this.workerId = options.workerId ?? `hb-worker-${uid("node")}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.claimLimit = options.claimLimit ?? 10;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextTick(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        if (this.running) {
          this.scheduleNextTick(this.pollIntervalMs);
        }
      });
    }, delayMs);
  }

  async tick(): Promise<AgentHeartbeatSettings[]> {
    if (this.processing) return [];
    this.processing = true;

    try {
      const due = await this.store.claimDueHeartbeats(this.workerId, this.claimLimit);
      if (!due.length) return [];

      const processed: AgentHeartbeatSettings[] = [];

      for (const hb of due) {
        try {
          const principal = { tenantId: hb.tenantId, userId: "system-heartbeat" };
          const agent = await this.store.getAgent(hb.agentId, principal);

          const now = Date.now();
          const nextTimestamp = new Date(now + hb.intervalSeconds * 1000).toISOString();

          if (!agent) {
            // Agent was removed; disable heartbeat
            await this.store.saveAgentHeartbeat(
              {
                ...hb,
                enabled: false,
                lockedBy: null,
                lockedUntil: null,
              },
              principal,
            );
            continue;
          }

          // Concurrency guard: Check durable cross-process run state and process-local active runs
          let isAgentBusy = false;
          if (typeof this.store.isAgentBusy === "function") {
            isAgentBusy = await this.store.isAgentBusy(hb.agentId, hb.tenantId);
          }
          if (!isAgentBusy) {
            const activeRuns = this.executor.getStore().list({ status: "running" });
            isAgentBusy = activeRuns.some((r) => {
              const entry = this.executor.getStore().get(r.id);
              const agentIds = (entry?.agentsSnapshot ?? []).map((a) => a.id);
              return agentIds.includes(hb.agentId);
            });
          }

          if (isAgentBusy) {
            // Defer heartbeat tick to next cycle rather than stacking concurrent executions
            await this.store.saveAgentHeartbeat(
              {
                ...hb,
                nextHeartbeatAt: nextTimestamp,
                lockedBy: null,
                lockedUntil: null,
              },
              principal,
            );
            log.info("heartbeat.skipped_busy", {
              agentId: hb.agentId,
              tenantId: hb.tenantId,
              reason: "agent_actively_running",
            });
            continue;
          }

          // Interval-based stable idempotency key
          const intervalMs = Math.max(1, hb.intervalSeconds) * 1000;
          const baseTime = hb.nextHeartbeatAt ? Date.parse(hb.nextHeartbeatAt) : now;
          const slot = Math.floor(baseTime / intervalMs);
          const idempotencyKey = `heartbeat:${hb.tenantId}:${hb.agentId}:${slot}`;

          // Update heartbeat schedule
          const updated: AgentHeartbeatSettings = {
            ...hb,
            lastHeartbeatAt: nowIso(),
            nextHeartbeatAt: nextTimestamp,
            lockedBy: null,
            lockedUntil: null,
          };

          // Wrap schedule update and outbox enqueue in one atomic transaction
          await this.store.transaction(async (tx) => {
            await tx.saveAgentHeartbeat(updated, principal);
            await tx.enqueueTriggerEvent({
              tenantId: hb.tenantId,
              eventType: "routine_tick",
              targetType: "agent",
              targetId: hb.agentId,
              idempotencyKey,
              payload: {
                heartbeat: true,
                agentId: hb.agentId,
                intervalSeconds: hb.intervalSeconds,
                slot,
              },
            });
          });

          log.info("heartbeat.dispatched", {
            agentId: hb.agentId,
            tenantId: hb.tenantId,
            nextHeartbeatAt: nextTimestamp,
            slot,
          });

          processed.push(updated);
        } catch (error) {
          log.warn("heartbeat.failed", {
            agentId: hb.agentId,
            tenantId: hb.tenantId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return processed;
    } finally {
      this.processing = false;
    }
  }
}
