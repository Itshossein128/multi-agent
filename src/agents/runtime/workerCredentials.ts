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

/** Ephemeral launch material. Never serialize this into application state. */
export interface WorkerLaunchSecrets {
  environment: Readonly<Record<string, string>>;
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
  ) {}

  async resolve(context: CredentialResolutionContext): Promise<WorkerLaunchSecrets | undefined> {
    if (!this.policy.enabled) return undefined;
    if (!context.tenantId.trim() || !context.principalId.trim() || !context.runId.trim() || !context.agentId.trim()) {
      throw new Error("Trusted tenant, principal, run, and agent identity are required for credential resolution.");
    }
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
    },
  }, env);
}
