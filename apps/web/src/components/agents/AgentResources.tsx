"use client";

import { useState } from "react";
import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import { Button } from "@/components/ui/button";
import { Section } from "./AgentFields";

export function AgentToolsPanel({ agent, tools, editing, onChange }: { agent: AgentRecord; tools: ToolRecord[]; editing: boolean; onChange: (tools: string[]) => void }) {
  const [toolId, setToolId] = useState("");
  const catalog = new Map(tools.map((tool) => [tool.id, tool]));
  const available = tools.filter((tool) => !agent.tools.includes(tool.id));
  return <Section title="Assigned tools">
    <p className="text-sm text-zinc-400">Assignments reference the Tool registry (<a className="text-indigo-300 underline" href="/org/tools">/org/tools</a>). Remove an assignment to disable that tool for this agent.</p>
    {!agent.tools.length && <p className="text-sm text-zinc-400">No tools assigned.</p>}
    <ul className="space-y-2">{agent.tools.map((id) => {
      const tool = catalog.get(id);
      return <li key={id} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3">
        <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{tool?.name ?? id}</p><p className="break-all text-xs text-zinc-400">{id} · {tool ? `${tool.category}${tool.enabled ? "" : " · disabled"}` : "Not found in registry"}</p>
          {tool && <p className="mt-1 text-sm text-zinc-400">{tool.description || "No description."}</p>}
        </div>
        {editing && <Button variant="outline" size="sm" onClick={() => onChange(agent.tools.filter((tool) => tool !== id))}>Remove {tool?.name ?? id}</Button>}
      </li>;
    })}</ul>
    {editing && <div className="flex items-end gap-3"><div className="flex-1"><label className="block space-y-1.5 text-sm text-zinc-300"><span>Tool</span>
      <select className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" value={toolId} onChange={(event) => setToolId(event.target.value)}>
        <option value="">— select a registered tool —</option>
        {available.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}{tool.enabled ? "" : " (disabled)"}</option>)}
      </select></label></div>
      <Button disabled={!toolId.trim()} onClick={() => { onChange([...agent.tools, toolId.trim()]); setToolId(""); }}>Assign tool</Button></div>}
  </Section>;
}

export function AgentWorkflowUsage({ agentId, workflows, navigate }: { agentId: string; workflows: WorkflowDefinition[]; navigate: (url: string) => void }) {
  const usages = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId).map((node) => ({ workflow, node })));
  return <Section title="Workflow usage">
    <p className="text-sm text-zinc-400">{new Set(usages.map(({ workflow }) => workflow.id)).size} saved workflows · {usages.length} node instances. Unsaved graph changes are not included.</p>
    {!usages.length && <p className="text-sm text-zinc-400">This agent is not referenced in a saved workflow.</p>}
    {usages.map(({ workflow, node }) => <div key={`${workflow.id}:${node.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3">
      <div className="min-w-0 flex-1"><p className="font-medium">{workflow.name}</p><p className="break-all text-xs text-zinc-400">Workflow: {workflow.id}</p><p className="break-all text-xs text-zinc-400">Node: {node.id} · Saved definition (execution status unavailable)</p></div>
      <Button variant="outline" size="sm" onClick={() => navigate(`/org?workflowId=${encodeURIComponent(workflow.id)}&focusNode=${encodeURIComponent(node.id)}`)}>Open in Graph</Button>
    </div>)}
  </Section>;
}
