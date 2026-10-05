import { nowIso, uid, type TriggerEvent } from "@multi-agent/types";
import type { StudioPrincipal, StudioStore } from "../../../../src/studio/contracts";
import type { RunExecutor } from "../runtime/runExecutor";
import type { TaskService } from "../api/studio/taskService";
import { log } from "../logging";

export interface TriggerOutboxProcessorOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseDurationSeconds?: number;
}

/**
 * Background worker that claims durable trigger intents from the outbox
 * using PostgreSQL `FOR UPDATE SKIP LOCKED` and dispatches workflow/task runs.
 */
export class TriggerOutboxProcessor {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseDurationSeconds: number;
  private timer?: NodeJS.Timeout;
  private running = false;
  private processing = false;

  constructor(
    private readonly store: StudioStore,
    private readonly executor?: RunExecutor,
    private readonly taskService?: TaskService,
    options: TriggerOutboxProcessorOptions = {},
  ) {
    this.workerId = options.workerId ?? `worker-${uid("node")}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.leaseDurationSeconds = options.leaseDurationSeconds ?? 60;
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

  /**
   * Single execution tick: claims the next available outbox event
   * and processes it to completion.
   */
  async tick(): Promise<TriggerEvent | null> {
    if (this.processing) return null;
    this.processing = true;

    try {
      const event = await this.store.claimNextTriggerEvent(this.workerId, this.leaseDurationSeconds);
      if (!event) return null;

      try {
        const dispatchedRunId = await this.processEvent(event);
        const updated = await this.store.updateTriggerEvent(
          event.id,
          {
            status: "processed",
            dispatchedRunId: dispatchedRunId ?? null,
            lastError: null,
            lockedBy: null,
            lockedUntil: null,
          },
          this.workerId,
        );
        if (!updated) {
          log.warn("trigger.ack_lease_lost", {
            eventId: event.id,
            workerId: this.workerId,
          });
        }
        log.info("trigger.processed", {
          eventId: event.id,
          eventType: event.eventType,
          targetType: event.targetType,
          targetId: event.targetId,
          tenantId: event.tenantId,
          runId: dispatchedRunId,
        });
        return event;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const nextRetry = event.retryCount + 1;
        const isDeadLetter = nextRetry >= event.maxRetries;
        const delaySeconds = Math.min(300, Math.pow(2, nextRetry) * 5);
        const nextRetryAt = isDeadLetter
          ? null
          : new Date(Date.now() + delaySeconds * 1000).toISOString();

        const updated = await this.store.updateTriggerEvent(
          event.id,
          {
            status: isDeadLetter ? "dead_letter" : "failed",
            retryCount: nextRetry,
            nextRetryAt,
            lastError: message,
            lockedBy: null,
            lockedUntil: null,
          },
          this.workerId,
        );
        if (!updated) {
          log.warn("trigger.retry_lease_lost", {
            eventId: event.id,
            workerId: this.workerId,
          });
        }

        log.warn(isDeadLetter ? "trigger.dead_letter" : "trigger.failed", {
          eventId: event.id,
          eventType: event.eventType,
          tenantId: event.tenantId,
          retryCount: nextRetry,
          maxRetries: event.maxRetries,
          error: message,
        });
        return event;
      }
    } finally {
      this.processing = false;
    }
  }

  private async processEvent(event: TriggerEvent): Promise<string | undefined> {
    const principal: StudioPrincipal = {
      tenantId: event.tenantId,
      userId: (event.payload?.userId as string) ?? "system-trigger",
    };

    if (event.targetType === "task") {
      const task = await this.store.getTask(event.targetId, principal);
      if (!task) {
        throw new Error(`Target task "${event.targetId}" not found for tenant "${event.tenantId}"`);
      }

      // If approval is being resolved, verify if run exists and resume; NEVER spawn a new run.
      if (event.eventType === "approval_resolved") {
        const runId = task.runId;
        const approvalId = event.payload?.approvalId as string | undefined;
        if (runId && approvalId && this.executor?.isRunResumable(runId)) {
          const decision = (event.payload?.decision as "approved" | "rejected") ?? "approved";
          const response = (event.payload?.response as string) ?? undefined;
          const clarificationAnswers = event.payload?.clarificationAnswers as
            | Array<{ questionId: string; value: string }>
            | undefined;
          try {
            this.executor.resolveApproval(runId, approvalId, {
              decision,
              response,
              clarificationAnswers,
            });
          } catch (err: any) {
            log.info("trigger.approval_already_resolved", {
              runId,
              approvalId,
              error: err?.message,
            });
          }
        }
        // Always treat approval_resolved as audit/reconciliation without creating a new run
        return runId ?? undefined;
      }

      // If a specific target agent was requested (e.g. from an @mention), wake that specific agent
      const specificTargetAgentId = event.payload?.targetAgentId as string | undefined;
      if (specificTargetAgentId) {
        if (!this.executor) {
          throw new Error("RunExecutor not configured for trigger outbox processor");
        }
        const agent = await this.store.getAgent(specificTargetAgentId, principal);
        if (!agent) {
          throw new Error(`Target agent "${specificTargetAgentId}" not found for tenant "${event.tenantId}"`);
        }
        const tools = await this.store.listTools(principal);
        const { createSingleAgentWorkflow } = await import("@multi-agent/types");
        const workflow = createSingleAgentWorkflow(agent, `Task [${task.title}]: Mention of @${agent.name}`);
        return this.executor.start(
          {
            workflow,
            agents: [agent],
            tools,
            input: { taskId: task.id, title: task.title, ...(event.payload ?? {}) },
            taskId: task.id,
            metadata: {
              triggerEventId: event.id,
              triggerEventType: event.eventType,
              targetAgentId: specificTargetAgentId,
              tenantId: event.tenantId,
            },
          },
          undefined,
          principal,
        );
      }

      // Check if task is already running
      if (task.status === "running" && task.runId) {
        const existingRun = this.executor?.getStore().get(task.runId);
        if (existingRun && ["queued", "running", "waiting_for_human"].includes(existingRun.run.status)) {
          // Task is already actively executing; do not start duplicate run
          return task.runId;
        }
      }

      if (this.taskService) {
        try {
          const result = await this.taskService.start(task.id, {
            userId: principal.userId,
            tenantId: principal.tenantId,
          });
          return result.runId;
        } catch (err: any) {
          if (/already executing/i.test(err?.message)) {
            return task.runId ?? undefined;
          }
          throw err;
        }
      }

      if (this.executor) {
        if (task.workflowId) {
          const workflow = await this.store.getWorkflow(task.workflowId, principal);
          if (workflow) {
            const agents = await this.store.listAgents(principal);
            const tools = await this.store.listTools(principal);
            return this.executor.start(
              {
                workflow,
                agents,
                tools,
                input: { taskId: task.id, title: task.title, ...(event.payload ?? {}) },
                taskId: task.id,
                metadata: { triggerEventId: event.id, triggerEventType: event.eventType, tenantId: event.tenantId },
              },
              undefined,
              principal,
            );
          }
        }

        const agentId = task.assignedAgent ?? task.assignedAgents?.[0];
        if (agentId) {
          const agent = await this.store.getAgent(agentId, principal);
          if (agent) {
            const tools = await this.store.listTools(principal);
            const { createSingleAgentWorkflow } = await import("@multi-agent/types");
            const workflow = createSingleAgentWorkflow(agent, `Task: ${task.title}`);
            return this.executor.start(
              {
                workflow,
                agents: [agent],
                tools,
                input: { taskId: task.id, title: task.title, ...(event.payload ?? {}) },
                taskId: task.id,
                metadata: { triggerEventId: event.id, triggerEventType: event.eventType, tenantId: event.tenantId },
              },
              undefined,
              principal,
            );
          }
        }

        return task.runId ?? undefined;
      }

      return task.runId ?? undefined;
    }

    if (event.targetType === "workflow") {
      if (!this.executor) {
        throw new Error(`RunExecutor not configured for trigger outbox processor`);
      }
      const workflow = await this.store.getWorkflow(event.targetId, principal);
      if (!workflow) {
        throw new Error(`Target workflow "${event.targetId}" not found for tenant "${event.tenantId}"`);
      }
      const agents = await this.store.listAgents(principal);
      const tools = await this.store.listTools(principal);

      const runId = this.executor.start(
        {
          workflow,
          agents,
          tools,
          input: event.payload ?? {},
          metadata: {
            triggerEventId: event.id,
            triggerEventType: event.eventType,
            tenantId: event.tenantId,
          },
        },
        undefined,
        {
          userId: principal.userId,
          tenantId: principal.tenantId,
        },
      );
      return runId;
    }

    if (event.targetType === "agent") {
      if (!this.executor) {
        throw new Error(`RunExecutor not configured for trigger outbox processor`);
      }
      const agent = await this.store.getAgent(event.targetId, principal);
      if (!agent) {
        throw new Error(`Target agent "${event.targetId}" not found for tenant "${event.tenantId}"`);
      }
      const tools = await this.store.listTools(principal);
      const { createSingleAgentWorkflow } = await import("@multi-agent/types");
      const workflow = createSingleAgentWorkflow(agent, `Trigger: ${event.eventType}`);

      const runId = this.executor.start(
        {
          workflow,
          agents: [agent],
          tools,
          input: event.payload ?? {},
          metadata: {
            triggerEventId: event.id,
            triggerEventType: event.eventType,
            tenantId: event.tenantId,
          },
        },
        undefined,
        {
          userId: principal.userId,
          tenantId: principal.tenantId,
        },
      );
      return runId;
    }

    throw new Error(`Unsupported trigger targetType: ${event.targetType}`);
  }
}
