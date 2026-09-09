import { Hono } from "hono";
import { type MemoryAccessContext, type MemoryService } from "../../../../src/memory/contracts";
import type { MemoryAccessResolver } from "../memory/access";
export declare function createMemoriesRouter(service: MemoryService | undefined, resolveAccess: MemoryAccessResolver): Hono<{
    Variables: {
        memoryAccess: MemoryAccessContext;
    };
}, import("hono/types").BlankSchema, "/">;
