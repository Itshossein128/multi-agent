"use client";

import type { AgentRecord, WorkflowDefinition } from "@multi-agent/types";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/agents/AgentFields";

export function ToolAssignedAgents({ toolId, agents }: { toolId: string; agents: AgentRecord[] }) {
  const assigned = agents.filter((agent) => agent.tools.includes(toolId));
  return <Section title="Assigned agents">
    <p className="text-sm text-zinc-400">{assigned.length} agents reference this tool.</p>
    {!assigned.length && <p className="text-sm text-zinc-400">No agents have this tool assigned.</p>}
    {assigned.map((agent) => <div key={agent.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3">
      <div className="min-w-0 flex-1"><p className="font-medium">{agent.name}</p><p className="break-all text-xs text-zinc-400">{agent.id} · {agent.enabled === false ? "Disabled" : "Enabled"}</p></div>
      <a className="text-sm text-indigo-300 underline" href={`/org/agents/${encodeURIComponent(agent.id)}`}>Open agent</a>
    </div>)}
  </Section>;
}

export function ToolWorkflowUsage({ toolId, workflows, navigate }: { toolId: string; workflows: WorkflowDefinition[]; navigate: (url: string) => void }) {
  const usages = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === "tool" && (node.config as { toolId?: string | null }).toolId === toolId).map((node) => ({ workflow, node })));
  return <Section title="Workflow usage">
    <p className="text-sm text-zinc-400">{new Set(usages.map(({ workflow }) => workflow.id)).size} saved workflows · {usages.length} node instances. Unsaved graph changes are not included.</p>
    {!usages.length && <p className="text-sm text-zinc-400">This tool is not referenced in a saved workflow.</p>}
    {usages.map(({ workflow, node }) => <div key={`${workflow.id}:${node.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3">
      <div className="min-w-0 flex-1"><p className="font-medium">{workflow.name}</p><p className="break-all text-xs text-zinc-400">Workflow: {workflow.id}</p><p className="break-all text-xs text-zinc-400">Node: {node.id}</p></div>
      <Button variant="outline" size="sm" onClick={() => navigate(`/org?workflowId=${encodeURIComponent(workflow.id)}&focusNode=${encodeURIComponent(node.id)}`)}>Open in Graph</Button>
    </div>)}
  </Section>;
}
