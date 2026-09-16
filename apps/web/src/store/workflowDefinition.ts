/** Shared helpers for workflow definition handling inside the editor store. */

import { createNode, type WorkflowDefinition, type WorkflowNode, type WorkflowNodeType, type WorkflowPosition } from "@/lib/workflow/types";

export function cloneDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  return JSON.parse(JSON.stringify(definition)) as WorkflowDefinition;
}

/** Canvas position for a new node: explicit, canvas center, or a gentle default scatter. */
export function resolveNodePosition(
  position: WorkflowPosition | undefined,
  helpers: { getCanvasCenter: () => WorkflowPosition } | null
): WorkflowPosition {
  return (
    position ??
    helpers?.getCanvasCenter() ??
    { x: 160 + Math.random() * 120, y: 140 + Math.random() * 80 }
  );
}

export function createNodeAt(type: WorkflowNodeType, position: WorkflowPosition, options?: { agentId?: string }): WorkflowNode {
  return createNode(type, position, options);
}
