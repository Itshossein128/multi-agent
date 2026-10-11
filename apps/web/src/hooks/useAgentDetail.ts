"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentRecord } from "@multi-agent/types";
import { useOptionalOrg } from "@/components/organization/OrgProvider";
import { workflowService } from "@/services/workflowService";
import { runService } from "@/services/runService";
import { validateAgentConfiguration } from "@/lib/agentConfiguration";

const options = { refetchInterval: false as const, refetchOnWindowFocus: false, retry: false };

export function useAgentDetail(agentId: string) {
  const cache = useQueryClient();
  const orgId = useOptionalOrg()?.org.id ?? "none";
  const agentKey = ["org", orgId, "agent", agentId] as const;
  const agent = useQuery({ ...options, queryKey: agentKey, queryFn: () => workflowService.getAgent(agentId) });
  const diagnostics = useQuery({ ...options, queryKey: ["org", orgId, "agent-diagnostics", agentId], queryFn: () => workflowService.getAgentDiagnostics(agentId), enabled: Boolean(agent.data) });
  const workflows = useQuery({ ...options, queryKey: ["org", orgId, "agent-workflows", agentId], queryFn: () => workflowService.listWorkflows() });
  const tools = useQuery({ ...options, queryKey: ["org", orgId, "agent-tools", agentId], queryFn: () => workflowService.listTools() });
  const runs = useQuery({ ...options, queryKey: ["org", orgId, "agent-runs", agentId], queryFn: () => runService.getAgentRuns(agentId), enabled: Boolean(agent.data) });
  const save = useMutation({
    mutationFn: async (draft: AgentRecord) => {
      const errors = validateAgentConfiguration(draft);
      if (errors.length) throw new Error(errors.join(" "));
      const { id, createdAt, ...patch } = draft;
      void createdAt;
      return workflowService.updateAgent(id, patch);
    },
    onSuccess: (saved) => cache.setQueryData(agentKey, saved),
  });
  const remove = useMutation({ mutationFn: async () => {
    // Check persisted usage again at action time, not just the visible query snapshot.
    const definitions = await workflowService.listWorkflows();
    if (definitions.some((workflow) => workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId))) {
      throw new Error("Remove this agent’s nodes in the Graph Editor and save the workflow before deleting the agent.");
    }
    await workflowService.deleteAgent(agentId);
    cache.removeQueries({ queryKey: agentKey });
  } });
  return { agent, diagnostics, workflows, tools, runs, save, remove };
}

export function useAgentRunEvents(agentId: string, runId: string | null) {
  const orgId = useOptionalOrg()?.org.id ?? "none";
  return useQuery({ ...options, queryKey: ["org", orgId, "agent-events", agentId, runId],
    queryFn: () => runService.getRunEvents(runId!, agentId), enabled: Boolean(runId) });
}
