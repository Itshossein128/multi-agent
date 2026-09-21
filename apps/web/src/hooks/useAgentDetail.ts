"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentRecord } from "@multi-agent/types";
import { workflowService } from "@/services/workflowService";
import { runService } from "@/services/runService";
import { validateAgentConfiguration } from "@/lib/agentConfiguration";

const options = { refetchInterval: false as const, refetchOnWindowFocus: false, retry: false };

export function useAgentDetail(agentId: string) {
  const cache = useQueryClient();
  const agent = useQuery({ ...options, queryKey: ["agent", agentId], queryFn: () => workflowService.getAgent(agentId) });
  const diagnostics = useQuery({ ...options, queryKey: ["agent-diagnostics", agentId], queryFn: () => workflowService.getAgentDiagnostics(agentId), enabled: Boolean(agent.data) });
  const workflows = useQuery({ ...options, queryKey: ["agent-workflows", agentId], queryFn: () => workflowService.listWorkflows() });
  const tools = useQuery({ ...options, queryKey: ["agent-tools", agentId], queryFn: () => workflowService.listTools() });
  const runs = useQuery({ ...options, queryKey: ["agent-runs", agentId], queryFn: () => runService.getAgentRuns(agentId), enabled: Boolean(agent.data) });
  const save = useMutation({
    mutationFn: async (draft: AgentRecord) => {
      const errors = validateAgentConfiguration(draft);
      if (errors.length) throw new Error(errors.join(" "));
      const { id, createdAt, ...patch } = draft;
      void createdAt;
      return workflowService.updateAgent(id, patch);
    },
    onSuccess: (saved) => cache.setQueryData(["agent", agentId], saved),
  });
  const remove = useMutation({ mutationFn: async () => {
    // Check persisted usage again at action time, not just the visible query snapshot.
    const definitions = await workflowService.listWorkflows();
    if (definitions.some((workflow) => workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId))) {
      throw new Error("Remove this agent’s nodes in the Graph Editor and save the workflow before deleting the agent.");
    }
    await workflowService.deleteAgent(agentId);
    cache.removeQueries({ queryKey: ["agent", agentId] });
  } });
  return { agent, diagnostics, workflows, tools, runs, save, remove };
}

export function useAgentRunEvents(agentId: string, runId: string | null) {
  return useQuery({ ...options, queryKey: ["agent-events", agentId, runId],
    queryFn: () => runService.getRunEvents(runId!, agentId), enabled: Boolean(runId) });
}
