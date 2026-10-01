"use client";

/**
 * Selection-dependent panels: node properties, edge properties, multi-select,
 * and the workflow overview. Composition only — forms live in NodeForms.tsx.
 */

import React, { useMemo } from "react";
import { Bot, CircleAlert, GitBranch, Trash2, Wrench } from "lucide-react";
import {
  ConditionNodeConfig,
  NODE_TYPE_META,
  ToolNodeConfig,
  ToolRecord,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/workflow/types";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";
import { Field, JsonField, inputClass } from "./fields";
import {
  AgentForm,
  ApprovalForm,
  ConditionForm,
  ContractForm,
  IOPortalForm,
  MemoryForm,
  ToolForm,
} from "./NodeForms";

export function NodeProperties({ node }: { node: WorkflowNode }) {
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const issues = useWorkflowStore((s) => s.issues);
  const nodeIssues = useMemo(
    () => issues.filter((issue) => issue.nodeId === node.id),
    [issues, node.id]
  );
  const meta = NODE_TYPE_META[node.type];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                meta.chipBg,
                meta.iconText
              )}
            >
              {meta.label}
            </span>
            {nodeIssues.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                <CircleAlert className="h-3 w-3" />
                {nodeIssues.length}
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">{node.id}</p>
        </div>
        <button
          type="button"
          title="Delete node"
          onClick={() => removeNodes([node.id])}
          className="text-zinc-500 hover:text-red-400 cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {nodeIssues.length > 0 && (
        <div className="space-y-1 rounded-lg border border-red-900/50 bg-red-950/20 p-2">
          {nodeIssues.map((issue) => (
            <p
              key={issue.id}
              className={cn(
                "text-[11px] leading-snug",
                issue.severity === "error" ? "text-red-300" : "text-amber-300"
              )}
            >
              • {issue.message}
            </p>
          ))}
        </div>
      )}

      {node.type === "agent" && <AgentForm node={node} />}
      {node.type === "tool" && <ToolForm node={node} />}
      {node.type === "approval" && <ApprovalForm node={node} />}
      {node.type === "memory" && <MemoryForm node={node} />}
      {node.type === "condition" && <ConditionForm node={node} />}
      {(node.type === "input" || node.type === "output") && (
        <IOPortalForm node={node as WorkflowNode & { type: "input" | "output" }} />
      )}
      <ContractForm node={node} />
    </div>
  );
}

