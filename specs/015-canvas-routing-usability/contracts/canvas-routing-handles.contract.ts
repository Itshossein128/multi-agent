/**
 * UI / authoring contract: Approval + Condition canvas handles
 * Feature: 015-canvas-routing-usability
 *
 * Documents the handle IDs and edge semantics the Studio canvas MUST produce.
 * Not a runtime import — reference for implementers and tests.
 */

/** Fixed Approval outcome handle IDs (also conditional branchKey values). */
export const APPROVAL_OUTCOME_HANDLES = [
  "approved",
  "rejected",
  "needs_clarification",
] as const;

export type ApprovalOutcomeHandle = (typeof APPROVAL_OUTCOME_HANDLES)[number];

export function isApprovalOutcomeHandle(value: string | null | undefined): value is ApprovalOutcomeHandle {
  return value === "approved" || value === "rejected" || value === "needs_clarification";
}

/**
 * Expected edge fields after a successful connect gesture from a handle.
 * Matches @multi-agent/types WorkflowEdge kind/branchKey semantics.
 */
export interface HandleDerivedEdgeSemantics {
  kind: "conditional" | "normal";
  branchKey: string;
}

export function edgeSemanticsFromSourceHandle(args: {
  sourceNodeType: string;
  sourceHandle: string | null | undefined;
}): HandleDerivedEdgeSemantics {
  if (args.sourceNodeType === "approval" && isApprovalOutcomeHandle(args.sourceHandle)) {
    return { kind: "conditional", branchKey: args.sourceHandle };
  }
  if (args.sourceNodeType === "condition" && typeof args.sourceHandle === "string" && args.sourceHandle.length > 0) {
    return { kind: "conditional", branchKey: args.sourceHandle };
  }
  return { kind: "normal", branchKey: "" };
}

/** Accessibility: each outcome/branch handle MUST expose a non-color-only name. */
export interface HandleAffordanceContract {
  handleId: string;
  /** Visible label text and/or aria-label / title. */
  accessibleName: string;
  /** Optional distinct color token — MUST NOT be the sole identity cue. */
  colorToken?: string;
}

export const APPROVAL_HANDLE_AFFORDANCES: HandleAffordanceContract[] = [
  { handleId: "approved", accessibleName: "Approved", colorToken: "success" },
  { handleId: "rejected", accessibleName: "Rejected", colorToken: "danger" },
  { handleId: "needs_clarification", accessibleName: "Needs clarification", colorToken: "warning" },
];

/**
 * React Flow projection: when loading an edge from an approval source,
 * dock to the outcome handle if branchKey matches; never clear branchKey.
 */
export function projectApprovalSourceHandle(branchKey: string | undefined): string | undefined {
  if (isApprovalOutcomeHandle(branchKey)) return branchKey;
  return undefined;
}
