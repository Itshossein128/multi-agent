"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresRunStore = exports.RunStore = exports.InMemoryRunStore = void 0;
const langGraphEventAdapter_1 = require("../adapters/langGraphEventAdapter");
function redactApproval(approval) {
    return { ...approval, message: (0, langGraphEventAdapter_1.redact)(approval.message), context: (0, langGraphEventAdapter_1.redact)(approval.context), response: approval.response !== undefined ? (0, langGraphEventAdapter_1.redact)(approval.response) : undefined };
}
function matchesFilters(entry, filters) {
    if (!filters)
        return true;
    if (filters.agentId && !entry.events.some((event) => event.agentId === filters.agentId))
        return false;
    if (filters.workflowId && entry.run.workflowId !== filters.workflowId)
        return false;
    if (filters.taskId && entry.run.taskId !== filters.taskId)
        return false;
    if (filters.status && entry.run.status !== filters.status)
        return false;
    if (filters.from && entry.run.startedAt < filters.from)
        return false;
    if (filters.to && entry.run.startedAt > filters.to)
        return false;
    return true;
}
function asIso(value) {
    if (value instanceof Date)
        return value.toISOString();
    return String(value);
}
/** In-process run store. Used directly in tests and as the hot cache for durable adapters. */
class InMemoryRunStore {
    entries = new Map();
    create(run, memoryOwner, snapshots) {
        this.entries.set(run.id, {
            run,
            events: [],
            listeners: new Set(),
            abort: new AbortController(),
            memoryOwner: memoryOwner ? { principalId: memoryOwner.principalId, tenantId: memoryOwner.tenantId } : undefined,
            approvals: [],
            approvalTimers: new Map(),
            workflowSnapshot: snapshots?.workflow,
            agentsSnapshot: snapshots?.agents,
        });
        return run;
    }
    getMemoryOwner(runId) {
        const owner = this.entries.get(runId)?.memoryOwner;
        return owner ? { ...owner } : undefined;
    }
    get(runId) { return this.entries.get(runId); }
    list(filters) {
        const normalized = typeof filters === "string" ? { agentId: filters } : filters;
        return [...this.entries.values()]
            .filter((entry) => matchesFilters(entry, normalized))
            .map((entry) => entry.run)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }
    append(runId, event) {
        const entry = this.entries.get(runId);
        if (!entry)
            return;
        const next = { ...event, payload: (0, langGraphEventAdapter_1.redact)(event.payload), sequence: entry.events.length + 1 };
        entry.events.push(next);
        entry.listeners.forEach((listener) => listener(next));
        return next;
    }
    update(runId, patch) {
        const entry = this.entries.get(runId);
        if (entry)
            entry.run = { ...entry.run, ...patch };
        return entry?.run;
    }
    events(runId, after = 0) { return this.entries.get(runId)?.events.filter((event) => event.sequence > after) ?? []; }
    subscribe(runId, listener) {
        const entry = this.entries.get(runId);
        if (!entry)
            return () => undefined;
        entry.listeners.add(listener);
        return () => { entry.listeners.delete(listener); };
    }
    cancel(runId) {
        const entry = this.entries.get(runId);
        if (!entry)
            return false;
        entry.abort.abort();
        return true;
    }
    signal(runId) { return this.entries.get(runId)?.abort.signal; }
    addApproval(runId, approval) { this.entries.get(runId)?.approvals.push(approval); }
    getApproval(runId, approvalId) {
        return this.entries.get(runId)?.approvals.find((approval) => approval.id === approvalId);
    }
    listApprovals(runId) {
        return (this.entries.get(runId)?.approvals ?? []).map(redactApproval);
    }
    updateApproval(runId, approvalId, patch) {
        const approval = this.entries.get(runId)?.approvals.find((candidate) => candidate.id === approvalId);
        if (approval)
            Object.assign(approval, patch);
        return approval;
    }
    setApprovalTimer(runId, approvalId, timer) {
        this.entries.get(runId)?.approvalTimers.set(approvalId, timer);
    }
    clearApprovalTimer(runId, approvalId) {
        const timers = this.entries.get(runId)?.approvalTimers;
        const timer = timers?.get(approvalId);
        if (timer)
            clearTimeout(timer);
        timers?.delete(approvalId);
    }
    setPausedContext(runId, context) {
        const entry = this.entries.get(runId);
        if (entry)
            entry.pausedContext = context ?? undefined;
    }
    getPausedContext(runId) { return this.entries.get(runId)?.pausedContext; }
    getWorkflowSnapshot(runId) { return this.entries.get(runId)?.workflowSnapshot; }
}
exports.InMemoryRunStore = InMemoryRunStore;
/** Back-compat alias for existing imports/tests. */
class RunStore extends InMemoryRunStore {
}
exports.RunStore = RunStore;
/**
 * Write-through durable store: hot path stays in-memory (SSE/listeners/abort),
 * mutations are persisted to Postgres. hydrate() rebuilds the cache after restart.
 */
