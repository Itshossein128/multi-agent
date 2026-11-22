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
    throw new Error("velora_knowledge_tool requires an absolute projectRoot.");
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`velora_knowledge_tool projectRoot "${candidate}" does not exist or is not a directory.`);
  }
  return fs.realpathSync(candidate);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === "EPERM";
  }
}

function assertNoActiveEmbeddingJob(projectRoot: string): void {
  const progressPath = path.join(projectRoot, ".knowledge", "index.progress.json");
  if (!fs.existsSync(progressPath)) return;

  const raw = fs.readFileSync(progressPath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new Error("Progress payload is not a JSON object");
    }
    parsed = json as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Corrupt .knowledge/index.progress.json at "${progressPath}": failed to parse progress JSON (${err instanceof Error ? err.message : String(err)}).`,
    );
  }

  const state = String(parsed.state ?? "").trim().toLowerCase();
  const pid = Number(parsed.pid);
  if ((state === "preparing" || state === "embedding") && isPidAlive(pid)) {
    throw new Error(
      `Refusing to start knowledge indexing: an active embedding job (state="${state}", pid=${pid}) is currently running.`,
    );
  }
}

export function executeVeloraKnowledgeTool(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const projectRoot = resolveProjectRoot(configuration, input);
  const action = String(
    input.action ?? configuration.action ?? (typeof input.query === "string" ? "context" : "status"),
  )
    .trim()
    .toLowerCase();

  if (action === "index") {
    if (input.semantic === false || input.lexical === true) {
      throw new Error(
        "Refusing to run knowledge index without --semantic: Velora AGENTS.md forbids downgrading a hybrid semantic index to lexical.",
      );
    }
    assertNoActiveEmbeddingJob(projectRoot);
  }

  const scriptPath = path.join(projectRoot, "scripts", "knowledge", "cli.py");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Velora knowledge CLI script not found at "${scriptPath}".`);
  }

  let args: string[];
  if (action === "index") {
    args = [scriptPath, "index", "--semantic"];
  } else if (action === "context" || action === "query") {
    const query = String(input.query ?? input.request ?? "").trim();
    if (!query) {
      throw new Error(`velora_knowledge_tool "${action}" requires a non-empty query.`);
    }
    args = [scriptPath, action, query];
    if (input.lexical === true) {
      args.push("--lexical");
    }
  } else if (action === "status") {
    args = [scriptPath, "status"];
  } else {
    throw new Error(`Unsupported velora_knowledge_tool action "${action}". Expected status, context, query, or index.`);
  }

  const configuredNoProxy = (process.env.no_proxy ?? process.env.NO_PROXY ?? "").trim();
  const noProxy = configuredNoProxy === "*" ? configuredNoProxy : [...new Set([
    ...configuredNoProxy.split(",").map(host => host.trim()).filter(Boolean),
    "127.0.0.1", "localhost", "::1",
  ])].join(",");
  const proc = spawnSync("python3", args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy },
  });

  if (proc.error) {
    throw new Error(`velora_knowledge_tool failed to spawn python3: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    const detail = (proc.stderr || proc.stdout || "").trim().slice(0, 1_500);
    throw new Error(
      `velora_knowledge_tool "${action}" exited with code ${String(proc.status)}${detail ? `: ${detail}` : ""}`,
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
    ...(action === "index" ? { semantic: true } : {}),
    output: parsedOutput,
    ...(parsedOutput && typeof parsedOutput === "object" && !Array.isArray(parsedOutput)
      ? (parsedOutput as Record<string, unknown>)
      : {}),
  };
}
