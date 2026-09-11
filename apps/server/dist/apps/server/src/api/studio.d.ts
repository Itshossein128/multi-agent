import { Hono } from "hono";
import type { StudioStore } from "../../../../src/studio/contracts";
import { type PrincipalResolver, type RequestPrincipal } from "../auth/principal";
export declare function createStudioRouter(store: StudioStore, resolvePrincipal?: PrincipalResolver): Hono<{
    Variables: {
        principal: RequestPrincipal;
    };
}, import("hono/types").BlankSchema, "/">;
