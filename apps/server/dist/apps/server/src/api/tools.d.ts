import { Hono } from "hono";
import { type ToolRecord } from "@multi-agent/types";
import { ToolRuntime } from "../../../../src/tools";
import type { StudioStore } from "../../../../src/studio/contracts";
import { type PrincipalResolver, type RequestPrincipal } from "../auth/principal";
export interface ToolTestRequest {
    tool?: ToolRecord;
    toolId?: string;
    input: Record<string, unknown>;
}
export declare function createToolsRouter(runtime?: Pick<ToolRuntime, "execute">, studioStore?: StudioStore, resolvePrincipal?: PrincipalResolver): Hono<{
    Variables: {
        principal: RequestPrincipal;
    };
}, import("hono/types").BlankSchema, "/">;
