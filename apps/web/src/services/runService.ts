import type { AgentRecord, ApprovalDecision, ApprovalRequest, Run, RunEvent, RunCreateRequest, RunCreateResponse, WorkflowDefinition } from "@multi-agent/types";

const API_URL = process.env.NEXT_PUBLIC_EXECUTION_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Execution request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const runService = {
  testAgent(agent: AgentRecord, input: Record<string, unknown>) {
    return request<RunCreateResponse>("/runs/agent-test", { method: "POST", body: JSON.stringify({ agent, input }) });
  },
  getAgentRuns(agentId: string) { return request<Run[]>(`/runs?agentId=${encodeURIComponent(agentId)}`); },
  getRunEvents(runId: string, agentId?: string) {
    return request<RunEvent[]>(`/runs/${encodeURIComponent(runId)}/history${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`);
  },
  startRun(workflow: WorkflowDefinition, agents: AgentRecord[], input: Record<string, unknown>) {
    const body: RunCreateRequest = { workflow, agents, input };
    return request<RunCreateResponse>("/runs", { method: "POST", body: JSON.stringify(body) });
  },
  getRun(runId: string) { return request<Run>(`/runs/${encodeURIComponent(runId)}`); },
  cancelRun(runId: string) { return request<{ runId: string; status: string }>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }); },
  eventsUrl(runId: string, afterSequence = 0) { return `${API_URL}/runs/${encodeURIComponent(runId)}/events?sequence=${afterSequence}`; },
  getApprovals(runId: string) { return request<ApprovalRequest[]>(`/runs/${encodeURIComponent(runId)}/approvals`); },
  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecision, response?: string) {
    return request<{ ok: true }>(`/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/resolve`, { method: "POST", body: JSON.stringify({ decision, response }) });
  },
};
