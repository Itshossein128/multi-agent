import { runDispatchContext } from "../runtime/runDispatchContext";
import { nowIso, uid, type TriggerEvent } from "@multi-agent/types";
import type { StudioPrincipal, StudioStore } from "../../../../src/studio/contracts";
import {
  assertOrganizationScope,
  asyncLocalOrganizationScopeRunner,
  type OrganizationScopeRunner,
} from "../../../../src/studio/infrastructure/organizationJobScope";
import type { RunExecutor } from "../runtime/runExecutor";
import {
  OrganizationAccessRevokedError,
  type RunOrganizationAccess,
} from "../runtime/runOrganizationAccess";
import type { TaskService } from "../api/studio/taskService";
import { log } from "../logging";
import { OrganizationContextDeniedError, OrganizationContextResolver } from "../auth/organizationContext";
import {
  assertRoutineDispatchTarget,
  routineActor,
  RoutineTargetAccessError,
} from "./routineTargetAccess";

export interface TriggerOutboxProcessorOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseDurationSeconds?: number;
  /** Executes each claimed event inside its own organization scope (US3/T050). */
  scopeRunner?: OrganizationScopeRunner;
}

/**
 * Background worker that claims durable trigger intents from the outbox
 * using PostgreSQL `FOR UPDATE SKIP LOCKED` and dispatches workflow/task runs.
 */
export class TriggerOutboxProcessor {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseDurationSeconds: number;
  private readonly scopeRunner: OrganizationScopeRunner;
  private timer?: NodeJS.Timeout;
  private running = false;
  private processing = false;

