"use client";

/**
 * Properties panel shell: routes the current selection to the right panel.
 * Panel and form implementations live in ./properties/.
 */

import { useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import {
  EdgeProperties,
  MultiSelectProperties,
  NodeProperties,
  Overview,
} from "./properties/panels";

export function PropertiesPanel({ className }: { className?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const definition = useWorkflowStore((s) => s.definition);
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useWorkflowStore((s) => s.selectedEdgeIds);
  const issues = useWorkflowStore((s) => s.issues);

  const selectedNode =
    selectedNodeIds.length === 1
      ? definition.nodes.find((n) => n.id === selectedNodeIds[0])
      : undefined;
  const selectedEdge =
    selectedNodeIds.length === 0 && selectedEdgeIds.length === 1
      ? definition.edges.find((e) => e.id === selectedEdgeIds[0])
      : undefined;

  const panelTitle = selectedNode
    ? "Node Inspector"
    : selectedEdge
      ? "Edge Inspector"
      : selectedNodeIds.length > 1
        ? "Selection"
        : "Workflow Properties";

  if (collapsed) {
    return (
      <aside
        aria-label="Workflow properties (collapsed)"
        className={cn(
          "hidden lg:flex w-11 flex-shrink-0 flex-col items-center justify-between border-l border-zinc-800/80 bg-zinc-950/80 py-3",
          className,
        )}
      >
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand properties panel"
            title="Expand properties panel"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800/90 bg-zinc-900/70 text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
          >
            <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
          </button>
          {issues.some((i) => i.severity === "error") && (
            <span
              className="h-2 w-2 rounded-full bg-red-400"
              title="Workflow has validation errors"
            />
          )}
        </div>
        <span
          className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
          style={{ writingMode: "vertical-rl" }}
        >
          Properties
        </span>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Workflow properties"
      className={cn(
        "flex w-full lg:w-80 flex-shrink-0 flex-col overflow-hidden border-l border-zinc-800/80 bg-zinc-950/70",
        className,
      )}
    >
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-3.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          {panelTitle}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse properties panel"
          title="Collapse properties panel"
          className="hidden lg:flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
        >
          <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5">
        {selectedNode && <NodeProperties key={selectedNode.id} node={selectedNode} />}
        {!selectedNode && selectedEdge && <EdgeProperties key={selectedEdge.id} edge={selectedEdge} />}
        {!selectedNode && !selectedEdge && selectedNodeIds.length > 1 && (
          <MultiSelectProperties nodeIds={selectedNodeIds} />
        )}
        {!selectedNode && !selectedEdge && selectedNodeIds.length <= 1 && <Overview />}
      </div>
    </aside>
  );
}
