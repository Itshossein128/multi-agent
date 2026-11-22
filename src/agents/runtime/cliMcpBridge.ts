/**
 * Run-scoped loopback HTTP bridge exposing Studio ToolRuntime tools to local
 * CLI workers (e.g. Codex CLI) over an ephemeral stdio MCP server.
 *
 * Security invariants:
 * - Binds strictly to 127.0.0.1 on an OS-assigned ephemeral port.
 * - Requires a per-invocation 256-bit bearer token verified in constant time.
 * - Exposes only `resolvedTools` (already filtered to agent ∩ enabled ∩ activeTools).
 * - Executes every tool call through ToolRuntime.execute (preserving schema
 *   validation, output bounding, approval checks, and audit events).
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { nowIso, type ToolRecord } from "@multi-agent/types";
import type { ToolRuntime } from "../../tools/toolRuntime";
import { ToolPolicyError } from "../../tools/toolRuntime";
import { buildBoundToolSchemas, resolveToolCallName } from "./toolBinding";
import { sanitizeForTelemetry } from "./apiAgentExecutor";
import type { AgentExecutionEvent } from "./types";
import type { TrustedCredentialPrincipal } from "./workerCredentials";

export const STUDIO_MCP_BRIDGE_URL_ENV = "STUDIO_MCP_BRIDGE_URL";
export const STUDIO_MCP_BRIDGE_TOKEN_ENV = "STUDIO_MCP_BRIDGE_TOKEN";
export const STUDIO_MCP_SERVER_NAME = "studio";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_TOOL_TEXT_BYTES = 64 * 1024;

export interface CliMcpBridgeOptions {
  runId: string;
  nodeId: string;
  agentId: string;
  resolvedTools: ToolRecord[];
  toolRuntime: Pick<ToolRuntime, "execute">;
  credentialPrincipal?: TrustedCredentialPrincipal;
  signal?: AbortSignal;
  onEvent?: (event: AgentExecutionEvent) => void;
}

export interface CliMcpBridgeHandle {
  url: string;
  token: string;
  bridgeScriptPath: string;
  env: Record<string, string>;
  codexConfigArgs: (nodeExecutable?: string) => string[];
  close: () => Promise<void>;
}

export function resolveCliMcpStdioBridgeScriptPath(): string {
  const candidates = [
    path.join(__dirname, "cliMcpStdioBridge.cjs"),
    path.resolve(__dirname, "../../../../../src/agents/runtime/cliMcpStdioBridge.cjs"),
    path.resolve(process.cwd(), "src/agents/runtime/cliMcpStdioBridge.cjs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Studio CLI MCP stdio bridge script not found. Checked: ${candidates.join(", ")}`,
  );
}

export function buildCodexMcpBridgeArgs(
  nodeExecutable: string,
  bridgeScriptPath: string,
): string[] {
  return [
    "-c",
    `mcp_servers.${STUDIO_MCP_SERVER_NAME}.command=${JSON.stringify(nodeExecutable)}`,
    "-c",
    `mcp_servers.${STUDIO_MCP_SERVER_NAME}.args=${JSON.stringify([bridgeScriptPath])}`,
    "-c",
    `mcp_servers.${STUDIO_MCP_SERVER_NAME}.env_vars=${JSON.stringify([STUDIO_MCP_BRIDGE_URL_ENV, STUDIO_MCP_BRIDGE_TOKEN_ENV])}`,
  ];
}

/**
 * Insert Codex `-c` overrides in the position accepted by both
 * `codex exec ... -` and `codex exec ... resume ... <sessionId> -`.
 */
export function appendCodexMcpConfigArgs(args: string[], mcpConfigArgs: string[]): string[] {
  if (!mcpConfigArgs.length) return [...args];
  const next = [...args];
  const endsWithDash = next[next.length - 1] === "-";
  const isResume = next.includes("resume");
  if (isResume && endsWithDash && next.length >= 3) {
    next.splice(next.length - 2, 0, ...mcpConfigArgs);
    return next;
  }
  if (endsWithDash) {
    next.splice(next.length - 1, 0, ...mcpConfigArgs);
    return next;
  }
  next.push(...mcpConfigArgs);
  return next;
}

export function formatCliMcpToolsPromptSection(tools: ToolRecord[]): string {
  const bound = buildBoundToolSchemas(tools);
  if (bound.length === 0) return "";
  const lines = [
    `AVAILABLE STUDIO MCP TOOLS (server "${STUDIO_MCP_SERVER_NAME}"):`,
    "The following Studio tools are registered as MCP tools for this run. Prefer calling them directly instead of manual shell fallbacks:",
  ];
  for (const schema of bound) {
    const desc = schema.description.trim();
    lines.push(`- ${schema.callName}${desc ? `: ${desc}` : ""}`);
  }
  return lines.join("\n");
}

function approvalGrantedForTool(tool: ToolRecord): boolean {
  if (tool.impact === "read-only") return true;
  return tool.executionPolicy?.requiresApproval === false;
}

function normalizeInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") {
    return {
      properties: {},
      ...schema,
    };
  }
  return {
    type: "object",
    properties: {},
    ...schema,
  };
}

