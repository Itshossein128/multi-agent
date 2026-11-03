import type { HumanApprovalDecision, HumanApprovalRole } from "@multi-agent/types";
import type { OrganizationMembership, OrganizationMembershipRole, StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";

const DEFAULT_ALLOWED_DECISIONS: readonly HumanApprovalDecision[] = [
  "approved",
  "rejected",
  "needs_clarification",
];

/** Map trusted organization membership roles onto Human Approval Gate roles. */
export function mapOrganizationRoleToApprovalRoles(
  membershipRole: OrganizationMembershipRole,
  membership?: Pick<OrganizationMembership, "metadata"> | null,
): HumanApprovalRole[] {
  const fromMetadata = membership?.metadata?.approvalRoles;
  if (Array.isArray(fromMetadata)) {
    return fromMetadata.filter((role): role is HumanApprovalRole =>
      role === "admin" || role === "project_manager" || role === "lead_architect",
    );
  }

  if (membershipRole === "owner" || membershipRole === "admin") {
    return ["admin"];
  }
  if (membershipRole === "member") {
    return ["project_manager"];
  }
  return [];
}

export function extractGateAuthorization(approval: {
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
} | null | undefined): {
  requiredRoles: HumanApprovalRole[];
  allowedDecisions: HumanApprovalDecision[];
} {
  const metadata = approval?.metadata ?? {};
  const context = approval?.context ?? {};
  const requiredRoles = normalizeRoles(
    metadata.requiredRoles ?? context.requiredRoles,
  );
  const allowedDecisions = normalizeDecisions(
    metadata.allowedDecisions ?? context.allowedDecisions,
  );
  return {
    requiredRoles,
    allowedDecisions: allowedDecisions.length > 0 ? allowedDecisions : [...DEFAULT_ALLOWED_DECISIONS],
  };
}

export async function assertApprovalDecisionAuthorized(options: {
  studioStore?: StudioStore;
  principal?: RequestPrincipal | null;
  tenantId?: string | null;
  approval: {
    metadata?: Record<string, unknown>;
    context?: Record<string, unknown>;
  } | null | undefined;
  decision: string;
  claimedReviewerRole?: string;
}): Promise<{ reviewerId: string; reviewerRole: HumanApprovalRole | string }> {
  const gate = extractGateAuthorization(options.approval);
  if (!gate.allowedDecisions.includes(options.decision as HumanApprovalDecision)) {
    throw new ApiError(
      400,
      `Decision "${options.decision}" is not allowed for this approval gate.`,
    );
  }

  const reviewerId = options.principal?.userId?.trim();
  if (!reviewerId) {
    throw new ApiError(401, "Authentication required to resolve approval decisions.");
  }

  if (!options.studioStore || !options.tenantId) {
    // Legacy routers without a Studio directory still require an authenticated
    // principal; production composition always wires the store for membership checks.
    const claimed = options.claimedReviewerRole;
    const safeClaimed = claimed === "admin" || claimed === "project_manager" || claimed === "lead_architect"
      ? claimed
      : "admin";
    return { reviewerId, reviewerRole: safeClaimed };
  }

  const membership = await options.studioStore.getMembership(options.tenantId, reviewerId);
  if (!membership || membership.status !== "active") {
    throw new ApiError(403, "Active organization membership is required to resolve this approval.");
  }

  const derivedRoles = mapOrganizationRoleToApprovalRoles(membership.role, membership);
  const requiredRoles = gate.requiredRoles.length > 0
    ? gate.requiredRoles
    : (["admin", "project_manager", "lead_architect"] as HumanApprovalRole[]);
  const matchedRole = derivedRoles.find((role) => requiredRoles.includes(role));
  if (!matchedRole) {
    throw new ApiError(
      403,
      `Organization role "${membership.role}" is not authorized for required approval roles: ${requiredRoles.join(", ")}.`,
    );
  }

  if (options.claimedReviewerRole && options.claimedReviewerRole !== matchedRole && !derivedRoles.includes(options.claimedReviewerRole as HumanApprovalRole)) {
    throw new ApiError(403, "Self-asserted reviewerRole does not match trusted organization membership.");
  }

  return { reviewerId, reviewerRole: matchedRole };
}

function normalizeRoles(value: unknown): HumanApprovalRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter((role): role is HumanApprovalRole =>
    role === "admin" || role === "project_manager" || role === "lead_architect",
  );
}

function normalizeDecisions(value: unknown): HumanApprovalDecision[] {
  if (!Array.isArray(value)) return [];
  return value.filter((decision): decision is HumanApprovalDecision =>
    decision === "approved" || decision === "rejected" || decision === "needs_clarification",
  );
}
