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
import { registerWorkflowRoutes } from "./studio/workflowRoutes";
import { registerAgentRoutes } from "./studio/agentRoutes";
import { registerToolRoutes } from "./studio/toolRoutes";
import { registerTaskRoutes } from "./studio/taskRoutes";
import { registerWorkspaceRoutes } from "./studio/workspaceRoutes";

import type { RunExecutor } from "../runtime/runExecutor";

export function createStudioRouter(
  store: StudioStore,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
  executor?: RunExecutor,
) {
  const app = new Hono<{ Variables: PrincipalVariables }>();
  const workflows = new WorkflowService(store);
  const agents = new AgentService(store);
  const tools = new StudioToolService(store);
  const tasks = new TaskService(store, executor);
  const workspace = new WorkspaceService(store);
  app.use("/*", requirePrincipal(resolvePrincipal));
  app.onError(respondWithApiError);

  // Delegate route registration to domain-specific modules (SRP + OCP).
  registerWorkflowRoutes(app, workflows);
  registerAgentRoutes(app, agents);
  registerToolRoutes(app, tools);
  registerTaskRoutes(app, tasks);
  registerWorkspaceRoutes(app, workspace);

  return app;
}
