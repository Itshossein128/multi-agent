import type { StudioPrincipal, StudioStore } from "../../../../src/studio/contracts";

/** Permanent refusal to execute a routine target the creator cannot access. */
export class RoutineTargetAccessError extends Error {
  readonly code = "ROUTINE_TARGET_FORBIDDEN";

  constructor(message: string) {
    super(message);
    this.name = "RoutineTargetAccessError";
  }
}

export type RoutineTargetType = "workflow" | "agent" | "task";

/** Personal actor. Ownership bypass stays off so private resources stay private. */
export function routineActor(principal: Pick<StudioPrincipal, "tenantId" | "userId">): StudioPrincipal {
  return {
    tenantId: principal.tenantId,
    userId: principal.userId,
    principalKind: "user",
    allowOwnershipBypass: false,
  };
}

/**
 * The creator must be able to read the workflow, agent, or task they are binding.
 * Missing and inaccessible targets share one message so an id is not an existence oracle.
 */
export async function assertRoutineTargetAccessible(
  store: StudioStore,
  principal: Pick<StudioPrincipal, "tenantId" | "userId">,
  targetType: RoutineTargetType,
  targetId: string,
): Promise<void> {
  const actor = routineActor(principal);
  if (targetType === "agent") {
    const agent = await store.getAgent(targetId, actor);
    if (!agent) {
      throw new RoutineTargetAccessError(`Target agent "${targetId}" not found in current tenant`);
    }
    return;
  }
  if (targetType === "task") {
    const task = await store.getTask(targetId, actor);
    if (!task) {
      throw new RoutineTargetAccessError(`Target task "${targetId}" not found in current tenant`);
    }
    return;
  }
  const workflow = await store.getWorkflow(targetId, actor);
  if (!workflow) {
    throw new RoutineTargetAccessError(`Target workflow "${targetId}" not found in current tenant`);
  }
}

/**
 * Authorize what a routine will actually execute.
 * A task target also requires access to the workflow or agent that task would run,
 * matching a direct task start by the same user.
 */
export async function assertRoutineDispatchTarget(
  store: StudioStore,
  principal: Pick<StudioPrincipal, "tenantId" | "userId">,
  targetType: RoutineTargetType,
  targetId: string,
): Promise<void> {
  if (targetType === "workflow" || targetType === "agent") {
    await assertRoutineTargetAccessible(store, principal, targetType, targetId);
    return;
  }
  const actor = routineActor(principal);
  const task = await store.getTask(targetId, actor);
  if (!task) {
    throw new RoutineTargetAccessError(`Target task "${targetId}" not found in current tenant`);
  }
  if (task.workflowId) {
    await assertRoutineTargetAccessible(store, actor, "workflow", task.workflowId);
    return;
  }
  const agentId = task.assignedAgent ?? task.assignedAgents?.find((id) => id.trim()) ?? null;
  if (agentId) {
    await assertRoutineTargetAccessible(store, actor, "agent", agentId);
  }
}
