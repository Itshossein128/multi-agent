import { parseResultEnvelope, type RunEvent } from "@multi-agent/types";
import type { NodeExecutionView, NodeToolCallView } from "../components/workflow/live/liveCanvas.types";
import type { RunCanvasProjectionApi, CanvasNodeLiveStatus } from "../components/workflow/live/liveCanvas.types";
const statuses: Record<string, CanvasNodeLiveStatus> = {
  "node.started": "running", "node.retrying": "running", "agent.started": "running", "llm.started": "running", "tool.started": "running",
  "node.completed": "completed", "agent.completed": "completed", "tool.completed": "completed",
  "node.failed": "failed", "agent.failed": "failed", "llm.failed": "failed", "tool.failed": "failed", "node.loop_limit_reached": "failed",
  "parallel.branch_failed": "failed", "subgraph.failed": "failed", "node.loop_iteration": "running",
  "parallel.branch_started": "running", "parallel.branch_completed": "completed",
  "subgraph.entered": "running", "subgraph.exited": "completed",
  "human_approval.requested": "waiting_human", "human_approval.rejection_halt": "failed", "branch.skipped": "skipped", "run.paused": "waiting_human",
};
export const projectRunCanvas: RunCanvasProjectionApi["projectRunCanvas"] = ({ events, run, approvals = [] }) => {
  const nodeStatus = new Map<string, CanvasNodeLiveStatus>();
  const nodeLifecycle = new Set<string>();
  const traversedEdgeIds = new Set<string>();
  const waitingApprovalNodeIds = new Set<string>();
  const iterationByNodeId: Record<string, { current: number; max: number; phase?: string }> = {};
  const parallelBranchesBySplitId: Record<string, Array<{ branchKey: string; nodeId?: string; status: "pending" | "running" | "completed" | "failed" | "timed_out" }>> = {};
  const subgraphFrames: Array<{ parentNodeId: string; workflowId: string; depth: number; status: "running" | "exited" | "failed" }> = [];
  let swarmTerminationReason: string | undefined;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const nodeId = event.nodeId || (typeof event.payload.nodeId === "string" ? event.payload.nodeId : undefined);
    if (event.type === "edge.traversed" && typeof event.payload.edgeId === "string")
      traversedEdgeIds.add(event.payload.edgeId);
    if (nodeId && (event.type === "node.started" || event.type === "node.retrying"))
      nodeLifecycle.add(nodeId);
    // Nested work completing does not complete its still-running enclosing node.
    const nestedCompletion = nodeId && nodeLifecycle.has(nodeId) && (event.type === "agent.completed" || event.type === "tool.completed");
    if (nodeId && statuses[event.type] && !nestedCompletion)
      nodeStatus.set(nodeId, statuses[event.type]);

    if (event.type === "node.loop_iteration" && nodeId) {
      iterationByNodeId[nodeId] = {
        current: Number(event.payload.current) || 0,
        max: Number(event.payload.max) || 0,
        ...(typeof event.payload.phase === "string" ? { phase: event.payload.phase } : {}),
      };
    }
    if (event.type === "node.loop_limit_reached" && typeof event.payload.terminationReason === "string") {
      swarmTerminationReason = event.payload.terminationReason;
    }
    if (event.type.startsWith("parallel.branch_")) {
      const splitId = typeof event.payload.splitNodeId === "string" ? event.payload.splitNodeId : "unknown";
      const branchKey = typeof event.payload.branchKey === "string" ? event.payload.branchKey : nodeId ?? "branch";
      const status =
        event.type === "parallel.branch_started" ? "running" :
        event.type === "parallel.branch_completed" ? "completed" :
        event.type === "parallel.branch_failed" ? "failed" : "pending";
      const list = parallelBranchesBySplitId[splitId] ?? (parallelBranchesBySplitId[splitId] = []);
      const existing = list.find((entry) => entry.branchKey === branchKey);
      if (existing) existing.status = status;
      else list.push({ branchKey, nodeId: nodeId ?? undefined, status });
    }
    if (event.type.startsWith("subgraph.")) {
      const parentNodeId = typeof event.payload.parentNodeId === "string" ? event.payload.parentNodeId : nodeId ?? "subgraph";
      const workflowId = typeof event.payload.workflowId === "string" ? event.payload.workflowId : "";
      const depth = Number(event.payload.depth) || 0;
      const status = event.type === "subgraph.entered" ? "running" : event.type === "subgraph.exited" ? "exited" : "failed";
      const existing = subgraphFrames.find((frame) => frame.parentNodeId === parentNodeId && frame.workflowId === workflowId);
      if (existing) existing.status = status;
      else subgraphFrames.push({ parentNodeId, workflowId, depth, status });
    }
  }
  if (run?.status === "waiting_for_human" && run.currentNodeId)
    nodeStatus.set(run.currentNodeId, "waiting_human");
  for (const approval of approvals)
    if (approval.status === "requested") {
      nodeStatus.set(approval.nodeId, "waiting_human");
      waitingApprovalNodeIds.add(approval.nodeId);
    }
  for (const [id, status] of nodeStatus)
    if (status === "waiting_human")
      waitingApprovalNodeIds.add(id);
  return {
    nodeStatus,
    traversedEdgeIds,
    waitingApprovalNodeIds,
    topologyHints: {
      iterationByNodeId,
      parallelBranchesBySplitId,
      subgraphFrames,
      ...(swarmTerminationReason ? { swarmTerminationReason } : {}),
    },
  };
};
// Stream content arrives through log/state/memory events. llm.completed is not
// decisive for the enclosing node; these events never invalidate graph status.
export const isStatusChangingEvent: RunCanvasProjectionApi["isStatusChangingEvent"] = type => type in statuses || type === "edge.traversed" || type.startsWith("human_approval.") || type.startsWith("run.");
export const filterTrayEvents: RunCanvasProjectionApi["filterTrayEvents"] = (events, filter) => events.filter(event => filter === "all" || (filter === "error" ? event.type.endsWith("failed") || event.type === "node.loop_limit_reached" : event.type.startsWith(`${filter}.`)));
export const edgeLiveStyle: RunCanvasProjectionApi["edgeLiveStyle"] = (_edge, traversed) => ({ traversed, liveAnimated: traversed });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Include child events with explicit parent association; never cross node identities. */
export function selectNodeEvents(events: readonly RunEvent[], nodeId: string): RunEvent[] {
  const selected = new Set<string>();
  return [...events].sort((a, b) => a.sequence - b.sequence).filter(event => {
    const declaredNode = event.nodeId || event.payload.nodeId;
    const state = record(event.payload.state);
    const nodeEvidence = record(event.payload.nodeOutcomes)[nodeId] !== undefined || record(state.nodeOutcomes)[nodeId] !== undefined;
    const matches = declaredNode === nodeId || (!declaredNode && (nodeEvidence || (!!event.parentEventId && selected.has(event.parentEventId))));
    if (matches) selected.add(event.id);
    return matches;
  });
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join("");
  const item = record(value);
  return typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : "";
}

