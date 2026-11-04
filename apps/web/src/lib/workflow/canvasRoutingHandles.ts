/**
 * Canvas routing helpers for Approval/Condition handle → edge semantics.
 * Mirrors specs/015-canvas-routing-usability/contracts/canvas-routing-handles.contract.ts
 */
import type { ApprovalDecision } from "@multi-agent/types";

export const APPROVAL_OUTCOME_HANDLES = [
  "approved",
  "rejected",
  "needs_clarification",
] as const satisfies readonly ApprovalDecision[];

export type ApprovalOutcomeHandle = (typeof APPROVAL_OUTCOME_HANDLES)[number];

export function isApprovalOutcomeHandle(value: string | null | undefined): value is ApprovalOutcomeHandle {
  return value === "approved" || value === "rejected" || value === "needs_clarification";
}

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

/**
 * When loading an edge from an approval source, dock to the outcome handle if
 * branchKey matches. Never invent or clear bindings.
 */
export function projectApprovalSourceHandle(branchKey: string | undefined): string | undefined {
  if (isApprovalOutcomeHandle(branchKey)) return branchKey;
  return undefined;
}

export const APPROVAL_HANDLE_AFFORDANCES: ReadonlyArray<{
  handleId: ApprovalOutcomeHandle;
  accessibleName: string;
  colorClass: string;
}> = [
  {
    handleId: "approved",
    accessibleName: "Approved",
    colorClass: "!bg-emerald-500 hover:!bg-emerald-400",
  },
  {
    handleId: "needs_clarification",
    accessibleName: "Needs clarification",
    colorClass: "!bg-amber-500 hover:!bg-amber-400",
  },
  {
    handleId: "rejected",
    accessibleName: "Rejected",
    colorClass: "!bg-red-500 hover:!bg-red-400",
  },
];
