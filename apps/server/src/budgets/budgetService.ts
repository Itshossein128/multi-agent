import type { StudioStore } from "../../../../src/studio/contracts";
import type { RequestPrincipal } from "../auth/principal";
import { ApiError } from "../api/shared/http";
import type { BudgetScope, BudgetStore } from "./budgetStore";

const scopes = new Set(["company", "agent", "project"]);

export class BudgetService {
  constructor(private readonly budgets: BudgetStore, private readonly studio: StudioStore) {}
  async overview(principal: RequestPrincipal) {
    const [budgets, alerts] = await Promise.all([this.budgets.list(principal.tenantId), this.budgets.alerts(principal.tenantId)]);
    return { budgets, alerts };
  }
  async configure(body: { scope?: unknown; scopeId?: unknown; limitUsd?: unknown; thresholdPercent?: unknown }, principal: RequestPrincipal) {
    if (typeof body.scope !== "string" || !scopes.has(body.scope)) throw new ApiError(400, "Invalid budget scope");
    const scope = body.scope as BudgetScope;
    const scopeId = scope === "company" ? principal.tenantId : body.scopeId;
    if (typeof scopeId !== "string" || !scopeId || scopeId.length > 200) throw new ApiError(400, "Invalid scopeId");
    if (scope === "agent" && !await this.studio.getAgent(scopeId, principal)) throw new ApiError(404, "Agent not found");
    if (scope === "project" && !await this.studio.getProject(scopeId, principal)) throw new ApiError(404, "Project not found");
    if (typeof body.limitUsd !== "number" || !Number.isFinite(body.limitUsd) || body.limitUsd < 0.000001 || body.limitUsd > 1_000_000) throw new ApiError(400, "limitUsd must be from 0.000001 to 1000000");
    const thresholdPercent = body.thresholdPercent ?? 80;
    if (typeof thresholdPercent !== "number" || !Number.isInteger(thresholdPercent) || thresholdPercent < 1 || thresholdPercent > 100) throw new ApiError(400, "thresholdPercent must be from 1 to 100");
    return this.budgets.setBudget({ tenantId: principal.tenantId, scope, scopeId, limitUsd: body.limitUsd, thresholdPercent });
  }
}
