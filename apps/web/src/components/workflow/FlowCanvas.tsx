"use client";

import React, { useCallback, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  OnSelectionChangeFunc,
  ReactFlow,
  ReactFlowInstance,
  useReactFlow,
} from "@xyflow/react";
import { NODE_TYPE_META, isWorkflowNodeType } from "@/lib/workflow/types";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { workflowNodeTypes } from "@/components/workflow/nodes/WorkflowNodes";
import { workflowEdgeTypes } from "@/components/workflow/edges/WorkflowEdge";

import { useCanvasStatusSnapshot } from "./live/useCanvasStatusSnapshot";
import { projectRunCanvas, edgeLiveStyle } from "@/lib/runCanvasProjection";
import { projectApprovalSourceHandle } from "@/lib/workflow/canvasRoutingHandles";
import type { WorkflowDefinition } from "@multi-agent/types";

const PALETTE_NODE_MIME = "application/x-workflow-node";
const PALETTE_AGENT_MIME = "application/x-workflow-agent";
const PALETTE_TOOL_MIME = "application/x-workflow-tool";

const EMPTY_LIVE_DEFINITION: WorkflowDefinition = {
  id: "",
  name: "",
  nodes: [],
  edges: [],
  updatedAt: "",
};

export function FlowCanvas({ live = false, liveDefinition, onInspectNode }: { live?: boolean; liveDefinition?: WorkflowDefinition | null; onInspectNode?: (nodeId: string) => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draft = useWorkflowStore((s) => s.definition);
  // Live mode must never silently render the editable draft as the observed run graph.
  const awaitingLiveGraph = live && !liveDefinition;
  const definition = live ? (liveDefinition ?? EMPTY_LIVE_DEFINITION) : draft;
  const snapshot = useCanvasStatusSnapshot(live);
  const statusEvents = snapshot.events;
  const projection = useMemo(() => projectRunCanvas(snapshot), [snapshot]);
  const errorCodeByNode = useMemo(() => {
    const codes = new Map<string, string>();
    for (const event of statusEvents) {
      if (event.nodeId && event.type.endsWith("failed") && typeof event.payload.code === "string") codes.set(event.nodeId, event.payload.code);
    }
    return codes;
  }, [statusEvents]);
  const agents = useWorkflowStore((s) => s.agents);
  const tools = useWorkflowStore((s) => s.tools);
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useWorkflowStore((s) => s.selectedEdgeIds);
  const issues = useWorkflowStore((s) => s.issues);
  const { screenToFlowPosition } = useReactFlow();

  const issueCountByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.nodeId) counts.set(issue.nodeId, (counts.get(issue.nodeId) ?? 0) + 1);
    }
    return counts;
  }, [issues]);

  const rfNodes = useMemo<Node[]>(
    () =>
      definition.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        selected: selectedNodeIds.includes(node.id),
        data: {
          node,
          liveStatus: live ? projection.nodeStatus.get(node.id) ?? "idle" : undefined,
          waitingApproval: live && projection.waitingApprovalNodeIds.has(node.id),
          liveErrorCode: live ? errorCodeByNode.get(node.id) : undefined,
          agent:
            node.type === "agent"
              ? agents.find(
                  (a) => a.id === (node.config as { agentId?: string | null }).agentId
                )
              : undefined,
          tool:
            node.type === "tool"
              ? tools.find(
                  (t) => t.id === (node.config as { toolId?: string | null }).toolId
                )
              : undefined,
          issueCount: issueCountByNode.get(node.id) ?? 0,
          issueTitle: issues
            .filter((issue) => issue.nodeId === node.id)
            .map((issue) => (issue.code ? `${issue.code}: ${issue.message}` : issue.message))
            .join("\n"),
        },
      })),
    [definition.nodes, agents, tools, selectedNodeIds, issueCountByNode, issues, live, projection, errorCodeByNode]
  );

  const rfEdges = useMemo<Edge[]>(
    () =>
      definition.edges.map((edge) => {
        const sourceNode = definition.nodes.find((n) => n.id === edge.source);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle:
            sourceNode?.type === "condition"
              ? edge.branchKey || undefined
              : sourceNode?.type === "approval"
                ? projectApprovalSourceHandle(edge.branchKey)
                : undefined,
          type: "workflow",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edge.kind === "conditional" ? "#c084fc" : "#52525b",
            width: 16,
            height: 16,
          },
          selected: selectedEdgeIds.includes(edge.id),
          data: { edge, readOnly: live, ...edgeLiveStyle(edge, live && projection.traversedEdgeIds.has(edge.id)) },
        };
      }),
    [definition.edges, definition.nodes, selectedEdgeIds, live, projection]
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (live) return;
    const positions = new Map<string, { x: number; y: number }>();
    const removed: string[] = [];
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        positions.set(change.id, change.position);
      } else if (change.type === "remove") {
        removed.push(change.id);
      }
    }
    const store = useWorkflowStore.getState();
    if (positions.size > 0) store.moveNodes(positions);
    if (removed.length > 0) store.removeNodes(removed);
  }, [live]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (live) return;
    const removed: string[] = [];
    for (const change of changes) {
      if (change.type === "remove") removed.push(change.id);
    }
    if (removed.length > 0) {
      useWorkflowStore.getState().removeEdges(removed);
    }
  }, [live]);

  const onConnect = useCallback((connection: Connection) => {
    if (live) return;
    if (!connection.source || !connection.target) return;
    // The editor stores cycles as valid graph structure. Compilation/runtime
    // policy remains authoritative and can reject or bound unsupported loops.
    useWorkflowStore.getState().addEdge({
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
    });
  }, [live]);

  const onSelectionChange = useCallback<OnSelectionChangeFunc>(({ nodes, edges }) => {
    if (live) return;
    useWorkflowStore.getState().setSelection(
      nodes.map((n) => n.id),
      edges.map((e) => e.id)
    );
  }, [live]);

  const onNodeDragStart = useCallback(() => {
    if (!live) useWorkflowStore.getState().beginHistory();
  }, [live]);

  const onInit = useCallback(
    (instance: ReactFlowInstance) => {
      useWorkflowStore.getState().setFlowHelpers({
        getCanvasCenter: () => {
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (!rect) return { x: 0, y: 0 };
          return instance.screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        },
        fitView: () => {
          void instance.fitView({ duration: 300 });
        },
        setCenter: (x, y, zoom) => {
          instance.setCenter(x, y, { zoom: zoom ?? 1.1, duration: 400 });
        },
      });
    },
    []
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (live) return;
      const nodeType = event.dataTransfer.getData(PALETTE_NODE_MIME);
      const agentId = event.dataTransfer.getData(PALETTE_AGENT_MIME);
      const toolId = event.dataTransfer.getData(PALETTE_TOOL_MIME);
      if (!nodeType && !agentId && !toolId) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const store = useWorkflowStore.getState();
      if (agentId) {
        store.addNodeForAgent(agentId, position);
      } else if (toolId) {
        store.addNodeForTool(toolId, position);
      } else if (isWorkflowNodeType(nodeType)) {
        if (nodeType === "agent") {
          void store.addAgentAndNode(position);
        } else {
          store.addNode(nodeType, position);
        }
      }
    },
    [screenToFlowPosition, live]
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = live ? "none" : "copy";
  }, [live]);

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full bg-zinc-950"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={workflowNodeTypes}
        edgeTypes={workflowEdgeTypes}
        onNodeClick={live ? (_event, node) => onInspectNode?.(node.id) : undefined}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onSelectionChange={onSelectionChange}
        onInit={onInit}
        nodesDraggable={!live}
        nodesConnectable={!live}
        edgesReconnectable={!live}
        deleteKeyCode={live ? null : ["Backspace", "Delete"]}
        multiSelectionKeyCode={["Shift", "Control", "Meta"]}
        minZoom={0.15}
        maxZoom={2.5}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} color="#27272a" gap={18} size={1.2} />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className="!rounded-lg !border !border-zinc-800 !bg-zinc-900 [&>button]:!border-zinc-800 [&>button]:!bg-zinc-900 [&>button:hover]:!bg-zinc-800"
        />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="!rounded-lg !border !border-zinc-800 !bg-zinc-900"
          maskColor="rgba(9, 9, 11, 0.75)"
          nodeColor={(node) => {
            switch (node.type) {
              case "agent":
                return "#6366f1";
              case "tool":
                return "#f59e0b";
              case "approval":
                return "#06b6d4";
              case "memory":
                return "#a855f7";
              case "condition":
                return "#f97316";
              case "input":
                return "#10b981";
              case "output":
                return "#3b82f6";
              default:
                return "#52525b";
            }
          }}
        />
      </ReactFlow>

      {awaitingLiveGraph && (
        <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/80 text-center">
          <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
          <p className="text-sm font-semibold text-zinc-300">Loading run graph…</p>
          <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
            Waiting for the execution snapshot. The current draft is not shown as the live topology.
          </p>
        </div>
      )}

      {!live && definition.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm font-semibold text-zinc-400">Empty canvas</p>
          <p className="max-w-sm text-xs leading-relaxed text-zinc-600">
            Drag node types from the palette — start with an{" "}
            <span className={NODE_TYPE_META.input.iconText}>Input</span>, add agents, and finish
            with an <span className={NODE_TYPE_META.output.iconText}>Output</span>.
          </p>
        </div>
      )}
    </div>
  );
}
