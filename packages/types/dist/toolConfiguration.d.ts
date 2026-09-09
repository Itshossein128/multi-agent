export type ToolCategory = "function" | "http" | "database" | "search" | "file" | "mcp" | "cli" | "custom";
export declare const TOOL_CATEGORIES: ToolCategory[];
/** Side-effect classification — the "permissions/security metadata" the Tool Model calls for. */
export type ToolImpact = "read-only" | "write" | "external" | "high-impact";
export declare const TOOL_IMPACTS: ToolImpact[];
export interface ToolRecord {
    id: string;
    name: string;
    description: string;
    category: ToolCategory;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    configuration: Record<string, string | number | boolean>;
    enabled: boolean;
    impact: ToolImpact;
    metadata: Record<string, string | number | boolean>;
    createdAt: string;
    updatedAt: string;
}
export declare function createToolRecord(input?: {
    name?: string;
    category?: ToolCategory;
    description?: string;
}): ToolRecord;
/** Normalize persisted / inbound tool records to the current schema. */
export declare function migrateToolRecord(raw: unknown): ToolRecord;
export declare function validateTool(tool: ToolRecord): string[];
