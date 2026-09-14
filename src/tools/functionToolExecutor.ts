import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ToolExecutionInput, ToolExecutor } from "./types";

/**
 * Function-category executor. Default behavior is a safe local echo.
 * Explicit configuration.kind values opt into bounded server-side helpers used by
 * workflow test/reject nodes (workspace must sit under CLI_AGENT_WORKSPACE_ROOTS).
 */
export class FunctionToolExecutor implements ToolExecutor {
  async execute({ tool, input }: ToolExecutionInput): Promise<Record<string, unknown>> {
    const kind = String(tool.configuration.kind ?? "");
    if (kind === "reject-run") {
      throw new Error(String(tool.configuration.message || "Workflow rejected"));
    }
    if (kind === "repo-tests") {
      return runRepoTests(tool.configuration, input);
    }
    return { ...tool.configuration, ...input };
  }
}

function runRepoTests(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const workspaceRoot = String(configuration.workspaceRoot ?? "");
  if (!workspaceRoot.trim()) throw new Error("repo-tests tool requires configuration.workspaceRoot.");
  const cwd = assertAllowedWorkspace(workspaceRoot);
  const relTest = String(configuration.testPath ?? "test");
  if (relTest.includes("\0") || path.isAbsolute(relTest) || relTest.split(/[\\/]/).includes("..")) {
    throw new Error("repo-tests testPath must be a relative path without parent segments.");
  }
  const testRun = spawnSync(process.execPath, ["--test", relTest], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
  });
  const diff = spawnSync("git", ["diff", "--", "."], { cwd, encoding: "utf8", windowsHide: true });
  const status = testRun.status ?? 1;
  return {
    branch: status === 0 ? "pass" : "fail",
    status,
    stdout: testRun.stdout ?? "",
    stderr: testRun.stderr ?? "",
    command: `node --test ${relTest}`,
    diff: diff.stdout ?? "",
    prior: input,
  };
}

export function assertAllowedWorkspace(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot);
  if (!path.isAbsolute(resolved) || /[\r\n\0]/.test(resolved)) {
    throw new Error("repo-tests workspaceRoot must be an absolute path.");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("repo-tests workspaceRoot does not exist.");
  }
  const roots = (process.env.CLI_AGENT_WORKSPACE_ROOTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  if (!roots.length) {
    throw new Error("repo-tests requires CLI_AGENT_WORKSPACE_ROOTS to be configured.");
  }
  const allowed = roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!allowed) {
    throw new Error("repo-tests workspaceRoot is outside CLI_AGENT_WORKSPACE_ROOTS.");
  }
  return resolved;
}