export const buildNodeExecutionView: RunCanvasProjectionApi["buildNodeExecutionView"] = (nodeId, input, node) => {
  const events = selectNodeEvents(input.events, nodeId);
  const scopedEvents = events.map(event => event.nodeId ? event : { ...event, nodeId });
  const view: NodeExecutionView = {
    nodeId, liveStatus: projectRunCanvas({ ...input, events: scopedEvents }).nodeStatus.get(nodeId) ?? "idle",
    attemptCount: 0, streamText: "", thoughtsText: "", toolCalls: [], events,
    approval: input.approvals?.find(approval => approval.nodeId === nodeId && approval.status === "requested"),
    input: node?.type === "input" ? input.run?.input : undefined,
  };
  const tools = new Map<string, NodeToolCallView>();
  const toolEventIds = new Map<string, string>();
  const starts = [...input.events].sort((a, b) => a.sequence - b.sequence).filter(event => event.type === "node.started");
  const step = starts.findIndex(event => event.nodeId === nodeId);
  if (step >= 0) view.stepIndex = step + 1;
  for (const event of events) {
    const payload = event.payload;
    if (event.type === "node.started" || event.type === "node.retrying") {
      view.attemptCount++;
      view.completedAt = undefined;
      view.error = undefined;
      view.contractViolation = undefined;
      view.result = undefined;
    }
    if ((event.type === "node.started" || event.type === "agent.started" || event.type === "tool.started") && !view.startedAt) view.startedAt = event.timestamp;
    if (payload.input !== undefined && !event.type.startsWith("tool.")) view.input = payload.input;
    if (event.type === "node.started" && typeof payload.step === "number" && view.attemptCount === 1) view.stepIndex = payload.step;
    if (event.type === "node.completed" || (event.type === "node.failed" && payload.terminal !== false)) view.completedAt = event.timestamp;
    if (event.type.endsWith("failed") || event.type === "node.loop_limit_reached") {
      view.error = typeof payload.error === "string" ? payload.error : text(record(payload.error).message) || "Execution failed";
      if (payload.contractViolation !== undefined) view.contractViolation = payload.contractViolation;
      else if (payload.code || payload.diagnostics) view.contractViolation = { code: payload.code, diagnostics: payload.diagnostics };
    }
    if (event.type.startsWith("tool.")) {
      const explicitId = typeof payload.toolCallId === "string" ? payload.toolCallId : typeof payload.callId === "string" ? payload.callId : undefined;
      const toolId = event.toolId ?? (typeof payload.toolId === "string" ? payload.toolId : undefined);
      const parentCall = event.parentEventId ? toolEventIds.get(event.parentEventId) : undefined;
      const active = [...tools.values()].reverse().find(call => call.status === "running" && call.toolId === toolId);
      const id = explicitId ?? parentCall ?? (event.type !== "tool.started" ? active?.id : undefined) ?? event.id;
      const call = tools.get(id) ?? { id, toolId, status: "unknown" };
      if (payload.arguments !== undefined || payload.input !== undefined) call.arguments = payload.arguments !== undefined ? payload.arguments : payload.input;
      if (event.type === "tool.started") { call.status = "running"; call.startedAt = event.timestamp; }
      if (event.type === "tool.completed" || event.type === "tool.failed") {
        call.status = event.type === "tool.completed" ? "completed" : "failed";
        call.completedAt = event.timestamp;
        call.result = payload.result !== undefined ? payload.result : payload.output;
        if (typeof payload.error === "string") call.error = payload.error;
      }
      tools.set(id, call); toolEventIds.set(event.id, id);
    } else {
      const state = record(payload.state);
      const candidate = payload.result ?? payload.envelope ?? payload.outcome ?? record(payload.nodeOutcomes)[nodeId] ?? record(state.nodeOutcomes)[nodeId];
      const parsed = parseResultEnvelope(candidate);
      if (parsed.kind === "valid") view.result = parsed.envelope;
      else if (parsed.kind === "malformed") view.contractViolation = parsed.diagnostics;
    }
    if (event.type === "log" || event.type.startsWith("agent.") || event.type.startsWith("llm.")) {
      const content = text(payload.delta ?? payload.chunk ?? payload.content ?? payload.text ?? payload.output);
      const thoughts = text(payload.thoughts ?? payload.reasoning);
      // Completion payloads are snapshots, not another copy of streamed chunks.
      if (event.type.endsWith("completed")) {
        if (content) view.streamText = content;
        if (thoughts) view.thoughtsText = thoughts;
      } else { view.streamText += content; view.thoughtsText += thoughts; }
    }
  }
  view.toolCalls = [...tools.values()];
  if (view.startedAt && view.completedAt) {
    const duration = Date.parse(view.completedAt) - Date.parse(view.startedAt);
    if (Number.isFinite(duration)) view.durationMs = Math.max(0, duration);
  }
  return view;
};
