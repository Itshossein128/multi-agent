import type { RunEvent, RunStatus } from "@multi-agent/types";

export interface ReplaySnapshot {
  runId: string;
  status: RunStatus | "unknown";
  eventCount: number;
  currentNodeId?: string;
  branches: string[];
  completedNodes: string[];
  failedNodes: string[];
  approvals: { id: string; nodeId?: string; status: string }[];
  firstEventAt?: string;
  lastEventAt?: string;
}

/** Reconstructs a bounded operational timeline from persisted events only. */
export function replayRunEvents(runId: string, events: readonly RunEvent[]): ReplaySnapshot {
  const branches = new Set<string>();
  const completed = new Set<string>();
  const failed = new Set<string>();
  const approvals = new Map<string, { id: string; nodeId?: string; status: string }>();
  let status: ReplaySnapshot["status"] = "unknown";
  let currentNodeId: string | undefined;
  for (const event of events) {
    currentNodeId = event.nodeId ?? currentNodeId;
    if (event.type === "state.updated" && typeof event.payload.branch === "string") branches.add(event.payload.branch);
    if (event.type === "edge.traversed" && typeof event.payload.branchKey === "string") branches.add(event.payload.branchKey);
    if (event.type === "node.completed" && event.nodeId) completed.add(event.nodeId);
    if (event.type === "node.failed" && event.nodeId) failed.add(event.nodeId);
    if (event.type === "run.started") status = "running";
    if (event.type === "run.paused") status = "waiting_for_human";
    if (event.type === "run.resumed") status = "running";
    if (event.type === "run.completed") status = "completed";
    if (event.type === "run.failed") status = "failed";
    if (event.type === "run.cancelled") status = "cancelled";
    const approvalId = typeof event.payload.approvalId === "string" ? event.payload.approvalId : undefined;
    if (approvalId) {
      const current = approvals.get(approvalId) ?? { id: approvalId, nodeId: event.nodeId, status: "requested" };
      if (event.type === "human_approval.approved") current.status = "approved";
      if (event.type === "human_approval.rejected") current.status = "rejected";
      if (event.type === "human_approval.resolved") current.status = String(event.payload.decision ?? current.status);
      approvals.set(approvalId, current);
    }
  }
  return {
    runId, status, eventCount: events.length, currentNodeId,
    branches: [...branches].slice(0, 100), completedNodes: [...completed].slice(0, 100), failedNodes: [...failed].slice(0, 100),
    approvals: [...approvals.values()].slice(0, 100),
    firstEventAt: events[0]?.timestamp, lastEventAt: events.at(-1)?.timestamp,
  };
}
