import type { Run } from "@multi-agent/types";
import type {
  OrganizationMembership,
  OrganizationProfile,
  StudioPrincipal,
} from "../../../../src/studio/contracts";

/** D-5 / FR-105: an execution whose initiator lost organization access stops. */
export const ORGANIZATION_ACCESS_REVOKED = "ORGANIZATION_ACCESS_REVOKED";
/** INV-6 / FR-105: a memory grant must belong to the run's organization. */
export const MEMORY_ACCESS_ORGANIZATION_MISMATCH = "MEMORY_ACCESS_ORGANIZATION_MISMATCH";

export type RunInitiatorKind = "user" | "service" | "schedule" | "trigger";
export const RUN_INITIATOR_KINDS: readonly RunInitiatorKind[] = ["user", "service", "schedule", "trigger"];

export function isRunInitiatorKind(value: unknown): value is RunInitiatorKind {
  return typeof value === "string" && (RUN_INITIATOR_KINDS as readonly string[]).includes(value);
}

export type RevocationReason =
  | "organization_inactive"
  | "membership_revoked"
  | "membership_missing"
  | "user_disabled"
  | "run_not_found";

export class OrganizationAccessRevokedError extends Error {
  readonly code = ORGANIZATION_ACCESS_REVOKED;
  readonly reason: RevocationReason;
  constructor(reason: RevocationReason, detail?: string) {
    super(`${ORGANIZATION_ACCESS_REVOKED}: ${detail ?? reason}`);
    this.name = "OrganizationAccessRevokedError";
    this.reason = reason;
  }
}

export class MemoryAccessOrganizationMismatchError extends Error {
  readonly code = MEMORY_ACCESS_ORGANIZATION_MISMATCH;
  constructor(detail: string) {
    super(`${MEMORY_ACCESS_ORGANIZATION_MISMATCH}: ${detail}`);
    this.name = "MemoryAccessOrganizationMismatchError";
  }
}

export interface RunAccessInput {
  id?: string;
  tenantId?: string;
  ownerId?: string;
  initiatorKind?: RunInitiatorKind;
  metadata?: Record<string, unknown>;
}

/** Who started this run: explicit metadata wins, then trigger shape, then principal kind. */
export function deriveRunInitiatorKind(input: {
  metadata?: Record<string, unknown>;
  principalKind?: string;
}): RunInitiatorKind {
  const metadata = input.metadata ?? {};
  if (isRunInitiatorKind(metadata.initiatorKind)) return metadata.initiatorKind;
  if (typeof metadata.triggerEventId === "string" && metadata.triggerEventId) {
    return metadata.triggerEventType === "routine_tick" ? "schedule" : "trigger";
  }
  if (typeof metadata.triggerDispatchKey === "string" && metadata.triggerDispatchKey) return "trigger";
  return input.principalKind === "service" ? "service" : "user";
}

export interface OrganizationAccessStore {
  getOrganizationProfile(principal: StudioPrincipal): Promise<OrganizationProfile | null>;
  getMembership(organizationId: string, userId: string): Promise<OrganizationMembership | null>;
  listMemberships(organizationId: string): Promise<OrganizationMembership[]>;
  isOrganizationUserActive(userId: string): Promise<boolean>;
}

export interface InitiatorStartContext {
  initiatorKind: RunInitiatorKind;
  membershipVersionAtStart?: number;
}

/**
 * Server-side revalidation of a run's initiator (D-5, plan Phase 3).
 *
 * Checkpoints: before a run starts/restarts execution, before an approval
 * resumes a paused run, before a retry, and before any credential lease.
 * Tasks and run history are never touched — only execution stops.
 */
export class RunOrganizationAccess {
  constructor(private readonly store: OrganizationAccessStore) {}

  /** Non-throwing snapshot captured when a run starts. */
  async resolveStartContext(
    run: RunAccessInput & { principalKind?: string },
  ): Promise<InitiatorStartContext> {
    const initiatorKind = deriveRunInitiatorKind({ metadata: run.metadata, principalKind: run.principalKind });
    let membershipVersionAtStart: number | undefined;
    if (run.tenantId && run.ownerId && initiatorKind === "user") {
      const membership = await this.store.getMembership(run.tenantId, run.ownerId);
      membershipVersionAtStart = membership?.version;
    }
    return { initiatorKind, membershipVersionAtStart };
  }

  /** Throws OrganizationAccessRevokedError when execution must stop. */
  async assertRunActive(run: RunAccessInput): Promise<void> {
    const organizationId = run.tenantId?.trim();
    if (!organizationId) return; // no organization boundary recorded on the run
    const profile = await this.store.getOrganizationProfile({
      userId: run.ownerId ?? "system",
      tenantId: organizationId,
    });
    if (profile && profile.status !== "active") {
      throw new OrganizationAccessRevokedError(
        "organization_inactive",
        `organization ${organizationId} is ${profile.status}`,
      );
    }
    const ownerId = run.ownerId?.trim();
    if (!ownerId) return;
    const initiatorKind = run.initiatorKind ?? deriveRunInitiatorKind({ metadata: run.metadata });
    if (initiatorKind !== "user") {
      // schedule/trigger/service runs are organization-bound; routine owners are
      // revalidated where the schedule fires (RoutineScheduler).
      return;
    }
    const membership = await this.store.getMembership(organizationId, ownerId);
    if (membership) {
      if (membership.status !== "active") {
        throw new OrganizationAccessRevokedError(
          "membership_revoked",
          `initiator ${ownerId} membership is ${membership.status}`,
        );
      }
      if (!(await this.store.isOrganizationUserActive(ownerId))) {
        throw new OrganizationAccessRevokedError("user_disabled", `initiator account ${ownerId} is not active`);
      }
      return;
    }
    if (!profile) return; // tenant without an organization record (development fixture)
    const known = await this.store.listMemberships(organizationId);
    if (known.length > 0) {
      throw new OrganizationAccessRevokedError(
        "membership_missing",
        `initiator ${ownerId} has no membership in ${organizationId}`,
      );
    }
  }

  /** Routines stop firing once their owner loses organization access (D-5). */
  async assertRoutineActive(routine: { tenantId: string; ownerId?: string | null }): Promise<void> {
    await this.assertRunActive({
      tenantId: routine.tenantId,
      ownerId: routine.ownerId ?? undefined,
      initiatorKind: "user",
    });
  }
}

/** Derive + persist initiator fields for a run being created (best effort at start). */
export function assertMemoryAccessMatchesRun(
  run: { id?: string; tenantId?: string },
  access: { tenantId?: string } | undefined,
): void {
  if (!access?.tenantId || !run.tenantId) return;
  if (access.tenantId !== run.tenantId) {
    throw new MemoryAccessOrganizationMismatchError(
      `memory grant organization ${access.tenantId} does not match run organization ${run.tenantId}`,
    );
  }
}

export type { Run };
