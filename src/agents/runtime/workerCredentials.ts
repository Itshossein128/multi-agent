import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Server-trusted identity used only to authorize credential resolution. */
export interface TrustedCredentialPrincipal {
  tenantId: string;
  principalId: string;
}

export interface CredentialResolutionContext extends TrustedCredentialPrincipal {
  runId: string;
  agentId: string;
  provider: string;
}

/** Absolute POSIX path inside the worker container. Never a host path. */
export const CODEX_CONTAINER_AUTH_PATH = "/home/worker/.codex/auth.json";
export const CLAUDE_CONTAINER_CREDENTIALS_PATH = "/home/worker/.claude/.credentials.json";

const ALLOWED_CREDENTIAL_CONTAINER_PATHS: ReadonlySet<string> = new Set([
  CODEX_CONTAINER_AUTH_PATH,
  CLAUDE_CONTAINER_CREDENTIALS_PATH,
]);

/** Ephemeral per-run credential file. Never serialize, log, or place in argv/env. */
export interface WorkerCredentialFile {
  containerPath: string;
  content: Buffer;
  mode: number;
  /** SHA-256 of content for change detection only. */
  contentSha256: string;
}

/** Ephemeral launch material. Never serialize this into application state. */
export interface WorkerLaunchSecrets {
  environment: Readonly<Record<string, string>>;
  files?: ReadonlyArray<WorkerCredentialFile>;
  /**
   * Persist refreshed credential files after a run. Implementations must never
   * log or return file contents.
   */
  persistRefreshedFiles?: (files: ReadonlyArray<WorkerCredentialFile>) => Promise<void>;
}

export interface WorkerCredentialResolver {
  resolve(context: CredentialResolutionContext): Promise<WorkerLaunchSecrets | undefined>;
}

export const NO_WORKER_CREDENTIALS: WorkerCredentialResolver = {
  async resolve() { return undefined; },
};

export const PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES: Readonly<Record<string, ReadonlySet<string>>> = {
  codex: new Set(["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"]),
  "claude-code": new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]),
  cursor: new Set(["CURSOR_API_KEY"]),
};

export interface EnvironmentCredentialResolverPolicy {
  enabled: boolean;
  providerEnvironmentNames: Readonly<Record<string, string | undefined>>;
}

/** Development-only adapter for explicitly selected server environment credentials. */
export class EnvironmentWorkerCredentialResolver implements WorkerCredentialResolver {
  constructor(
    private readonly policy: EnvironmentCredentialResolverPolicy,
    private readonly serverEnvironment: Readonly<Record<string, string | undefined>> = process.env,
  ) { }

  async resolve(context: CredentialResolutionContext): Promise<WorkerLaunchSecrets | undefined> {
    if (!this.policy.enabled) return undefined;
    assertTrustedCredentialContext(context);
    const environmentName = this.policy.providerEnvironmentNames[context.provider]?.trim();
    if (!environmentName) return undefined;
    if (!PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES[context.provider]?.has(environmentName)) {
      throw new Error(`Unsupported server credential environment selection for provider "${context.provider}".`);
    }
    const value = this.serverEnvironment[environmentName];
    if (!value) throw new Error(`Configured server credential for provider "${context.provider}" is unavailable.`);
    return { environment: { [environmentName]: value } };
  }
}

export function environmentWorkerCredentialResolverFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerCredentialResolver {
  return new EnvironmentWorkerCredentialResolver({
    enabled: env.CLI_CREDENTIAL_ENVIRONMENT_ENABLED === "true",
    providerEnvironmentNames: {
      codex: env.CLI_CODEX_CREDENTIAL_ENV_VAR,
      "claude-code": env.CLI_CLAUDE_CREDENTIAL_ENV_VAR,
      // Cursor only accepts CURSOR_API_KEY; default the mapping when env delivery is on.
      cursor: env.CLI_CURSOR_CREDENTIAL_ENV_VAR?.trim()
        || (env.CLI_CREDENTIAL_ENVIRONMENT_ENABLED === "true" ? "CURSOR_API_KEY" : undefined),
    },
  }, env);
}

export interface CodexAuthFileCredentialResolverPolicy {
  enabled: boolean;
  /** Server-only source path. Never forwarded into the worker container. */
  authFilePath: string;
}

/**
 * Development-only Codex subscription auth via the minimum credential unit
 * (`auth.json`). Resolves bytes server-side and never exposes the host path to
 * the worker.
 */
