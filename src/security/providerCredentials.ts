import { credentialGatewayFromEnvironment, type CredentialGateway } from "./credentialGateway";

/**
 * Short-lived API provider credential resolution for agent execution.
 *
 * When enabled, the execution server leases the model provider key from the
 * external broker (tenant/principal/run bound, single-use, short TTL) and
 * passes it directly into the model constructor for the duration of one agent
 * invocation. The key is never read from browser state, workflow input,
 * AgentRecord, or telemetry, and it is not persisted anywhere on the server.
 *
 * When disabled (development default), providers fall back to the server's
 * own environment variables exactly as before.
 */

export interface ApiCredentialRequest {
  provider: string;
  tenantId: string;
  principalId: string;
  runId: string;
  agentId: string;
}

export interface ApiProviderCredentialResolver {
  resolve(request: ApiCredentialRequest): Promise<string | undefined>;
}

export const NO_API_CREDENTIALS: ApiProviderCredentialResolver = {
  async resolve() { return undefined; },
};

/** Server-owned alias per provider, e.g. env API_CREDENTIAL_ALIAS_OPENAI=openai-team-key. */
export function apiCredentialAlias(provider: string, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const key = `API_CREDENTIAL_ALIAS_${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  return env[key]?.trim() || undefined;
}

/**
 * Broker-backed resolver. Fails closed: when the broker is configured but a
 * lease cannot be issued/consumed, the invocation fails instead of silently
 * degrading to a long-lived environment key.
 */
export class BrokerApiCredentialResolver implements ApiProviderCredentialResolver {
  constructor(
    private readonly gateway: CredentialGateway,
    private readonly aliases: Readonly<Record<string, string | undefined>>,
    private readonly purpose = "agent",
  ) {}

  async resolve(request: ApiCredentialRequest): Promise<string | undefined> {
    const alias = this.aliases[request.provider];
    if (!alias) return undefined;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(alias)) {
      throw new Error("API credential alias is invalid.");
    }
    const leaseRequest = {
      provider: request.provider as "openai" | "anthropic" | "gemini",
      alias,
      tenantId: request.tenantId,
      principalId: request.principalId,
      runId: request.runId,
      agentId: request.agentId,
      purpose: this.purpose,
    };
    const lease = await this.gateway.issue(leaseRequest);
    const secret = await this.gateway.consume(lease, leaseRequest);
    if (!secret) throw new Error("Credential gateway returned no provider credential.");
    return secret;
  }
}

/**
 * Compose the resolver for this process.
 *
 * Enabled only when at least one provider alias is configured
 * (API_CREDENTIAL_ALIAS_<PROVIDER>) — aliases are server-owned and never taken
 * from agent records or workflow input.
 *
 * Production guard: provider leasing in production requires a valid external
 * broker; credentialGatewayFromEnvironment throws when it is missing, so a
 * misconfigured production process fails at startup rather than falling back
 * to long-lived process environment secrets.
 */
export function apiProviderCredentialResolverFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ApiProviderCredentialResolver {
  const providers = (env.API_CREDENTIAL_LEASED_PROVIDERS ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const hasAliases = providers.some((provider) => apiCredentialAlias(provider, env));
  if (!hasAliases) {
    if (env.NODE_ENV === "production" && env.CREDENTIAL_BROKER_ENABLED === "true" && providers.length) {
      // Leasing was requested but no alias is provisioned: fail closed.
      throw new Error("API credential leasing requires a server-owned API_CREDENTIAL_ALIAS_<PROVIDER> per enabled provider.");
    }
    return NO_API_CREDENTIALS;
  }
  const gateway = credentialGatewayFromEnvironment(env);
  const aliases: Record<string, string | undefined> = {};
  for (const provider of providers) aliases[provider] = apiCredentialAlias(provider, env);
  return new BrokerApiCredentialResolver(gateway, aliases);
}
