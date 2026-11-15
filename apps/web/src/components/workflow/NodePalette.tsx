"use client";

import { useOrgPath } from "@/components/organization/OrgProvider";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Boxes,
  ChevronRight,
  Database,
  GitBranch,
  GitFork,
  GitMerge,
  LogIn,
  LogOut,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  NODE_TYPE_META,
  WorkflowNodeType,
  agentBackendLabel,
  isWorkflowNodeType,
} from "@/lib/workflow/types";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";

const PALETTE_ICON: Record<WorkflowNodeType, React.ReactNode> = {
  agent: <Bot className="h-3.5 w-3.5" />,
  tool: <Wrench className="h-3.5 w-3.5" />,
  condition: <GitBranch className="h-3.5 w-3.5" />,
  approval: <ShieldCheck className="h-3.5 w-3.5" />,
  memory: <Database className="h-3.5 w-3.5" />,
  input: <LogIn className="h-3.5 w-3.5" />,
  output: <LogOut className="h-3.5 w-3.5" />,
  parallel_split: <GitFork className="h-3.5 w-3.5" />,
  parallel_join: <GitMerge className="h-3.5 w-3.5" />,
  subgraph: <Boxes className="h-3.5 w-3.5" />,
};

const PALETTE_ORDER: WorkflowNodeType[] = [
  "agent",
  "tool",
  "condition",
  "approval",
  "memory",
  "input",
  "output",
  "parallel_split",
  "parallel_join",
  "subgraph",
];

function PaletteItem({
  type,
  onAdd,
}: {
  type: WorkflowNodeType;
  onAdd: (type: WorkflowNodeType) => void;
}) {
  const meta = NODE_TYPE_META[type];
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-workflow-node", type);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onAdd(type)}
      title={`${meta.description} — drag onto the canvas or click to add`}
      className="group flex min-h-10 w-full cursor-grab items-center gap-2 rounded-lg border border-zinc-800/90 bg-zinc-900/45 px-2 py-1.5 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:cursor-grabbing"
    >
      <span
        className={cn(
          "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md",
          meta.iconBg,
          meta.iconText
        )}
      >
        {PALETTE_ICON[type]}
      </span>
      <span className="min-w-0 flex-1 text-[11px] font-semibold leading-tight text-zinc-200">
        {meta.label}
      </span>
    </button>
  );
}

