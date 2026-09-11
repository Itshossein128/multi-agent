import type { AgentRecord, ApprovalDecision, ApprovalRequest, Run, RunEvent, RunCreateRequest, RunCreateResponse, RunStatus, WorkflowDefinition } from "@multi-agent/types";

const API_URL = "/api/execution";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Execution request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export interface RunListQuery {
  agentId?: string;
  workflowId?: string;
  taskId?: string;
  status?: RunStatus;
  from?: string;
  to?: string;
}

function toQuery(filters: RunListQuery = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const runService = {
  testAgent(agent: AgentRecord, input: Record<string, unknown>) {
    return request<RunCreateResponse>("/runs/agent-test", { method: "POST", body: JSON.stringify({ agent, input }) });
  },
  listRuns(filters: RunListQuery = {}) {
    return request<Run[]>(`/runs${toQuery(filters)}`);
  },
  getAgentRuns(agentId: string) { return this.listRuns({ agentId }); },
  getRunEvents(runId: string, agentId?: string) {
    return request<RunEvent[]>(`/runs/${encodeURIComponent(runId)}/history${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`);
  },
  startRun(workflow: WorkflowDefinition, agents: AgentRecord[], input: Record<string, unknown>, taskId?: string) {
    const body: RunCreateRequest = { workflow, agents, input, taskId };
    return request<RunCreateResponse>("/runs", { method: "POST", body: JSON.stringify(body) });
  },
  getRun(runId: string) { return request<Run>(`/runs/${encodeURIComponent(runId)}`); },
  getRunDefinition(runId: string) {
    return request<{ workflow: WorkflowDefinition; agents: AgentRecord[] }>(`/runs/${encodeURIComponent(runId)}/definition`);
  },
  cancelRun(runId: string) { return request<{ runId: string; status: string }>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }); },
  eventsUrl(runId: string, afterSequence = 0) { return `${API_URL}/runs/${encodeURIComponent(runId)}/events?sequence=${afterSequence}`; },
  getApprovals(runId: string) { return request<ApprovalRequest[]>(`/runs/${encodeURIComponent(runId)}/approvals`); },
  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecision, response?: string) {
    return request<{ ok: true }>(`/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/resolve`, { method: "POST", body: JSON.stringify({ decision, response }) });
  },
};
