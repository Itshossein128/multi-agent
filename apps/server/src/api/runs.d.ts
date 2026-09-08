import { Hono } from "hono";
import { RunExecutor } from "../runtime/runExecutor";
export declare function createRunsRouter(executor?: RunExecutor): {
    app: Hono<import("hono/types").BlankEnv, import("hono/types").BlankSchema, "/">;
    executor: RunExecutor;
};
