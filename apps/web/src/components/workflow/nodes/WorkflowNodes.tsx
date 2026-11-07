"use client";

import React from "react";
import { Handle, NodeProps, NodeTypes, Position } from "@xyflow/react";
import {
  Bot,
  Boxes,
  Circle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  CircleMinus,
  CircleAlert,
  Database,
  GitBranch,
  GitFork,
  GitMerge,
  LogIn,
  LogOut,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import {
  AgentNodeConfig,
  AgentRecord,
  ApprovalNodeConfig,
  ConditionNodeConfig,
  MemoryNodeConfig,
  NODE_TYPE_META,
  ToolNodeConfig,
  ToolRecord,
  WorkflowNode,
  agentBackendLabel,
} from "@/lib/workflow/types";
import { cn } from "@/lib/utils";
import { APPROVAL_HANDLE_AFFORDANCES } from "@/lib/workflow/canvasRoutingHandles";

import type { CanvasNodeLiveStatus, LiveWorkflowNodeDataFields } from "../live/liveCanvas.types";

export interface WorkflowNodeData extends Record<string, unknown>, LiveWorkflowNodeDataFields {
  node: WorkflowNode;
  agent?: AgentRecord;
  tool?: ToolRecord;
  issueCount: number;
  issueTitle?: string;
}

function useNodeData(props: NodeProps): WorkflowNodeData {
  return props.data as WorkflowNodeData;
}

const HANDLE_CLASS =
  "!h-2.5 !w-2.5 !rounded-full !border-2 !border-zinc-950 !bg-zinc-500 hover:!bg-indigo-400";

const liveClasses: Record<CanvasNodeLiveStatus, string> = {
  idle: "ring-1 ring-zinc-600",
  running: "ring-2 ring-indigo-400 border-indigo-400",
  waiting_human: "ring-2 ring-amber-400 border-amber-400",
  completed: "ring-2 ring-emerald-400 border-emerald-400",
  failed: "ring-2 ring-red-400 border-red-400",
  skipped: "opacity-50 border-dashed ring-1 ring-zinc-500",
};

function LiveStatusBadge({ liveStatus, liveErrorCode, waitingApproval }: LiveWorkflowNodeDataFields) {
  const status = waitingApproval ? "waiting_human" : liveStatus;
  if (!status) return null;
  const Icon = { idle: Circle, running: LoaderCircle, waiting_human: Clock3, completed: CheckCircle2, failed: CircleAlert, skipped: CircleMinus }[status];
  const label = { idle: "Idle", running: "Running", waiting_human: "Waiting for approval", completed: "Completed", failed: "Failed", skipped: "Skipped" }[status];
  return <div className="mt-2 flex items-center gap-1.5 border-t border-zinc-800 pt-1.5 text-xs text-zinc-200" role="status">
    <Icon aria-hidden="true" className={cn("h-3.5 w-3.5", status === "running" && "animate-spin motion-reduce:animate-none")} />
    <span>{label}{status === "failed" && liveErrorCode ? ` · ${liveErrorCode}` : ""}</span>
  </div>;
}

interface NodeShellProps extends LiveWorkflowNodeDataFields {
  selected: boolean;
  node: WorkflowNode;
  issueCount: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  issueTitle?: string;
  showTarget?: boolean;
  showSource?: boolean;
  children?: React.ReactNode;
}

function NodeShell({
  selected,
  liveStatus,
  liveErrorCode,
  waitingApproval,
  node,
  issueCount,
  issueTitle,
  icon,
  title,
  subtitle,
  showTarget = true,
  showSource = true,
  children,
}: NodeShellProps) {
  const meta = NODE_TYPE_META[node.type];
  return (
    <div
      data-live-status={waitingApproval ? "waiting_human" : liveStatus}
      title={issueTitle || undefined}
      data-issue-code={issueTitle?.includes("LINEAR_PIPELINE_CYCLE_FORBIDDEN") ? "LINEAR_PIPELINE_CYCLE_FORBIDDEN" : undefined}
      className={cn(
        "w-56 rounded-xl border bg-zinc-950/95 px-3 py-2.5 shadow-xl backdrop-blur-md transition-all",
        selected ? cn(meta.borderSelected, "shadow-indigo-500/10") : meta.border,
        issueCount > 0 && "border-red-500/70 ring-1 ring-red-500/40",
        liveStatus && liveClasses[waitingApproval ? "waiting_human" : liveStatus]
      )}
    >
      {showTarget && <Handle type="target" position={Position.Top} id="in" className={HANDLE_CLASS} />}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md",
            meta.iconBg,
            meta.iconText
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-zinc-100 leading-tight">{title}</div>
          <div className="truncate text-[10px] text-zinc-400">{subtitle}</div>
        </div>
        {issueCount > 0 && (
          <CircleAlert className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />
        )}
      </div>
      {children}
      <LiveStatusBadge liveStatus={liveStatus} liveErrorCode={liveErrorCode} waitingApproval={waitingApproval} />
      {showSource && (
        <Handle type="source" position={Position.Bottom} id="out" className={HANDLE_CLASS} />
      )}
    </div>
  );
}

function AgentNodeComponent(props: NodeProps) {
  const { node, agent, issueCount, issueTitle } = useNodeData(props);
  const config = node.config as AgentNodeConfig;
  const linked = Boolean(config.agentId && agent);
  const hasPersistentSession =
    config.sessionMode === "node" || config.sessionMode === "shared";
  const sessionBadgeLabel =
    config.sessionMode === "shared"
      ? `Session: ${config.sessionKey?.trim() || "shared"}`
      : config.sessionMode === "node"
        ? "Session: node-persistent"
        : null;
  return (
    <NodeShell
      {...useNodeData(props)}
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      issueTitle={issueTitle}
      icon={<Bot className="h-4 w-4" />}
      title={agent?.name ?? "Unlinked agent"}
      subtitle={agent ? `${agentBackendLabel(agent.backend)} · ${agent.tools.length} tools` : "Not linked to an agent"}
    >
      {hasPersistentSession && sessionBadgeLabel && (
        <div
          data-testid="agent-node-session-badge"
          className="mt-1.5 flex items-center gap-1 border-t border-zinc-800/80 pt-1.5"
        >
          <span
            className="truncate rounded bg-indigo-950/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-indigo-300"
            title={sessionBadgeLabel}
          >
            {sessionBadgeLabel}
          </span>
        </div>
      )}
      {agent?.description && (
        <p className="mt-1.5 line-clamp-2 border-t border-zinc-800/80 pt-1.5 text-[10px] leading-snug text-zinc-500">
          {agent.description}
        </p>
      )}
      {linked && agent && agent.systemPrompt.trim() === "" && (
        <p className="mt-1 text-[10px] text-amber-400/90">No system prompt</p>
      )}
    </NodeShell>
  );
}

function ToolNodeComponent(props: NodeProps) {
  const { node, tool, issueCount, issueTitle } = useNodeData(props);
  const config = node.config as ToolNodeConfig;
  return (
    <NodeShell
      {...useNodeData(props)}
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      issueTitle={issueTitle}
      icon={<Wrench className="h-4 w-4" />}
      title={tool?.name ?? "Unlinked tool"}
      subtitle={tool ? `${tool.category}${tool.enabled ? "" : " · disabled"}` : "Not linked to a tool"}
    >
      {tool?.description && (
        <p className="mt-1.5 line-clamp-2 border-t border-zinc-800/80 pt-1.5 text-[10px] leading-snug text-zinc-500">
          {tool.description}
        </p>
      )}
      {!config.toolId && (
        <p className="mt-1 text-[10px] text-amber-400/90">No tool selected</p>
      )}
    </NodeShell>
  );
}

function ApprovalNodeComponent(props: NodeProps) {
  const { node, issueCount, issueTitle } = useNodeData(props);
  const config = node.config as ApprovalNodeConfig;
  return (
    <NodeShell
      {...useNodeData(props)}
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      issueTitle={issueTitle}
      icon={<ShieldCheck className="h-4 w-4" />}
      title="Human Approval"
      subtitle={config.message || "No message configured"}
      showSource={false}
    >
      <div className="mt-1.5 flex items-center gap-1.5 border-t border-zinc-800/80 pt-1.5">
        <span className="rounded bg-cyan-950/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
          {config.approvalType === "timeout" ? `Timeout ${config.timeoutSeconds}s` : "Manual"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-center gap-2 border-t border-zinc-800/80 pt-3">
        {APPROVAL_HANDLE_AFFORDANCES.map((outcome) => (
          <div key={outcome.handleId} className="relative flex min-w-[4.25rem] flex-col items-center pb-2.5">
            <span
              className={cn(
                "mb-1 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold",
                outcome.handleId === "approved" && "bg-emerald-950/60 text-emerald-300",
                outcome.handleId === "rejected" && "bg-red-950/60 text-red-300",
                outcome.handleId === "needs_clarification" && "bg-amber-950/60 text-amber-300",
              )}
              title={outcome.accessibleName}
            >
              {outcome.accessibleName}
            </span>
            <Handle
              type="source"
              position={Position.Bottom}
              id={outcome.handleId}
              aria-label={outcome.accessibleName}
              title={outcome.accessibleName}
              className={cn(HANDLE_CLASS, outcome.colorClass)}
              style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)" }}
            />
          </div>
        ))}
      </div>
    </NodeShell>
  );
}

function MemoryNodeComponent(props: NodeProps) {
  const { node, issueCount, issueTitle } = useNodeData(props);
  const config = node.config as MemoryNodeConfig;
  return (
    <NodeShell
      {...useNodeData(props)}
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      issueTitle={issueTitle}
      icon={<Database className="h-4 w-4" />}
      title={config.key || "Memory"}
      subtitle={`${config.memoryType.replace("_", " ")} · ${config.mode.replace("_", " ")}`}
    />
  );
}

function ConditionNodeComponent(props: NodeProps) {
  const { node, issueCount, issueTitle } = useNodeData(props);
  const liveData = useNodeData(props);
  const config = node.config as ConditionNodeConfig;
  const branches = config.branches;
  return (
    <div
      data-live-status={liveData.waitingApproval ? "waiting_human" : liveData.liveStatus}
      title={issueTitle || undefined}
      data-issue-code={issueTitle?.includes("LINEAR_PIPELINE_CYCLE_FORBIDDEN") ? "LINEAR_PIPELINE_CYCLE_FORBIDDEN" : undefined}
      className={cn(
        "min-w-56 max-w-sm rounded-xl border bg-zinc-950/95 px-3 py-2.5 shadow-xl backdrop-blur-md transition-all",
        props.selected
          ? cn(NODE_TYPE_META.condition.borderSelected, "shadow-indigo-500/10")
          : NODE_TYPE_META.condition.border,
        issueCount > 0 && "border-red-500/70 ring-1 ring-red-500/40",
        liveData.liveStatus && liveClasses[liveData.waitingApproval ? "waiting_human" : liveData.liveStatus]
      )}
    >
      <Handle type="target" position={Position.Top} id="in" className={HANDLE_CLASS} />
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md",
            NODE_TYPE_META.condition.iconBg,
            NODE_TYPE_META.condition.iconText
          )}
        >
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-zinc-100 leading-tight">Condition / Router</div>
          <div className="text-[10px] text-zinc-400">
            {branches.length} branch{branches.length === 1 ? "" : "es"}
          </div>
        </div>
        {issueCount > 0 && <CircleAlert className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />}
      </div>

      <LiveStatusBadge {...liveData} />
      {/* One labeled chip per branch with its own non-overlapping handle */}
      <div className="mt-2 flex flex-wrap items-end justify-center gap-2 border-t border-zinc-800/80 pt-3">
        {branches.map((branch, index) => {
          const label = branch.label || branch.key || "?";
          const handleId = branch.key || `branch-${index}`;
          return (
            <div key={handleId} className="relative flex min-w-[3.75rem] max-w-[6.5rem] flex-col items-center pb-2.5">
              <span
                className="mb-1 truncate rounded bg-orange-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300"
                title={`branch: ${branch.key || label}`}
              >
                {label}
              </span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={handleId}
                aria-label={`Branch ${label}`}
                title={`Branch ${label}`}
                className={HANDLE_CLASS}
                style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)" }}
              />
            </div>
          );
        })}
        {branches.length === 0 && (
          <span className="text-[10px] text-zinc-500">No branches defined</span>
        )}
      </div>
    </div>
  );
}

