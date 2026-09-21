/**
 * Log Codex into an isolated CODEX_HOME for agent workers.
 * Never reads or writes the developer ~/.codex login used for local development.
 *
 * Usage (from repo root):
 *   pnpm credentials:login-codex
 *   pnpm credentials:login-codex -- --status
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const AGENT_CODEX_HOME = path.join(REPO_ROOT, ".local", "agent-credentials", "codex");
const AGENT_AUTH_FILE = path.join(AGENT_CODEX_HOME, "auth.json");
const DEVELOPER_AUTH_FILE = path.join(os.homedir(), ".codex", "auth.json");

function sha256File(filePath: string): Buffer | undefined {
  try {
    return createHash("sha256").update(fs.readFileSync(filePath)).digest();
  } catch {
    return undefined;
  }
}

function sameHash(a: Buffer | undefined, b: Buffer | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Resolve a spawnable Codex CLI entry (Windows npm shims are not directly executable). */
function resolveCodexSpawn(): { command: string; prefixArgs: string[]; shell: boolean } {
  const configured = process.env.CODEX_CLI_PATH?.trim();
  if (configured) return { command: configured, prefixArgs: [], shell: false };

  if (process.platform === "win32") {
    const npmCodexJs = path.join(
      process.env.APPDATA ?? "",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (fs.existsSync(npmCodexJs)) {
      return { command: process.execPath, prefixArgs: [npmCodexJs], shell: false };
    }
    return { command: "codex.cmd", prefixArgs: [], shell: true };
  }

  return { command: "codex", prefixArgs: [], shell: false };
}

function runCodex(args: string[], options: { inherit?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const spawnTarget = resolveCodexSpawn();
  const env = { ...process.env, ...options.env };
  return spawnSync(spawnTarget.command, [...spawnTarget.prefixArgs, ...args], {
    env,
    stdio: options.inherit ? "inherit" : "pipe",
    encoding: options.inherit ? undefined : "utf8",
    windowsHide: !options.inherit,
    shell: spawnTarget.shell,
  });
}

function printEnvHint(): void {
  const authPath = AGENT_AUTH_FILE.replace(/\\/g, "/");
  console.log("");
  console.log("Point the server at the agent account (apps/server/.env):");
  console.log("  CLI_WORKER_MODE=container");
  console.log("  CLI_CREDENTIAL_FILE_ENABLED=true");
  console.log(`  CLI_CODEX_AUTH_FILE=${authPath}`);
  console.log("  CLI_CREDENTIAL_ENVIRONMENT_ENABLED=false");
  console.log("  CLI_WORKER_ALLOW_NETWORK=true");
  console.log("");
  console.log("Developer Codex home stays untouched:");
  console.log(`  ${DEVELOPER_AUTH_FILE}`);
}

function statusOnly(): number {
  fs.mkdirSync(AGENT_CODEX_HOME, { recursive: true });
  const developerBefore = sha256File(DEVELOPER_AUTH_FILE);
  const result = runCodex(["login", "status"], { env: { CODEX_HOME: AGENT_CODEX_HOME } });
  const developerAfter = sha256File(DEVELOPER_AUTH_FILE);
  if (!sameHash(developerBefore, developerAfter)) {
    console.error("Refusing to continue: developer ~/.codex/auth.json changed during status check.");
    return 1;
  }
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const loggedIn = /logged in/i.test(out) && !/not logged in/i.test(out);
  console.log(`Agent CODEX_HOME: ${AGENT_CODEX_HOME}`);
  console.log(`Agent auth.json:  ${fs.existsSync(AGENT_AUTH_FILE) ? "present" : "missing"}`);
  console.log(`Status: ${out || `(exit ${result.status ?? "null"})`}`);
  printEnvHint();
  if (!loggedIn) {
    console.log("");
    console.log("Agent account is not logged in yet. Next:");
    console.log("  1) Open a private/incognito browser window (or sign out of ChatGPT)");
    console.log("  2) pnpm credentials:login-codex");
    console.log("  3) Sign in as account B in that window");
  }
  // Status reporting succeeded; "not logged in" is informational, not a script failure.
  return 0;
}

function main(): number {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--status") || args.includes("status")) {
    return statusOnly();
  }

  if (!sha256File(DEVELOPER_AUTH_FILE)) {
    console.warn("Note: no developer ~/.codex/auth.json found yet. Continuing with isolated agent login only.");
  } else {
    console.log(`Preserving developer account at ${DEVELOPER_AUTH_FILE}`);
  }

  fs.mkdirSync(AGENT_CODEX_HOME, { recursive: true });
  const developerBefore = sha256File(DEVELOPER_AUTH_FILE);

  console.log(`Logging agent Codex into isolated home:`);
  console.log(`  CODEX_HOME=${AGENT_CODEX_HOME}`);
  console.log("Complete the browser/device login for account B. Account A will not be used.");
  console.log("");

  const result = runCodex(["login"], { inherit: true, env: { CODEX_HOME: AGENT_CODEX_HOME } });

  const developerAfter = sha256File(DEVELOPER_AUTH_FILE);
  if (!sameHash(developerBefore, developerAfter)) {
    console.error("");
    console.error("FAILED safety check: developer ~/.codex/auth.json changed during agent login.");
    console.error("Investigate before continuing. Agent credentials may still be under:");
    console.error(`  ${AGENT_AUTH_FILE}`);
    return 1;
  }

  if (!fs.existsSync(AGENT_AUTH_FILE) || fs.statSync(AGENT_AUTH_FILE).size < 1) {
    console.error("");
    console.error("Agent auth.json was not created. Login may have been cancelled.");
    console.error(`Expected: ${AGENT_AUTH_FILE}`);
    return 1;
  }

  const verify = runCodex(["login", "status"], { env: { CODEX_HOME: AGENT_CODEX_HOME } });
  const statusText = `${verify.stdout ?? ""}${verify.stderr ?? ""}`.trim();

  console.log("");
  console.log("Agent Codex login complete.");
  console.log(`  auth.json: ${AGENT_AUTH_FILE}`);
  console.log(`  status: ${statusText || "(unavailable)"}`);
  console.log("Developer ~/.codex/auth.json hash unchanged.");
  printEnvHint();
  return result.status === 0 ? 0 : result.status ?? 1;
}

process.exit(main());
