"use client";

import { useState } from "react";
import type { AgentRecord, ToolNodeConfig, WorkflowDefinition } from "@multi-agent/types";
import { Button } from "@/components/ui/button";
import { Field, fieldClass, Section } from "./AgentFields";

export function AgentToolsPanel({ agent, workflows, editing, onChange }: { agent: AgentRecord; workflows: WorkflowDefinition[]; editing: boolean; onChange: (tools: string[]) => void }) {
  const [toolId, setToolId] = useState("");
  const catalog = new Map<string, ToolNodeConfig>();
  for (const workflow of workflows) for (const node of workflow.nodes) if (node.type === "tool") {
    const config = node.config as ToolNodeConfig;
    catalog.set(config.toolId, config);
  }
  return <Section title="Assigned tools">
    <p className="text-sm text-zinc-400">Assignments reference tool IDs. Names and descriptions below come from saved workflow tool nodes. Per-agent enable/disable settings are not supported yet.</p>
    {!agent.tools.length && <p className="text-sm text-zinc-400">No tools assigned.</p>}
    <ul className="space-y-2">{agent.tools.map((id) => {
      const tool = catalog.get(id);
      return <li key={id} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3">
        <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{tool?.name ?? id}</p><p className="break-all text-xs text-zinc-400">{id} · Assigned · {tool ? "Workflow tool" : "Details unavailable"}</p>
          {tool && <><p className="mt-1 text-sm text-zinc-400">{tool.description || "No description."}</p><p className="text-xs text-zinc-400">{Object.keys(tool.config).length} configuration fields in Graph Editor</p></>}
        </div>
        {editing && <Button variant="outline" size="sm" onClick={() => onChange(agent.tools.filter((tool) => tool !== id))}>Remove {tool?.name ?? id}</Button>}
      </li>;
    })}</ul>
    {editing && <div className="flex items-end gap-3"><div className="flex-1"><Field label="Tool ID"><input className={fieldClass} list="agent-tool-catalog" value={toolId} onChange={(event) => setToolId(event.target.value)} /></Field><datalist id="agent-tool-catalog">{[...catalog].map(([id, tool]) => <option key={id} value={id}>{tool.name}</option>)}</datalist></div>
      <Button disabled={!toolId.trim() || agent.tools.includes(toolId.trim())} onClick={() => { onChange([...agent.tools, toolId.trim()]); setToolId(""); }}>Assign tool</Button></div>}
  </Section>;
}

export function AgentWorkflowUsage({ agentId, workflows, navigate }: { agentId: string; workflows: WorkflowDefinition[]; navigate: (url: string) => void }) {
  const usages = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId).map((node) => ({ workflow, node })));
  return <Section title="Workflow usage">
    <p className="text-sm text-zinc-400">{new Set(usages.map(({ workflow }) => workflow.id)).size} saved workflows · {usages.length} node instances. The current service stores one workflow; unsaved graph changes are not included.</p>
    {!usages.length && <p className="text-sm text-zinc-400">This agent is not referenced in a saved workflow.</p>}
    {usages.map(({ workflow, node }) => <div key={`${workflow.id}:${node.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3">
      <div className="min-w-0 flex-1"><p className="font-medium">{workflow.name}</p><p className="break-all text-xs text-zinc-400">Workflow: {workflow.id}</p><p className="break-all text-xs text-zinc-400">Node: {node.id} · Saved definition (execution status unavailable)</p></div>
      <Button variant="outline" size="sm" onClick={() => navigate(`/org?workflowId=${encodeURIComponent(workflow.id)}&focusNode=${encodeURIComponent(node.id)}`)}>Open in Graph</Button>
    </div>)}
  </Section>;
}
