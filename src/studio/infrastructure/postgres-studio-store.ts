import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import type { PgPool } from "../../memory/infrastructure";
import type { StudioStore, StudioTask, StudioWorkspaceImport } from "../contracts";

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function decodeTask(row: Record<string, unknown>): StudioTask {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    priority: row.priority as StudioTask["priority"],
    status: row.status as StudioTask["status"],
    assignedAgent: (row.assigned_agent as string | null) ?? null,
    dependencies: Array.isArray(row.dependencies) ? row.dependencies as string[] : [],
    output: (row.output as string | null) ?? null,
    retryCount: Number(row.retry_count ?? 0),
    paused: Boolean(row.paused),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

export class PostgresStudioStore implements StudioStore {
  constructor(private readonly pool: PgPool) {}

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const result = await this.pool.query("SELECT definition FROM studio_workflows ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.definition as WorkflowDefinition);
  }
  async getWorkflow(id: string): Promise<WorkflowDefinition | null> {
    const result = await this.pool.query("SELECT definition FROM studio_workflows WHERE id = $1", [id]);
    return result.rows[0]?.definition as WorkflowDefinition ?? null;
  }
  async saveWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    await this.pool.query(
      `INSERT INTO studio_workflows (id, name, definition, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`,
      [definition.id, definition.name, JSON.stringify(definition), definition.updatedAt, definition.updatedAt],
    );
    return definition;
  }
  async deleteWorkflow(id: string): Promise<void> {
    await this.pool.query("DELETE FROM studio_workflows WHERE id = $1", [id]);
  }

  async listAgents(): Promise<AgentRecord[]> {
    const result = await this.pool.query("SELECT record FROM studio_agents ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.record as AgentRecord);
  }
  async getAgent(id: string): Promise<AgentRecord | null> {
    const result = await this.pool.query("SELECT record FROM studio_agents WHERE id = $1", [id]);
    return result.rows[0]?.record as AgentRecord ?? null;
  }
  async saveAgent(agent: AgentRecord): Promise<AgentRecord> {
    await this.pool.query(
      `INSERT INTO studio_agents (id, name, record, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
      [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt],
    );
    return agent;
  }
  async deleteAgent(id: string): Promise<void> {
    await this.pool.query("DELETE FROM studio_agents WHERE id = $1", [id]);
  }

  async listTools(): Promise<ToolRecord[]> {
    const result = await this.pool.query("SELECT record FROM studio_tools ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.record as ToolRecord);
  }
  async getTool(id: string): Promise<ToolRecord | null> {
    const result = await this.pool.query("SELECT record FROM studio_tools WHERE id = $1", [id]);
    return result.rows[0]?.record as ToolRecord ?? null;
  }
  async saveTool(tool: ToolRecord): Promise<ToolRecord> {
    await this.pool.query(
      `INSERT INTO studio_tools (id, name, record, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
      [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt],
    );
    return tool;
  }
  async deleteTool(id: string): Promise<void> {
    await this.pool.query("DELETE FROM studio_tools WHERE id = $1", [id]);
  }

  async listTasks(): Promise<StudioTask[]> {
    const result = await this.pool.query("SELECT * FROM studio_tasks ORDER BY updated_at DESC, id");
    return result.rows.map(decodeTask);
  }
  async getTask(id: string): Promise<StudioTask | null> {
    const result = await this.pool.query("SELECT * FROM studio_tasks WHERE id = $1", [id]);
    return result.rows[0] ? decodeTask(result.rows[0]) : null;
  }
  async saveTask(task: StudioTask): Promise<StudioTask> {
    await this.pool.query(
      `INSERT INTO studio_tasks (id, title, description, priority, status, assigned_agent, dependencies, output, retry_count, paused, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::timestamptz,$12::timestamptz)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, priority = EXCLUDED.priority,
         status = EXCLUDED.status, assigned_agent = EXCLUDED.assigned_agent, dependencies = EXCLUDED.dependencies,
         output = EXCLUDED.output, retry_count = EXCLUDED.retry_count, paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at`,
      [task.id, task.title, task.description, task.priority, task.status, task.assignedAgent, JSON.stringify(task.dependencies), task.output, task.retryCount, task.paused, task.createdAt, task.updatedAt],
    );
    return task;
  }
  async deleteTask(id: string): Promise<void> {
    await this.pool.query("DELETE FROM studio_tasks WHERE id = $1", [id]);
  }

  async importWorkspace(workspace: StudioWorkspaceImport): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const workflow of workspace.workflows) {
        await client.query(
          `INSERT INTO studio_workflows (id, name, definition, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`,
          [workflow.id, workflow.name, JSON.stringify(workflow), workflow.updatedAt, workflow.updatedAt],
        );
      }
      for (const agent of workspace.agents) {
        await client.query(
          `INSERT INTO studio_agents (id, name, record, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
          [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt],
        );
      }
      for (const tool of workspace.tools) {
        await client.query(
          `INSERT INTO studio_tools (id, name, record, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
          [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