export function EdgeProperties({ edge }: { edge: WorkflowEdge }) {
  const definition = useWorkflowStore((s) => s.definition);
  const tools = useWorkflowStore((s) => s.tools);
  const updateEdge = useWorkflowStore((s) => s.updateEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);

  const sourceNode = definition.nodes.find((n) => n.id === edge.source);
  const targetNode = definition.nodes.find((n) => n.id === edge.target);
  const sourceIsCondition = sourceNode?.type === "condition";
  const sourceIsApproval = sourceNode?.type === "approval";
  const branches =
    sourceIsCondition && sourceNode
      ? (sourceNode.config as ConditionNodeConfig).branches
      : sourceIsApproval
        ? [{ key: "approved", label: "Approved" }, { key: "rejected", label: "Rejected" }]
        : [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            {edge.kind === "conditional" ? (
              <GitBranch className="h-3.5 w-3.5 text-purple-300" />
            ) : (
              <Wrench className="h-3.5 w-3.5 text-zinc-400" />
            )}
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              {edge.kind} edge
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">{edge.id}</p>
        </div>
        <button
          type="button"
          title="Delete edge"
          onClick={() => removeEdges([edge.id])}
          className="text-zinc-500 hover:text-red-400 cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2 text-[11px] text-zinc-400">
        <div className="flex items-center gap-1.5">
          <Bot className="h-3 w-3 text-zinc-500" />
          <span className="truncate">{sourceNode ? nodeTitle(sourceNode, tools) : edge.source}</span>
        </div>
        <div className="ml-1.5 border-l border-zinc-700 pl-2 text-zinc-600">↓</div>
        <div className="flex items-center gap-1.5">
          <Bot className="h-3 w-3 text-zinc-500" />
          <span className="truncate">{targetNode ? nodeTitle(targetNode, tools) : edge.target}</span>
        </div>
      </div>

      <Field label="Edge Type">
        <select
          value={edge.kind}
          onChange={(event) => updateEdge(edge.id, { kind: event.target.value as WorkflowEdge["kind"] })}
          className={inputClass}
        >
          <option value="normal">Normal</option>
          <option value="conditional">Conditional</option>
        </select>
      </Field>

      {edge.kind === "conditional" && (
        <Field label="Branch Key (condition value)">
          {branches.length > 0 ? (
            <select
              value={edge.branchKey}
              onChange={(event) => updateEdge(edge.id, { branchKey: event.target.value })}
              className={inputClass}
            >
              <option value="">— select branch —</option>
              {branches.map((branch) => (
                <option key={branch.key} value={branch.key}>
                  {branch.key}
                  {branch.label ? ` (${branch.label})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={edge.branchKey}
              onChange={(event) => updateEdge(edge.id, { branchKey: event.target.value })}
              placeholder='e.g. "approved"'
              className={cn(inputClass, "font-mono text-[11px]")}
            />
          )}
        </Field>
      )}

      <Field label="Label (display only)">
        <input
          type="text"
          value={edge.label}
          onChange={(event) => updateEdge(edge.id, { label: event.target.value })}
          className={inputClass}
        />
      </Field>

      <JsonField
        label="Metadata"
        value={edge.metadata ?? {}}
        onChange={(metadata) => updateEdge(edge.id, { metadata })}
      />
    </div>
  );
}

export function MultiSelectProperties({ nodeIds }: { nodeIds: string[] }) {
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  return (
    <div className="space-y-3 text-center">
      <p className="text-xs text-zinc-400">
        {nodeIds.length} nodes selected
      </p>
      <button
        type="button"
        onClick={() => removeNodes(nodeIds)}
        className="w-full rounded-lg border border-red-900/60 bg-red-950/30 py-2 text-xs font-semibold text-red-300 hover:bg-red-950/60 cursor-pointer"
      >
        Delete selected nodes
      </button>
    </div>
  );
}

export function Overview() {
  const definition = useWorkflowStore((s) => s.definition);
  const issues = useWorkflowStore((s) => s.issues);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const counts = new Map<string, number>();
  for (const node of definition.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Workflow</h3>
        <p className="mt-1 font-mono text-[10px] text-zinc-600">{definition.id}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
          <div className="text-zinc-500">Nodes</div>
          <div className="text-sm font-bold text-zinc-100">{definition.nodes.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
          <div className="text-zinc-500">Edges</div>
          <div className="text-sm font-bold text-zinc-100">{definition.edges.length}</div>
        </div>
      </div>

      {counts.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {[...counts.entries()].map(([type, count]) => (
            <span
              key={type}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                NODE_TYPE_META[type as keyof typeof NODE_TYPE_META]?.chipBg ?? "bg-zinc-800",
                NODE_TYPE_META[type as keyof typeof NODE_TYPE_META]?.iconText ?? "text-zinc-300"
              )}
            >
              {type} × {count}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-500">
        <p className="font-semibold text-zinc-400">Validation</p>
        {issues.length === 0 || (errors === 0 && warnings === 0) ? (
          <p className="mt-1 text-emerald-400">No issues — workflow looks valid.</p>
        ) : (
          <p className="mt-1">
            <span className={errors > 0 ? "text-red-400" : "text-zinc-500"}>{errors} errors</span>
            {" · "}
            <span className={warnings > 0 ? "text-amber-400" : "text-zinc-500"}>
              {warnings} warnings
            </span>
          </p>
        )}
        <p className="mt-2 text-[10px] text-zinc-600">
          Select a node or edge to inspect and configure it. The backend compiles this definition
          into a LangGraph StateGraph on execution.
        </p>
      </div>
    </div>
  );
}

function nodeTitle(node: WorkflowNode, tools: ToolRecord[]): string {
  switch (node.type) {
    case "agent":
      return "Agent node";
    case "tool": {
      const config = node.config as ToolNodeConfig;
      return tools.find((t) => t.id === config.toolId)?.name || "Tool node";
    }
    case "condition":
      return "Condition / Router";
    case "approval":
      return "Human Approval";
    case "memory":
      return "Memory node";
    default:
      return node.type;
  }
}
