"use client";

import React from "react";
import { Handle, NodeProps, NodeTypes, Position } from "@xyflow/react";
import {
  Bot,
  Circle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  CircleMinus,
  CircleAlert,
  Database,
  GitBranch,
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
    >
      <div className="mt-1.5 flex items-center gap-1.5 border-t border-zinc-800/80 pt-1.5">
        <span className="rounded bg-cyan-950/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
          {config.approvalType === "timeout" ? `Timeout ${config.timeoutSeconds}s` : "Manual"}
        </span>
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
        "w-56 rounded-xl border bg-zinc-950/95 px-3 py-2.5 shadow-xl backdrop-blur-md transition-all",
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
      {/* Branch chips — one source handle per branch, spread across the bottom */}
      <div className="mt-2 flex items-center justify-between gap-1 border-t border-zinc-800/80 pt-1.5">
        {branches.map((branch, index) => (
          <span
            key={branch.key || index}
            className="truncate rounded bg-orange-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300"
            title={`branch: ${branch.key}`}
          >
            {branch.label || branch.key || "?"}
          </span>
        ))}
        {branches.length === 0 && (
          <span className="text-[10px] text-zinc-500">No branches defined</span>
        )}
      </div>

      {branches.map((branch, index) => (
        <Handle
          key={branch.key || `branch-${index}`}
          type="source"
          position={Position.Bottom}
          id={branch.key}
          className={HANDLE_CLASS}
          style={{ left: `${((index + 1) / (branches.length + 1)) * 100}%` }}
        />
      ))}
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

/** React Flow node-type registry — add new node types here. */
export const workflowNodeTypes: NodeTypes = {
  agent: AgentNodeComponent,
  tool: ToolNodeComponent,
  approval: ApprovalNodeComponent,
  memory: MemoryNodeComponent,
  condition: ConditionNodeComponent,
  input: InputNodeComponent,
  output: OutputNodeComponent,
};
