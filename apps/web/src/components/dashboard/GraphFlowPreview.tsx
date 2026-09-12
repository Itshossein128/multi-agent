"use client";

import React, { useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Edge,
  Node,
  NodeProps,
  Position,
  Handle,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Network,
  Sparkles,
  Bot,
  Code,
  FileText,
  CheckCheck,
  Wrench,
  ShieldCheck,
  Database,
  GitBranch,
  LogIn,
  LogOut,
} from "lucide-react";
import type { AgentRecord, WorkflowDefinition, WorkflowNodeType } from "@multi-agent/types";
import { NODE_TYPE_META, agentBackendLabel } from "@/lib/workflow/types";
import { workflowService } from "@/services/workflowService";

function AgentNode(props: NodeProps) {
  const data = props.data as {
    status?: string;
    label?: string;
    role?: string;
    icon?: React.ReactNode;
  };
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

const nodeTypes = {
  agentNode: AgentNode,
};

const NODE_ICONS: Record<WorkflowNodeType, React.ReactNode> = {
  input: <LogIn className="h-3.5 w-3.5" />,
  output: <LogOut className="h-3.5 w-3.5" />,
  agent: <Bot className="h-3.5 w-3.5" />,
  tool: <Wrench className="h-3.5 w-3.5" />,
  approval: <ShieldCheck className="h-3.5 w-3.5" />,
  memory: <Database className="h-3.5 w-3.5" />,
  condition: <GitBranch className="h-3.5 w-3.5" />,
};

const EDGE_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#06b6d4"];

function mockGraph(): { nodes: Node[]; edges: Edge[] } {
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

function workflowToGraph(
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

export function GraphFlowPreview() {
  const pickedIdRef = useRef<string | null>(null);
  const workflowsQuery = useQuery({
    queryKey: ["dashboard-workflows"],
    queryFn: () => workflowService.listWorkflows(),
  });
  const agentsQuery = useQuery({
    queryKey: ["dashboard-agents"],
    queryFn: () => workflowService.listAgents(),
  });

  const workflow = useMemo(() => {
    const workflows = (workflowsQuery.data ?? []).filter((item) => item.nodes.length > 0);
    if (!workflows.length) return null;
    if (!pickedIdRef.current || !workflows.some((item) => item.id === pickedIdRef.current)) {
      pickedIdRef.current = workflows[Math.floor(Math.random() * workflows.length)]!.id;
    }
    return workflows.find((item) => item.id === pickedIdRef.current) ?? null;
  }, [workflowsQuery.data]);

  const graph = useMemo(() => {
    if (!workflow) return mockGraph();
    return workflowToGraph(workflow, agentsQuery.data ?? []);
  }, [workflow, agentsQuery.data]);

  const isLiveWorkflow = !!workflow;

  return (
    <Card className="border-zinc-800/80 bg-zinc-900/40 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
              <Network className="h-5 w-5 text-indigo-400" />
              {isLiveWorkflow ? workflow.name : "Live Workflow Graph (React Flow)"}
            </CardTitle>
            <Badge
              variant="outline"
              className={
                isLiveWorkflow
                  ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/30 text-[11px]"
                  : "text-indigo-400 border-indigo-500/30 bg-indigo-950/30 text-[11px]"
              }
            >
              {isLiveWorkflow ? "Saved Workflow" : "Preview"}
            </Badge>
          </div>
          <CardDescription className="text-xs text-zinc-400 mt-1">
            {isLiveWorkflow
              ? "Random saved workflow from your organization studio."
              : "No saved workflows yet — showing a sample topology until you create one."}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="h-[390px] w-full bg-zinc-950/90 relative">
          <ReactFlowProvider>
            <ReactFlow
              key={workflow?.id ?? "preview"}
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#27272a" gap={16} size={1} />
              <Controls className="!bg-zinc-900 !border-zinc-800 !text-zinc-300 fill-zinc-300 [&>button]:!border-zinc-800" />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </CardContent>
    </Card>
  );
}