export class CodexAuthFileCredentialResolver implements WorkerCredentialResolver {
  constructor(
    private readonly policy: CodexAuthFileCredentialResolverPolicy,
  ) { }

  static fromEnvironment(
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): CodexAuthFileCredentialResolver {
    return new CodexAuthFileCredentialResolver({
      enabled: env.CLI_CREDENTIAL_FILE_ENABLED === "true",
      authFilePath: resolveCodexAuthFilePath(env),
    });
  }

  async resolve(context: CredentialResolutionContext): Promise<WorkerLaunchSecrets | undefined> {
    if (!this.policy.enabled) return undefined;
    if (context.provider !== "codex") return undefined;
    assertTrustedCredentialContext(context);

    const sourcePath = this.policy.authFilePath;
    let content: Buffer;
    try {
      content = await fs.promises.readFile(sourcePath);
    } catch {
      throw new Error("Configured Codex credential file is unavailable.");
    }
    if (!content.length) throw new Error("Configured Codex credential file is empty.");

    const contentSha256 = sha256Hex(content);
    const file: WorkerCredentialFile = {
      containerPath: CODEX_CONTAINER_AUTH_PATH,
      content,
      mode: 0o600,
      contentSha256,
    };

    return {
      environment: {},
      files: [file],
      persistRefreshedFiles: async (files) => {
        for (const refreshed of files) {
          if (refreshed.containerPath !== CODEX_CONTAINER_AUTH_PATH) continue;
          await persistCredentialFile(sourcePath, contentSha256, refreshed.content);
        }
      },
    };
  }
}

export interface ClaudeCredentialsFileCredentialResolverPolicy {
  enabled: boolean;
  /** Server-only source path. Never forwarded into the worker container. */
  credentialsFilePath: string;
}

/**
 * Development-only Claude Code subscription auth via the minimum credential unit
 * (`.credentials.json`). Resolves bytes server-side and never exposes the host
 * path to the worker.
 */
export class ClaudeCredentialsFileCredentialResolver implements WorkerCredentialResolver {
  constructor(
    private readonly policy: ClaudeCredentialsFileCredentialResolverPolicy,
  ) { }

  static fromEnvironment(
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): ClaudeCredentialsFileCredentialResolver {
    return new ClaudeCredentialsFileCredentialResolver({
      enabled: env.CLI_CREDENTIAL_FILE_ENABLED === "true",
      credentialsFilePath: resolveClaudeCredentialsFilePath(env),
    });
  }

  async resolve(context: CredentialResolutionContext): Promise<WorkerLaunchSecrets | undefined> {
    if (!this.policy.enabled) return undefined;
    if (context.provider !== "claude-code") return undefined;
    assertTrustedCredentialContext(context);

    const sourcePath = this.policy.credentialsFilePath;
    let content: Buffer;
    try {
      content = await fs.promises.readFile(sourcePath);
    } catch {
      throw new Error("Configured Claude credential file is unavailable.");
    }
    if (!content.length) throw new Error("Configured Claude credential file is empty.");
    assertClaudeCredentialsFileUsable(content);

    const contentSha256 = sha256Hex(content);
    const file: WorkerCredentialFile = {
      containerPath: CLAUDE_CONTAINER_CREDENTIALS_PATH,
      content,
      mode: 0o600,
      contentSha256,
    };

    return {
      environment: {},
      files: [file],
      persistRefreshedFiles: async (files) => {
        for (const refreshed of files) {
          if (refreshed.containerPath !== CLAUDE_CONTAINER_CREDENTIALS_PATH) continue;
          // Re-validate refreshed material before writeback; never log contents.
          assertClaudeCredentialsFileUsable(refreshed.content);
          await persistCredentialFile(sourcePath, contentSha256, refreshed.content);
        }
      },
    };
  }
}

/** First resolver that returns material wins (file delivery before environment). */
export class CompositeWorkerCredentialResolver implements WorkerCredentialResolver {
  constructor(private readonly resolvers: ReadonlyArray<WorkerCredentialResolver>) { }

  async resolve(context: CredentialResolutionContext): Promise<WorkerLaunchSecrets | undefined> {
    for (const resolver of this.resolvers) {
      const resolved = await resolver.resolve(context);
      if (resolved) return resolved;
    }
    return undefined;
  }
}

