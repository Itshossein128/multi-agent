import { nowIso, uid } from "@multi-agent/types";
import type { StudioStore } from "../../../../src/studio/contracts";
import type { RequestPrincipal } from "../auth/principal";
import type { RunExecutor } from "../runtime/runExecutor";
import { ApiError } from "../api/shared/http";
import { TaskService } from "../api/studio/taskService";
import { ensureTenantProjectWorkspaceDefaults } from "../api/studio/tenantDefaults";
import type { GoalStatus, OrganizationGoal, OrganizationStore, ReportingLine } from "./organizationStore";

const roles = new Set(["ceo", "manager", "member"]);
const statuses = new Set(["proposed", "active", "completed", "cancelled"]);
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ApiError(400, `${name} must be a nonempty string of at most ${max} characters`);
  return value.trim();
}

export class OrganizationService {
  constructor(private readonly organization: OrganizationStore, private readonly studio: StudioStore, private readonly executor?: RunExecutor) {}

  async overview(principal: RequestPrincipal) {
    const [goals, reportingLines, agents, tasks] = await Promise.all([
      this.organization.goals(principal.tenantId), this.organization.reportingLines(principal.tenantId), this.studio.listAgents(principal), new TaskService(this.studio, this.executor).list(principal),
    ]);
    const visible = new Set(agents.filter(agent => !agent.isSystem && agent.tenantId === principal.tenantId).map(agent => agent.id));
    return { goals: goals.filter(goal => !goal.ownerAgentId || visible.has(goal.ownerAgentId)), reportingLines: reportingLines.filter(line => visible.has(line.agentId)), agents: agents.filter(agent => visible.has(agent.id)).map(agent => ({ id: agent.id, name: agent.name })), goalTasks: tasks.filter(task => typeof task.metadata?.organizationGoalId === "string").map(task => ({ id: task.id, title: task.title, status: task.status, output: task.output, goalId: task.metadata!.organizationGoalId as string, parentTaskId: task.parentTaskId, strategyProposal: task.metadata?.strategyProposal === true })) };
  }

