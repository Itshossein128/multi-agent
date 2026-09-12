import { Hono } from "hono";
import type { StudioStore } from "../../../../src/studio/contracts";
import { RunExecutor } from "../runtime/runExecutor";
import type { MemoryAccessResolver } from "../memory/access";
import { type PrincipalResolver, type RequestPrincipal } from "../auth/principal";
interface RunVariables {
    principal: RequestPrincipal | undefined;
}
export declare function createRunsRouter(executor?: RunExecutor, resolveMemoryAccess?: MemoryAccessResolver, studioStore?: StudioStore, resolvePrincipal?: PrincipalResolver): {
    app: Hono<{
        Variables: RunVariables;
    }, import("hono/types").BlankSchema, "/">;
    executor: RunExecutor;
};
export {};
