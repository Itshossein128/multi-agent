import { Hono } from "hono";
import { RunExecutor } from "../runtime/runExecutor";
import type { MemoryAccessResolver } from "../memory/access";
export declare function createRunsRouter(executor?: RunExecutor, resolveMemoryAccess?: MemoryAccessResolver): {
    app: Hono<import("hono/types").BlankEnv, import("hono/types").BlankSchema, "/">;
    executor: RunExecutor;
};
