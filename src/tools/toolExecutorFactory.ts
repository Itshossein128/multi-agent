import type { ToolRecord } from "@multi-agent/types";
import { FunctionToolExecutor } from "./functionToolExecutor";
import { HttpToolExecutor } from "./httpToolExecutor";
import { NotImplementedToolExecutor } from "./notImplementedToolExecutor";
import type { ToolExecutor } from "./types";

export class ToolExecutorFactory {
  create(category: ToolRecord["category"]): ToolExecutor {
    if (category === "function") return new FunctionToolExecutor();
    if (category === "http") return new HttpToolExecutor();
    return new NotImplementedToolExecutor(category);
  }
}

export const toolExecutorFactory = new ToolExecutorFactory();
