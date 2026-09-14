import type { AgentRecord, ApprovalRequest, Run, RunEvent, RunStatus, WorkflowDefinition } from "@multi-agent/types";
import { redact } from "../adapters/langGraphEventAdapter";
import type { PgPool } from "../../../../src/memory/infrastructure";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import type { RequestPrincipal } from "../auth/principal";

type Listener = (event: RunEvent) => void;
export interface MemoryOwner { principalId: string; tenantId: string }
export interface RunEntry {
  run: Run;
  events: RunEvent[];
  listeners: Set<Listener>;
  abort: AbortController;
  memoryOwner?: MemoryOwner;
  approvals: ApprovalRequest[];
  approvalTimers: Map<string, NodeJS.Timeout>;
  workflowSnapshot?: WorkflowDefinition;
  agentsSnapshot?: AgentRecord[];
  toolsSnapshot?: import("@multi-agent/types").ToolRecord[];
  pausedContext?: { workflow: WorkflowDefinition; agents: AgentRecord[]; tools?: import("@multi-agent/types").ToolRecord[]; memoryAccess?: MemoryAccessContext };
}

export interface RunListFilters {
  agentId?: string;
  workflowId?: string;
  taskId?: string;
  status?: RunStatus;
  from?: string;
  to?: string;
}

export interface RunStoreContract {
  create(
    run: Run,
    memoryOwner?: MemoryOwner,
    snapshots?: { workflow?: WorkflowDefinition; agents?: AgentRecord[]; tools?: import("@multi-agent/types").ToolRecord[] },
    principal?: RequestPrincipal,
  ): Run;
  getMemoryOwner(runId: string): MemoryOwner | undefined;
  get(runId: string): RunEntry | undefined;
  list(filters?: string | RunListFilters, principal?: RequestPrincipal): Run[];
  append(runId: string, event: RunEvent): RunEvent | undefined;
  update(runId: string, patch: Partial<Run>): Run | undefined;
  events(runId: string, after?: number): RunEvent[];
  subscribe(runId: string, listener: Listener): () => void;
  cancel(runId: string): boolean;
  signal(runId: string): AbortSignal | undefined;
  addApproval(runId: string, approval: ApprovalRequest, timeoutSeconds?: number): void;
  getApproval(runId: string, approvalId: string): ApprovalRequest | undefined;
  listApprovals(runId: string): ApprovalRequest[];
  updateApproval(runId: string, approvalId: string, patch: Partial<ApprovalRequest>): ApprovalRequest | undefined;
  setApprovalTimer(runId: string, approvalId: string, timer: NodeJS.Timeout): void;
  clearApprovalTimer(runId: string, approvalId: string): void;
  setPausedContext?(runId: string, context: RunEntry["pausedContext"] | null): void;
  getPausedContext?(runId: string): RunEntry["pausedContext"] | undefined;
  getWorkflowSnapshot?(runId: string): WorkflowDefinition | undefined;
  getAgentSnapshot?(runId: string): AgentRecord[] | undefined;
  getToolSnapshot?(runId: string): import("@multi-agent/types").ToolRecord[] | undefined;
  hydrate?(): Promise<void>;
  flush?(): Promise<void>;
}

function redactApproval(approval: ApprovalRequest): ApprovalRequest {
  return {
    ...approval,
    message: redact(approval.message) as string,
    context: redact(approval.context) as Record<string, unknown> | undefined,
    response: approval.response !== undefined ? (redact(approval.response) as string) : undefined,
  };
}