export function NodePalette({ className }: { className?: string }) {
  const orgUrl = useOrgPath();
  const [query, setQuery] = useState("");
  const addNode = useWorkflowStore((s) => s.addNode);
  const addAgentAndNode = useWorkflowStore((s) => s.addAgentAndNode);
  const addNodeForAgent = useWorkflowStore((s) => s.addNodeForAgent);
  const deleteAgent = useWorkflowStore((s) => s.deleteAgent);
  const agents = useWorkflowStore((s) => s.agents);
  const addToolAndNode = useWorkflowStore((s) => s.addToolAndNode);
  const addNodeForTool = useWorkflowStore((s) => s.addNodeForTool);
  const deleteTool = useWorkflowStore((s) => s.deleteTool);
  const tools = useWorkflowStore((s) => s.tools);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTypes = useMemo(() => {
    if (!normalizedQuery) return PALETTE_ORDER;
    return PALETTE_ORDER.filter((type) => {
      const meta = NODE_TYPE_META[type];
      return (
        meta.label.toLowerCase().includes(normalizedQuery) ||
        meta.description.toLowerCase().includes(normalizedQuery) ||
        type.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [normalizedQuery]);

  const filteredAgents = useMemo(
    () =>
      normalizedQuery
        ? agents.filter((agent) => agent.name.toLowerCase().includes(normalizedQuery))
        : agents,
    [agents, normalizedQuery],
  );

  const filteredTools = useMemo(
    () =>
      normalizedQuery
        ? tools.filter(
            (tool) =>
              tool.name.toLowerCase().includes(normalizedQuery) ||
              tool.category.toLowerCase().includes(normalizedQuery),
          )
        : tools,
    [tools, normalizedQuery],
  );

  const handleAdd = (type: string) => {
    if (isWorkflowNodeType(type)) {
      if (type === "agent") {
        // Creating an Agent follows the full flow:
        // create agent → configure → node appears → connect.
        void addAgentAndNode();
        return;
      }
      if (type === "tool") {
        void addToolAndNode();
        return;
      }
      addNode(type);
    }
  };

  return (
    <aside
      aria-label="Node palette"
      className={cn(
        "flex w-full lg:w-64 flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-zinc-800/80 bg-zinc-950/60 p-2.5",
        className,
      )}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <input
          type="search"
          aria-label="Filter palette"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter nodes, agents, tools…"
          className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900/80 pl-8 pr-7 text-xs text-zinc-100 placeholder-zinc-500 transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear palette filter"
            onClick={() => setQuery("")}
            className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>

      <details open className="group/sec space-y-2">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-1 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <h3 className="text-[10px] font-bold uppercase tracking-widest">
            Node Types ({filteredTypes.length})
          </h3>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500 transition-transform group-open/sec:rotate-90" aria-hidden="true" />
        </summary>
        {filteredTypes.length === 0 ? (
          <p className="px-1 text-[11px] text-zinc-500">No matching node types.</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filteredTypes.map((type) => (
              <PaletteItem key={type} type={type} onAdd={handleAdd} />
            ))}
          </div>
        )}
      </details>

      <details open className="group/sec space-y-1.5 border-t border-zinc-800/70 pt-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-1 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <h3 className="text-[10px] font-bold uppercase tracking-widest">
            Agents ({filteredAgents.length})
          </h3>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500 transition-transform group-open/sec:rotate-90" aria-hidden="true" />
        </summary>
        {filteredAgents.length === 0 && (
          <p className="px-1 text-[11px] leading-snug text-zinc-500">
            {agents.length === 0
              ? "No agents yet. Click “Agent” above to create one — it appears on the canvas as a node."
              : "No matching agents."}
          </p>
        )}
        {filteredAgents.map((agent) => (
          <div
            key={agent.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-workflow-agent", agent.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            className="group flex cursor-grab items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5 transition-colors hover:border-indigo-500/40 active:cursor-grabbing"
            title={`Drag onto canvas to add "${agent.name}" as a node`}
          >
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-indigo-500/15 text-indigo-300">
              <Bot className="h-3 w-3" aria-hidden="true" />
            </span>
            <button
              type="button"
              onClick={() => addNodeForAgent(agent.id)}
              className="min-w-0 flex-1 text-left cursor-pointer"
            >
              <span className="block truncate text-[11px] font-medium text-zinc-200">
                {agent.name}
              </span>
              <span className="block truncate text-[10px] text-zinc-500">
                {agent.enabled === false ? "Disabled · " : ""}{agentBackendLabel(agent.backend)}
              </span>
            </button>
            <Link
              href={orgUrl(`/org/agents/${encodeURIComponent(agent.id)}`)}
              aria-label={`Inspect ${agent.name}`}
              className="flex min-h-7 items-center rounded px-1.5 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/15 focus-visible:outline-2 focus-visible:outline-indigo-400"
            >
              Details
            </Link>
            <button
              type="button"
              aria-label={`Delete agent ${agent.name}`}
              title={`Delete agent "${agent.name}" and its nodes`}
              onClick={() => {
                if (window.confirm(`Delete agent "${agent.name}" and all of its nodes from every saved workflow? This cannot be undone.`)) {
                  void deleteAgent(agent.id);
                }
              }}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-red-500/15 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </details>

      <details open className="group/sec space-y-1.5 border-t border-zinc-800/70 pt-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-1 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <h3 className="text-[10px] font-bold uppercase tracking-widest">
            Tools ({filteredTools.length})
          </h3>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500 transition-transform group-open/sec:rotate-90" aria-hidden="true" />
        </summary>
        {filteredTools.length === 0 && (
          <p className="px-1 text-[11px] leading-snug text-zinc-500">
            {tools.length === 0
              ? "No tools yet. Click “Tool” above to create one — it appears on the canvas as a node."
              : "No matching tools."}
          </p>
        )}
        {filteredTools.map((tool) => (
          <div
            key={tool.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-workflow-tool", tool.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            className="group flex cursor-grab items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5 transition-colors hover:border-amber-500/40 active:cursor-grabbing"
            title={`Drag onto canvas to add "${tool.name}" as a node`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-500/15 text-amber-300">
              <Wrench className="h-3 w-3" aria-hidden="true" />
            </span>
            <button
              type="button"
              onClick={() => addNodeForTool(tool.id)}
              className="min-w-0 flex-1 text-left cursor-pointer"
            >
              <span className="block truncate text-[11px] font-medium text-zinc-200">
                {tool.name}
              </span>
              <span className="block truncate text-[10px] text-zinc-500">
                {tool.enabled === false ? "Disabled · " : ""}{tool.category}
              </span>
            </button>
            <Link
              href={orgUrl(`/org/tools/${encodeURIComponent(tool.id)}`)}
              aria-label={`Inspect ${tool.name}`}
              className="flex min-h-7 items-center rounded px-1.5 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/15 focus-visible:outline-2 focus-visible:outline-indigo-400"
            >
              Details
            </Link>
            <button
              type="button"
              aria-label={`Delete tool ${tool.name}`}
              title={`Delete tool "${tool.name}" and its nodes`}
              onClick={() => {
                if (window.confirm(`Delete tool "${tool.name}" and all of its nodes from every saved workflow? This cannot be undone.`)) {
                  void deleteTool(tool.id);
                }
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-red-500/15 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </details>

      <p className="mt-auto rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2 text-[11px] leading-relaxed text-zinc-500">
        Drag a node type onto the canvas or click to insert. Connect handles to wire your graph.
      </p>
    </aside>
  );
}
