import type { ToolRecord } from "@multi-agent/types";
import { FunctionToolExecutor } from "./functionToolExecutor";
import { HttpToolExecutor } from "./httpToolExecutor";
import { NotImplementedToolExecutor } from "./notImplementedToolExecutor";
import type { ToolExecutor } from "./types";
import { DatabaseToolExecutor } from "./databaseToolExecutor";
import { SearchToolExecutor } from "./searchToolExecutor";
import { McpToolExecutor } from "./mcpToolExecutor";
import type { CredentialGateway } from "../security/credentialGateway";
import { credentialGatewayFromEnvironment } from "../security/credentialGateway";

export class ToolExecutorFactory {
  constructor(private readonly gateway?: CredentialGateway) {}
  create(category: ToolRecord["category"]): ToolExecutor {
    if (category === "function") return new FunctionToolExecutor();
    if (category === "http") return new HttpToolExecutor();
    if (category === "database") return new DatabaseToolExecutor(this.gateway);
    if (category === "search") return new SearchToolExecutor(this.gateway);
    if (category === "mcp") return new McpToolExecutor(this.gateway);
    return new NotImplementedToolExecutor(category);
  }
}

export const toolExecutorFactory = new ToolExecutorFactory(credentialGatewayFromEnvironment());
