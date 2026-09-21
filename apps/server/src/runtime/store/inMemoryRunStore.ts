import type { AgentRecord, ApprovalRequest, Run, RunEvent, RunStatus, WorkflowDefinition } from "@multi-agent/types";
import { redact } from "../../adapters/langGraphEventAdapter";
import { boundJsonValue, boundedBytesFromEnvironment } from "../../../../../src/runtime/boundedValue";
import type { RequestPrincipal } from "../../auth/principal";
import type { MemoryOwner, RunEntry, RunListFilters, RunStoreContract } from "./contracts";
import { matchesFilters, redactApproval, boundedEventCount, createBoundedRun } from "./helpers";

type Listener = (event: RunEvent) => void;

/** In-process run store. Used directly in tests and as the hot cache for durable adapters. */
export class InMemoryRunStore implements RunStoreContract {
  private entries = new Map<string, RunEntry>();
  private readonly maxEventPayloadBytes: number;
  private readonly maxEventsPerRun: number;
  private readonly maxRunPayloadBytes: number;

  constructor(options: { maxEventPayloadBytes?: number; maxEventsPerRun?: number; maxRunPayloadBytes?: number } = {}) {
    this.maxEventPayloadBytes = options.maxEventPayloadBytes ?? boundedBytesFromEnvironment(process.env.RUN_EVENT_MAX_PAYLOAD_BYTES, 64 * 1024);
    this.maxEventsPerRun = options.maxEventsPerRun ?? boundedEventCount(process.env.RUN_MAX_EVENTS, 10_000);
    this.maxRunPayloadBytes = options.maxRunPayloadBytes ?? boundedBytesFromEnvironment(process.env.RUN_MAX_PAYLOAD_BYTES, 256 * 1024);
  }

  create(
    run: Run,
    memoryOwner?: MemoryOwner,
    snapshots?: { workflow?: WorkflowDefinition; agents?: AgentRecord[]; tools?: import("@multi-agent/types").ToolRecord[] },
    principal?: RequestPrincipal,
  ) {
    if (principal) {
      run = { ...run, ownerId: principal.userId, tenantId: principal.tenantId };
    }
    const effectiveOwner = memoryOwner
      ? { principalId: memoryOwner.principalId, tenantId: memoryOwner.tenantId }
      : run.ownerId && run.tenantId
      ? { principalId: run.ownerId, tenantId: run.tenantId }
      : undefined;

    run = this.sanitizeRun(run);
    this.entries.set(run.id, {
      run,
      events: [],
      listeners: new Set(),
      abort: new AbortController(),
      memoryOwner: effectiveOwner,
      approvals: [],
      approvalTimers: new Map(),
      workflowSnapshot: snapshots?.workflow ? structuredClone(snapshots.workflow) : undefined,
      agentsSnapshot: snapshots?.agents ? structuredClone(snapshots.agents) : undefined,
      toolsSnapshot: snapshots?.tools ? structuredClone(snapshots.tools) : undefined,
    });
    return run;
  }

  getMemoryOwner(runId: string): MemoryOwner | undefined {
    const owner = this.entries.get(runId)?.memoryOwner;
    return owner ? { ...owner } : undefined;
  }

  get(runId: string) {
    return this.entries.get(runId);
  }