class PostgresRunStore {
    pool;
    memory = new InMemoryRunStore();
    writeChain = Promise.resolve();
    constructor(pool) {
        this.pool = pool;
    }
    enqueue(operation) {
        this.writeChain = this.writeChain.then(operation, operation).catch((error) => {
            console.error("Studio run persistence failed:", error instanceof Error ? error.message : error);
        });
    }
    async hydrate() {
        const runs = await this.pool.query("SELECT * FROM studio_runs ORDER BY started_at ASC");
        for (const row of runs.rows) {
            const run = {
                id: String(row.id),
                workflowId: String(row.workflow_id),
                taskId: row.task_id ? String(row.task_id) : undefined,
                status: row.status,
                startedAt: asIso(row.started_at),
                completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
                input: row.input ?? undefined,
                output: row.output ?? undefined,
                error: row.error ?? undefined,
                currentNodeId: row.current_node_id ?? undefined,
                metadata: (row.metadata ?? {}),
            };
            const owner = row.memory_owner_principal_id && row.memory_owner_tenant_id
                ? { principalId: String(row.memory_owner_principal_id), tenantId: String(row.memory_owner_tenant_id) }
                : undefined;
            this.memory.create(run, owner, {
                workflow: row.workflow_snapshot,
                agents: row.agents_snapshot,
            });
            if (row.paused_context)
                this.memory.setPausedContext(run.id, row.paused_context);
            const events = await this.pool.query("SELECT event FROM studio_run_events WHERE run_id = $1 ORDER BY sequence ASC", [run.id]);
            const entry = this.memory.get(run.id);
            for (const eventRow of events.rows) {
                const event = eventRow.event;
                entry.events.push(event);
            }
            const approvals = await this.pool.query("SELECT * FROM studio_approvals WHERE run_id = $1 ORDER BY requested_at ASC", [run.id]);
            for (const approvalRow of approvals.rows) {
                entry.approvals.push({
                    id: String(approvalRow.id),
                    runId: String(approvalRow.run_id),
                    nodeId: String(approvalRow.node_id),
                    status: approvalRow.status,
                    message: String(approvalRow.message),
                    requestedAt: asIso(approvalRow.requested_at),
                    resolvedAt: approvalRow.resolved_at ? asIso(approvalRow.resolved_at) : undefined,
                    context: approvalRow.context ?? undefined,
                    response: approvalRow.response ?? undefined,
                    metadata: (approvalRow.metadata ?? {}),
                });
            }
        }
    }
    create(run, memoryOwner, snapshots) {
        const created = this.memory.create(run, memoryOwner, snapshots);
        this.enqueue(async () => {
            await this.pool.query(`INSERT INTO studio_runs (
           id, workflow_id, task_id, status, started_at, completed_at, input, output, error, current_node_id, metadata,
           memory_owner_principal_id, memory_owner_tenant_id, workflow_snapshot, agents_snapshot, updated_at
         ) VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15::jsonb,now())
         ON CONFLICT (id) DO NOTHING`, [
                run.id, run.workflowId, run.taskId ?? null, run.status, run.startedAt, run.completedAt ?? null,
                run.input ? JSON.stringify(run.input) : null, run.output ? JSON.stringify(run.output) : null,
                run.error ?? null, run.currentNodeId ?? null, JSON.stringify(run.metadata ?? {}),
                memoryOwner?.principalId ?? null, memoryOwner?.tenantId ?? null,
                snapshots?.workflow ? JSON.stringify(snapshots.workflow) : null,
                snapshots?.agents ? JSON.stringify(snapshots.agents) : null,
            ]);
        });
        return created;
    }
    getMemoryOwner(runId) { return this.memory.getMemoryOwner(runId); }
    get(runId) { return this.memory.get(runId); }
    list(filters) { return this.memory.list(filters); }
    append(runId, event) {
        const next = this.memory.append(runId, event);
        if (next) {
            this.enqueue(async () => {
                await this.pool.query(`INSERT INTO studio_run_events (run_id, sequence, event) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (run_id, sequence) DO NOTHING`, [runId, next.sequence, JSON.stringify(next)]);
            });
        }
        return next;
    }
    update(runId, patch) {
        const run = this.memory.update(runId, patch);
        if (run) {
            this.enqueue(async () => {
                await this.pool.query(`UPDATE studio_runs SET status = $2, completed_at = $3::timestamptz, input = $4::jsonb, output = $5::jsonb,
             error = $6, current_node_id = $7, metadata = $8::jsonb, updated_at = now()
           WHERE id = $1`, [
                    runId, run.status, run.completedAt ?? null,
                    run.input ? JSON.stringify(run.input) : null,
                    run.output ? JSON.stringify(run.output) : null,
                    run.error ?? null, run.currentNodeId ?? null, JSON.stringify(run.metadata ?? {}),
                ]);
            });
        }
        return run;
    }
    events(runId, after = 0) { return this.memory.events(runId, after); }
    subscribe(runId, listener) { return this.memory.subscribe(runId, listener); }
    cancel(runId) { return this.memory.cancel(runId); }
    signal(runId) { return this.memory.signal(runId); }
    addApproval(runId, approval, timeoutSeconds) {
        this.memory.addApproval(runId, approval);
        this.enqueue(async () => {
            await this.pool.query(`INSERT INTO studio_approvals (id, run_id, node_id, status, message, requested_at, resolved_at, context, response, metadata, timeout_seconds)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb,$9,$10::jsonb,$11)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at, response = EXCLUDED.response, metadata = EXCLUDED.metadata`, [
                approval.id, approval.runId, approval.nodeId, approval.status, approval.message, approval.requestedAt,
                approval.resolvedAt ?? null, approval.context ? JSON.stringify(approval.context) : null,
                approval.response ?? null, JSON.stringify(approval.metadata ?? {}), timeoutSeconds ?? null,
            ]);
        });
    }
    getApproval(runId, approvalId) { return this.memory.getApproval(runId, approvalId); }
    listApprovals(runId) { return this.memory.listApprovals(runId); }
    updateApproval(runId, approvalId, patch) {
        const approval = this.memory.updateApproval(runId, approvalId, patch);
        if (approval) {
            this.enqueue(async () => {
                await this.pool.query(`UPDATE studio_approvals SET status = $2, resolved_at = $3::timestamptz, response = $4, context = $5::jsonb, metadata = $6::jsonb
           WHERE run_id = $7 AND id = $1`, [
                    approvalId, approval.status, approval.resolvedAt ?? null, approval.response ?? null,
                    approval.context ? JSON.stringify(approval.context) : null, JSON.stringify(approval.metadata ?? {}), runId,
                ]);
            });
        }
        return approval;
    }
    setApprovalTimer(runId, approvalId, timer) {
        this.memory.setApprovalTimer(runId, approvalId, timer);
    }
    clearApprovalTimer(runId, approvalId) {
        this.memory.clearApprovalTimer(runId, approvalId);
    }
    setPausedContext(runId, context) {
        this.memory.setPausedContext(runId, context);
        this.enqueue(async () => {
            await this.pool.query("UPDATE studio_runs SET paused_context = $2::jsonb, updated_at = now() WHERE id = $1", [
                runId, context ? JSON.stringify(context) : null,
            ]);
        });
    }
    getPausedContext(runId) { return this.memory.getPausedContext(runId); }
    getWorkflowSnapshot(runId) { return this.memory.getWorkflowSnapshot(runId); }
}
exports.PostgresRunStore = PostgresRunStore;
//# sourceMappingURL=runStore.js.map