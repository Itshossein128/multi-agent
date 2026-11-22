import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_VELORA_ROOT = "/home/hossein/Desktop/projects/building-management";

function resolveProjectRoot(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): string {
  const candidate = String(
    input.projectRoot ?? configuration.projectRoot ?? configuration.workspaceRoot ?? DEFAULT_VELORA_ROOT,
  ).trim();
  if (!candidate || !path.isAbsolute(candidate)) {
    throw new Error("velora_graphify_tool requires an absolute projectRoot.");
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`velora_graphify_tool projectRoot "${candidate}" does not exist or is not a directory.`);
  }
  return fs.realpathSync(candidate);
}

export function executeVeloraGraphifyTool(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const projectRoot = resolveProjectRoot(configuration, input);
  const action = String(
    input.action ?? configuration.action ?? (typeof input.query === "string" ? "query" : "update"),
  )
    .trim()
    .toLowerCase();

  let args: string[];
  if (action === "query") {
    const query = String(input.query ?? input.question ?? "").trim();
    if (!query) throw new Error('velora_graphify_tool "query" requires a non-empty query.');
    args = ["query", query];
  } else if (action === "explain") {
    const concept = String(input.concept ?? input.node ?? input.query ?? "").trim();
    if (!concept) throw new Error('velora_graphify_tool "explain" requires a non-empty concept.');
    args = ["explain", concept];
  } else if (action === "path") {
    const from = String(input.from ?? input.source ?? "").trim();
    const to = String(input.to ?? input.target ?? "").trim();
    if (!from || !to) throw new Error('velora_graphify_tool "path" requires both from and to node names.');
    args = ["path", from, to];
  } else if (action === "update") {
    args = ["update", projectRoot];
  } else if (action === "extract") {
    const backend = String(input.backend ?? configuration.backend ?? "gemini").trim();
    args = ["extract", projectRoot, "--backend", backend];
  } else {
    throw new Error(`Unsupported velora_graphify_tool action "${action}". Expected query, explain, path, update, or extract.`);
  }

  const proc = spawnSync("graphify", args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  });

  if (proc.error) {
    throw new Error(`velora_graphify_tool failed to spawn graphify: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    const detail = (proc.stderr || proc.stdout || "").trim().slice(0, 1_500);
    throw new Error(
      `velora_graphify_tool "${action}" exited with code ${String(proc.status)}${detail ? `: ${detail}` : ""}`,
    );
  }

  const stdout = (proc.stdout ?? "").trim();
  let parsedOutput: unknown = stdout;
  if (stdout.startsWith("{") || stdout.startsWith("[")) {
    try {
      parsedOutput = JSON.parse(stdout);
    } catch {
      parsedOutput = stdout;
    }
  }

  return {
    ok: true,
    action,
    projectRoot,
    ...(input.semantic === true ? { semantic: true } : {}),
    output: parsedOutput,
    ...(parsedOutput && typeof parsedOutput === "object" && !Array.isArray(parsedOutput)
      ? (parsedOutput as Record<string, unknown>)
      : {}),
  };
}
