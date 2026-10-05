import { assertNoCredentials, migrateToolRecord, validateTool, type ToolRecord } from "@multi-agent/types";
import { ToolRuntime, UnsupportedToolCategoryError } from "../../../../../src/tools";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { authorizeToolOrAgent } from "../../auth/authorization";
import { ApiError } from "../shared/http";
import { randomUUID } from "node:crypto";

export interface ToolTestRequest {
  tool?: ToolRecord;
  toolId?: string;
  input: Record<string, unknown>;
}

export class ToolTestService {
  constructor(
    private readonly runtime: Pick<ToolRuntime, "execute"> = new ToolRuntime(),
    private readonly studioStore?: Pick<StudioStore, "getTool">,
  ) {}

  async execute(request: ToolTestRequest, principal: RequestPrincipal) {
    this.validateRequest(request);
    let tool: ToolRecord | null = null;
    const targetId = request.toolId ?? request.tool?.id;

    if (this.studioStore) {
      if (!targetId) throw new ApiError(404, "Tool not found");
      const stored = await this.studioStore.getTool(targetId, principal);
      if (!stored || !authorizeToolOrAgent(principal, stored, "execute")) {
        throw new ApiError(404, "Access denied to tool.");
      }
      // The registry is authoritative. Never execute browser-supplied changes
      // to category, configuration, impact, or enabled state for a saved id.
      tool = stored;
    } else if (request.tool) {
      assertNoCredentials(request.tool);
      tool = migrateToolRecord(request.tool);
    }
    if (!tool) throw new ApiError(404, "Tool not found");
    const errors = validateTool(tool);
    if (errors.length) throw new ApiError(400, errors.join(" "));

    try {
      const runId = `tool-test-${randomUUID()}`;
      return { output: await this.runtime.execute(tool, request.input, undefined, { runId, idempotencyKey: runId, credentialPrincipal: { tenantId: principal.tenantId, principalId: principal.userId } }) };
    } catch (error) {
      if (error instanceof UnsupportedToolCategoryError) throw new ApiError(400, error.message);
      throw error;
    }
  }

  private validateRequest(request: ToolTestRequest) {
    if ((!request?.tool && !request?.toolId) || !request.input || typeof request.input !== "object" || Array.isArray(request.input)) {
      throw new ApiError(400, "tool and sample input object are required");
    }
  }
}
