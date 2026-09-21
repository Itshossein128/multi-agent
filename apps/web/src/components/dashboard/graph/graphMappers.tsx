"use client";

/**
 * Pure mapping from workflow definitions (or the sample fallback) to React Flow
 * graph models. No data fetching, no store access — independently testable.
 */

import React from "react";
import { Edge, Node } from "@xyflow/react";
import {
  Bot,
  CheckCheck,
  Code,
  Database,
  FileText,
  GitBranch,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { AgentRecord, WorkflowDefinition, WorkflowNodeType } from "@multi-agent/types";
import { NODE_TYPE_META, agentBackendLabel } from "@/lib/workflow/types";

export const NODE_ICONS: Record<WorkflowNodeType, React.ReactNode> = {
  input: <LogIn className="h-3.5 w-3.5" />,
  output: <LogOut className="h-3.5 w-3.5" />,
  agent: <Bot className="h-3.5 w-3.5" />,
  tool: <Wrench className="h-3.5 w-3.5" />,
  approval: <ShieldCheck className="h-3.5 w-3.5" />,
  memory: <Database className="h-3.5 w-3.5" />,
  condition: <GitBranch className="h-3.5 w-3.5" />,
};

const EDGE_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#06b6d4"];

/** Sample topology shown when the organization has no saved workflows yet. */
export function sampleGraph(): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: [
      {
        id: "input",
        type: "agentNode",
        position: { x: 260, y: 15 },
        data: {
          label: "User Requirement",
          role: "Input Stream / Hook",
          icon: <Sparkles className="h-3.5 w-3.5" />,
          status: "idle",
        },
      },
      {
        id: "orchestrator",
        type: "agentNode",
        position: { x: 260, y: 110 },
        data: {
          label: "Orchestrator Node",
          role: "LangGraph StateGraph",
          icon: <Bot className="h-3.5 w-3.5" />,
          status: "active",
        },
      },
      {
        id: "docGen",
        type: "agentNode",
        position: { x: 100, y: 220 },
        data: {
          label: "Doc Generator",
          role: "BookStack Chapter Node",
          icon: <FileText className="h-3.5 w-3.5" />,
          status: "idle",
        },
      },
      {
        id: "developer",
        type: "agentNode",
        position: { x: 420, y: 220 },
        data: {
          label: "Developer Agent",
          role: "Code Generator & Git",
          icon: <Code className="h-3.5 w-3.5" />,
          status: "processing",
        },
      },
      {
        id: "end",
        type: "agentNode",
        position: { x: 260, y: 330 },
        data: {
          label: "Verification & Output",
          role: "PR / Artifact Dispatch",
          icon: <CheckCheck className="h-3.5 w-3.5" />,
          status: "idle",
        },
      },
    ],
    edges: [
      {
        id: "e-in-orch",
        source: "input",
        target: "orchestrator",
        animated: true,
        style: { stroke: "#10b981", strokeWidth: 2 },
      },
      {
        id: "e-orch-doc",
        source: "orchestrator",
        target: "docGen",
        label: "!isMatureDoc",
        labelStyle: { fill: "#a1a1aa", fontSize: 10 },
        labelBgStyle: { fill: "#18181b" },
        style: { stroke: "#52525b" },
      },
      {
        id: "e-doc-orch",
        source: "docGen",
        target: "orchestrator",
        animated: true,
        style: { stroke: "#8b5cf6" },
      },
      {
        id: "e-orch-dev",
        source: "orchestrator",
        target: "developer",
        animated: true,
        label: "ready_for_dev",
        labelStyle: { fill: "#60a5fa", fontSize: 10 },
        labelBgStyle: { fill: "#18181b" },
        style: { stroke: "#3b82f6", strokeWidth: 2 },
      },
      {
        id: "e-dev-end",
        source: "developer",
        target: "end",
        animated: true,
        style: { stroke: "#3b82f6" },
      },
    ],
  };
}

/** Convert a workflow definition plus agent registry into a React Flow graph. */
export function workflowToGraph(
  workflow: WorkflowDefinition,
  agents: AgentRecord[]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = workflow.nodes.map((node) => {
    const meta = NODE_TYPE_META[node.type];
    const agent =
      node.type === "agent"
        ? agents.find((item) => item.id === (node.config as { agentId?: string | null }).agentId)
        : undefined;
    const label =
      node.type === "agent"
        ? agent?.name || meta.label
        : node.type === "tool"
          ? (node.config as { toolId?: string | null }).toolId || meta.label
          : meta.label;
    const role =
      node.type === "agent" && agent ? agentBackendLabel(agent.backend) : meta.description;

    return {
      id: node.id,
      type: "agentNode",
      position: node.position,
      data: {
        label,
        role,
        icon: NODE_ICONS[node.type],
        status: "idle",
      },
    };
  });

  const edges: Edge[] = workflow.edges.map((edge, index) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.kind === "conditional",
    label: edge.branchKey || undefined,
    labelStyle: edge.branchKey ? { fill: "#a1a1aa", fontSize: 10 } : undefined,
    labelBgStyle: edge.branchKey ? { fill: "#18181b" } : undefined,
    style: {
      stroke: EDGE_COLORS[index % EDGE_COLORS.length],
      strokeWidth: edge.kind === "conditional" ? 1.5 : 2,
    },
  }));

  return { nodes, edges };
}
