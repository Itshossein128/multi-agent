/**
 * UI Contracts: In-Canvas Live Execution & Observability
 *
 * Boundaries between WorkflowEditor Live mode, React Flow projection,
 * useRunStore / runService, and overlay components (inspector, tray, approvals).
 */

import type {
  ApprovalRequest,
  NodeResultEnvelope,
  Run,
  RunEvent,
  RunStatus,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from "@multi-agent/types";

/** Studio editor operator mode (FR-001). */
export type EditorMode = "design" | "live";

/** Reduced per-node status for canvas chrome (FR-007). */
export type CanvasNodeLiveStatus =
  | "idle"
  | "running"
  | "waiting_human"
  | "completed"
  | "failed"
  | "skipped";

/** Compact tray event filter (FR-011). */
export type LiveTrayEventFilter = "all" | "node" | "error" | "tool";

/** SSE / attachment health mirrored from run event stream. */
export type LiveStreamStatus = "connecting" | "live" | "error" | "closed";

/**
 * Studio deep-link query contract for `/o/{orgSlug}/org`.
 * `runId` present ⇒ Live mode (research Decision 1 / 7).
 */
export interface StudioLiveQuery {
  workflowId?: string;
  runId?: string;
  focusNode?: string;
}

/** Projection input: authoritative events + optional run header. */
export interface RunCanvasProjectionInput {
  events: readonly RunEvent[];
  run?: Run | null;
  approvals?: readonly ApprovalRequest[];
}

export interface RunCanvasProjection {
  nodeStatus: ReadonlyMap<string, CanvasNodeLiveStatus>;
  traversedEdgeIds: ReadonlySet<string>;
  waitingApprovalNodeIds: ReadonlySet<string>;
}

/** Nested tool activity for the inspector (FR-009). */
export interface NodeToolCallView {
  id: string;
  toolId?: string;
  status: CanvasNodeLiveStatus | "unknown";
  arguments?: unknown;
  result?: unknown;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Slide-over inspector model (FR-008 / FR-009). */
export interface NodeExecutionView {
  nodeId: string;
  liveStatus: CanvasNodeLiveStatus;
  input?: unknown;
  stepIndex?: number;
  attemptCount: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  streamText: string;
  thoughtsText?: string;
  toolCalls: NodeToolCallView[];
  result?: NodeResultEnvelope;
  error?: string;
  contractViolation?: unknown;
  approval?: ApprovalRequest;
  events: RunEvent[];
}

/** Bottom tray view-model (FR-011). */
export interface LiveRunTrayModel {
  runId: string;
  status: RunStatus;
  streamStatus: LiveStreamStatus;
  elapsedMs: number;
  stepCurrent: number;
  stepMax: number;
  collapsed: boolean;
  eventFilter: LiveTrayEventFilter;
  canCancel: boolean;
  canRetry: boolean;
  events: RunEvent[];
}

/** Extended React Flow node data while Live (merged onto existing WorkflowNodeData). */
export interface LiveWorkflowNodeDataFields {
  liveStatus?: CanvasNodeLiveStatus;
  liveErrorCode?: string;
  waitingApproval?: boolean;
}

/** Extended edge presentation while Live. */
export interface LiveWorkflowEdgeDataFields {
  traversed?: boolean;
  liveAnimated?: boolean;
}

/**
 * Toolbar / editor orchestration contract for mode transitions.
 */
export interface LiveCanvasController {
  mode: EditorMode;
  attachedRunId: string | null;
  liveDefinition: WorkflowDefinition | null;
  selectedInspectNodeId: string | null;

  /** After successful startRun — enter Live, attach SSE, sync URL. */
  enterLive(runId: string, definitionSnapshot?: WorkflowDefinition): Promise<void>;
  /** Exit Live — detach, clear runId query, restore Design. */
  exitLive(): void;
  /** Deep link / historical load. */
  attachExistingRun(runId: string, workflowId?: string): Promise<void>;
  selectInspectNode(nodeId: string | null): void;
}

/**
 * Actions that MUST call existing authenticated runService (FR-012 / FR-015).
 */
export interface LiveCanvasRunActions {
  startRun: (definition: WorkflowDefinition, input: Record<string, unknown>) => Promise<{ runId: string }>;
  cancelRun: (runId: string) => Promise<void>;
  retryRun: (runId: string) => Promise<{ runId: string }>;
  resolveApproval: (
    runId: string,
    approvalId: string,
    decision: "approved" | "rejected" | "needs_clarification",
    response?: string,
  ) => Promise<void>;
}

/** Guard: Design mutations disabled when Live (FR-014). */
export function isDesignMutationAllowed(mode: EditorMode): boolean {
  return mode === "design";
}

/** Pure helpers expected from projection module (signatures only). */
export interface RunCanvasProjectionApi {
  projectRunCanvas(input: RunCanvasProjectionInput): RunCanvasProjection;
  buildNodeExecutionView(
    nodeId: string,
    input: RunCanvasProjectionInput,
    node?: WorkflowNode,
  ): NodeExecutionView;
  isStatusChangingEvent(type: RunEvent["type"]): boolean;
  filterTrayEvents(events: readonly RunEvent[], filter: LiveTrayEventFilter): RunEvent[];
  edgeLiveStyle(edge: WorkflowEdge, traversed: boolean): LiveWorkflowEdgeDataFields;
}