function serializeToolResult(output: unknown): string {
  const serialized = typeof output === "string" ? output : JSON.stringify(output ?? {});
  if (serialized.length <= MAX_TOOL_TEXT_BYTES) return serialized;
  return `${serialized.slice(0, MAX_TOOL_TEXT_BYTES)}\n... [truncated]`;
}

function tokensEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body exceeds maximum size."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("Request body must be a JSON object."));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body, "utf8"),
  });
  res.end(body);
}

export async function startCliMcpBridge(options: CliMcpBridgeOptions): Promise<CliMcpBridgeHandle> {
  const bridgeScriptPath = resolveCliMcpStdioBridgeScriptPath();
  const token = randomBytes(32).toString("hex");
  const boundSchemas = buildBoundToolSchemas(options.resolvedTools);
  const effectiveToolIds = options.resolvedTools.map((tool) => tool.id);
  let callCounter = 0;

  const emit = (type: AgentExecutionEvent["type"], payload: unknown) => {
    options.onEvent?.({
      type,
      timestamp: nowIso(),
      agentId: options.agentId,
      nodeId: options.nodeId,
      runId: options.runId,
      payload,
    });
  };

  const server = http.createServer(async (req, res) => {
    try {
      const authHeader = String(req.headers.authorization ?? "");
      const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!providedToken || !tokensEqual(token, providedToken)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const urlPath = (req.url ?? "/").split("?")[0];

      if (urlPath === "/tools/list") {
        const tools = boundSchemas.map((schema) => ({
          name: schema.callName,
          description: schema.description,
          inputSchema: normalizeInputSchema(schema.inputSchema),
        }));
        sendJson(res, 200, { tools });
        return;
      }

      if (urlPath === "/tools/call") {
        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : "Invalid request" });
          return;
        }

        const toolName = typeof body.name === "string" ? body.name.trim() : "";
        const rawArgs =
          body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
            ? (body.arguments as Record<string, unknown>)
            : {};

        callCounter += 1;
        const toolCallId = `mcp_${callCounter}_${randomUUID().slice(0, 8)}`;
        const sanitizedArgs = sanitizeForTelemetry(rawArgs);

        const resolved = resolveToolCallName(toolName, options.resolvedTools);
        const authorized = resolved && effectiveToolIds.includes(resolved.id) ? resolved : undefined;

        if (!authorized) {
          emit("tool.failed", {
            name: toolName,
            error: `Unauthorized tool call: "${toolName}" is not assigned to this agent.`,
            toolCallId,
            code: "TOOL_UNAUTHORIZED",
            transport: "cli-mcp-bridge",
          });
          sendJson(res, 200, {
            ok: false,
            isError: true,
            content: [{ type: "text", text: `Error: tool "${toolName}" is not authorized for this agent.` }],
          });
          return;
        }

        emit("tool.started", {
          toolId: authorized.id,
          name: authorized.name,
          arguments: sanitizedArgs,
          toolCallId,
          transport: "cli-mcp-bridge",
        });

        const startedAt = Date.now();
        try {
          const output = await options.toolRuntime.execute(
            authorized,
            rawArgs,
            options.signal,
            {
              runId: options.runId,
              credentialPrincipal: options.credentialPrincipal,
              agentId: options.agentId,
              authorizedToolIds: effectiveToolIds,
              idempotencyKey: `${options.runId}:${options.nodeId}:${toolCallId}`,
              approvalGranted: approvalGrantedForTool(authorized),
            },
          );
          const durationMs = Date.now() - startedAt;
          const sanitizedOutput = sanitizeForTelemetry(output);
          emit("tool.completed", {
            toolId: authorized.id,
            name: authorized.name,
            output: sanitizedOutput,
            durationMs,
            toolCallId,
            transport: "cli-mcp-bridge",
          });
          sendJson(res, 200, {
            ok: true,
            isError: false,
            content: [{ type: "text", text: serializeToolResult(output) }],
          });
        } catch (toolError) {
          const durationMs = Date.now() - startedAt;
          const rawMessage = toolError instanceof Error ? toolError.message : String(toolError);
          const sanitizedMessage = String(sanitizeForTelemetry(rawMessage)).slice(0, 500);
          emit("tool.failed", {
            toolId: authorized.id,
            name: authorized.name,
            error: sanitizedMessage,
            toolCallId,
            durationMs,
            code: toolError instanceof ToolPolicyError ? "TOOL_POLICY_REJECTED" : (toolError as { code?: string }).code,
            transport: "cli-mcp-bridge",
          });
          sendJson(res, 200, {
            ok: false,
            isError: true,
            content: [{ type: "text", text: `Error executing tool "${authorized.name}": ${rawMessage.slice(0, 1_500)}` }],
          });
        }
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : "Internal bridge error" });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind Studio CLI MCP bridge to loopback port.");
  }

  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    token,
    bridgeScriptPath,
    env: {
      [STUDIO_MCP_BRIDGE_URL_ENV]: url,
      [STUDIO_MCP_BRIDGE_TOKEN_ENV]: token,
    },
    codexConfigArgs: (nodeExecutable = process.execPath) =>
      buildCodexMcpBridgeArgs(nodeExecutable, bridgeScriptPath),
    close: async () => {
      await new Promise<void>((resolve) => {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      });
    },
  };
}
