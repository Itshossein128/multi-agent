import { type RunEvent } from "@multi-agent/types";
import type { AgentExecutionEvent } from "./types";
/** Map executor-boundary events into the Phase 4 RunEvent stream. */
export declare function mapAgentExecutionEvent(event: AgentExecutionEvent, runId: string): RunEvent[];
