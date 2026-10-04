import type { AgentRecord, ApprovalDecision, ApprovalRequest, ClarificationPackage, ClarificationSubmitResponse, Run, RunEvent, RunCreateRequest, RunCreateResponse, RunStatus, WorkflowDefinition } from "@multi-agent/types";
import { requestJson } from "./requestJson";

const API_URL = "/api/execution";
const TASKS_API_URL = "/api/tasks";

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, init, { apiUrl: API_URL });
}

function tasksAction<T>(body: Record<string, unknown>): Promise<T> {
  return requestJson<T>("", { method: "POST", body: JSON.stringify(body) }, { apiUrl: TASKS_API_URL });
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
  startRun(workflow: WorkflowDefinition, agents: AgentRecord[], input: Record<string, unknown>, taskId?: string, tools?: import("@multi-agent/types").ToolRecord[]) {
    const body: RunCreateRequest = { workflow, agents, input, taskId, tools };
    return request<RunCreateResponse>("/runs", { method: "POST", body: JSON.stringify(body) });
  },
  getRun(runId: string) { return request<Run>(`/runs/${encodeURIComponent(runId)}`); },
  getRunDefinition(runId: string) {
    return request<{ workflow: WorkflowDefinition; agents: AgentRecord[]; tools?: import("@multi-agent/types").ToolRecord[] }>(`/runs/${encodeURIComponent(runId)}/definition`);
  },
  cancelRun(runId: string) { return request<{ runId: string; status: string }>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }); },
  cancelBranch(runId: string, branchKey: string) { return request<{ runId: string; branchKey: string; status: string }>(`/runs/${encodeURIComponent(runId)}/branches/${encodeURIComponent(branchKey)}/cancel`, { method: "POST" }); },
  retryRun(runId: string) { return request<RunCreateResponse>(`/runs/${encodeURIComponent(runId)}/retry`, { method: "POST" }); },
  eventsUrl(runId: string, afterSequence = 0) { return `${API_URL}/runs/${encodeURIComponent(runId)}/events?sequence=${afterSequence}`; },
  getApprovals(runId: string) { return request<ApprovalRequest[]>(`/runs/${encodeURIComponent(runId)}/approvals`); },
  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecision, response?: string) {
    return request<{ ok: true }>(`/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/resolve`, { method: "POST", body: JSON.stringify({ decision, response }) });
  },
  getRunClarification(runId: string) {
    return request<ClarificationPackage>(`/runs/${encodeURIComponent(runId)}/clarification`);
  },
  submitRunClarification(runId: string, answers: Array<{ questionId: string; value: string }>, idempotencyKey?: string) {
    return request<ClarificationSubmitResponse>(`/runs/${encodeURIComponent(runId)}/clarification`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify({ answers }),
    });
  },
  getTaskClarification(taskId: string) {
    return tasksAction<ClarificationPackage>({ action: "getClarification", taskId });
  },
  submitTaskClarification(taskId: string, answers: Array<{ questionId: string; value: string }>, idempotencyKey?: string) {
    return tasksAction<ClarificationSubmitResponse>({
      action: "submitClarification",
      taskId,
      answers,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  },
};
