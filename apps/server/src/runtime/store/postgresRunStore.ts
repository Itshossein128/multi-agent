import type { AgentRecord, ApprovalRequest, Run, RunEvent, RunStatus, WorkflowDefinition } from "@multi-agent/types";
import type { PgPool } from "../../../../../src/memory/infrastructure";
import type { RequestPrincipal } from "../../auth/principal";
import type { MemoryAccessContext } from "../../../../../src/memory/contracts";
import type { MemoryOwner, RunEntry, RunListFilters, RunStoreContract } from "./contracts";
import { InMemoryRunStore } from "./inMemoryRunStore";
import { asIso } from "./helpers";
import { randomUUID } from "node:crypto";
import { log } from "../../logging";

type Listener = (event: RunEvent) => void;

class RunLeaseLostError extends Error {
  constructor(readonly runId: string) {
    super(`Execution lease lost for run ${runId}`);
    this.name = "RunLeaseLostError";
  }
}

export interface PostgresRunStoreOptions {
  durableMemoryJobs?: boolean;
  instanceId?: string;
  leaseDurationMs?: number;
  leaseRenewalIntervalMs?: number;
}

/**
 * Write-through durable store: hot path stays in-memory (SSE/listeners/abort),
 * mutations are persisted to Postgres. hydrate() rebuilds the cache after restart.
 */
export class PostgresRunStore implements RunStoreContract {
  private readonly memory = new InMemoryRunStore();
  private writeChain: Promise<void> = Promise.resolve();
  private persistenceError?: Error;
  private readonly runPromises = new Map<string, Promise<{ success: boolean; duplicate?: boolean }>>();
  public readonly instanceId: string;
  public readonly leaseDurationMs: number;
  public readonly leaseRenewalIntervalMs: number;
  private leaseHeartbeatTimer?: NodeJS.Timeout;
  private hasLeaseColumns?: boolean;

