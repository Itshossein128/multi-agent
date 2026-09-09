import type { ApprovalRequest, Run, RunEvent } from "@multi-agent/types";
import { redact } from "../adapters/langGraphEventAdapter";

type Listener = (event: RunEvent) => void;
interface MemoryOwner { principalId: string; tenantId: string }
interface Entry { run: Run; events: RunEvent[]; listeners: Set<Listener>; abort: AbortController; memoryOwner?: MemoryOwner; approvals: ApprovalRequest[]; approvalTimers: Map<string, NodeJS.Timeout> }

function redactApproval(approval: ApprovalRequest): ApprovalRequest {
  return { ...approval, message: redact(approval.message) as string, context: redact(approval.context) as Record<string, unknown> | undefined, response: approval.response !== undefined ? redact(approval.response) as string : undefined };
}

export class RunStore {
  private entries = new Map<string, Entry>();
  create(run: Run, memoryOwner?: MemoryOwner) { this.entries.set(run.id, { run, events: [], listeners: new Set(), abort: new AbortController(), memoryOwner: memoryOwner ? { principalId: memoryOwner.principalId, tenantId: memoryOwner.tenantId } : undefined, approvals: [], approvalTimers: new Map() }); return run; }
  getMemoryOwner(runId: string): MemoryOwner | undefined { const owner = this.entries.get(runId)?.memoryOwner; return owner ? { ...owner } : undefined; }
  get(runId: string) { return this.entries.get(runId); }
  list(agentId?: string): Run[] {
    return [...this.entries.values()]
      .filter((entry) => !agentId || entry.events.some((event) => event.agentId === agentId))
      .map((entry) => entry.run)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  append(runId: string, event: RunEvent) {
    const entry = this.entries.get(runId); if (!entry) return;
    const next = { ...event, payload: redact(event.payload) as RunEvent["payload"], sequence: entry.events.length + 1 };
    entry.events.push(next); entry.listeners.forEach((listener) => listener(next));
    return next;
  }
  update(runId: string, patch: Partial<Run>) { const entry = this.entries.get(runId); if (entry) entry.run = { ...entry.run, ...patch }; return entry?.run; }
  events(runId: string, after = 0) { return this.entries.get(runId)?.events.filter((event) => event.sequence > after) ?? []; }
  subscribe(runId: string, listener: Listener) { const entry = this.entries.get(runId); if (!entry) return () => undefined; entry.listeners.add(listener); return () => entry.listeners.delete(listener); }
  cancel(runId: string) { const entry = this.entries.get(runId); if (!entry) return false; entry.abort.abort(); return true; }
  signal(runId: string) { return this.entries.get(runId)?.abort.signal; }

  addApproval(runId: string, approval: ApprovalRequest) { this.entries.get(runId)?.approvals.push(approval); }
  getApproval(runId: string, approvalId: string): ApprovalRequest | undefined { return this.entries.get(runId)?.approvals.find((approval) => approval.id === approvalId); }
  listApprovals(runId: string): ApprovalRequest[] { return (this.entries.get(runId)?.approvals ?? []).map(redactApproval); }
  updateApproval(runId: string, approvalId: string, patch: Partial<ApprovalRequest>) {
    const approval = this.entries.get(runId)?.approvals.find((candidate) => candidate.id === approvalId);
    if (approval) Object.assign(approval, patch);
    return approval;
  }
  setApprovalTimer(runId: string, approvalId: string, timer: NodeJS.Timeout) { this.entries.get(runId)?.approvalTimers.set(approvalId, timer); }
  clearApprovalTimer(runId: string, approvalId: string) {
    const timers = this.entries.get(runId)?.approvalTimers;
    const timer = timers?.get(approvalId);
    if (timer) clearTimeout(timer);
    timers?.delete(approvalId);
  }
}
