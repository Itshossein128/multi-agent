import type { Hono } from "hono";
import type { PrincipalVariables } from "../api/shared/http";
import type { BudgetService } from "./budgetService";
import { ApiError } from "../api/shared/http";

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "Expected a JSON object");
  return value as Record<string, unknown>;
}

export function registerBudgetRoutes(app: Hono<{ Variables: PrincipalVariables }>, service: BudgetService) {
  app.get("/budgets", async c => c.json(await service.overview(c.get("principal"))));
  app.put("/budgets", async c => c.json(await service.configure(await bodyObject(c.req.raw), c.get("principal"))));
}
