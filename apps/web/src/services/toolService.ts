import type { ToolRecord } from "@multi-agent/types";
import { requestJson } from "./requestJson";

export const toolService = {
  testTool(tool: ToolRecord, input: Record<string, unknown>) {
    return requestJson<{ output: Record<string, unknown> }>("/tools/test", { method: "POST", body: JSON.stringify({ tool, input }) });
  },
};
