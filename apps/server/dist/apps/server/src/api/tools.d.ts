import { Hono } from "hono";
import { type ToolRecord } from "@multi-agent/types";
export interface ToolTestRequest {
    tool: ToolRecord;
    input: Record<string, unknown>;
}
export declare function createToolsRouter(): Hono<import("hono/types").BlankEnv, import("hono/types").BlankSchema, "/">;
