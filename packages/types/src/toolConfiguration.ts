import { credentialIssues } from "./agentConfiguration";

// Local copies of index.ts's uid/nowIso to avoid a circular module dependency
// (index.ts re-exports from this file).
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string {
  return new Date().toISOString();
}

export type ToolCategory =
  | "function"
  | "http"
  | "database"
  | "search"
  | "file"
  | "mcp"
  | "cli"
  | "custom";

export const TOOL_CATEGORIES: ToolCategory[] = [
  "function",
  "http",
  "database",
  "search",
  "file",
  "mcp",
  "cli",
  "custom",
];

/** Side-effect classification — the "permissions/security metadata" the Tool Model calls for. */
export type ToolImpact = "read-only" | "write" | "external" | "high-impact";

export const TOOL_IMPACTS: ToolImpact[] = ["read-only", "write", "external", "high-impact"];

export interface ToolExecutionPolicy {
  /** Side-effecting execution must be explicitly enabled/approved by the server. */
  requiresApproval: boolean;
  /** Required keys make retries/replays return the first result instead of executing twice. */
  idempotency: "required" | "optional" | "none";
  /** Whether the runtime may retry this tool after a transport failure. */
  retryable: boolean;
}

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
  executionPolicy?: ToolExecutionPolicy;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  tenantId?: string;
  isSystem?: boolean;
}

export function createToolRecord(input?: {
  name?: string;
  category?: ToolCategory;
  description?: string;
}): ToolRecord {
  const stamp = nowIso();
  return {
    id: uid("tool"),
    name: input?.name ?? "New Tool",
    description: input?.description ?? "",
    category: input?.category ?? "function",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    configuration: {},
    enabled: true,
    impact: "read-only",
    executionPolicy: { requiresApproval: false, idempotency: "optional", retryable: true },
    metadata: {},
    createdAt: stamp,
    updatedAt: stamp,
  };
}

interface LegacyToolRecord {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  configuration?: unknown;
  enabled?: boolean;
  impact?: string;
  executionPolicy?: unknown;
  metadata?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { type: "object", properties: {} };
}

function asConfiguration(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => ["string", "number", "boolean"].includes(typeof v)
  ) as [string, string | number | boolean][];
  return Object.fromEntries(entries);
}

/** Normalize persisted / inbound tool records to the current schema. */
export function migrateToolRecord(raw: unknown): ToolRecord {
  const record = (raw ?? {}) as LegacyToolRecord;
  const stamp = nowIso();
  const impact = TOOL_IMPACTS.includes(record.impact as ToolImpact) ? (record.impact as ToolImpact) : "read-only";
  const policy = record.executionPolicy && typeof record.executionPolicy === "object" && !Array.isArray(record.executionPolicy)
    ? record.executionPolicy as Record<string, unknown> : undefined;
  return {
    id: typeof record.id === "string" && record.id ? record.id : uid("tool"),
    name: typeof record.name === "string" && record.name.trim() ? record.name : "New Tool",
    description: typeof record.description === "string" ? record.description : "",
    category: TOOL_CATEGORIES.includes(record.category as ToolCategory) ? (record.category as ToolCategory) : "function",
    inputSchema: asJsonObject(record.inputSchema),
    outputSchema: asJsonObject(record.outputSchema),
    configuration: asConfiguration(record.configuration),
    enabled: record.enabled !== false,
    impact,
    executionPolicy: {
      requiresApproval: typeof policy?.requiresApproval === "boolean" ? policy.requiresApproval : impact !== "read-only",
      idempotency: policy?.idempotency === "required" || policy?.idempotency === "none" ? policy.idempotency : impact === "read-only" ? "optional" : "required",
      retryable: typeof policy?.retryable === "boolean" ? policy.retryable : impact === "read-only",
    },
    metadata: asConfiguration(record.metadata),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : stamp,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : stamp,
  };
}

export function validateTool(tool: ToolRecord): string[] {
  const errors = credentialIssues(tool);
  if (typeof tool?.name !== "string" || !tool.name.trim()) errors.push("Tool name is required.");
  if (!TOOL_CATEGORIES.includes(tool?.category)) errors.push("A valid tool category is required.");
  if (!TOOL_IMPACTS.includes(tool?.impact)) errors.push("A valid tool impact/permission level is required.");
  if (tool.executionPolicy !== undefined && (!tool.executionPolicy || typeof tool.executionPolicy !== "object" || !["required", "optional", "none"].includes(tool.executionPolicy.idempotency) || typeof tool.executionPolicy.requiresApproval !== "boolean" || typeof tool.executionPolicy.retryable !== "boolean")) errors.push("Tool executionPolicy must declare approval, idempotency, and retry behavior.");
  if (tool.enabled !== undefined && typeof tool.enabled !== "boolean") errors.push("Enabled must be a boolean.");
  if (typeof tool.description !== "string") errors.push("Description must be a string.");
  if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) errors.push("Input schema must be a JSON object.");
  if (!tool.outputSchema || typeof tool.outputSchema !== "object" || Array.isArray(tool.outputSchema)) errors.push("Output schema must be a JSON object.");
  if (!tool.configuration || typeof tool.configuration !== "object" || Array.isArray(tool.configuration) || Object.entries(tool.configuration).some(([key, value]) => !key.trim() || !["string", "number", "boolean"].includes(typeof value))) errors.push("Configuration values must be strings, numbers, or booleans.");
  if (!tool.metadata || typeof tool.metadata !== "object" || Array.isArray(tool.metadata) || Object.entries(tool.metadata).some(([key, value]) => !key.trim() || !["string", "number", "boolean"].includes(typeof value))) errors.push("Metadata values must be strings, numbers, or booleans.");
  return errors;
}
