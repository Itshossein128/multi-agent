"use client";

import React from "react";
import Link from "next/link";
import {
  Bot,
  Database,
  GitBranch,
  LogIn,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  Wrench,
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
};

const PALETTE_ORDER: WorkflowNodeType[] = [
  "agent",
  "tool",
  "condition",
  "approval",
  "memory",
  "input",
  "output",
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
      className="group flex w-full cursor-grab items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-2 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900 active:cursor-grabbing"
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
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-zinc-200">{meta.label}</span>
        <span className="block truncate text-[10px] text-zinc-500">{meta.description}</span>
      </span>
      <Plus className="h-3 w-3 flex-shrink-0 text-zinc-600 group-hover:text-zinc-300" />
    </button>
  );
}

export function NodePalette() {
  const addNode = useWorkflowStore((s) => s.addNode);
  const addAgentAndNode = useWorkflowStore((s) => s.addAgentAndNode);
  const addNodeForAgent = useWorkflowStore((s) => s.addNodeForAgent);
  const deleteAgent = useWorkflowStore((s) => s.deleteAgent);
  const agents = useWorkflowStore((s) => s.agents);

  const handleAdd = (type: string) => {
    if (isWorkflowNodeType(type)) {
      if (type === "agent") {
        // Creating an Agent follows the full flow:
        // create agent → configure → node appears → connect.
        void addAgentAndNode();
        return;
      }
      addNode(type);
    }
  };

  return (
    <aside className="flex w-56 flex-shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-800/80 bg-zinc-950/60 p-3">
      <section className="space-y-1.5">
        <h3 className="px-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Node Types
        </h3>
        {PALETTE_ORDER.map((type) => (
          <PaletteItem key={type} type={type} onAdd={handleAdd} />
        ))}
      </section>

      <section className="space-y-1.5">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Agents ({agents.length})
          </h3>
        </div>
        {agents.length === 0 && (
          <p className="px-1 text-[10px] leading-snug text-zinc-600">
            No agents yet. Click “Agent” above to create one — it appears on the canvas as a node.
          </p>
        )}
        {agents.map((agent) => (
          <div
            key={agent.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-workflow-agent", agent.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            className="group flex cursor-grab items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-2 py-1.5 transition-colors hover:border-indigo-500/40 active:cursor-grabbing"
            title={`Drag onto canvas to add "${agent.name}" as a node`}
          >
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-indigo-500/15 text-indigo-300">
              <Bot className="h-3 w-3" />
            </span>
            <button
              type="button"
              onClick={() => addNodeForAgent(agent.id)}
              className="min-w-0 flex-1 text-left cursor-pointer"
            >
              <span className="block truncate text-[11px] font-medium text-zinc-200">
                {agent.name}
              </span>
              <span className="block truncate text-[9px] text-zinc-500">
                {agentBackendLabel(agent.backend)}
              </span>
            </button>
            <Link href={`/org/agents/${encodeURIComponent(agent.id)}`} aria-label={`Inspect ${agent.name}`} className="rounded px-1 py-2 text-xs text-indigo-300 underline focus-visible:outline-2 focus-visible:outline-indigo-400">Details</Link>
            <button
              type="button"
              title={`Delete agent "${agent.name}" and its nodes`}
              onClick={() => {
                if (window.confirm(`Delete agent "${agent.name}" and all of its nodes?`)) {
                  void deleteAgent(agent.id);
                }
              }}
              className="flex-shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </section>

      <p className="mt-auto rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2 text-[10px] leading-relaxed text-zinc-500">
        Drag a type onto the canvas, or click to add it at the center. Drag from a node handle to
        another node to connect.
      </p>
    </aside>
  );
}
