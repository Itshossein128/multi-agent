"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ToolRecord } from "@multi-agent/types";
import { validateTool } from "@multi-agent/types";
import { useOptionalOrg } from "@/components/organization/OrgProvider";
import { findToolUsages, workflowService } from "@/services/workflowService";

const options = { refetchInterval: false as const, refetchOnWindowFocus: false, retry: false };

export function useToolDetail(toolId: string) {
  const cache = useQueryClient();
  const orgId = useOptionalOrg()?.org.id ?? "none";
  const toolKey = ["org", orgId, "tool", toolId] as const;
  const tool = useQuery({ ...options, queryKey: toolKey, queryFn: () => workflowService.getTool(toolId) });
  const agents = useQuery({ ...options, queryKey: ["org", orgId, "tool-agents", toolId], queryFn: () => workflowService.listAgents() });
  const workflows = useQuery({ ...options, queryKey: ["org", orgId, "tool-workflows", toolId], queryFn: () => workflowService.listWorkflows() });
  const save = useMutation({
    mutationFn: async (draft: ToolRecord) => {
      const errors = validateTool(draft);
      if (errors.length) throw new Error(errors.join(" "));
      const { id, createdAt, ...patch } = draft;
      void createdAt;
      return workflowService.updateTool(id, patch);
    },
    onSuccess: (saved) => cache.setQueryData(toolKey, saved),
  });
  const remove = useMutation({ mutationFn: async () => {
    // Check persisted usage again at action time, not just the visible query snapshot.
    const [definitions, allAgents] = await Promise.all([workflowService.listWorkflows(), workflowService.listAgents()]);
    const { assignedAgents, nodeUsages } = findToolUsages(toolId, allAgents, definitions);
    if (assignedAgents.length || nodeUsages.length) {
      throw new Error("Remove this tool’s nodes in the Graph Editor and agent assignments before deleting the tool.");
    }
    await workflowService.deleteTool(toolId);
    cache.removeQueries({ queryKey: toolKey });
  } });
  return { tool, agents, workflows, save, remove };
}