  constructor(private readonly pool: PgPool, private readonly options: PostgresRunStoreOptions = {}) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.leaseRenewalIntervalMs =
      options.leaseRenewalIntervalMs !== undefined
        ? options.leaseRenewalIntervalMs
        : Math.min(10_000, Math.floor(this.leaseDurationMs / 3));
    if (options.leaseRenewalIntervalMs !== undefined && options.leaseRenewalIntervalMs > 0) {
      this.startLeaseHeartbeat();
    }
  }

  private startLeaseHeartbeat(): void {
    if (this.leaseRenewalIntervalMs <= 0 || this.leaseHeartbeatTimer) return;
    this.leaseHeartbeatTimer = setInterval(() => {
      void this.renewActiveLeases().catch(() => {});
    }, this.leaseRenewalIntervalMs);
    if (this.leaseHeartbeatTimer.unref) {
      this.leaseHeartbeatTimer.unref();
    }
  }

  async renewActiveLeases(): Promise<string[]> {
    if (this.persistenceError) return [];
    if (this.hasLeaseColumns === false) return [];
    if ((this.pool as any).ended || (this.pool as any).ending) {
      this.close();
      return [];
    }
    try {
      const activeRuns = this.memory.list().filter(r =>
        ["queued", "running", "waiting_for_human"].includes(r.status) &&
        (!r.executionOwnerId || r.executionOwnerId === this.instanceId)
      );
      if (!activeRuns.length) return [];
      const ids = activeRuns.map(r => r.id);
      const res = await this.pool.query(
        `UPDATE studio_runs
            SET execution_lease_expires_at = now() + ($1 || ' milliseconds')::interval,
                execution_heartbeat_at = now(),
                updated_at = now()
          WHERE id = ANY($2::text[])
            AND (execution_owner_id = $3 OR execution_owner_id IS NULL)
            AND status IN ('queued', 'running', 'waiting_for_human')
          RETURNING id`,
        [this.leaseDurationMs, ids, this.instanceId]
      );
      this.hasLeaseColumns = true;
      const renewed = res.rows.map(r => String(r.id));
      const renewedSet = new Set(renewed);
      for (const run of activeRuns) {
        if (!renewedSet.has(run.id)) {
          this.memory.cancel(run.id);
          log.warn("run.execution_lease_lost", { runId: run.id, instanceId: this.instanceId });
        }
      }
      for (const id of renewed) {
        const entry = this.memory.get(id);
        if (entry) {
          entry.run.executionOwnerId = this.instanceId;
          entry.run.executionLeaseExpiresAt = new Date(Date.now() + this.leaseDurationMs).toISOString();
        }
      }
      return renewed;
    } catch (err: any) {
      if (err?.code === "42703") {
        this.hasLeaseColumns = false;
        return [];
      }
      if (err?.message?.includes("after calling end on the pool") || (this.pool as any).ended || (this.pool as any).ending) {
        this.close();
        return [];
      }
      for (const run of this.memory.list()) {
        if (["queued", "running", "waiting_for_human"].includes(run.status) &&
            run.executionOwnerId === this.instanceId &&
            run.executionLeaseExpiresAt && Date.parse(run.executionLeaseExpiresAt) <= Date.now()) {
          this.memory.cancel(run.id);
        }
      }
      throw err;
    }
  }

  close(): void {
    if (this.leaseHeartbeatTimer) {
      clearInterval(this.leaseHeartbeatTimer);
      this.leaseHeartbeatTimer = undefined;
    }
  }

  private enqueue(operation: () => Promise<void>): void {
    this.writeChain = this.writeChain.then(async () => {
      if (this.persistenceError) return;
      await operation();
    }).catch((error) => {
      if (error instanceof RunLeaseLostError) {
        this.memory.cancel(error.runId);
        log.warn("run.execution_lease_lost", { runId: error.runId, instanceId: this.instanceId });
        return;
      }
      if (!this.persistenceError) {
        this.persistenceError = error instanceof Error ? error : new Error(String(error));
      }
      console.error("Studio run persistence failed:", this.persistenceError.message);
    });
  }

  private requireOwnedUpdate(runId: string, result: { rowCount?: number | null }): void {
    if (result.rowCount === 0) throw new RunLeaseLostError(runId);
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

  /** PostgreSQL execution must not start without the fencing columns from migration 016. */
  async assertLeaseSchema(): Promise<void> {
    await this.pool.query("SELECT execution_owner_id, execution_lease_expires_at FROM studio_runs LIMIT 0");
    this.hasLeaseColumns = true;
  }

  /** Read authoritative status for cross-replica budget recovery. */
  async getDurableStatus(runId: string): Promise<RunStatus | undefined> {
    const result = await this.pool.query("SELECT status FROM studio_runs WHERE id = $1", [runId]);
    return result.rows[0]?.status as RunStatus | undefined;
  }

  async hydrate(): Promise<void> {
    const runs = await this.pool.query("SELECT * FROM studio_runs ORDER BY started_at ASC");
    if (runs.rows.length > 0) {
      this.hasLeaseColumns = Object.prototype.hasOwnProperty.call(runs.rows[0], "execution_owner_id");
    }
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
        executionOwnerId: row.execution_owner_id ? String(row.execution_owner_id) : undefined,
        executionLeaseExpiresAt: row.execution_lease_expires_at ? asIso(row.execution_lease_expires_at) : undefined,
        executionHeartbeatAt: row.execution_heartbeat_at ? asIso(row.execution_heartbeat_at) : undefined,
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
    if (this.leaseRenewalIntervalMs > 0 && this.hasLeaseColumns !== false) {
      this.startLeaseHeartbeat();
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
    const ownerInstanceId = run.executionOwnerId ?? this.instanceId;
    const leaseExpires = run.executionLeaseExpiresAt ?? new Date(Date.now() + this.leaseDurationMs).toISOString();
    const heartbeatIso = run.executionHeartbeatAt ?? new Date().toISOString();
    run = {
      ...run,
      executionOwnerId: ownerInstanceId,
      executionLeaseExpiresAt: leaseExpires,
      executionHeartbeatAt: heartbeatIso,
    };
    let created: Run;
    try {
      created = this.memory.create(run, memoryOwner, snapshots, principal, memoryAccess);
    } catch (err: any) {
      if (err?.code === "23505") {
        log.info("run.duplicate_trigger_dispatch_key_suppressed", { runId: run.id, triggerDispatchKey: String(run.metadata?.triggerDispatchKey ?? "") });
        this.runPromises.set(run.id, Promise.resolve({ success: false, duplicate: true }));
        return run;
      }
      throw err;
    }

    let resolvePromise!: (val: { success: boolean; duplicate?: boolean }) => void;
    let rejectPromise!: (err: any) => void;
    const runPromise = new Promise<{ success: boolean; duplicate?: boolean }>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    runPromise.catch(() => {});
    this.runPromises.set(run.id, runPromise);

    this.enqueue(async () => {
      try {
        if (this.hasLeaseColumns !== false) {
          try {
            await this.pool.query(
              `INSERT INTO studio_runs (
                 id, workflow_id, task_id, status, started_at, completed_at, input, output, result, error, current_node_id, metadata,
                 memory_owner_principal_id, memory_owner_tenant_id, workflow_snapshot, agents_snapshot, tools_snapshot, updated_at,
                 owner_id, tenant_id, memory_access, execution_owner_id, execution_lease_expires_at, execution_heartbeat_at
               ) VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,now(),$18,$19,$20::jsonb,$21,$22::timestamptz,$23::timestamptz)
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
                ownerInstanceId,
                leaseExpires,
                heartbeatIso,
              ],
            );
            this.hasLeaseColumns = true;
            resolvePromise({ success: true });
            return;
          } catch (err: any) {
            if (err?.code === "42703") {
              this.hasLeaseColumns = false;
            } else {
              throw err;
            }
          }
        }

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
        resolvePromise({ success: true });
      } catch (err: any) {
        if (err?.code === "23505" && (err?.constraint === "studio_runs_trigger_dispatch_key" || String(err?.detail || err?.message).includes("triggerDispatchKey"))) {
          log.info("run.duplicate_trigger_dispatch_key_suppressed", { runId: run.id, triggerDispatchKey: String(run.metadata?.triggerDispatchKey ?? "") });
          const entry = this.memory.get(run.id);
          if (entry) {
            entry.run.status = "failed";
            entry.run.error = "DUPLICATE_TRIGGER_DISPATCH";
          }
          this.memory.cancel(run.id);
          resolvePromise({ success: false, duplicate: true });
          return;
        }
        rejectPromise(err);
        throw err;
      }
    });
    return created;
  }

  async waitForPersistence(runId: string): Promise<{ success: boolean; duplicate?: boolean }> {
    const promise = this.runPromises.get(runId);
    if (!promise) return { success: true };
    const result = await promise;
    if (!result.duplicate) this.runPromises.delete(runId);
    return result;
  }

  findByTriggerDispatchKey(key: string, tenantId?: string): RunEntry | undefined {
    return this.memory.findByTriggerDispatchKey?.(key, tenantId);
  }

  async findDurableRunIdByTriggerDispatchKey(key: string, tenantId?: string): Promise<string | null> {
    const memoryHit = this.memory.findByTriggerDispatchKey?.(key, tenantId);
    if (memoryHit) return memoryHit.run.id;
    const res = await this.pool.query(
      "SELECT id FROM studio_runs WHERE metadata->>'triggerDispatchKey' = $1 AND ($2::text IS NULL OR tenant_id = $2::text) LIMIT 1",
      [key, tenantId ?? null]
    );
    return res.rows[0]?.id ? String(res.rows[0].id) : null;
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
        const promise = this.runPromises.get(runId);
        if (promise) {
          const res = await promise;
          if (res.duplicate) return;
        }
        if (this.hasLeaseColumns !== false) {
          try {
            await this.pool.query(
              `INSERT INTO studio_run_events (run_id, sequence, event)
               SELECT $1, $2, $3::jsonb FROM studio_runs
                WHERE id = $1 AND execution_owner_id = $4 AND execution_lease_expires_at > now()
               ON CONFLICT (run_id, sequence) DO NOTHING`,
              [runId, next.sequence, JSON.stringify(next), this.instanceId],
            );
            this.hasLeaseColumns = true;
            return;
          } catch (error: any) {
            if (error?.code !== "42703") throw error;
            this.hasLeaseColumns = false;
          }
        }
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
    const terminal = patch.status && ["completed", "failed", "cancelled"].includes(patch.status);
    if (terminal) {
      patch = {
        ...patch,
        executionOwnerId: this.instanceId,
        executionLeaseExpiresAt: new Date(Date.now() + this.leaseDurationMs).toISOString(),
        executionHeartbeatAt: new Date().toISOString(),
      };
    } else if (patch.status === "running" || patch.status === "waiting_for_human" || patch.status === "queued") {
      patch = {
        ...patch,
        executionOwnerId: patch.executionOwnerId ?? this.instanceId,
        executionLeaseExpiresAt: patch.executionLeaseExpiresAt ?? new Date(Date.now() + this.leaseDurationMs).toISOString(),
        executionHeartbeatAt: new Date().toISOString(),
      };
    }
    const run = this.memory.update(runId, patch);
    if (run) {
      this.enqueue(async () => {
        const promise = this.runPromises.get(runId);
        if (promise) {
          const res = await promise;
          if (res.duplicate) return;
        }
        const entry = this.memory.get(runId);
        const namespace = entry?.memoryAccess?.writableNamespaces[0];
        const isTerminal = ["completed", "failed", "cancelled"].includes(run.status);
        // The server's studio and memory persistence use the same configured
        // PostgreSQL database. Terminal state and its episodic work intent are
        // committed together; a failed insert rolls both back.
        if (this.options.durableMemoryJobs && isTerminal && namespace && entry?.memoryAccess) {
          const client = await this.pool.connect();
          try {
            await client.query("BEGIN");
            if (this.hasLeaseColumns !== false) {
              try {
                const updated = await client.query(
                  `UPDATE studio_runs SET status = $2, completed_at = $3::timestamptz, input = $4::jsonb, output = $5::jsonb,
                   result = $6::jsonb, error = $7, current_node_id = $8, metadata = $9::jsonb,
                   execution_lease_expires_at = now() + ($11 || ' milliseconds')::interval,
                   execution_heartbeat_at = now(), updated_at = now()
                   WHERE id = $1 AND execution_owner_id = $10 AND execution_lease_expires_at > now()
                     AND (status IN ('queued','running','waiting_for_human') OR status = $2)`,
                  [runId, run.status, run.completedAt ?? null, run.input ? JSON.stringify(run.input) : null, run.output ? JSON.stringify(run.output) : null, run.result ? JSON.stringify(run.result) : null, run.error ?? null, run.currentNodeId ?? null, JSON.stringify(run.metadata ?? {}), this.instanceId, this.leaseDurationMs],
                );
                this.requireOwnedUpdate(runId, updated);
                this.hasLeaseColumns = true;
              } catch (err: any) {
                if (err?.code === "42703") {
                  this.hasLeaseColumns = false;
                  await client.query(
                    `UPDATE studio_runs SET status = $2, completed_at = $3::timestamptz, input = $4::jsonb, output = $5::jsonb,
                     result = $6::jsonb, error = $7, current_node_id = $8, metadata = $9::jsonb, updated_at = now() WHERE id = $1`,
                    [runId, run.status, run.completedAt ?? null, run.input ? JSON.stringify(run.input) : null, run.output ? JSON.stringify(run.output) : null, run.result ? JSON.stringify(run.result) : null, run.error ?? null, run.currentNodeId ?? null, JSON.stringify(run.metadata ?? {})],
                  );
                } else {
                  throw err;
                }
              }
            } else {
              await client.query(
                `UPDATE studio_runs SET status = $2, completed_at = $3::timestamptz, input = $4::jsonb, output = $5::jsonb,
                 result = $6::jsonb, error = $7, current_node_id = $8, metadata = $9::jsonb, updated_at = now() WHERE id = $1`,
                [runId, run.status, run.completedAt ?? null, run.input ? JSON.stringify(run.input) : null, run.output ? JSON.stringify(run.output) : null, run.result ? JSON.stringify(run.result) : null, run.error ?? null, run.currentNodeId ?? null, JSON.stringify(run.metadata ?? {})],
              );
            }
            await client.query(
              `INSERT INTO studio_memory_jobs (id,job_kind,handler_version,idempotency_key,tenant_id,namespace_scope,namespace_id,run_id)
               VALUES ($1,'episodic_extraction',1,$2,$3,$4,$5,$6)
               ON CONFLICT (tenant_id,job_kind,handler_version,idempotency_key) DO NOTHING`,
              [randomUUID(), `episodic:${runId}:v1`, entry.memoryAccess.tenantId, namespace.scope, namespace.id, runId],
            );
            await client.query("COMMIT");
          } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
          return;
        }
        if (isTerminal) {
          if (this.hasLeaseColumns !== false) {
            try {
              const updated = await this.pool.query(
                `UPDATE studio_runs SET status = $2, completed_at = $3::timestamptz, input = $4::jsonb, output = $5::jsonb,
                   result = $6::jsonb, error = $7, current_node_id = $8, metadata = $9::jsonb,
                   execution_lease_expires_at = now() + ($11 || ' milliseconds')::interval,
                   execution_heartbeat_at = now(), updated_at = now()
                 WHERE id = $1 AND execution_owner_id = $10 AND execution_lease_expires_at > now()
                   AND (status IN ('queued','running','waiting_for_human') OR status = $2)`,
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
                  this.instanceId,
                  this.leaseDurationMs,
                ],
              );
              this.requireOwnedUpdate(runId, updated);
              this.hasLeaseColumns = true;
              return;
            } catch (err: any) {
              if (err?.code === "42703") {
                this.hasLeaseColumns = false;
              } else {
                throw err;
              }
            }
          }
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
        } else {
          if (this.hasLeaseColumns !== false) {
            try {
              const updated = await this.pool.query(
                `UPDATE studio_runs SET status = $2, completed_at = $3::timestamptz, input = $4::jsonb, output = $5::jsonb,
                   result = $6::jsonb, error = $7, current_node_id = $8, metadata = $9::jsonb,
                   execution_owner_id = COALESCE(execution_owner_id, $10),
                   execution_lease_expires_at = now() + ($11 || ' milliseconds')::interval,
                   execution_heartbeat_at = now(),
                   updated_at = now()
                 WHERE id = $1 AND execution_owner_id = $10 AND execution_lease_expires_at > now()
                   AND (status IN ('queued','running','waiting_for_human') OR status = $2)`,
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
                  this.instanceId,
                  this.leaseDurationMs,
                ],
              );
              this.requireOwnedUpdate(runId, updated);
              this.hasLeaseColumns = true;
              return;
            } catch (err: any) {
              if (err?.code === "42703") {
                this.hasLeaseColumns = false;
              } else {
                throw err;
              }
            }
          }
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
        }
      });
    }
    return run;
  }

  async claimOrphanedRuns(options?: {
    ownerId?: string;
    leaseDurationMs?: number;
    statuses?: RunStatus[];
  }): Promise<Array<{ id: string; status: RunStatus }>> {
    this.assertHealthy();
    if (this.hasLeaseColumns === false) {
      return [];
    }
    const ownerId = options?.ownerId ?? this.instanceId;
    const leaseDurationMs = options?.leaseDurationMs ?? this.leaseDurationMs;
    const statuses = options?.statuses ?? ["waiting_for_human", "queued", "running"];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `UPDATE studio_runs
            SET execution_owner_id = $1,
                execution_lease_expires_at = now() + ($2 || ' milliseconds')::interval,
                execution_heartbeat_at = now(),
                updated_at = now()
          WHERE id IN (
            SELECT id FROM studio_runs
             WHERE status = ANY($3::text[])
               AND (execution_lease_expires_at IS NULL OR execution_lease_expires_at <= now())
             ORDER BY started_at ASC
             FOR UPDATE SKIP LOCKED
          )
          RETURNING id, status, workflow_id, task_id, workflow_snapshot, agents_snapshot, tools_snapshot, input, output, metadata, paused_context, memory_access, owner_id, tenant_id, started_at, completed_at`,
        [ownerId, leaseDurationMs, statuses]
      );
      await client.query("COMMIT");
      this.hasLeaseColumns = true;

      const claimed: Array<{ id: string; status: RunStatus }> = [];
      const leaseExpiresIso = new Date(Date.now() + leaseDurationMs).toISOString();
      const heartbeatIso = new Date().toISOString();

      for (const row of res.rows) {
        const id = String(row.id);
        const status = row.status as RunStatus;
        claimed.push({ id, status });

        const entry = this.memory.get(id);
        if (entry) {
          entry.run.executionOwnerId = ownerId;
          entry.run.executionLeaseExpiresAt = leaseExpiresIso;
          entry.run.executionHeartbeatAt = heartbeatIso;
        } else {
          const run: Run = {
            id,
            workflowId: String(row.workflow_id ?? ""),
            taskId: row.task_id ? String(row.task_id) : undefined,
            status,
            startedAt: asIso(row.started_at),
            completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
            input: row.input ?? undefined,
            output: row.output ?? undefined,
            metadata: (row.metadata ?? {}) as Record<string, unknown>,
            ownerId: row.owner_id ? String(row.owner_id) : undefined,
            tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
            executionOwnerId: ownerId,
            executionLeaseExpiresAt: leaseExpiresIso,
            executionHeartbeatAt: heartbeatIso,
          };
          this.memory.create(
            run,
            undefined,
            {
              workflow: row.workflow_snapshot as WorkflowDefinition | undefined,
              agents: row.agents_snapshot as AgentRecord[] | undefined,
              tools: row.tools_snapshot as import("@multi-agent/types").ToolRecord[] | undefined,
            },
            undefined,
            row.memory_access ? (row.memory_access as MemoryAccessContext) : undefined
          );
          if (row.paused_context) {
            this.memory.setPausedContext(id, row.paused_context as RunEntry["pausedContext"]);
          }
        }
      }
      return claimed;
    } catch (error: any) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error?.code === "42703") {
        this.hasLeaseColumns = false;
        return [];
      }
      throw error;
    } finally {
      client.release();
    }
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
      const values = [
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
        ];
      if (this.hasLeaseColumns !== false) {
        try {
          const inserted = await this.pool.query(
            `INSERT INTO studio_approvals (id, run_id, node_id, status, message, requested_at, resolved_at, context, response, metadata, timeout_seconds)
             SELECT $1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb,$9,$10::jsonb,$11
               FROM studio_runs WHERE id=$2 AND execution_owner_id=$12 AND execution_lease_expires_at > now()
                 AND status IN ('queued','running','waiting_for_human')
             ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at, response = EXCLUDED.response, metadata = EXCLUDED.metadata`,
            [...values, this.instanceId],
          );
          this.requireOwnedUpdate(runId, inserted);
          this.hasLeaseColumns = true;
          return;
        } catch (error: any) {
          if (error?.code !== "42703") throw error;
          this.hasLeaseColumns = false;
        }
      }
      await this.pool.query(
        `INSERT INTO studio_approvals (id, run_id, node_id, status, message, requested_at, resolved_at, context, response, metadata, timeout_seconds)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb,$9,$10::jsonb,$11)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at, response = EXCLUDED.response, metadata = EXCLUDED.metadata`,
        values,
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
        const values = [
          approvalId,
          approval.status,
          approval.resolvedAt ?? null,
          approval.response ?? null,
          approval.context ? JSON.stringify(approval.context) : null,
          JSON.stringify(approval.metadata ?? {}),
          runId,
        ];
        if (this.hasLeaseColumns !== false) {
          try {
            const updated = await this.pool.query(
              `UPDATE studio_approvals SET status = $2, resolved_at = $3::timestamptz, response = $4, context = $5::jsonb, metadata = $6::jsonb
               WHERE run_id = $7 AND id = $1 AND EXISTS (
                 SELECT 1 FROM studio_runs WHERE id=$7 AND execution_owner_id=$8 AND execution_lease_expires_at > now()
                   AND status IN ('queued','running','waiting_for_human'))`,
              [...values, this.instanceId],
            );
            this.requireOwnedUpdate(runId, updated);
            this.hasLeaseColumns = true;
            return;
          } catch (error: any) {
            if (error?.code !== "42703") throw error;
            this.hasLeaseColumns = false;
          }
        }
        await this.pool.query(
          `UPDATE studio_approvals SET status = $2, resolved_at = $3::timestamptz, response = $4, context = $5::jsonb, metadata = $6::jsonb
           WHERE run_id = $7 AND id = $1`,
          values,
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
      if (this.hasLeaseColumns !== false) {
        try {
          const updated = await this.pool.query(
            `UPDATE studio_runs SET paused_context = $2::jsonb, updated_at = now()
             WHERE id = $1 AND execution_owner_id = $3 AND execution_lease_expires_at > now()
               AND status IN ('queued','running','waiting_for_human')`,
            [runId, context ? JSON.stringify(context) : null, this.instanceId],
          );
          this.requireOwnedUpdate(runId, updated);
          this.hasLeaseColumns = true;
          return;
        } catch (error: any) {
          if (error?.code !== "42703") throw error;
          this.hasLeaseColumns = false;
        }
      }
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
