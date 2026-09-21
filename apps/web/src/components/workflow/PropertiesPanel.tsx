"use client";

/**
 * Properties panel shell: routes the current selection to the right panel.
 * Panel and form implementations live in ./properties/.
 */

import { useWorkflowStore } from "@/store/useWorkflowStore";
import { EdgeProperties, MultiSelectProperties, NodeProperties, Overview } from "./properties/panels";

export function PropertiesPanel() {
  const definition = useWorkflowStore((s) => s.definition);
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useWorkflowStore((s) => s.selectedEdgeIds);

  const selectedNode =
    selectedNodeIds.length === 1
      ? definition.nodes.find((n) => n.id === selectedNodeIds[0])
      : undefined;
  const selectedEdge =
    selectedNodeIds.length === 0 && selectedEdgeIds.length === 1
      ? definition.edges.find((e) => e.id === selectedEdgeIds[0])
      : undefined;

  return (
    <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-zinc-800/80 bg-zinc-950/60 p-3">
      {selectedNode && <NodeProperties node={selectedNode} />}
      {!selectedNode && selectedEdge && <EdgeProperties edge={selectedEdge} />}
      {!selectedNode && !selectedEdge && selectedNodeIds.length > 1 && (
        <MultiSelectProperties nodeIds={selectedNodeIds} />
      )}
      {!selectedNode && !selectedEdge && selectedNodeIds.length <= 1 && <Overview />}
    </aside>
  );
}
