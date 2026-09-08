"use client";

import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  EdgeTypes,
  getSmoothStepPath,
} from "@xyflow/react";
import { GitBranch, X } from "lucide-react";
import { WorkflowEdge } from "@/lib/workflow/types";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";

function WorkflowEdgeComponent(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    selected,
  } = props;
  const edge = (props.data as { edge?: WorkflowEdge } | undefined)?.edge;
  const selectEdgeOnly = useWorkflowStore((s) => s.selectEdgeOnly);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 14,
  });

  const isConditional = edge?.kind === "conditional";
  const stroke = selected ? "#818cf8" : isConditional ? "#c084fc" : "#52525b";
  const chipLabel = isConditional
    ? edge?.branchKey || "branch?"
    : edge?.label;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth: selected ? 2.4 : 1.8,
          strokeDasharray: isConditional ? "7 5" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {chipLabel !== undefined && chipLabel !== "" && (
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                selectEdgeOnly(id);
              }}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer",
                selected
                  ? "border-indigo-400 bg-indigo-950/90 text-indigo-200"
                  : isConditional
                    ? "border-purple-500/40 bg-zinc-950/90 text-purple-300 hover:border-purple-400"
                    : "border-zinc-700 bg-zinc-950/90 text-zinc-400 hover:border-zinc-500"
              )}
            >
              {isConditional && <GitBranch className="h-2.5 w-2.5" />}
              {chipLabel}
              <span
                role="button"
                tabIndex={-1}
                title="Delete edge"
                onClick={(event) => {
                  event.stopPropagation();
                  removeEdges([id]);
                }}
                className="ml-0.5 rounded-full text-zinc-500 hover:text-red-400"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

/** React Flow edge-type registry — add new edge types here. */
export const workflowEdgeTypes: EdgeTypes = {
  workflow: WorkflowEdgeComponent,
};
