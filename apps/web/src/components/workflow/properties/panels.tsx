"use client";

/**
 * Selection-dependent panels: node properties, edge properties, multi-select,
 * and the workflow overview. Composition only — forms live in NodeForms.tsx.
 */

import React, { useMemo } from "react";
import { resolveWorkflowArchetype } from "@multi-agent/types";
import { useOptionalOrg } from "@/components/organization/OrgProvider";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  GitBranch,
  Layers,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  AgentNodeConfig,
  AgentRecord,
  ConditionNodeConfig,
  NODE_TYPE_META,
  ToolNodeConfig,
  ToolRecord,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/workflow/types";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";
import {
  CopyIdChip,
  Field,
  JsonField,
  PanelSection,
  inputClass,
  selectChevronStyle,
  selectClass,
} from "./fields";
import {
  AgentForm,
  ApprovalForm,
  ConditionForm,
  ContractForm,
  IOPortalForm,
  MemoryForm,
  ParallelJoinForm,
  SubgraphForm,
  ToolForm,
} from "./NodeForms";
import {
  ArchetypeSection,
  AutonomousSwarmForm,
  EvaluatorOptimizerForm,
  RecursionGuardsManager,
  SupervisorExecutionLimitsForm,
  SupervisorHubPicker,
} from "./ArchetypeForms";