  constructor(
    private readonly store: StudioStore,
    private readonly executor?: RunExecutor,
    private readonly taskService?: TaskService,
    options: TriggerOutboxProcessorOptions = {},
    private readonly organizationAccess?: RunOrganizationAccess,
  ) {
    this.workerId = options.workerId ?? `worker-${uid("node")}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.leaseDurationSeconds = options.leaseDurationSeconds ?? 60;
    this.scopeRunner = options.scopeRunner ?? asyncLocalOrganizationScopeRunner;
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
        const dispatchedRunId = await this.scopeRunner(
          { organizationId: event.tenantId, source: "trigger_outbox" },
          async () => {
            // Per-item organization assertion (INV-7 / US3).
            assertOrganizationScope(event.tenantId);
            if (this.organizationAccess) {
              try {
                await this.organizationAccess.assertRunActive({ tenantId: event.tenantId, initiatorKind: "service" });
              } catch (error) {
                // Suspended/deleted organizations never dispatch scheduled work.
                if (error instanceof OrganizationAccessRevokedError) return { revoked: true as const };
                throw error;
              }
            }
            const routineOwnerId = await this.routineOwnerForDispatch(event);
            if (routineOwnerId && this.organizationAccess) {
              try {
                await this.organizationAccess.assertRoutineActive({ tenantId: event.tenantId, ownerId: routineOwnerId });
              } catch (error) {
                if (error instanceof OrganizationAccessRevokedError) return { revoked: true as const };
                throw error;
              }
            }
            const webhookOwnerId = await this.webhookOwnerForDispatch(event);
            if (webhookOwnerId && this.organizationAccess) {
              try {
                await this.organizationAccess.assertRoutineActive({ tenantId: event.tenantId, ownerId: webhookOwnerId });
              } catch (error) {
                if (error instanceof OrganizationAccessRevokedError) return { revoked: true as const };
                throw error;
              }
            }
            const runId = await runDispatchContext.run(Object.freeze({ organizationId: event.tenantId, kind: event.eventType === "routine_tick" ? "schedule" : "trigger" }), () => this.processEvent(event));
            if (runId) await this.executor?.getStore?.().waitForPersistence?.(runId);
            return { revoked: false as const, runId };
          },
        );
        if (dispatchedRunId && "revoked" in dispatchedRunId && dispatchedRunId.revoked) {
          const denied = await this.store.updateTriggerEvent(
            event.id,
            {
              status: "dead_letter",
              lastError: "ORGANIZATION_ACCESS_REVOKED",
              lockedBy: null,
              lockedUntil: null,
            },
            this.workerId,
          );
          log.warn("trigger.organization_access_revoked", {
            eventId: event.id,
            tenantId: event.tenantId,
            leaseLost: !denied,
          });
          return event;
        }
        const dispatchedRunIdValue = dispatchedRunId && "runId" in dispatchedRunId ? dispatchedRunId.runId : undefined;
        const updated = await this.store.updateTriggerEvent(
          event.id,
          {
            status: "processed",
            dispatchedRunId: dispatchedRunIdValue ?? null,
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
          runId: dispatchedRunIdValue,
        });
        return event;
      } catch (error) {
        if (error instanceof RoutineTargetAccessError) {
          const denied = await this.store.updateTriggerEvent(
            event.id,
            {
              status: "dead_letter",
              lastError: `${error.code}: ${error.message}`,
              lockedBy: null,
              lockedUntil: null,
            },
            this.workerId,
          );
          log.warn("trigger.routine_target_forbidden", {
            eventId: event.id,
            tenantId: event.tenantId,
            targetType: event.targetType,
            targetId: event.targetId,
            leaseLost: !denied,
          });
          return event;
        }
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

  /**
   * User routines carry a routine id. The stored routine owner is the only actor
   * allowed to execute that target. Heartbeats reuse routine_tick without a routine
   * id and keep the service principal, as do task wakeups. Webhooks are
   * authorized independently against their stored owner.
   */
  private async routineOwnerForDispatch(event: TriggerEvent): Promise<string | null> {
    if (event.eventType !== "routine_tick" || event.payload?.heartbeat === true) return null;
    const routineId = event.payload?.routineId;
    if (typeof routineId !== "string" || !routineId.trim()) return null;
    const routine = await this.store.getRoutine(routineId.trim(), {
      tenantId: event.tenantId,
      userId: "system-trigger",
      principalKind: "service",
      allowOwnershipBypass: false,
    });
    if (!routine || routine.tenantId !== event.tenantId || !routine.ownerId?.trim()) {
      throw new RoutineTargetAccessError(`Routine "${routineId}" cannot be executed`);
    }
    if (routine.targetType !== event.targetType || routine.targetId !== event.targetId) {
      throw new RoutineTargetAccessError(`Routine "${routineId}" is not allowed to execute this target`);
    }
    return routine.ownerId;
  }

  private async dispatchPrincipal(event: TriggerEvent): Promise<StudioPrincipal> {
    const ownerId = await this.routineOwnerForDispatch(event) ?? await this.webhookOwnerForDispatch(event);
    if (!ownerId) {
      const payloadUserId = event.payload?.userId;
      return {
        tenantId: event.tenantId,
        principalKind: "service",
        userId: typeof payloadUserId === "string" && payloadUserId.trim() ? payloadUserId : "system-trigger",
      };
    }
    const actor = routineActor({ tenantId: event.tenantId, userId: ownerId });
    await assertRoutineDispatchTarget(this.store, actor, event.targetType, event.targetId);
    return actor;
  }

  private async webhookOwnerForDispatch(event: TriggerEvent): Promise<string | null> {
    if (event.eventType !== "webhook_inbound") return null;
    const triggerId = event.payload?.triggerId;
    if (typeof triggerId !== "string" || !triggerId.trim()) {
      throw new RoutineTargetAccessError("Webhook trigger cannot be executed");
    }
    const trigger = await this.store.getWebhookTrigger(triggerId, {
      tenantId: event.tenantId, userId: "system-trigger", principalKind: "service", allowOwnershipBypass: false,
    });
    if (!trigger || !trigger.enabled || !trigger.ownerId?.trim() ||
        trigger.targetType !== event.targetType || trigger.targetId !== event.targetId) {
      throw new RoutineTargetAccessError("Webhook trigger cannot execute this target");
    }
    try {
      const context = await new OrganizationContextResolver(this.store).resolve(event.tenantId, trigger.ownerId);
      if (!context.permissions.includes("credentials.manage") || !context.permissions.includes("runs.execute")) {
        throw new RoutineTargetAccessError("Webhook owner lacks execution permission");
      }
    } catch (error) {
      if (error instanceof OrganizationContextDeniedError) throw new RoutineTargetAccessError("Webhook owner no longer has access");
      throw error;
    }
    return trigger.ownerId;
  }

  private async processEvent(event: TriggerEvent): Promise<string | undefined> {
    const principal = await this.dispatchPrincipal(event);

    const triggerDispatchKey = `trigger:${event.id}`;

    // If this event was already dispatched to a run in a previous attempt before worker crash
    if (event.dispatchedRunId) {
      return event.dispatchedRunId;
    }

    if (this.executor && typeof this.executor.getStore === "function") {
      const runStore = this.executor.getStore();
      const existing = runStore?.findByTriggerDispatchKey?.(triggerDispatchKey, event.tenantId);
      if (existing) {
        return existing.run.id;
      }
      if (typeof (runStore as any)?.findDurableRunIdByTriggerDispatchKey === "function") {
        const durableRunId = await (runStore as any).findDurableRunIdByTriggerDispatchKey(triggerDispatchKey, event.tenantId);
        if (durableRunId) {
          return durableRunId;
        }
      }
    }

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
              triggerDispatchKey,
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
        const runStore = typeof this.executor?.getStore === "function" ? this.executor.getStore() : undefined;
        const existingRun = runStore?.get(task.runId);
        if (existingRun && ["queued", "running", "waiting_for_human"].includes(existingRun.run.status)) {
          // Task is already actively executing; do not start duplicate run
          return task.runId;
        }
      }

      if (this.taskService) {
        try {
          const result = await this.taskService.start(
            task.id,
            {
              userId: principal.userId,
              tenantId: principal.tenantId,
            },
            { triggerDispatchKey },
          );
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
                metadata: {
                  triggerDispatchKey,
                  triggerEventId: event.id,
                  triggerEventType: event.eventType,
                  tenantId: event.tenantId,
                },
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
                metadata: {
                  triggerDispatchKey,
                  triggerEventId: event.id,
                  triggerEventType: event.eventType,
                  tenantId: event.tenantId,
                },
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
            triggerDispatchKey,
            triggerEventId: event.id,
            triggerEventType: event.eventType,
            tenantId: event.tenantId,
          },
        },
        undefined,
        principal,
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
            triggerDispatchKey,
            triggerEventId: event.id,
            triggerEventType: event.eventType,
            tenantId: event.tenantId,
          },
        },
        undefined,
        principal,
      );
      return runId;
    }

    throw new Error(`Unsupported trigger targetType: ${event.targetType}`);
  }
}
