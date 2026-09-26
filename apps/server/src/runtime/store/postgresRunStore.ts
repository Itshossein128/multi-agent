import type { AgentRecord, ApprovalRequest, Run, RunEvent, WorkflowDefinition } from "@multi-agent/types";
import type { PgPool } from "../../../../../src/memory/infrastructure";
import type { RequestPrincipal } from "../../auth/principal";
import type { MemoryAccessContext } from "../../../../../src/memory/contracts";
import type { MemoryOwner, RunEntry, RunListFilters, RunStoreContract } from "./contracts";
import { InMemoryRunStore } from "./inMemoryRunStore";
import { asIso } from "./helpers";

type Listener = (event: RunEvent) => void;

/**
 * Write-through durable store: hot path stays in-memory (SSE/listeners/abort),
 * mutations are persisted to Postgres. hydrate() rebuilds the cache after restart.
 */
export class PostgresRunStore implements RunStoreContract {
  private readonly memory = new InMemoryRunStore();
  private writeChain: Promise<void> = Promise.resolve();
  private persistenceError?: Error;

  constructor(private readonly pool: PgPool) {}

  private enqueue(operation: () => Promise<void>): void {
    this.writeChain = this.writeChain.then(async () => {
      if (this.persistenceError) return;
      await operation();
    }).catch((error) => {
      if (!this.persistenceError) {
        this.persistenceError = error instanceof Error ? error : new Error(String(error));
      }
      console.error("Studio run persistence failed:", this.persistenceError.message);
    });
  }

  assertHealthy(): void {
    if (this.persistenceError) {
      throw new Error(`Studio run persistence is unavailable: ${this.persistenceError.message}`);
    }
  }

  async flush(): Promise<void> {
    await this.writeChain;
    this.assertHealthy();
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
        result: (row.result as import("@multi-agent/types").NodeResultEnvelope | null) ?? undefined,
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
      }, undefined, row.memory_access ? row.memory_access as MemoryAccessContext : undefined);
      const hydrated = this.memory.get(run.id);
      if (hydrated && row.episodic_memory_status) hydrated.episodicMemoryStatus = row.episodic_memory_status;
      if (hydrated && row.procedural_memory_status) hydrated.proceduralMemoryStatus = row.procedural_memory_status;
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
    memoryAccess?: MemoryAccessContext,
  ) {
    this.assertHealthy();
    if (principal) {
      run = { ...run, ownerId: principal.userId, tenantId: principal.tenantId };
    }
    const created = this.memory.create(run, memoryOwner, snapshots, principal, memoryAccess);
    this.enqueue(async () => {
      await this.pool.query(
        `INSERT INTO studio_runs (
           id, workflow_id, task_id, status, started_at, completed_at, input, output, result, error, current_node_id, metadata,
           memory_owner_principal_id, memory_owner_tenant_id, workflow_snapshot, agents_snapshot, tools_snapshot, updated_at,
           owner_id, tenant_id, memory_access
         ) VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,now(),$18,$19,$20::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, completed_at = EXCLUDED.completed_at, input = EXCLUDED.input, output = EXCLUDED.output,
           result = EXCLUDED.result, error = EXCLUDED.error, current_node_id = EXCLUDED.current_node_id, metadata = EXCLUDED.metadata,
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
          run.result ? JSON.stringify(run.result) : null,
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
          memoryAccess ? JSON.stringify(memoryAccess) : null,
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
    this.assertHealthy();
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
    this.assertHealthy();
    const run = this.memory.update(runId, patch);
    if (run) {
      this.enqueue(async () => {
        await this.pool.query(
          `UPDATE studio_runs SET status = $2, completed_at = $3::timestamptz, input = $4::jsonb, output = $5::jsonb,
             result = $6::jsonb, error = $7, current_node_id = $8, metadata = $9::jsonb, updated_at = now()
           WHERE id = $1`,
          [
            runId,
            run.status,
            run.completedAt ?? null,
            run.input ? JSON.stringify(run.input) : null,
            run.output ? JSON.stringify(run.output) : null,
            run.result ? JSON.stringify(run.result) : null,
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
    this.assertHealthy();
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
    this.assertHealthy();
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
    this.assertHealthy();
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

  markEpisodicMemoryPending(runId: string) {
    this.assertHealthy();
    this.memory.markEpisodicMemoryPending(runId);
    this.enqueue(async () => {
      await this.pool.query("UPDATE studio_runs SET episodic_memory_status = 'pending', updated_at = now() WHERE id = $1", [runId]);
    });
  }

  setEpisodicMemoryStatus(runId: string, status: "processed" | "failed") {
    this.assertHealthy();
    this.memory.setEpisodicMemoryStatus(runId, status);
    this.enqueue(async () => {
      await this.pool.query("UPDATE studio_runs SET episodic_memory_status = $2, updated_at = now() WHERE id = $1", [runId, status]);
    });
  }

  markProceduralMemoryPending(runId: string) {
    this.assertHealthy();
    this.memory.markProceduralMemoryPending(runId);
    this.enqueue(async () => {
      await this.pool.query("UPDATE studio_runs SET procedural_memory_status = 'pending', updated_at = now() WHERE id = $1", [runId]);
    });
  }

  setProceduralMemoryStatus(runId: string, status: "processed" | "failed") {
    this.assertHealthy();
    this.memory.setProceduralMemoryStatus(runId, status);
    this.enqueue(async () => {
      await this.pool.query("UPDATE studio_runs SET procedural_memory_status = $2, updated_at = now() WHERE id = $1", [runId, status]);
    });
  }
}