function matchesFilters(entry: RunEntry, filters?: RunListFilters): boolean {
  if (!filters) return true;
  if (filters.agentId && !entry.events.some((event) => event.agentId === filters.agentId)) return false;
  if (filters.workflowId && entry.run.workflowId !== filters.workflowId) return false;
  if (filters.taskId && entry.run.taskId !== filters.taskId) return false;
  if (filters.status && entry.run.status !== filters.status) return false;
  if (filters.from && entry.run.startedAt < filters.from) return false;
  if (filters.to && entry.run.startedAt > filters.to) return false;
  return true;
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** In-process run store. Used directly in tests and as the hot cache for durable adapters. */
export class InMemoryRunStore implements RunStoreContract {
  private entries = new Map<string, RunEntry>();

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

    this.entries.set(run.id, {
      run,
      events: [],
      listeners: new Set(),
      abort: new AbortController(),
      memoryOwner: effectiveOwner,
      approvals: [],
      approvalTimers: new Map(),
      workflowSnapshot: snapshots?.workflow,
      agentsSnapshot: snapshots?.agents,
      toolsSnapshot: snapshots?.tools,
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
          // Fail-closed quarantine: unowned legacy runs are never returned to a scoped principal
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
    const next = { ...event, payload: redact(event.payload) as RunEvent["payload"], sequence: entry.events.length + 1 };
    entry.events.push(next);
    entry.listeners.forEach((listener) => listener(structuredClone(next)));
    return next;
  }

  update(runId: string, patch: Partial<Run>) {
    const entry = this.entries.get(runId);
    if (entry) entry.run = { ...entry.run, ...patch };
    return entry?.run;
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
    return this.entries.get(runId)?.workflowSnapshot;
  }

  getAgentSnapshot(runId: string) {
    return this.entries.get(runId)?.agentsSnapshot;
  }

  getToolSnapshot(runId: string) {
    return this.entries.get(runId)?.toolsSnapshot;
  }
}

/** Back-compat alias for existing imports/tests. */
export class RunStore extends InMemoryRunStore {}

/**
 * Write-through durable store: hot path stays in-memory (SSE/listeners/abort),
 * mutations are persisted to Postgres. hydrate() rebuilds the cache after restart.
 */
export class PostgresRunStore implements RunStoreContract {
  private readonly memory = new InMemoryRunStore();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly pool: PgPool) {}

  private enqueue(operation: () => Promise<void>): void {
    this.writeChain = this.writeChain.then(operation, operation).catch((error) => {
      console.error("Studio run persistence failed:", error instanceof Error ? error.message : error);
    });
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  async hydrate(): Promise<void> {
    const runs = await this.pool.query("SELECT * FROM studio_runs ORDER BY started_at ASC");
    for (const row of runs.rows) {
      const run: Run = {
        id: String(row.id),
        workflowId: String(row.workflow_id),
        taskId: row.task_id ? String(row.task_id) : undefined,
        status: row.status as Run["status"],
        startedAt: asIso(row.started_at),
        completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
        input: row.input ?? undefined,
        output: row.output ?? undefined,
        error: row.error ?? undefined,
        currentNodeId: row.current_node_id ?? undefined,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        ownerId: (row.owner_id as string | null) ?? (row.memory_owner_principal_id as string | null) ?? undefined,
        tenantId: (row.tenant_id as string | null) ?? (row.memory_owner_tenant_id as string | null) ?? undefined,
      };
      const owner =
        row.owner_id && row.tenant_id
          ? { principalId: String(row.owner_id), tenantId: String(row.tenant_id) }
          : row.memory_owner_principal_id && row.memory_owner_tenant_id
          ? { principalId: String(row.memory_owner_principal_id), tenantId: String(row.memory_owner_tenant_id) }
          : undefined;

      this.memory.create(run, owner, {
        workflow: row.workflow_snapshot as WorkflowDefinition | undefined,
        agents: row.agents_snapshot as AgentRecord[] | undefined,
        tools: row.tools_snapshot as import("@multi-agent/types").ToolRecord[] | undefined,
      });
      if (row.paused_context) this.memory.setPausedContext(run.id, row.paused_context as RunEntry["pausedContext"]);

      const events = await this.pool.query("SELECT event FROM studio_run_events WHERE run_id = $1 ORDER BY sequence ASC", [run.id]);
      const entry = this.memory.get(run.id)!;
      for (const eventRow of events.rows) {
        const event = eventRow.event as RunEvent;
        entry.events.push(event);
      }

      const approvals = await this.pool.query("SELECT * FROM studio_approvals WHERE run_id = $1 ORDER BY requested_at ASC", [run.id]);
      for (const approvalRow of approvals.rows) {
        entry.approvals.push({
          id: String(approvalRow.id),
          runId: String(approvalRow.run_id),
          nodeId: String(approvalRow.node_id),
          status: approvalRow.status as ApprovalRequest["status"],
          message: String(approvalRow.message),
          requestedAt: asIso(approvalRow.requested_at),
          resolvedAt: approvalRow.resolved_at ? asIso(approvalRow.resolved_at) : undefined,
          context: approvalRow.context ?? undefined,
          response: approvalRow.response ?? undefined,
          metadata: (approvalRow.metadata ?? {}) as Record<string, unknown>,
        });
      }
    }
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
    const created = this.memory.create(run, memoryOwner, snapshots, principal);
    this.enqueue(async () => {
      await this.pool.query(
        `INSERT INTO studio_runs (
           id, workflow_id, task_id, status, started_at, completed_at, input, output, error, current_node_id, metadata,
           memory_owner_principal_id, memory_owner_tenant_id, workflow_snapshot, agents_snapshot, tools_snapshot, updated_at,
           owner_id, tenant_id
         ) VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,now(),$17,$18)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, completed_at = EXCLUDED.completed_at, input = EXCLUDED.input, output = EXCLUDED.output,
           error = EXCLUDED.error, current_node_id = EXCLUDED.current_node_id, metadata = EXCLUDED.metadata,
           tools_snapshot = EXCLUDED.tools_snapshot, updated_at = now()`,
        [
          run.id,
          run.workflowId,
          run.taskId ?? null,
          run.status,
          run.startedAt,
          run.completedAt ?? null,
          run.input ? JSON.stringify(run.input) : null,
          run.output ? JSON.stringify(run.output) : null,
          run.error ?? null,
          run.currentNodeId ?? null,
          JSON.stringify(run.metadata ?? {}),
          memoryOwner?.principalId ?? run.ownerId ?? null,
          memoryOwner?.tenantId ?? run.tenantId ?? null,
          snapshots?.workflow ? JSON.stringify(snapshots.workflow) : null,
          snapshots?.agents ? JSON.stringify(snapshots.agents) : null,
          snapshots?.tools ? JSON.stringify(snapshots.tools) : null,
          run.ownerId ?? principal?.userId ?? null,
          run.tenantId ?? principal?.tenantId ?? null,
        ],
      );
    });
    return created;
  }

  getMemoryOwner(runId: string) {
    return this.memory.getMemoryOwner(runId);
  }
  get(runId: string) {
    return this.memory.get(runId);
  }
  list(filters?: string | RunListFilters, principal?: RequestPrincipal) {
    return this.memory.list(filters, principal);
  }

  append(runId: string, event: RunEvent) {
    const next = this.memory.append(runId, event);
    if (next) {
      this.enqueue(async () => {
        await this.pool.query(
          `INSERT INTO studio_run_events (run_id, sequence, event) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (run_id, sequence) DO NOTHING`,
          [runId, next.sequence, JSON.stringify(next)],
        );
      });
    }
    return next;
  }

  update(runId: string, patch: Partial<Run>) {
    const run = this.memory.update(runId, patch);
    if (run) {
      this.enqueue(async () => {
        await this.pool.query(
          `UPDATE studio_runs SET status = $2, completed_at = $3::timestamptz, input = $4::jsonb, output = $5::jsonb,
             error = $6, current_node_id = $7, metadata = $8::jsonb, updated_at = now()
           WHERE id = $1`,
          [
            runId,
            run.status,
            run.completedAt ?? null,
            run.input ? JSON.stringify(run.input) : null,
            run.output ? JSON.stringify(run.output) : null,
            run.error ?? null,
            run.currentNodeId ?? null,
            JSON.stringify(run.metadata ?? {}),
          ],
        );
      });
    }
    return run;
  }

  events(runId: string, after = 0) {
    return this.memory.events(runId, after);
  }
  subscribe(runId: string, listener: Listener) {
    return this.memory.subscribe(runId, listener);
  }
  cancel(runId: string) {
    return this.memory.cancel(runId);
  }
  signal(runId: string) {
    return this.memory.signal(runId);
  }

  addApproval(runId: string, approval: ApprovalRequest, timeoutSeconds?: number) {
    this.memory.addApproval(runId, approval);
    this.enqueue(async () => {
      await this.pool.query(
        `INSERT INTO studio_approvals (id, run_id, node_id, status, message, requested_at, resolved_at, context, response, metadata, timeout_seconds)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb,$9,$10::jsonb,$11)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at, response = EXCLUDED.response, metadata = EXCLUDED.metadata`,
        [
          approval.id,
          approval.runId,
          approval.nodeId,
          approval.status,
          approval.message,
          approval.requestedAt,
          approval.resolvedAt ?? null,
          approval.context ? JSON.stringify(approval.context) : null,
          approval.response ?? null,
          JSON.stringify(approval.metadata ?? {}),
          timeoutSeconds ?? null,
        ],
      );
    });
  }

  getApproval(runId: string, approvalId: string) {
    return this.memory.getApproval(runId, approvalId);
  }
  listApprovals(runId: string) {
    return this.memory.listApprovals(runId);
  }

  updateApproval(runId: string, approvalId: string, patch: Partial<ApprovalRequest>) {
    const approval = this.memory.updateApproval(runId, approvalId, patch);
    if (approval) {
      this.enqueue(async () => {
        await this.pool.query(
          `UPDATE studio_approvals SET status = $2, resolved_at = $3::timestamptz, response = $4, context = $5::jsonb, metadata = $6::jsonb
           WHERE run_id = $7 AND id = $1`,
          [
            approvalId,
            approval.status,
            approval.resolvedAt ?? null,
            approval.response ?? null,
            approval.context ? JSON.stringify(approval.context) : null,
            JSON.stringify(approval.metadata ?? {}),
            runId,
          ],
        );
      });
    }
    return approval;
  }

  setApprovalTimer(runId: string, approvalId: string, timer: NodeJS.Timeout) {
    this.memory.setApprovalTimer(runId, approvalId, timer);
  }
  clearApprovalTimer(runId: string, approvalId: string) {
    this.memory.clearApprovalTimer(runId, approvalId);
  }

  setPausedContext(runId: string, context: RunEntry["pausedContext"] | null) {
    this.memory.setPausedContext(runId, context);
    this.enqueue(async () => {
      await this.pool.query("UPDATE studio_runs SET paused_context = $2::jsonb, updated_at = now() WHERE id = $1", [
        runId,
        context ? JSON.stringify(context) : null,
      ]);
    });
  }
  getPausedContext(runId: string) {
    return this.memory.getPausedContext(runId);
  }
  getWorkflowSnapshot(runId: string) {
    return this.memory.getWorkflowSnapshot(runId);
  }
  getAgentSnapshot(runId: string) {
    return this.memory.getAgentSnapshot(runId);
  }
  getToolSnapshot(runId: string) {
    return this.memory.getToolSnapshot(runId);
  }
}
