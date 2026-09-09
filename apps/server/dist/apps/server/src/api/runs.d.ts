import { Hono } from "hono";
import { RunExecutor } from "../runtime/runExecutor";
import type { MemoryAccessResolver } from "../memory/access";
import type { StudioStore } from "../../../../src/studio/contracts";
export declare function createRunsRouter(executor?: RunExecutor, resolveMemoryAccess?: MemoryAccessResolver, studioStore?: StudioStore): {
    app: Hono<import("hono/types").BlankEnv, import("hono/types").BlankSchema, "/">;
    executor: RunExecutor;
};
