import type { AgentRecord, ToolRecord } from "@multi-agent/types";
import {
  DEFAULT_STUDIO_TASK_TOOL_AUTHORIZED_AGENT_IDS,
  STUDIO_TASK_TOOL_NAME,
  StudioTaskToolExecutor,
} from "./studioTaskToolExecutor";
import { ToolExecutorFactory } from "./toolExecutorFactory";
import { ToolRuntime } from "./toolRuntime";
import type {
  StudioTaskToolAction,
  StudioTaskToolInput,
  StudioTaskToolOutput,
} from "./types";
import type { StudioStore } from "../studio/contracts";
import type { OrganizationScopeRunner } from "../studio/infrastructure/organizationJobScope";

export interface LeadOrchestratorBoardInvocation {
  tool: ToolRecord;
  action: StudioTaskToolAction;
  params?: Record<string, unknown>;
  tenantId: string;
  agent: Pick<AgentRecord, "id" | "tools">;
  runId?: string;
  approvalGranted?: boolean;
}

/**
 * Callable path from the seeded Lead Orchestrator into studio_task_tool.
 * Enforces agent tool grants / allow-list authorization before mutating the board.
 */
export async function invokeLeadOrchestratorBoardAction(
  invocation: LeadOrchestratorBoardInvocation,
  options: {
    store: StudioStore;
    scope?: OrganizationScopeRunner;
    runtime?: Pick<ToolRuntime, "execute">;
  },
): Promise<StudioTaskToolOutput> {
  const tools = invocation.agent.tools ?? [];
  if (!tools.includes(STUDIO_TASK_TOOL_NAME) && !DEFAULT_STUDIO_TASK_TOOL_AUTHORIZED_AGENT_IDS.includes(invocation.agent.id)) {
    return {
      success: false,
      action: invocation.action,
      error: {
        code: "UNAUTHORIZED_ACTION",
        message: `Agent "${invocation.agent.id}" is not authorized to invoke ${STUDIO_TASK_TOOL_NAME}.`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  const factory = new ToolExecutorFactory(undefined, options.store, options.scope);
  const runtime = options.runtime ?? new ToolRuntime(30_000, true, factory);

  const input: StudioTaskToolInput = invocation.params
    ? ({ action: invocation.action, params: invocation.params } as StudioTaskToolInput)
    : ({ action: invocation.action } as StudioTaskToolInput);

  const result = await runtime.execute(
    invocation.tool,
    input as unknown as Record<string, unknown>,
    undefined,
    {
      runId: invocation.runId,
      credentialPrincipal: {
        tenantId: invocation.tenantId,
        principalId: invocation.agent.id,
      },
      agentId: invocation.agent.id,
      authorizedToolIds: tools.includes(STUDIO_TASK_TOOL_NAME) ? tools : [STUDIO_TASK_TOOL_NAME, ...tools],
      approvalGranted: invocation.approvalGranted ?? true,
      idempotencyKey: invocation.runId
        ? `${invocation.runId}:${invocation.agent.id}:${invocation.action}:${JSON.stringify(invocation.params ?? {})}`
        : undefined,
    },
  );

  return result as StudioTaskToolOutput;
}

export function createAuthorizedStudioTaskToolExecutor(
  store: StudioStore,
  scope?: OrganizationScopeRunner,
): StudioTaskToolExecutor {
  return new StudioTaskToolExecutor(store, scope, {
    allowedAgentIds: DEFAULT_STUDIO_TASK_TOOL_AUTHORIZED_AGENT_IDS,
    enforceAuthorization: true,
  });
}
