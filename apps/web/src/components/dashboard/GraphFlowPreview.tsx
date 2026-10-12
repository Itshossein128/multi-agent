"use client";

import { useOptionalOrg } from "@/components/organization/OrgProvider";

/**
 * Dashboard graph preview shell: data queries, workflow pick, and card layout.
 * Node rendering lives in graph/GraphAgentNode; graph mapping lives in
 * graph/graphMappers.
 */

import React, { useMemo } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Network } from "lucide-react";
import { workflowService } from "@/services/workflowService";
import { graphNodeTypes } from "./graph/GraphAgentNode";
import { workflowToGraph } from "./graph/graphMappers";

// Evaluated once at module load (not during render) so the preview picks a
// random workflow per page load while keeping render pure.
const MOUNT_SEED = Math.floor(Math.random() * 1_000_000);

export function GraphFlowPreview() {
  const orgId = useOptionalOrg()?.org.id ?? "none";
  const workflowsQuery = useQuery({
    queryKey: ["org", orgId, "dashboard-workflows"],
    queryFn: () => workflowService.listWorkflows(),
  });
  const agentsQuery = useQuery({
    queryKey: ["org", orgId, "dashboard-agents"],
    queryFn: () => workflowService.listAgents(),
  });

  // Stable random pick per mount: seeded index modulo the current list length,
  // so refetches keep the same workflow unless it is removed or list shrinks.
  const workflow = useMemo(() => {
    const workflows = (workflowsQuery.data ?? []).filter((item) => item.nodes.length > 0);
    if (!workflows.length) return null;
    return workflows[MOUNT_SEED % workflows.length] ?? null;
  }, [workflowsQuery.data]);

  const graph = useMemo(() => {
    if (!workflow) return null;
    return workflowToGraph(workflow, agentsQuery.data ?? []);
  }, [workflow, agentsQuery.data]);

  if (!workflow || !graph) return null;

  return (
    <section>
      <Card className="border-zinc-800/80 bg-zinc-900/40 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                <Network className="h-5 w-5 text-indigo-400" />
                {workflow.name}
              </CardTitle>
              <Badge
                variant="outline"
                className="text-emerald-400 border-emerald-500/30 bg-emerald-950/30 text-[11px]"
              >
                Saved Workflow
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-400 mt-1">
              Random saved workflow from your organization studio.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="h-[390px] w-full bg-zinc-950/90 relative">
            <ReactFlowProvider>
              <ReactFlow
                key={workflow.id}
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={graphNodeTypes}
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
    </section>
  );
}
