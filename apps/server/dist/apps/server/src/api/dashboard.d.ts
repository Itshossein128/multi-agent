import { Hono } from "hono";
import type { RunStoreContract } from "../runtime/runStore";
import type { StudioStore } from "../../../../src/studio/contracts";
import type { RunExecutor } from "../runtime/runExecutor";
import { type PrincipalResolver } from "../auth/principal";
import { type PrincipalVariables } from "./shared/http";
export * from "./dashboard/models";
export declare function createDashboardRouter(runStore: RunStoreContract, studioStore?: StudioStore, executor?: RunExecutor, resolvePrincipal?: PrincipalResolver): Hono<{
    Variables: PrincipalVariables;
}, import("hono/types").BlankSchema, "/">;