export function workerCredentialResolverFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerCredentialResolver {
  return new CompositeWorkerCredentialResolver([
    CodexAuthFileCredentialResolver.fromEnvironment(env),
    ClaudeCredentialsFileCredentialResolver.fromEnvironment(env),
    environmentWorkerCredentialResolverFromEnvironment(env),
  ]);
}

export function assertAllowedCredentialContainerPath(containerPath: string): void {
  if (!ALLOWED_CREDENTIAL_CONTAINER_PATHS.has(containerPath)) {
    throw new Error("Trusted credential file targets an unsupported container path.");
  }
}

export function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Structural usability check only. Never logs or returns token values.
 * Requires non-empty access and refresh tokens and a non-expired refresh token
 * when an expiry is present.
 */
export function assertClaudeCredentialsFileUsable(content: Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("Configured Claude credential file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Configured Claude credential file lacks usable OAuth material.");
  }
  const oauth = (parsed as { claudeAiOauth?: unknown }).claudeAiOauth;
  if (!oauth || typeof oauth !== "object" || Array.isArray(oauth)) {
    throw new Error("Configured Claude credential file lacks usable OAuth material.");
  }
  const accessToken = (oauth as { accessToken?: unknown }).accessToken;
  const refreshToken = (oauth as { refreshToken?: unknown }).refreshToken;
  if (typeof accessToken !== "string" || accessToken.length < 1) {
    throw new Error("Configured Claude credential file does not contain usable OAuth material.");
  }
  if (typeof refreshToken !== "string" || refreshToken.length < 1) {
    throw new Error("Configured Claude credential file does not contain usable OAuth material.");
  }
  const refreshExpiresAt = (oauth as { refreshTokenExpiresAt?: unknown }).refreshTokenExpiresAt;
  if (typeof refreshExpiresAt === "number" && Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) {
    throw new Error("Configured Claude credential file refresh token is expired.");
  }
}

function assertTrustedCredentialContext(context: CredentialResolutionContext): void {
  if (!context.tenantId.trim() || !context.principalId.trim() || !context.runId.trim() || !context.agentId.trim()) {
    throw new Error("Trusted tenant, principal, run, and agent identity are required for credential resolution.");
  }
}

export function resolveCodexAuthFilePath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env.CLI_CODEX_AUTH_FILE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".codex", "auth.json");
}

export function resolveClaudeCredentialsFilePath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env.CLI_CLAUDE_CREDENTIALS_FILE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".claude", ".credentials.json");
}

/**
 * Concurrent-safe writeback: only replace the store when it still matches the
 * bytes originally staged for this run (compare-and-swap via content hash).
 */
export async function persistCredentialFile(
  targetPath: string,
  originalSha256: string,
  refreshedContent: Buffer,
): Promise<"written" | "unchanged" | "skipped_conflict"> {
  const refreshedSha = sha256Hex(refreshedContent);
  if (refreshedSha === originalSha256) return "unchanged";

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  return withExclusiveFileLock(`${targetPath}.lock`, async () => {
    let current: Buffer | undefined;
    try {
      current = await fs.promises.readFile(targetPath);
    } catch {
      current = undefined;
    }
    const currentSha = current ? sha256Hex(current) : undefined;
    if (currentSha === refreshedSha) return "unchanged";
    if (currentSha !== undefined && currentSha !== originalSha256) return "skipped_conflict";

    const tempPath = `${targetPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await fs.promises.writeFile(tempPath, refreshedContent, { mode: 0o600, flag: "wx" });
      await fs.promises.chmod(tempPath, 0o600);
      await fs.promises.rename(tempPath, targetPath);
      try { await fs.promises.chmod(targetPath, 0o600); } catch { /* best effort on platforms that ignore mode */ }
      return "written";
    } catch (error) {
      await fs.promises.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  });
}

/** @deprecated Prefer persistCredentialFile. Kept for existing Codex call sites/tests. */
export async function persistCodexAuthFile(
  targetPath: string,
  originalSha256: string,
  refreshedContent: Buffer,
): Promise<"written" | "unchanged" | "skipped_conflict"> {
  return persistCredentialFile(targetPath, originalSha256, refreshedContent);
}

async function withExclusiveFileLock<T>(lockPath: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  while (true) {
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(lockPath, "wx");
      try {
        return await action();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.promises.unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - started > 10_000) throw new Error("Timed out acquiring credential file lock.");
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.floor(Math.random() * 25)));
    }
  }
}
