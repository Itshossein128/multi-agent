import { Hono } from "hono";
import { RunExecutor } from "../runtime/runExecutor";
import type { MemoryAccessResolver } from "../memory/access";
import type { StudioStore } from "../../../../src/studio/contracts";
import { type PrincipalResolver, type RequestPrincipal } from "../auth/principal";
export declare function createRunsRouter(executor?: RunExecutor, resolveMemoryAccess?: MemoryAccessResolver, studioStore?: StudioStore, resolvePrincipal?: PrincipalResolver): {
    app: Hono<{
        Variables: {
            principal: RequestPrincipal;
        };
    }, import("hono/types").BlankSchema, "/">;
    executor: RunExecutor;
};
