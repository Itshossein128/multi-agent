import type { PgPool, PgClient } from "../../../../src/memory/infrastructure";
import { withOrganization, scopedDbClient, type PrincipalKind } from "../../../../src/studio/infrastructure/withOrganization";


import { prepareInMemoryCommit } from "../../../../src/studio/infrastructure/in-memory-transaction";

export type GoalStatus = "proposed" | "active" | "completed" | "cancelled";
export interface OrganizationGoal {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  status: GoalStatus;
  parentGoalId: string | null;
  projectId: string | null;
  ownerAgentId: string | null;
  proposedByAgentId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface ReportingLine { tenantId: string; agentId: string; managerAgentId: string | null; role: "ceo" | "manager" | "member" }

export interface OrganizationStore {
  purgeTenantGoals?(tenantId: string): void | Promise<void>;
  goals(tenantId: string): Promise<OrganizationGoal[]>;
  saveGoal(goal: OrganizationGoal): Promise<OrganizationGoal>;
  reportingLines(tenantId: string): Promise<ReportingLine[]>;
  saveReportingLine(line: ReportingLine): Promise<ReportingLine>;
}

export class InMemoryOrganizationStore implements OrganizationStore {
  private readonly goalRows = new Map<string, OrganizationGoal>();
  private readonly lineRows = new Map<string, ReportingLine>();
  stageTransaction(): { store: InMemoryOrganizationStore; commit: () => void } {
    const current = { goalRows: this.goalRows, lineRows: this.lineRows };
    const before = structuredClone(current);
    const draft = structuredClone(before);
    const store: InMemoryOrganizationStore = Object.assign(Object.create(Object.getPrototypeOf(this)), this, draft);
    // Match the PostgreSQL UoW: reporting changes require their own graph validation boundary.
    store.saveReportingLine = async () => { throw new Error("Reporting-line updates are not supported inside an organization unit of work"); };
    return { store, commit: () => prepareInMemoryCommit(current, before, draft)() };
  }
  async goals(tenantId: string) { return [...this.goalRows.values()].filter(g => g.tenantId === tenantId).map(g => structuredClone(g)); }
  async saveGoal(goal: OrganizationGoal) {
    const existing = this.goalRows.get(goal.id);
    if (existing && existing.tenantId !== goal.tenantId) throw new Error("Goal tenant mismatch");
    this.goalRows.set(goal.id, structuredClone(goal)); return structuredClone(goal);
  }
  async reportingLines(tenantId: string) { return [...this.lineRows.values()].filter(l => l.tenantId === tenantId).map(l => structuredClone(l)); }
  async saveReportingLine(line: ReportingLine) {
    if (line.role === "ceo" && [...this.lineRows.values()].some(existing => existing.tenantId === line.tenantId && existing.role === "ceo" && existing.agentId !== line.agentId)) throw new Error("This organization already has a CEO agent");
    const lines = [...this.lineRows.values()].filter(existing => existing.tenantId === line.tenantId);
    if (line.managerAgentId && !lines.some(existing => existing.agentId === line.managerAgentId)) throw new Error("Manager must have an organization role");
    const parents = new Map(lines.map(existing => [existing.agentId, existing.managerAgentId]));
    parents.set(line.agentId, line.managerAgentId);
    const seen = new Set<string>();
    let cursor = line.managerAgentId;
    while (cursor) {
      if (cursor === line.agentId || seen.has(cursor)) throw new Error("Reporting cycle detected");
      seen.add(cursor);
      cursor = parents.get(cursor) ?? null;
    }
    this.lineRows.set(`${line.tenantId}:${line.agentId}`, structuredClone(line)); return structuredClone(line);
  }
  purgeTenantGoals(tenantId: string): void {
    for (const [id, goal] of Array.from(this.goalRows.entries())) {
      if (goal.tenantId === tenantId) this.goalRows.delete(id);
    }
    for (const [key, line] of Array.from(this.lineRows.entries())) {
      if (line.tenantId === tenantId) this.lineRows.delete(key);
    }
  }
}

function goalFromRow(row: Record<string, unknown>): OrganizationGoal {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), title: String(row.title), description: String(row.description),
    status: row.status as GoalStatus, parentGoalId: row.parent_goal_id as string | null,
    projectId: row.project_id as string | null, ownerAgentId: row.owner_agent_id as string | null,
    proposedByAgentId: row.proposed_by_agent_id as string | null, createdBy: String(row.created_by),
    createdAt: new Date(row.created_at as string).toISOString(), updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export class PostgresOrganizationStore implements OrganizationStore {
  constructor(private readonly pool: PgPool, private readonly client?: PgClient) {}
  async purgeTenantGoals(tenantId: string): Promise<void> {
    await this.scopedExecution(tenantId, "service", async () => {
      await this.query("DELETE FROM studio_organization_goals WHERE tenant_id=$1", [tenantId]);
      await this.query("DELETE FROM studio_agent_reporting WHERE tenant_id=$1", [tenantId]);
    });
  }
  private query(text: string, values?: unknown[]) { return (this.client ?? scopedDbClient(this.pool) ?? this.pool).query(text, values); }

  private scopedExecution<T>(
    tenantId: string | undefined,
    principalKind: PrincipalKind | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (this.client || scopedDbClient(this.pool) || !tenantId?.trim()) {
      return fn();
    }
    return withOrganization(this.pool, tenantId.trim(), principalKind ?? "service", () => fn());
  }

  async goals(tenantId: string): Promise<OrganizationGoal[]> {
    return this.scopedExecution(tenantId, "service", async () => {
      const result = await this.query("SELECT * FROM studio_organization_goals WHERE tenant_id=$1 ORDER BY created_at", [tenantId]);
      return result.rows.map(goalFromRow);
    });
  }

  async saveGoal(goal: OrganizationGoal): Promise<OrganizationGoal> {
    return this.scopedExecution(goal.tenantId, "service", async () => {
      const result = await this.query(
        `INSERT INTO studio_organization_goals (id,tenant_id,title,description,status,parent_goal_id,project_id,owner_agent_id,proposed_by_agent_id,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,status=EXCLUDED.status,
           parent_goal_id=EXCLUDED.parent_goal_id,project_id=EXCLUDED.project_id,owner_agent_id=EXCLUDED.owner_agent_id,updated_at=EXCLUDED.updated_at
         WHERE studio_organization_goals.tenant_id=EXCLUDED.tenant_id RETURNING *`,
        [goal.id,goal.tenantId,goal.title,goal.description,goal.status,goal.parentGoalId,goal.projectId,goal.ownerAgentId,goal.proposedByAgentId,goal.createdBy,goal.createdAt,goal.updatedAt],
      );
      if (!result.rows[0]) throw new Error("Goal tenant mismatch");
      return goalFromRow(result.rows[0]);
    });
  }

  async reportingLines(tenantId: string): Promise<ReportingLine[]> {
    return this.scopedExecution(tenantId, "service", async () => {
      const result = await this.query("SELECT tenant_id,agent_id,manager_agent_id,role FROM studio_agent_reporting WHERE tenant_id=$1", [tenantId]);
      return result.rows.map(row => ({ tenantId: String(row.tenant_id), agentId: String(row.agent_id), managerAgentId: row.manager_agent_id as string | null, role: row.role as ReportingLine["role"] }));
    });
  }

  async saveReportingLine(line: ReportingLine): Promise<ReportingLine> {
    if (this.client) throw new Error("Reporting-line updates are not supported inside an organization unit of work");
    return withOrganization(this.pool, line.tenantId, "service", async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`organization:${line.tenantId}`]);
      const current = await client.query("SELECT agent_id,manager_agent_id,role FROM studio_agent_reporting WHERE tenant_id=$1", [line.tenantId]);
      const lines = current.rows.map(row => ({ agentId: String(row.agent_id), managerAgentId: row.manager_agent_id as string | null, role: row.role as ReportingLine["role"] }));
      if (line.role === "ceo" && lines.some(item => item.role === "ceo" && item.agentId !== line.agentId)) throw new Error("This organization already has a CEO agent");
      if (line.managerAgentId && !lines.some(item => item.agentId === line.managerAgentId)) throw new Error("Manager must have an organization role");
      const parents = new Map(lines.map(item => [item.agentId, item.managerAgentId]));
      parents.set(line.agentId, line.managerAgentId);
      const seen = new Set<string>(); let cursor = line.managerAgentId;
      while (cursor) {
        if (cursor === line.agentId || seen.has(cursor)) throw new Error("Reporting cycle detected");
        seen.add(cursor); cursor = parents.get(cursor) ?? null;
      }
      await client.query(
        `INSERT INTO studio_agent_reporting (tenant_id,agent_id,manager_agent_id,role) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id,agent_id) DO UPDATE SET manager_agent_id=EXCLUDED.manager_agent_id,role=EXCLUDED.role`,
        [line.tenantId,line.agentId,line.managerAgentId,line.role],
      );
      return line;
    });
  }
}
