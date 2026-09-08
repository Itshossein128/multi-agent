"use client";

import React from "react";
import { Handle, NodeProps, NodeTypes, Position } from "@xyflow/react";
import {
  Bot,
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
  WorkflowNode,
} from "@/lib/workflow/types";
import { cn } from "@/lib/utils";

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  agent?: AgentRecord;
  issueCount: number;
}

function useNodeData(props: NodeProps): WorkflowNodeData {
  return props.data as WorkflowNodeData;
}

const HANDLE_CLASS =
  "!h-2.5 !w-2.5 !rounded-full !border-2 !border-zinc-950 !bg-zinc-500 hover:!bg-indigo-400";

interface NodeShellProps {
  selected: boolean;
  node: WorkflowNode;
  issueCount: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  showTarget?: boolean;
  showSource?: boolean;
  children?: React.ReactNode;
}

function NodeShell({
  selected,
  node,
  issueCount,
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
      className={cn(
        "w-56 rounded-xl border bg-zinc-950/95 px-3 py-2.5 shadow-xl backdrop-blur-md transition-all",
        selected ? cn(meta.borderSelected, "shadow-indigo-500/10") : meta.border,
        issueCount > 0 && "border-red-500/70 ring-1 ring-red-500/40"
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
          <div className="truncate text-xs font-bold text-white leading-tight">{title}</div>
          <div className="truncate text-[10px] text-zinc-400">{subtitle}</div>
        </div>
        {issueCount > 0 && (
          <CircleAlert className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />
        )}
      </div>
      {children}
      {showSource && (
        <Handle type="source" position={Position.Bottom} id="out" className={HANDLE_CLASS} />
      )}
    </div>
  );
}

function AgentNodeComponent(props: NodeProps) {
  const { node, agent, issueCount } = useNodeData(props);
  const config = node.config as AgentNodeConfig;
  const linked = Boolean(config.agentId && agent);
  return (
    <NodeShell
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      icon={<Bot className="h-4 w-4" />}
      title={agent?.name ?? "Unlinked agent"}
      subtitle={agent ? `${agent.model} · ${agent.tools.length} tools` : "Not linked to an agent"}
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
  const { node, issueCount } = useNodeData(props);
  const config = node.config as ToolNodeConfig;
  return (
    <NodeShell
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      icon={<Wrench className="h-4 w-4" />}
      title={config.name || "Unnamed tool"}
      subtitle={config.toolId}
    >
      {config.description && (
        <p className="mt-1.5 line-clamp-2 border-t border-zinc-800/80 pt-1.5 text-[10px] leading-snug text-zinc-500">
          {config.description}
        </p>
      )}
    </NodeShell>
  );
}

function ApprovalNodeComponent(props: NodeProps) {
  const { node, issueCount } = useNodeData(props);
  const config = node.config as ApprovalNodeConfig;
  return (
    <NodeShell
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
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
  const { node, issueCount } = useNodeData(props);
  const config = node.config as MemoryNodeConfig;
  return (
    <NodeShell
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      icon={<Database className="h-4 w-4" />}
      title={config.key || "Memory"}
      subtitle={`${config.memoryType.replace("_", " ")} · ${config.mode.replace("_", " ")}`}
    />
  );
}

function ConditionNodeComponent(props: NodeProps) {
  const { node, issueCount } = useNodeData(props);
  const config = node.config as ConditionNodeConfig;
  const branches = config.branches;
  return (
    <div
      className={cn(
        "w-56 rounded-xl border bg-zinc-950/95 px-3 py-2.5 shadow-xl backdrop-blur-md transition-all",
        props.selected
          ? cn(NODE_TYPE_META.condition.borderSelected, "shadow-indigo-500/10")
          : NODE_TYPE_META.condition.border,
        issueCount > 0 && "border-red-500/70 ring-1 ring-red-500/40"
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
          <div className="text-xs font-bold text-white leading-tight">Condition / Router</div>
          <div className="text-[10px] text-zinc-400">
            {branches.length} branch{branches.length === 1 ? "" : "es"}
          </div>
        </div>
        {issueCount > 0 && <CircleAlert className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />}
      </div>

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
  const { node, issueCount } = useNodeData(props);
  return (
    <NodeShell
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
      icon={<LogIn className="h-4 w-4" />}
      title="Input"
      subtitle="Workflow entry point"
      showTarget={false}
    />
  );
}

function OutputNodeComponent(props: NodeProps) {
  const { node, issueCount } = useNodeData(props);
  return (
    <NodeShell
      selected={Boolean(props.selected)}
      node={node}
      issueCount={issueCount}
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