  list(filters?: string | RunListFilters, principal?: RequestPrincipal): Run[] {
    const normalized: RunListFilters | undefined = typeof filters === "string" ? { agentId: filters } : filters;
    return [...this.entries.values()]
      .filter((entry) => {
        if (principal) {
          const ownerId = entry.run.ownerId ?? entry.memoryOwner?.principalId;
          const tenantId = entry.run.tenantId ?? entry.memoryOwner?.tenantId;
          if (!ownerId || !tenantId || ownerId !== principal.userId || tenantId !== principal.tenantId) {
            return false;
          }
        }
        return matchesFilters(entry, normalized);
      })
      .map((entry) => entry.run)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  append(runId: string, event: RunEvent) {
    const entry = this.entries.get(runId);
    if (!entry) return;
    const terminal = event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled";
    if (entry.events.length >= this.maxEventsPerRun && !terminal) {
      if (!entry.events.some((candidate) => candidate.type === "log" && candidate.payload.eventLimitReached === true)) {
        const limitEvent: RunEvent = {
          id: `${event.id}-limit`, runId, type: "log", timestamp: event.timestamp, sequence: entry.events.length + 1,
          payload: { eventLimitReached: true, maxEvents: this.maxEventsPerRun },
        };
        entry.events.push(limitEvent);
        entry.listeners.forEach((listener) => listener(structuredClone(limitEvent)));
        return limitEvent;
      }
      return;
    }
    const redacted = redact(event.payload);
    const bounded = boundJsonValue(redacted, this.maxEventPayloadBytes);
    const payload = bounded && typeof bounded === "object" && !Array.isArray(bounded) ? bounded as RunEvent["payload"] : { value: bounded };
    const next = { ...event, payload, sequence: entry.events.length + 1 };
    entry.events.push(next);
    entry.listeners.forEach((listener) => listener(structuredClone(next)));
    return next;
  }

  update(runId: string, patch: Partial<Run>) {
    const entry = this.entries.get(runId);
    if (entry) {
      const terminalStatuses: RunStatus[] = ["completed", "failed", "cancelled"];
      if (terminalStatuses.includes(entry.run.status) && patch.status && patch.status !== entry.run.status) {
        return entry.run;
      }
      entry.run = this.sanitizeRun({ ...entry.run, ...patch });
    }
    return entry?.run;
  }

  private sanitizeRun(run: Run): Run {
    return createBoundedRun(run, this.maxEventPayloadBytes, this.maxRunPayloadBytes);
  }

  events(runId: string, after = 0) {
    return structuredClone(this.entries.get(runId)?.events.filter((event) => event.sequence > after) ?? []);
  }

  subscribe(runId: string, listener: Listener): () => void {
    const entry = this.entries.get(runId);
    if (!entry) return () => undefined;
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  cancel(runId: string) {
    const entry = this.entries.get(runId);
    if (!entry) return false;
    entry.abort.abort();
    return true;
  }

  signal(runId: string) {
    return this.entries.get(runId)?.abort.signal;
  }

  addApproval(runId: string, approval: ApprovalRequest) {
    this.entries.get(runId)?.approvals.push(approval);
  }

  getApproval(runId: string, approvalId: string): ApprovalRequest | undefined {
    return this.entries.get(runId)?.approvals.find((approval) => approval.id === approvalId);
  }

  listApprovals(runId: string): ApprovalRequest[] {
    return (this.entries.get(runId)?.approvals ?? []).map(redactApproval);
  }

  updateApproval(runId: string, approvalId: string, patch: Partial<ApprovalRequest>) {
    const approval = this.entries.get(runId)?.approvals.find((candidate) => candidate.id === approvalId);
    if (approval) Object.assign(approval, patch);
    return approval;
  }

  setApprovalTimer(runId: string, approvalId: string, timer: NodeJS.Timeout) {
    this.entries.get(runId)?.approvalTimers.set(approvalId, timer);
  }

  clearApprovalTimer(runId: string, approvalId: string) {
    const timers = this.entries.get(runId)?.approvalTimers;
    const timer = timers?.get(approvalId);
    if (timer) clearTimeout(timer);
    timers?.delete(approvalId);
  }

  setPausedContext(runId: string, context: RunEntry["pausedContext"] | null) {
    const entry = this.entries.get(runId);
    if (entry) entry.pausedContext = context ?? undefined;
  }

  getPausedContext(runId: string) {
    return this.entries.get(runId)?.pausedContext;
  }

  getWorkflowSnapshot(runId: string) {
    const snapshot = this.entries.get(runId)?.workflowSnapshot;
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  getAgentSnapshot(runId: string) {
    const snapshot = this.entries.get(runId)?.agentsSnapshot;
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  getToolSnapshot(runId: string) {
    const snapshot = this.entries.get(runId)?.toolsSnapshot;
    return snapshot ? structuredClone(snapshot) : undefined;
  }
}