export function NodeProperties({ node }: { node: WorkflowNode }) {
  const agents = useWorkflowStore((s) => s.agents);
  const tools = useWorkflowStore((s) => s.tools);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);
  const issues = useWorkflowStore((s) => s.issues);
  const nodeIssues = useMemo(
    () => issues.filter((issue) => issue.nodeId === node.id),
    [issues, node.id],
  );
  const meta = NODE_TYPE_META[node.type];
  const title = nodeTitle(node, agents, tools);

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => clearSelection()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Overview
        </button>
        <CopyIdChip id={node.id} label="Copy node ID" />
      </div>

      <PanelSection className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  meta.chipBg,
                  meta.iconText,
                )}
              >
                {meta.label}
              </span>
              {nodeIssues.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-950/50 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                  <CircleAlert className="h-3 w-3" aria-hidden="true" />
                  {nodeIssues.length}
                </span>
              )}
            </div>
            <h2 className="truncate text-sm font-semibold text-zinc-100">{title}</h2>
          </div>

          <button
            type="button"
            aria-label="Delete node"
            title="Delete node"
            onClick={() => removeNodes([node.id])}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800/80 bg-zinc-950/60 text-zinc-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </PanelSection>

      {nodeIssues.length > 0 && (
        <div
          role="alert"
          className="space-y-1.5 rounded-xl border border-red-900/60 bg-red-950/25 p-2.5"
        >
          {nodeIssues.map((issue) => (
            <div
              key={issue.id}
              className={cn(
                "flex items-start gap-1.5 text-[11px] leading-snug",
                issue.severity === "error" ? "text-red-300" : "text-amber-300",
              )}
            >
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      {node.type === "agent" && <AgentForm node={node} />}
      {node.type === "tool" && <ToolForm node={node} />}
      {node.type === "approval" && <ApprovalForm node={node} />}
      {node.type === "memory" && <MemoryForm node={node} />}
      {node.type === "condition" && <ConditionForm node={node} />}
      {node.type === "parallel_join" && <ParallelJoinForm node={node} />}
      {node.type === "subgraph" && <SubgraphForm node={node} />}
      {(node.type === "input" || node.type === "output") && (
        <IOPortalForm node={node as WorkflowNode & { type: "input" | "output" }} />
      )}
      <ContractForm node={node} />
    </div>
  );
}

export function EdgeProperties({ edge }: { edge: WorkflowEdge }) {
  const definition = useWorkflowStore((s) => s.definition);
  const agents = useWorkflowStore((s) => s.agents);
  const tools = useWorkflowStore((s) => s.tools);
  const updateEdge = useWorkflowStore((s) => s.updateEdge);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);

  const sourceNode = definition.nodes.find((n) => n.id === edge.source);
  const targetNode = definition.nodes.find((n) => n.id === edge.target);
  const sourceMeta = sourceNode ? NODE_TYPE_META[sourceNode.type] : undefined;
  const targetMeta = targetNode ? NODE_TYPE_META[targetNode.type] : undefined;
  const sourceIsCondition = sourceNode?.type === "condition";
  const sourceIsApproval = sourceNode?.type === "approval";
  const branches =
    sourceIsCondition && sourceNode
      ? (sourceNode.config as ConditionNodeConfig).branches
      : sourceIsApproval
        ? [
            { key: "approved", label: "Approved" },
            { key: "rejected", label: "Rejected" },
          ]
        : [];

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => clearSelection()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Overview
        </button>
        <CopyIdChip id={edge.id} label="Copy edge ID" />
      </div>

      <PanelSection className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {edge.kind === "conditional" ? (
              <GitBranch className="h-3.5 w-3.5 text-purple-300" aria-hidden="true" />
            ) : (
              <Wrench className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
            )}
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-200">
              {edge.kind} edge
            </span>
          </div>
          <button
            type="button"
            aria-label="Delete edge"
            title="Delete edge"
            onClick={() => removeEdges([edge.id])}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800/80 bg-zinc-950/60 text-zinc-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-1 rounded-lg border border-zinc-800/70 bg-zinc-950/50 p-2 text-[11px]">
          <div className="flex items-center gap-2 text-zinc-200">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                sourceMeta?.chipBg ?? "bg-zinc-600",
              )}
            />
            <span className="truncate font-medium">
              {sourceNode ? nodeTitle(sourceNode, agents, tools) : edge.source}
            </span>
          </div>
          <div className="ml-0.5 border-l border-zinc-700 pl-2.5 text-[10px] text-zinc-500">
            ↓
          </div>
          <div className="flex items-center gap-2 text-zinc-200">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                targetMeta?.chipBg ?? "bg-zinc-600",
              )}
            />
            <span className="truncate font-medium">
              {targetNode ? nodeTitle(targetNode, agents, tools) : edge.target}
            </span>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Edge Routing">
        <Field label="Edge Type">
          <select
            value={edge.kind}
            style={selectChevronStyle()}
            onChange={(event) =>
              updateEdge(edge.id, { kind: event.target.value as WorkflowEdge["kind"] })
            }
            className={selectClass}
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
                style={selectChevronStyle()}
                onChange={(event) => updateEdge(edge.id, { branchKey: event.target.value })}
                className={selectClass}
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
            placeholder="Optional edge label…"
            className={inputClass}
          />
        </Field>

        <JsonField
          label="Metadata"
          value={edge.metadata ?? {}}
          onChange={(metadata) => updateEdge(edge.id, { metadata })}
        />
      </PanelSection>
    </div>
  );
}

export function MultiSelectProperties({ nodeIds }: { nodeIds: string[] }) {
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);
  return (
    <PanelSection className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/60 text-indigo-300">
          <Layers className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold text-zinc-100">{nodeIds.length} nodes selected</p>
          <p className="text-[11px] text-zinc-400">Bulk selection actions</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => clearSelection()}
          className="w-full rounded-lg border border-zinc-700/80 bg-zinc-900 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
        >
          Clear selection
        </button>
        <button
          type="button"
          onClick={() => removeNodes(nodeIds)}
          className="w-full rounded-lg border border-red-900/60 bg-red-950/35 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-950/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
        >
          Delete {nodeIds.length} selected nodes
        </button>
      </div>
    </PanelSection>
  );
}

