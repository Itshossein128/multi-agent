"use client";

/**
 * Custom React Flow node used by the dashboard graph preview, plus the
 * node-type registry consumed by ReactFlow.
 */

import React from "react";
import { Handle, NodeProps, Position } from "@xyflow/react";

export interface GraphAgentNodeData {
  status?: string;
  label?: string;
  role?: string;
  icon?: React.ReactNode;
}

export function GraphAgentNode(props: NodeProps) {
  const data = props.data as GraphAgentNodeData;
  return (
    <div
      className={`rounded-xl border px-4 py-3 shadow-lg backdrop-blur-md transition-all ${data.status === "active"
          ? "border-emerald-500/80 bg-emerald-950/40 shadow-emerald-500/10"
          : data.status === "processing"
            ? "border-blue-500/80 bg-blue-950/40 shadow-blue-500/10"
            : "border-zinc-800 bg-zinc-950/80"
        }`}
      style={{ minWidth: 170 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-600 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${data.status === "active"
              ? "bg-emerald-500/20 text-emerald-400"
              : data.status === "processing"
                ? "bg-blue-500/20 text-blue-400"
                : "bg-zinc-800 text-zinc-400"
            }`}
        >
          {data.icon}
        </div>
        <div>
          <div className="text-xs font-bold text-white leading-tight">{data.label}</div>
          <div className="text-[10px] text-zinc-400">{data.role}</div>
        </div>
      </div>
      {data.status && (
        <div className="mt-2 flex items-center justify-between border-t border-zinc-800/80 pt-1.5 text-[10px]">
          <span className="text-zinc-500">Status</span>
          <span
            className={`font-semibold capitalize ${data.status === "active"
                ? "text-emerald-400"
                : data.status === "processing"
                  ? "text-blue-400"
                  : "text-zinc-500"
              }`}
          >
            {data.status}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600 !w-2 !h-2" />
    </div>
  );
}

export const graphNodeTypes = {
  agentNode: GraphAgentNode,
};
