import { Hono } from "hono";
import type { StudioStore } from "../../../../src/studio/contracts";
import { type PrincipalResolver } from "../auth/principal";
import { type PrincipalVariables } from "./shared/http";
export declare function createStudioRouter(store: StudioStore, resolvePrincipal?: PrincipalResolver): Hono<{
    Variables: PrincipalVariables;
}, import("hono/types").BlankSchema, "/">;