  async setReportingLine(agentId: string, input: { role?: unknown; managerAgentId?: unknown }, principal: RequestPrincipal): Promise<ReportingLine> {
    const agent = await this.studio.getAgent(agentId, principal);
    if (!agent || agent.isSystem || agent.tenantId !== principal.tenantId) throw new ApiError(404, "Agent not found");
    const role = input.role;
    if (typeof role !== "string" || !roles.has(role)) throw new ApiError(400, "Invalid organization role");
    const managerAgentId = input.managerAgentId === null || input.managerAgentId === undefined ? null : text(input.managerAgentId, "managerAgentId", 200);
    if (role === "ceo" && managerAgentId) throw new ApiError(400, "CEO cannot have a manager");
    if (role !== "ceo" && !managerAgentId) throw new ApiError(400, "A non-CEO agent needs a manager");
    if (managerAgentId) {
      const manager = await this.studio.getAgent(managerAgentId, principal);
      if (!manager || manager.isSystem || manager.tenantId !== principal.tenantId) throw new ApiError(400, "Manager agent not found");
    }
    const lines = await this.organization.reportingLines(principal.tenantId);
    if (role === "ceo" && lines.some(line => line.role === "ceo" && line.agentId !== agentId)) throw new ApiError(409, "This organization already has a CEO agent");
    const parents = new Map(lines.map(line => [line.agentId, line.managerAgentId]));
    parents.set(agentId, managerAgentId);
    let cursor = managerAgentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === agentId || seen.has(cursor)) throw new ApiError(400, "Reporting cycle detected");
      seen.add(cursor);
      cursor = parents.get(cursor) ?? null;
    }
    if (managerAgentId && !lines.some(line => line.agentId === managerAgentId)) throw new ApiError(400, "Manager must have an organization role");
    try {
      return await this.organization.saveReportingLine({ tenantId: principal.tenantId, agentId, managerAgentId, role: role as ReportingLine["role"] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ApiError(409, "This organization already has a CEO agent");
      if (error instanceof Error && error.message === "This organization already has a CEO agent") throw new ApiError(409, error.message);
      if (error instanceof Error && ["Manager must have an organization role", "Reporting cycle detected"].includes(error.message)) throw new ApiError(400, error.message);
      throw error;
    }
  }

  async createGoal(input: Partial<OrganizationGoal>, principal: RequestPrincipal): Promise<OrganizationGoal> {
    const goals = await this.organization.goals(principal.tenantId);
    const title = text(input.title, "title", 200);
    const description = typeof input.description === "string" && input.description.length <= 4000 ? input.description : "";
    const parentGoalId = input.parentGoalId ?? null;
    if (parentGoalId && !goals.some(goal => goal.id === parentGoalId)) throw new ApiError(400, "Parent goal not found");
    const projectId = input.projectId ?? null;
    if (projectId && !await this.studio.getProject(projectId, principal)) throw new ApiError(400, "Project not found");
    const ownerAgentId = input.ownerAgentId ?? null;
    if (ownerAgentId && !await this.studio.getAgent(ownerAgentId, principal)) throw new ApiError(400, "Owner agent not found");
    const proposedByAgentId = input.proposedByAgentId ?? null;
    if (proposedByAgentId) {
      const ceo = (await this.organization.reportingLines(principal.tenantId)).find(line => line.role === "ceo");
      if (!ceo || ceo.agentId !== proposedByAgentId) throw new ApiError(403, "Only the CEO agent can propose strategy goals");
    }
    const stamp = nowIso();
    return this.organization.saveGoal({ id: uid("goal"), tenantId: principal.tenantId, title, description, status: proposedByAgentId ? "proposed" : "active", parentGoalId, projectId, ownerAgentId, proposedByAgentId, createdBy: principal.userId, createdAt: stamp, updatedAt: stamp });
  }

  async updateGoal(id: string, input: { status?: unknown; ownerAgentId?: unknown }, principal: RequestPrincipal): Promise<OrganizationGoal> {
    const goals = await this.organization.goals(principal.tenantId);
    const existing = goals.find(goal => goal.id === id);
    if (!existing) throw new ApiError(404, "Goal not found");
    const status = input.status ?? existing.status;
    if (typeof status !== "string" || !statuses.has(status)) throw new ApiError(400, "Invalid goal status");
    const transitions: Record<GoalStatus, GoalStatus[]> = {
      proposed: ["proposed", "active", "cancelled"],
      active: ["active", "completed", "cancelled"],
      completed: ["completed"],
      cancelled: ["cancelled"],
    };
    if (!transitions[existing.status].includes(status as GoalStatus)) throw new ApiError(409, `Cannot change goal from ${existing.status} to ${status}`);
    if (existing.status === "proposed" && status === "active" && existing.proposedByAgentId) {
      const strategyTasks = (await new TaskService(this.studio, this.executor).list(principal)).filter(task =>
        task.metadata?.organizationGoalId === id && task.metadata?.strategyProposal === true,
      );
      if (strategyTasks.length && !strategyTasks.some(task => ["completed", "done"].includes(task.status) && Boolean(task.output?.trim()))) {
        throw new ApiError(409, "The CEO strategy task must finish with an output before this goal can be approved");
      }
    }
    const ownerAgentId = input.ownerAgentId === undefined ? existing.ownerAgentId : input.ownerAgentId === null ? null : text(input.ownerAgentId, "ownerAgentId", 200);
    if (ownerAgentId && !await this.studio.getAgent(ownerAgentId, principal)) throw new ApiError(400, "Owner agent not found");
    return this.organization.saveGoal({ ...existing, status: status as GoalStatus, ownerAgentId, updatedAt: nowIso() });
  }

  async delegate(goalId: string, input: { agentId?: unknown; title?: unknown; parentTaskId?: unknown }, principal: RequestPrincipal) {
    const goal = (await this.organization.goals(principal.tenantId)).find(item => item.id === goalId);
    if (!goal) throw new ApiError(404, "Goal not found");
    if (goal.status !== "active") throw new ApiError(409, "Only active goals can be delegated");
    const agentId = text(input.agentId, "agentId", 200);
    const agent = await this.studio.getAgent(agentId, principal);
    if (!agent || agent.isSystem || agent.tenantId !== principal.tenantId) throw new ApiError(400, "Agent not found");
    if (goal.ownerAgentId) {
      const parents = new Map((await this.organization.reportingLines(principal.tenantId)).map(line => [line.agentId, line.managerAgentId]));
      let cursor: string | null = agentId;
      const seen = new Set<string>();
      while (cursor && cursor !== goal.ownerAgentId && !seen.has(cursor)) { seen.add(cursor); cursor = parents.get(cursor) ?? null; }
      if (cursor !== goal.ownerAgentId) throw new ApiError(403, "Delegate must report through the goal owner");
    }
    const defaults = await ensureTenantProjectWorkspaceDefaults(this.studio, principal);
    const task = await new TaskService(this.studio).create({
      title: input.title === undefined ? goal.title : text(input.title, "title", 200), description: goal.description,
      assignedAgent: agentId, parentTaskId: input.parentTaskId === null || input.parentTaskId === undefined ? null : text(input.parentTaskId, "parentTaskId", 200),
      projectId: goal.projectId ?? defaults.projectId, workspaceId: null, metadata: { organizationGoalId: goal.id },
    }, principal);
    return task;
  }

  async requestStrategyProposal(input: { title?: unknown; brief?: unknown; projectId?: string | null }, principal: RequestPrincipal) {
    const title = text(input.title, "title", 200);
    const brief = text(input.brief, "brief", 4000);
    const ceo = (await this.organization.reportingLines(principal.tenantId)).find(line => line.role === "ceo");
    if (!ceo) throw new ApiError(409, "Configure a CEO agent before requesting strategy");
    const agent = await this.studio.getAgent(ceo.agentId, principal);
    if (!agent) throw new ApiError(404, "CEO agent not found");
    const goal = await this.createGoal({ title, description: brief, projectId: input.projectId ?? null, ownerAgentId: ceo.agentId, proposedByAgentId: ceo.agentId }, principal);
    const defaults = await ensureTenantProjectWorkspaceDefaults(this.studio, principal);
    try {
      const task = await new TaskService(this.studio).create({
        title: `Strategy proposal: ${title}`.slice(0, 200),
        description: `Propose a concrete strategy for this organization goal. Include measurable outcomes, a delegation plan, and risks. Brief: ${brief}`.slice(0, 2000),
        assignedAgent: ceo.agentId, projectId: goal.projectId ?? defaults.projectId, workspaceId: null,
        metadata: { organizationGoalId: goal.id, strategyProposal: true },
      }, principal);
      return { goal, task };
    } catch (error) {
      await this.organization.saveGoal({ ...goal, status: "cancelled", updatedAt: nowIso() });
      throw error;
    }
  }
}
