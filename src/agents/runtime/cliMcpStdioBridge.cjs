#!/usr/bin/env node
"use strict";

/**
 * Run-scoped stdio MCP bridge for local CLI workers (e.g. Codex CLI).
 *
 * Speaks MCP JSON-RPC 2.0 over newline-delimited stdin/stdout and forwards
 * `tools/list` and `tools/call` to the Studio server's loopback HTTP bridge
 * authenticated with a per-invocation one-time bearer token.
 *
 * Zero external dependencies so it runs directly under `node` from both
 * source (`src/agents/runtime/`) and compiled (`apps/server/dist/`) layouts.
 */

const http = require("node:http");
const https = require("node:https");
const readline = require("node:readline");

const BRIDGE_URL = process.env.STUDIO_MCP_BRIDGE_URL || "";
const BRIDGE_TOKEN = process.env.STUDIO_MCP_BRIDGE_TOKEN || "";

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function postJson(endpointPath, payload) {
  return new Promise((resolve, reject) => {
    if (!BRIDGE_URL || !BRIDGE_TOKEN) {
      reject(new Error("Studio MCP bridge environment is not configured."));
      return;
    }

    let url;
    try {
      url = new URL(endpointPath, BRIDGE_URL);
    } catch (err) {
      reject(new Error(`Invalid Studio MCP bridge URL: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    const body = JSON.stringify(payload ?? {});
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        agent: false,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body, "utf8"),
          authorization: `Bearer ${BRIDGE_TOKEN}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed ?? {});
            return;
          }
          const detail = (parsed && typeof parsed.error === "string" ? parsed.error : raw) || `HTTP ${res.statusCode}`;
          reject(new Error(detail));
        });
      },
    );

    req.on("error", (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function handleRequest(message) {
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    if (isNotification) return;
    const protocolVersion =
      params && typeof params.protocolVersion === "string" && params.protocolVersion.trim()
        ? params.protocolVersion
        : "2024-11-05";
    sendResult(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "studio-mcp-bridge", version: "1.0.0" },
    });
    return;
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return;
  }

  if (method === "ping") {
    if (!isNotification) sendResult(id, {});
    return;
  }

  if (method === "tools/list") {
    if (isNotification) return;
    try {
      const response = await postJson("/tools/list", {});
      const tools = Array.isArray(response.tools) ? response.tools : [];
      sendResult(id, { tools });
    } catch (err) {
      sendError(id, -32603, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (method === "tools/call") {
    if (isNotification) return;
    const toolName = params && typeof params.name === "string" ? params.name : "";
    const toolArgs =
      params && params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? params.arguments
        : {};
    if (!toolName) {
      sendError(id, -32602, "tools/call requires a non-empty tool name.");
      return;
    }
    try {
      const response = await postJson("/tools/call", { name: toolName, arguments: toolArgs });
      const content = Array.isArray(response.content)
        ? response.content
        : [{ type: "text", text: typeof response.text === "string" ? response.text : JSON.stringify(response) }];
      sendResult(id, {
        content,
        isError: response.isError === true,
      });
    } catch (err) {
      sendResult(id, {
        content: [{ type: "text", text: `Error executing tool "${toolName}": ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      });
    }
    return;
  }

  if (!isNotification) {
    sendError(id, -32601, `Method not found: ${String(method)}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let inFlight = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && inFlight === 0) {
    process.exit(0);
  }
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    sendError(null, -32700, "Parse error");
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    sendError(null, -32600, "Invalid Request");
    return;
  }
  inFlight += 1;
  handleRequest(parsed)
    .catch((err) => {
      if (parsed.id !== undefined && parsed.id !== null) {
        sendError(parsed.id, -32603, err instanceof Error ? err.message : String(err));
      }
    })
    .finally(() => {
      inFlight -= 1;
      maybeExit();
    });
});

rl.on("close", () => {
  stdinClosed = true;
  maybeExit();
});
