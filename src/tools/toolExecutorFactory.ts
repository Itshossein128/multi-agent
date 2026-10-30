import type { ToolRecord } from "@multi-agent/types";
import { FunctionToolExecutor } from "./functionToolExecutor";
import { HttpToolExecutor } from "./httpToolExecutor";
import { NotImplementedToolExecutor } from "./notImplementedToolExecutor";
import type { ToolExecutor } from "./types";
import { DatabaseToolExecutor } from "./databaseToolExecutor";
import { SearchToolExecutor } from "./searchToolExecutor";
import { McpToolExecutor } from "./mcpToolExecutor";
import { StudioTaskToolExecutor } from "./studioTaskToolExecutor";
import type { StudioStore } from "../studio/contracts";
import type { CredentialGateway } from "../security/credentialGateway";
import { credentialGatewayFromEnvironment } from "../security/credentialGateway";

export class ToolExecutorFactory {
  constructor(
    private readonly gateway?: CredentialGateway,
    private readonly studioStore?: StudioStore,
  ) {}

  create(
    category: ToolRecord["category"] | "studio_task_tool",
    toolNameOrRecord?: string | ToolRecord,
  ): ToolExecutor {
    const toolName = typeof toolNameOrRecord === "string" ? toolNameOrRecord : toolNameOrRecord?.name;
    if (category === "studio_task_tool" || toolName === "studio_task_tool") {
      return new StudioTaskToolExecutor(this.studioStore);
    }
    if (category === "function") return new FunctionToolExecutor();
    if (category === "http") return new HttpToolExecutor();
    if (category === "database") return new DatabaseToolExecutor(this.gateway);
    if (category === "search") return new SearchToolExecutor(this.gateway);
    if (category === "mcp") return new McpToolExecutor(this.gateway);
    return new NotImplementedToolExecutor(category);
  }

  createStudioTaskToolExecutor(): StudioTaskToolExecutor {
    return new StudioTaskToolExecutor(this.studioStore);
  }
}

export const toolExecutorFactory = new ToolExecutorFactory(credentialGatewayFromEnvironment());
