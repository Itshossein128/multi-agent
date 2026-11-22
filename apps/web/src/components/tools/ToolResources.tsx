"use client";

import { useOrgPath } from "@/components/organization/OrgProvider";
import Link from "next/link";
import { ArrowUpRight, Bot, Workflow } from "lucide-react";
import type { AgentRecord, WorkflowDefinition } from "@multi-agent/types";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/agents/AgentFields";

export function ToolAssignedAgents({ toolId, agents }: { toolId: string; agents: AgentRecord[] }) {
  const orgUrl = useOrgPath();
  const assigned = agents.filter((agent) => agent.tools.includes(toolId));
  return (
    <Section title="Assigned agents" description={`${assigned.length} agents reference this tool.`}>
      {!assigned.length ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 px-4 py-8 text-center">
          <Bot className="mx-auto mb-2 h-5 w-5 text-zinc-500" aria-hidden="true" />
          <p className="text-sm text-zinc-400">No agents have this tool assigned.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assigned.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-100">{agent.name}</p>
                <p className="break-all font-mono text-xs text-zinc-400">
                  {agent.id} · {agent.enabled === false ? "Disabled" : "Enabled"}
                </p>
              </div>
              <Link
                aria-label={`Open agent ${agent.name}`}
                className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-indigo-300 transition-colors hover:border-zinc-700 hover:underline"
                href={orgUrl(`/org/agents/${encodeURIComponent(agent.id)}`)}
              >
                <span>Open agent</span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

export function ToolWorkflowUsage({
  toolId,
  workflows,
  navigate,
}: {
  toolId: string;
  workflows: WorkflowDefinition[];
  navigate: (url: string) => void;
}) {
  const usages = workflows.flatMap((workflow) =>
    workflow.nodes
      .filter((node) => node.type === "tool" && (node.config as { toolId?: string | null }).toolId === toolId)
      .map((node) => ({ workflow, node })),
  );
  return (
    <Section
      title="Workflow usage"
      description={`${new Set(usages.map(({ workflow }) => workflow.id)).size} saved workflows · ${usages.length} node instances. Unsaved graph changes are not included.`}
    >
      {!usages.length ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 px-4 py-8 text-center">
          <Workflow className="mx-auto mb-2 h-5 w-5 text-zinc-500" aria-hidden="true" />
          <p className="text-sm text-zinc-400">This tool is not referenced in a saved workflow.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {usages.map(({ workflow, node }) => (
            <div
              key={`${workflow.id}:${node.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3.5"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-medium text-zinc-100">{workflow.name}</p>
                <p className="break-all font-mono text-xs text-zinc-400">Workflow: {workflow.id}</p>
                <p className="break-all font-mono text-xs text-zinc-400">Node: {node.id}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate(`/org?workflowId=${encodeURIComponent(workflow.id)}&focusNode=${encodeURIComponent(node.id)}`)
                }
              >
                Open in Graph
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