function InputNodeComponent(props: NodeProps) {
  const { node, issueCount, issueTitle } = useNodeData(props);
  return (
    <NodeShell
      {...useNodeData(props)}
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      issueTitle={issueTitle}
      icon={<LogIn className="h-4 w-4" />}
      title="Input"
      subtitle="Workflow entry point"
      showTarget={false}
    />
  );
}

function OutputNodeComponent(props: NodeProps) {
  const { node, issueCount, issueTitle } = useNodeData(props);
  return (
    <NodeShell
      {...useNodeData(props)}
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      issueTitle={issueTitle}
      icon={<LogOut className="h-4 w-4" />}
      title="Output"
      subtitle="Workflow exit point"
      showSource={false}
    />
  );
}

function ParallelSplitNodeComponent(props: NodeProps) {
  const data = useNodeData(props);
  return (
    <NodeShell
      {...data}
      selected={Boolean(props.selected)}
      node={data.node}
      issueCount={data.issueCount}
      issueTitle={data.issueTitle}
      icon={<GitFork className="h-4 w-4" />}
      title={NODE_TYPE_META.parallel_split.label}
      subtitle={NODE_TYPE_META.parallel_split.description}
    />
  );
}

function ParallelJoinNodeComponent(props: NodeProps) {
  const data = useNodeData(props);
  const policy = (data.node.config as { joinPolicy?: string }).joinPolicy ?? "all_success";
  return (
    <NodeShell
      {...data}
      selected={Boolean(props.selected)}
      node={data.node}
      issueCount={data.issueCount}
      issueTitle={data.issueTitle}
      icon={<GitMerge className="h-4 w-4" />}
      title={NODE_TYPE_META.parallel_join.label}
      subtitle={`Join: ${policy}`}
    />
  );
}

function SubgraphNodeComponent(props: NodeProps) {
  const data = useNodeData(props);
  const workflowId = (data.node.config as { workflowId?: string }).workflowId?.trim() || "unset";
  return (
    <NodeShell
      {...data}
      selected={Boolean(props.selected)}
      node={data.node}
      issueCount={data.issueCount}
      issueTitle={data.issueTitle}
      icon={<Boxes className="h-4 w-4" />}
      title={NODE_TYPE_META.subgraph.label}
      subtitle={workflowId}
    />
  );
}

/** React Flow node-type registry — add new node types here. */
export const workflowNodeTypes: NodeTypes = {
  agent: AgentNodeComponent,
  tool: ToolNodeComponent,
  approval: ApprovalNodeComponent,
  memory: MemoryNodeComponent,
  condition: ConditionNodeComponent,
  input: InputNodeComponent,
  output: OutputNodeComponent,
  parallel_split: ParallelSplitNodeComponent,
  parallel_join: ParallelJoinNodeComponent,
  subgraph: SubgraphNodeComponent,
};
