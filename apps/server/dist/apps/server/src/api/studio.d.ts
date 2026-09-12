import { Hono } from "hono";
import type { StudioStore } from "../../../../src/studio/contracts";
import { type PrincipalResolver } from "../auth/principal";
import { type PrincipalVariables } from "./shared/http";
import type { RunExecutor } from "../runtime/runExecutor";
export declare function createStudioRouter(store: StudioStore, resolvePrincipal?: PrincipalResolver, executor?: RunExecutor): Hono<{
    Variables: PrincipalVariables;
}, import("hono/types").BlankSchema, "/">;
