import { assertNoCredentials, migrateToolRecord, validateTool, type ToolRecord } from "@multi-agent/types";
import { ToolRuntime, UnsupportedToolCategoryError } from "../../../../../src/tools";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { authorizeToolOrAgent } from "../../auth/principal";
import { ApiError } from "../shared/http";

export interface ToolTestRequest {
  tool?: ToolRecord;
  toolId?: string;
  input: Record<string, unknown>;
}

export interface ToolExecutor {
  execute(tool: ToolRecord, input: Record<string, unknown>): Promise<unknown>;
}

export class ToolTestService {
  constructor(
    private readonly runtime: ToolExecutor = new ToolRuntime(),
    private readonly studioStore?: Pick<StudioStore, "getTool">,
  ) {}

  async execute(request: ToolTestRequest, principal: RequestPrincipal) {
    this.validateRequest(request);
    let tool: ToolRecord | null = null;
    const targetId = request.toolId ?? request.tool?.id;

    if (targetId && this.studioStore) {
      const stored = await this.studioStore.getTool(targetId);
      if (stored) {
        if (!authorizeToolOrAgent(principal, stored, "execute")) throw new ApiError(404, "Access denied to tool.");
        tool = stored;
      }
    }
    if (request.tool) {
      assertNoCredentials(request.tool);
      tool = migrateToolRecord(request.tool);
    }
    if (!tool) throw new ApiError(404, "Tool not found");
    const errors = validateTool(tool);
    if (errors.length) throw new ApiError(400, errors.join(" "));

    try {
      return { output: await this.runtime.execute(tool, request.input) };
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
