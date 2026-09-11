"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresStudioStore = void 0;
const types_1 = require("@multi-agent/types");
function asIso(value) {
    if (value instanceof Date)
        return value.toISOString();
    return String(value);
}
function decodeTask(row) {
    return {
        id: String(row.id),
        title: String(row.title),
        description: String(row.description ?? ""),
        priority: row.priority,
        status: row.status,
        assignedAgent: row.assigned_agent ?? null,
        dependencies: Array.isArray(row.dependencies) ? row.dependencies : [],
        output: row.output ?? null,
        retryCount: Number(row.retry_count ?? 0),
        paused: Boolean(row.paused),
        createdAt: asIso(row.created_at),
        updatedAt: asIso(row.updated_at),
        ownerId: row.owner_id ?? undefined,
        tenantId: row.tenant_id ?? undefined,
    };
}
class PostgresStudioStore {
    pool;
    client;
    constructor(pool, client) {
        this.pool = pool;
        this.client = client;
    }
    query(text, values) { return (this.client ?? this.pool).query(text, values); }
    async transaction(operation) {
        if (this.client)
            throw new Error("Nested Studio transactions are unsupported.");
        const client = await this.pool.connect();
        const transactionStore = new PostgresStudioStore(this.pool, client);
        try {
            await client.query("BEGIN");
            const result = await operation(transactionStore);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            try {
                await client.query("ROLLBACK");
            }
            catch { /* Preserve the operation error. */ }
            throw error;
        }
        finally {
            client.release();
        }
    }
    async listWorkflows(principal) {
        const result = principal
            ? await this.query("SELECT definition FROM studio_workflows WHERE tenant_id = $1 AND owner_id = $2 ORDER BY updated_at DESC, id", [principal.tenantId, principal.userId])
            : await this.query("SELECT definition FROM studio_workflows ORDER BY updated_at DESC, id");
        return result.rows.map((row) => row.definition);
    }
    async getWorkflow(id, principal) {
        const result = principal
            ? await this.query("SELECT definition FROM studio_workflows WHERE id = $1 AND tenant_id = $2 AND owner_id = $3", [id, principal.tenantId, principal.userId])
            : await this.query("SELECT definition FROM studio_workflows WHERE id = $1", [id]);
        return result.rows[0]?.definition ?? null;
    }
    async saveWorkflow(definition, principal) {
        if (principal) {
            const existing = await this.query("SELECT tenant_id, owner_id FROM studio_workflows WHERE id = $1", [definition.id]);
            if (existing.rows.length) {
                const row = existing.rows[0];
                if (!row.tenant_id || !row.owner_id || row.tenant_id !== principal.tenantId || row.owner_id !== principal.userId) {
                    throw new Error("Access denied to workflow");
                }
            }
            definition = { ...definition, ownerId: principal.userId, tenantId: principal.tenantId };
            await this.query(`INSERT INTO studio_workflows (id, name, definition, created_at, updated_at, owner_id, tenant_id)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id`, [definition.id, definition.name, JSON.stringify(definition), definition.updatedAt, definition.updatedAt, principal.userId, principal.tenantId]);
        }
        else {
            await this.query(`INSERT INTO studio_workflows (id, name, definition, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`, [definition.id, definition.name, JSON.stringify(definition), definition.updatedAt, definition.updatedAt]);
        }
        return definition;
    }
    async deleteWorkflow(id, principal) {
        if (principal) {
            await this.query("DELETE FROM studio_workflows WHERE id = $1 AND tenant_id = $2 AND owner_id = $3", [id, principal.tenantId, principal.userId]);
        }
        else {
            await this.query("DELETE FROM studio_workflows WHERE id = $1", [id]);
        }
    }
    async listAgents(principal) {
        const result = principal
            ? await this.query("SELECT record FROM studio_agents WHERE is_system = true OR (tenant_id = $1 AND (owner_id = $2 OR owner_id IS NULL)) ORDER BY updated_at DESC, id", [principal.tenantId, principal.userId])
            : await this.query("SELECT record FROM studio_agents ORDER BY updated_at DESC, id");
        return result.rows.map((row) => row.record);
    }
    async getAgent(id, principal) {
        const result = principal
            ? await this.query("SELECT record FROM studio_agents WHERE id = $1 AND (is_system = true OR (tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL)))", [id, principal.tenantId, principal.userId])
            : await this.query("SELECT record FROM studio_agents WHERE id = $1", [id]);
        return result.rows[0]?.record ?? null;
    }
    async saveAgent(agent, principal) {
        if (principal) {
            const existing = await this.query("SELECT is_system, tenant_id, owner_id FROM studio_agents WHERE id = $1", [agent.id]);
            if (existing.rows.length) {
                const row = existing.rows[0];
                if (row.is_system)
                    throw new Error("Cannot modify system agent");
                if (!row.tenant_id || row.tenant_id !== principal.tenantId || (row.owner_id && row.owner_id !== principal.userId)) {
                    throw new Error("Access denied to agent");
                }
            }
            agent = { ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
            await this.query(`INSERT INTO studio_agents (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system`, [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt, principal.userId, principal.tenantId]);
        }
        else {
            await this.query(`INSERT INTO studio_agents (id, name, record, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`, [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt]);
        }
        return agent;
    }
    async deleteAgent(id, principal) {
        if (principal) {
            await this.query("DELETE FROM studio_agents WHERE id = $1 AND is_system = false AND tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL)", [id, principal.tenantId, principal.userId]);
        }
        else {
            await this.query("DELETE FROM studio_agents WHERE id = $1", [id]);
        }
    }
    async listTools(principal) {
        const result = principal
            ? await this.query("SELECT record FROM studio_tools WHERE is_system = true OR (tenant_id = $1 AND (owner_id = $2 OR owner_id IS NULL)) ORDER BY updated_at DESC, id", [principal.tenantId, principal.userId])
            : await this.query("SELECT record FROM studio_tools ORDER BY updated_at DESC, id");
        return result.rows.map((row) => row.record);
    }
    async getTool(id, principal) {
        const result = principal
            ? await this.query("SELECT record FROM studio_tools WHERE id = $1 AND (is_system = true OR (tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL)))", [id, principal.tenantId, principal.userId])
            : await this.query("SELECT record FROM studio_tools WHERE id = $1", [id]);
        return result.rows[0]?.record ?? null;
    }
    async saveTool(tool, principal) {
        if (principal) {
            const existing = await this.query("SELECT is_system, tenant_id, owner_id FROM studio_tools WHERE id = $1", [tool.id]);
            if (existing.rows.length) {
                const row = existing.rows[0];
                if (row.is_system)
                    throw new Error("Cannot modify system tool");
                if (!row.tenant_id || row.tenant_id !== principal.tenantId || (row.owner_id && row.owner_id !== principal.userId)) {
                    throw new Error("Access denied to tool");
                }
            }
            tool = { ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
            await this.query(`INSERT INTO studio_tools (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system`, [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt, principal.userId, principal.tenantId]);
        }
        else {
            await this.query(`INSERT INTO studio_tools (id, name, record, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`, [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt]);
        }
        return tool;
    }
    async deleteTool(id, principal) {
        if (principal) {
            await this.query("DELETE FROM studio_tools WHERE id = $1 AND is_system = false AND tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL)", [id, principal.tenantId, principal.userId]);
        }
        else {
            await this.query("DELETE FROM studio_tools WHERE id = $1", [id]);
        }
    }
    async listTasks(principal) {
        const result = principal
            ? await this.query("SELECT * FROM studio_tasks WHERE tenant_id = $1 ORDER BY updated_at DESC, id", [principal.tenantId])
            : await this.query("SELECT * FROM studio_tasks ORDER BY updated_at DESC, id");
        return result.rows.map(decodeTask);
    }
    async getTask(id, principal) {
        const result = principal
            ? await this.query("SELECT * FROM studio_tasks WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId])
            : await this.query("SELECT * FROM studio_tasks WHERE id = $1", [id]);
        return result.rows[0] ? decodeTask(result.rows[0]) : null;
    }
    async saveTask(task, principal) {
        if (principal) {
            const existing = await this.query("SELECT tenant_id FROM studio_tasks WHERE id = $1", [task.id]);
            if (existing.rows.length && existing.rows[0].tenant_id !== principal.tenantId) {
                throw new Error("Access denied to task");
            }
            const updatedAt = task.updatedAt ?? task.createdAt ?? (0, types_1.nowIso)();
            task = { ...task, tenantId: principal.tenantId, ownerId: task.ownerId ?? principal.userId, updatedAt };
            await this.query(`INSERT INTO studio_tasks (id, title, description, priority, status, assigned_agent, dependencies, output, retry_count, paused, created_at, updated_at, owner_id, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13,$14)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, priority = EXCLUDED.priority,
           status = EXCLUDED.status, assigned_agent = EXCLUDED.assigned_agent, dependencies = EXCLUDED.dependencies,
           output = EXCLUDED.output, retry_count = EXCLUDED.retry_count, paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id`, [task.id, task.title, task.description, task.priority, task.status, task.assignedAgent, JSON.stringify(task.dependencies), task.output, task.retryCount, task.paused, task.createdAt, updatedAt, task.ownerId, principal.tenantId]);
        }
        else {
            const updatedAt = task.updatedAt ?? task.createdAt ?? (0, types_1.nowIso)();
            task = { ...task, updatedAt };
            await this.query(`INSERT INTO studio_tasks (id, title, description, priority, status, assigned_agent, dependencies, output, retry_count, paused, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::timestamptz,$12::timestamptz)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, priority = EXCLUDED.priority,
           status = EXCLUDED.status, assigned_agent = EXCLUDED.assigned_agent, dependencies = EXCLUDED.dependencies,
           output = EXCLUDED.output, retry_count = EXCLUDED.retry_count, paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at`, [task.id, task.title, task.description, task.priority, task.status, task.assignedAgent, JSON.stringify(task.dependencies), task.output, task.retryCount, task.paused, task.createdAt, updatedAt]);
        }
        return task;
    }
    async deleteTask(id, principal) {
        if (principal) {
            await this.query("DELETE FROM studio_tasks WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId]);
        }
        else {
            await this.query("DELETE FROM studio_tasks WHERE id = $1", [id]);
        }
    }
    async importWorkspace(workspace, principal) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            for (const workflow of workspace.workflows) {
                if (principal) {
                    const stamped = { ...workflow, ownerId: principal.userId, tenantId: principal.tenantId };
                    await client.query(`INSERT INTO studio_workflows (id, name, definition, created_at, updated_at, owner_id, tenant_id)
             VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at,
               owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id`, [stamped.id, stamped.name, JSON.stringify(stamped), stamped.updatedAt, stamped.updatedAt, principal.userId, principal.tenantId]);
                }
                else {
                    await client.query(`INSERT INTO studio_workflows (id, name, definition, created_at, updated_at)
             VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`, [workflow.id, workflow.name, JSON.stringify(workflow), workflow.updatedAt, workflow.updatedAt]);
                }
            }
            for (const agent of workspace.agents) {
                if (principal) {
                    const stamped = { ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
                    await client.query(`INSERT INTO studio_agents (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
             VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
               owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system`, [stamped.id, stamped.name, JSON.stringify(stamped), stamped.createdAt, stamped.updatedAt, principal.userId, principal.tenantId]);
                }
                else {
                    await client.query(`INSERT INTO studio_agents (id, name, record, created_at, updated_at)
             VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`, [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt]);
                }
            }
            for (const tool of workspace.tools) {
                if (principal) {
                    const stamped = { ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
                    await client.query(`INSERT INTO studio_tools (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
             VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
               owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system`, [stamped.id, stamped.name, JSON.stringify(stamped), stamped.createdAt, stamped.updatedAt, principal.userId, principal.tenantId]);
                }
                else {
                    await client.query(`INSERT INTO studio_tools (id, name, record, created_at, updated_at)
             VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`, [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt]);
                }
            }
            await client.query("COMMIT");
        }
        catch (error) {
            try {
                await client.query("ROLLBACK");
            }
            catch { /* preserve */ }
            throw error;
        }
        finally {
            client.release();
        }
    }
}
exports.PostgresStudioStore = PostgresStudioStore;
//# sourceMappingURL=postgres-studio-store.js.map