import { Hono } from "hono";
import type { StudioStore, StudioTask } from "../../../../src/studio/contracts";
import { resolveRequestPrincipal } from "../auth/principal";
import type { PrincipalResolver } from "../auth/authorization";
import { requirePrincipal, respondWithApiError, type PrincipalVariables } from "./shared/http";
import { WorkflowService } from "./studio/workflowService";
import { AgentService } from "./studio/agentService";
import { StudioToolService } from "./studio/toolService";
import { TaskService } from "./studio/taskService";
import { WorkspaceService } from "./studio/workspaceService";
import { ProjectService, WorkspaceEntityService } from "./studio/projectService";
import { registerWorkflowRoutes } from "./studio/workflowRoutes";
import { registerAgentRoutes } from "./studio/agentRoutes";
import { registerToolRoutes } from "./studio/toolRoutes";
import { registerTaskRoutes } from "./studio/taskRoutes";
import { registerWorkspaceRoutes } from "./studio/workspaceRoutes";
import { registerProjectRoutes } from "./studio/projectRoutes";
import { registerWorkspaceEntityRoutes } from "./studio/workspaceEntityRoutes";
import { registerTaskCommentRoutes } from "./studio/taskCommentRoutes";
import { registerRoutineRoutes } from "./studio/routineRoutes";
import { registerWebhookTriggerRoutes } from "./studio/webhookTriggerRoutes";
import { OrganizationProfileService } from "./studio/organizationProfileService";
import { registerOrganizationProfileRoutes } from "./studio/organizationProfileRoutes";
import { InMemoryOrganizationStore, type OrganizationStore } from "../organization/organizationStore";
import { OrganizationService } from "../organization/organizationService";
import type { OrganizationUnitOfWork } from "../organization/organizationUnitOfWork";
import { registerOrganizationRoutes } from "../organization/organizationRoutes";
import { InMemoryBudgetStore, type BudgetStore } from "../budgets/budgetStore";
import { BudgetService } from "../budgets/budgetService";
import { registerBudgetRoutes } from "../budgets/budgetRoutes";

import type { RunExecutor } from "../runtime/runExecutor";

export function createStudioRouter(
  store: StudioStore,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
  executor?: RunExecutor,
  organizationStore: OrganizationStore = new InMemoryOrganizationStore(),
  budgetStore: BudgetStore = new InMemoryBudgetStore(),
  organizationUnitOfWork?: OrganizationUnitOfWork,
) {
  const app = new Hono<{ Variables: PrincipalVariables }>();
  const workflows = new WorkflowService(store);
  const agents = new AgentService(store);
  const tools = new StudioToolService(store);
  const tasks = new TaskService(store, executor);
  const workspace = new WorkspaceService(store);
  const projects = new ProjectService(store);
  const workspaceEntities = new WorkspaceEntityService(store);
  const organizationProfiles = new OrganizationProfileService(store);
  app.use("/*", requirePrincipal(resolvePrincipal));
  app.onError(respondWithApiError);

  // Delegate route registration to domain-specific modules (SRP + OCP).
  registerWorkflowRoutes(app, workflows);
  registerAgentRoutes(app, agents);
  registerToolRoutes(app, tools);
  registerTaskRoutes(app, tasks);
  registerWorkspaceRoutes(app, workspace);
  registerProjectRoutes(app, projects);
  registerWorkspaceEntityRoutes(app, workspaceEntities);
  registerOrganizationProfileRoutes(app, organizationProfiles);
  registerTaskCommentRoutes(app, store);
  registerRoutineRoutes(app, store);
  registerWebhookTriggerRoutes(app, store);
  registerOrganizationRoutes(app, new OrganizationService(organizationStore, store, executor, organizationUnitOfWork));
  registerBudgetRoutes(app, new BudgetService(budgetStore, store));

  return app;
}
