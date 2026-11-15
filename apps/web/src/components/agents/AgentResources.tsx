"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus, Trash2, Workflow, Wrench } from "lucide-react";
import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import { useOrgPath } from "@/components/organization/OrgProvider";
import { Button } from "@/components/ui/button";
import { fieldClass, Section } from "./AgentFields";

export function AgentToolsPanel({
  agent,
  tools,
  editing,
  onChange,
}: {
  agent: AgentRecord;
  tools: ToolRecord[];
  editing: boolean;
  onChange: (tools: string[]) => void;
}) {
  const orgUrl = useOrgPath();
  const [toolId, setToolId] = useState("");
  const catalog = new Map(tools.map((tool) => [tool.id, tool]));
  const available = tools.filter((tool) => !agent.tools.includes(tool.id));

  return (
    <Section
      title="Assigned tools"
      description="Tools referenced from the organization tool registry."
      action={
        <Link
          href={orgUrl("/org/tools")}
          className="inline-flex min-h-7 items-center gap-1 rounded px-2 text-xs font-medium text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span>Tool registry</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <p className="text-xs text-zinc-400">
        Assignments reference the Tool registry (
        <Link
          className="inline-flex min-h-6 items-center rounded px-0.5 text-indigo-300 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          href={orgUrl("/org/tools")}
        >
          /org/tools
        </Link>
        ). Remove an assignment to disable that tool for this agent.
      </p>

      {!agent.tools.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center">
          <Wrench className="mb-2 h-5 w-5 text-zinc-500" aria-hidden="true" />
          <p className="text-sm text-zinc-300">No tools assigned.</p>
          <p className="mt-1 text-xs text-zinc-500">
            {editing
              ? "Select a tool below to grant this agent access."
              : "Enable editing to assign tools from your registry."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {agent.tools.map((id) => {
            const tool = catalog.get(id);
            return (
              <li
                key={id}
                className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-all text-sm font-medium text-zinc-100">
                      {tool?.name ?? id}
                    </p>
                    {tool ? (
                      <>
                        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
                          {tool.category}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${
                            tool.enabled
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 [html[data-appearance='light']_&]:text-emerald-700"
                              : "border-zinc-700 bg-zinc-900 text-zinc-400"
                          }`}
                        >
                          {tool.enabled ? "enabled" : "disabled"}
                        </span>
                      </>
                    ) : (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 [html[data-appearance='light']_&]:text-amber-700">
                        Not found in registry
                      </span>
                    )}
                  </div>
                  <p className="break-all font-mono text-[11px] text-zinc-500">{id}</p>
                  {tool ? (
                    <p className="text-xs text-zinc-400">{tool.description || "No description."}</p>
                  ) : null}
                </div>
                {editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange(agent.tools.filter((item) => item !== id))}
                    className="gap-1.5 self-start text-xs sm:self-center"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Remove {tool?.name ?? id}</span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3.5 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block space-y-1.5 text-sm">
              <span className="block text-xs font-medium text-zinc-200">Tool</span>
              <select
                className={fieldClass}
                value={toolId}
                onChange={(event) => setToolId(event.target.value)}
              >
                <option value="">— select a registered tool —</option>
                {available.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.name}
                    {tool.enabled ? "" : " (disabled)"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            type="button"
            disabled={!toolId.trim()}
            onClick={() => {
              onChange([...agent.tools, toolId.trim()]);
              setToolId("");
            }}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Assign tool
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

export function AgentWorkflowUsage({
  agentId,
  workflows,
  navigate,
}: {
  agentId: string;
  workflows: WorkflowDefinition[];
  navigate: (url: string) => void;
}) {
  const usages = workflows.flatMap((workflow) =>
    workflow.nodes
      .filter((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId)
      .map((node) => ({ workflow, node })),
  );

  return (
    <Section
      title="Workflow usage"
      description={`${new Set(usages.map(({ workflow }) => workflow.id)).size} saved workflows · ${usages.length} node instances. Unsaved graph changes are not included.`}
    >
      {!usages.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center">
          <Workflow className="mb-2 h-5 w-5 text-zinc-500" aria-hidden="true" />
          <p className="text-sm text-zinc-300">This agent is not referenced in a saved workflow.</p>
          <p className="mt-1 text-xs text-zinc-500">
            Add an agent node in the Graph Editor to wire this agent into a pipeline.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {usages.map(({ workflow, node }) => (
            <div
              key={`${workflow.id}:${node.id}`}
              className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3.5 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium text-zinc-100">{workflow.name}</p>
                <p className="break-all font-mono text-xs text-zinc-400">Workflow: {workflow.id}</p>
                <p className="break-all font-mono text-xs text-zinc-400">
                  Node: {node.id} · Saved definition (execution status unavailable)
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate(
                    `/org?workflowId=${encodeURIComponent(workflow.id)}&focusNode=${encodeURIComponent(node.id)}`,
                  )
                }
                className="gap-1.5 self-start text-xs sm:self-center"
              >
                <span>Open in Graph</span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
