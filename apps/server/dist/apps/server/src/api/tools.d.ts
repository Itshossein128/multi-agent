import { Hono } from "hono";
import { ToolRuntime } from "../../../../src/tools";
import type { StudioStore } from "../../../../src/studio/contracts";
import { type PrincipalResolver } from "../auth/principal";
import { type PrincipalVariables } from "./shared/http";
export type { ToolTestRequest } from "./tools/toolTestService";
export declare function createToolsRouter(runtime?: Pick<ToolRuntime, "execute">, studioStore?: StudioStore, resolvePrincipal?: PrincipalResolver): Hono<{
    Variables: PrincipalVariables;
}, import("hono/types").BlankSchema, "/">;
