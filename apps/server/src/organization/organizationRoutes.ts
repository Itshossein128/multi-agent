import type { Hono } from "hono";
import type { PrincipalVariables } from "../api/shared/http";
import type { OrganizationService } from "./organizationService";
import { ApiError } from "../api/shared/http";

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "Expected a JSON object");
  return value as Record<string, unknown>;
}

export function registerOrganizationRoutes(app: Hono<{ Variables: PrincipalVariables }>, service: OrganizationService) {
  app.get("/organization", async c => c.json(await service.overview(c.get("principal"))));
  app.put("/organization/agents/:id", async c => c.json(await service.setReportingLine(c.req.param("id"), await bodyObject(c.req.raw), c.get("principal"))));
  app.post("/organization/goals", async c => {
    const input = await bodyObject(c.req.raw);
    delete input.proposedByAgentId;
    return c.json(await service.createGoal(input, c.get("principal")), 201);
  });
  app.post("/organization/strategy", async c => c.json(await service.requestStrategyProposal(await bodyObject(c.req.raw), c.get("principal")), 201));
  app.patch("/organization/goals/:id", async c => c.json(await service.updateGoal(c.req.param("id"), await bodyObject(c.req.raw), c.get("principal"))));
  app.post("/organization/goals/:id/delegate", async c => c.json(await service.delegate(c.req.param("id"), await bodyObject(c.req.raw), c.get("principal")), 201));
}
