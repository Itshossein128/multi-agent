import { Hono } from "hono";
import type { StudioStore } from "../../../../src/studio/contracts";
export declare function createStudioRouter(store: StudioStore): Hono<import("hono/types").BlankEnv, import("hono/types").BlankSchema, "/">;
