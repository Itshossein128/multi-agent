import type { ToolRecord } from "@multi-agent/types";
import type { ToolExecutor } from "./types";
export declare class ToolExecutorFactory {
    create(category: ToolRecord["category"]): ToolExecutor;
}
export declare const toolExecutorFactory: ToolExecutorFactory;