export function Overview() {
  const definition = useWorkflowStore((s) => s.definition);
  const agents = useWorkflowStore((s) => s.agents);
  const issues = useWorkflowStore((s) => s.issues);
  const focusIssue = useWorkflowStore((s) => s.focusIssue);
  const orgId = useOptionalOrg()?.org.id;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const archetype = resolveWorkflowArchetype(definition);
  const tenantAgentNodes = definition.nodes.filter((node) => {
    if (node.type !== "agent") return false;
    if (!orgId) return true;
    const agentId = (node.config as { agentId?: string | null }).agentId;
    const agent = agentId ? agents.find((candidate) => candidate.id === agentId) : undefined;
    return agent?.tenantId === orgId;
  });

  const counts = new Map<string, number>();
  for (const node of definition.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  return (
    <div className="space-y-3.5">
      <PanelSection className="space-y-2.5">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-100">
              {definition.name || "Untitled Workflow"}
            </h2>
          </div>
          <CopyIdChip id={definition.id} label="Copy workflow ID" />
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-2.5 py-2">
            <span className="text-zinc-400">Nodes</span>
            <span className="text-sm font-bold tabular-nums text-zinc-100">
              {definition.nodes.length}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-2.5 py-2">
            <span className="text-zinc-400">Edges</span>
            <span className="text-sm font-bold tabular-nums text-zinc-100">
              {definition.edges.length}
            </span>
          </div>
        </div>

        {counts.size > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {[...counts.entries()].map(([type, count]) => {
              const meta = NODE_TYPE_META[type as keyof typeof NODE_TYPE_META];
              return (
                <span
                  key={type}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    meta?.chipBg ?? "bg-zinc-800",
                    meta?.iconText ?? "text-zinc-300",
                  )}
                >
                  {meta?.label ?? type} × {count}
                </span>
              );
            })}
          </div>
        )}
      </PanelSection>

      <ArchetypeSection />
      {archetype === "hierarchical-supervisor" && (
        <>
          <SupervisorHubPicker agentNodes={tenantAgentNodes} />
          <RecursionGuardsManager />
          <SupervisorExecutionLimitsForm />
        </>
      )}
      {archetype === "evaluator-optimizer" && (
        <EvaluatorOptimizerForm agentNodes={tenantAgentNodes} />
      )}
      {archetype === "autonomous-swarm" && <AutonomousSwarmForm />}

      <PanelSection
        title="Validation"
        badge={
          issues.length === 0 || (errors === 0 && warnings === 0) ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-950/40 px-2 py-0.5 text-[10px] font-medium text-red-300">
              {errors > 0 ? `${errors}E` : ""}
              {errors > 0 && warnings > 0 ? " · " : ""}
              {warnings > 0 ? `${warnings}W` : ""}
            </span>
          )
        }
      >
        {issues.length === 0 || (errors === 0 && warnings === 0) ? (
          <p className="text-[11px] leading-relaxed text-emerald-300/90">
            No issues — workflow looks valid.
          </p>
        ) : (
          <div className="space-y-1.5">
            {issues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => focusIssue(issue)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer",
                  issue.severity === "error"
                    ? "border-red-900/50 bg-red-950/25 text-red-200 hover:border-red-700/70 hover:bg-red-950/45"
                    : "border-amber-900/50 bg-amber-950/20 text-amber-200 hover:border-amber-700/70 hover:bg-amber-950/40",
                )}
              >
                {issue.severity === "error" ? (
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">{issue.message}</span>
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-snug text-zinc-400">
          Select a node or edge on the canvas to configure it. Compiles into a LangGraph StateGraph
          on run.
        </p>
      </PanelSection>
    </div>
  );
}

function nodeTitle(node: WorkflowNode, agents: AgentRecord[], tools: ToolRecord[]): string {
  switch (node.type) {
    case "agent": {
      const config = node.config as AgentNodeConfig;
      return agents.find((a) => a.id === config.agentId)?.name || "Agent node";
    }
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
      return NODE_TYPE_META[node.type]?.label ?? node.type;
  }
}
