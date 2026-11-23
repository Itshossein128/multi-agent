import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { spawnToolProcess } from "./spawnToolProcess";

const DEFAULT_VELORA_ROOT = "/home/hossein/Desktop/projects/building-management";
const LABEL_REFRESH_HINT_RE = /community set changed since labeling|run [`']graphify label[`']/i;

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

function graphifyEnv(): NodeJS.ProcessEnv {
  const configuredNoProxy = (process.env.no_proxy ?? process.env.NO_PROXY ?? "").trim();
  const noProxy =
    configuredNoProxy === "*"
      ? configuredNoProxy
      : [
          ...new Set([
            ...configuredNoProxy
              .split(",")
              .map((host) => host.trim())
              .filter(Boolean),
            "127.0.0.1",
            "localhost",
            "::1",
          ]),
        ].join(",");
  return { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy };
}

function buildLabelArgs(
  projectRoot: string,
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): string[] {
  const args = ["label", projectRoot];
  const missingOnly = input.missingOnly !== false && input.force !== true;
  if (missingOnly) {
    args.push("--missing-only");
  }
  const backend = String(input.backend ?? configuration.backend ?? "").trim();
  if (backend) {
    args.push(`--backend=${backend}`);
  }
  const model = String(input.model ?? configuration.model ?? "").trim();
  if (model) {
    args.push(`--model=${model}`);
  }
  return args;
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
  } else if (action === "label") {
    args = buildLabelArgs(projectRoot, configuration, input);
  } else if (action === "extract") {
    const backend = String(input.backend ?? configuration.backend ?? "gemini").trim();
    args = ["extract", projectRoot, "--backend", backend];
  } else {
    throw new Error(
      `Unsupported velora_graphify_tool action "${action}". Expected query, explain, path, update, label, or extract.`,
    );
  }

  const env = graphifyEnv();
  const timeoutMs = action === "label" || action === "extract" ? 300_000 : 120_000;
  const proc = spawnSync("graphify", args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: timeoutMs,
    env,
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
  const stderr = (proc.stderr ?? "").trim();
  const labelsNeedRefresh = action === "update" && LABEL_REFRESH_HINT_RE.test(stderr);

  let labelsRefreshed = false;
  let labelRefreshOutput: string | undefined;
  const shouldRefreshLabels =
    action === "update" &&
    (input.refreshLabels === true || configuration.refreshLabels === true);

  if (shouldRefreshLabels && labelsNeedRefresh) {
    const labelArgs = buildLabelArgs(projectRoot, configuration, input);
    const labelProc = spawnSync("graphify", labelArgs, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 300_000,
      env,
    });
    if (labelProc.error) {
      throw new Error(`velora_graphify_tool failed to spawn graphify label: ${labelProc.error.message}`);
    }
    if (labelProc.status !== 0) {
      const detail = (labelProc.stderr || labelProc.stdout || "").trim().slice(0, 1_500);
      throw new Error(
        `velora_graphify_tool "label" exited with code ${String(labelProc.status)}${detail ? `: ${detail}` : ""}`,
      );
    }
    labelsRefreshed = true;
    labelRefreshOutput = (labelProc.stdout ?? "").trim();
  }

  return formatGraphifyResult(action, projectRoot, input, stdout, stderr, labelsNeedRefresh, labelsRefreshed, labelRefreshOutput);
}

function formatGraphifyResult(
  action: string,
  projectRoot: string,
  input: Record<string, unknown>,
  stdout: string,
  stderr: string,
  labelsNeedRefresh: boolean,
  labelsRefreshed: boolean,
  labelRefreshOutput: string | undefined,
): Record<string, unknown> {
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
    ...(labelsNeedRefresh && !labelsRefreshed ? { labelsNeedRefresh: true, labelWarning: stderr } : {}),
    ...(labelsRefreshed ? { labelsRefreshed: true, labelRefreshOutput } : {}),
    output: parsedOutput,
    ...(parsedOutput && typeof parsedOutput === "object" && !Array.isArray(parsedOutput)
      ? (parsedOutput as Record<string, unknown>)
      : {}),
  };
}

/**
 * Non-blocking async variant used by FunctionToolExecutor so `graphify` CLI calls
 * never block the server event loop or starve Postgres execution-lease heartbeats.
 */
export async function executeVeloraGraphifyToolAsync(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
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
  } else if (action === "label") {
    args = buildLabelArgs(projectRoot, configuration, input);
  } else if (action === "extract") {
    const backend = String(input.backend ?? configuration.backend ?? "gemini").trim();
    args = ["extract", projectRoot, "--backend", backend];
  } else {
    throw new Error(
      `Unsupported velora_graphify_tool action "${action}". Expected query, explain, path, update, label, or extract.`,
    );
  }

  const env = graphifyEnv();
  const timeoutMs = action === "label" || action === "extract" ? 300_000 : 120_000;
  const proc = await spawnToolProcess("graphify", args, {
    cwd: projectRoot,
    timeoutMs,
    signal,
    env,
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

  const stdout = proc.stdout.trim();
  const stderr = proc.stderr.trim();
  const labelsNeedRefresh = action === "update" && LABEL_REFRESH_HINT_RE.test(stderr);

  let labelsRefreshed = false;
  let labelRefreshOutput: string | undefined;
  const shouldRefreshLabels =
    action === "update" &&
    (input.refreshLabels === true || configuration.refreshLabels === true);

  if (shouldRefreshLabels && labelsNeedRefresh) {
    const labelArgs = buildLabelArgs(projectRoot, configuration, input);
    const labelProc = await spawnToolProcess("graphify", labelArgs, {
      cwd: projectRoot,
      timeoutMs: 300_000,
      signal,
      env,
    });
    if (labelProc.error) {
      throw new Error(`velora_graphify_tool failed to spawn graphify label: ${labelProc.error.message}`);
    }
    if (labelProc.status !== 0) {
      const detail = (labelProc.stderr || labelProc.stdout || "").trim().slice(0, 1_500);
      throw new Error(
        `velora_graphify_tool "label" exited with code ${String(labelProc.status)}${detail ? `: ${detail}` : ""}`,
      );
    }
    labelsRefreshed = true;
    labelRefreshOutput = labelProc.stdout.trim();
  }

  return formatGraphifyResult(action, projectRoot, input, stdout, stderr, labelsNeedRefresh, labelsRefreshed, labelRefreshOutput);
}
