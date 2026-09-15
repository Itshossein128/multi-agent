import { randomBytes } from "node:crypto";

export interface CredentialGatewayRequest {
  provider: "database" | "search" | "mcp";
  alias: string;
  tenantId: string;
  principalId: string;
  runId: string;
}

export interface CredentialLease {
  leaseId: string;
  expiresAt: number;
}

export interface CredentialGateway {
  issue(request: CredentialGatewayRequest): Promise<CredentialLease>;
  consume(lease: CredentialLease, request: CredentialGatewayRequest): Promise<string | undefined>;
}

export type CredentialGatewayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Production adapter for a separately deployed credential broker. */
export class HttpCredentialGateway implements CredentialGateway {
  private readonly baseUrl: URL;
  constructor(
    rawBaseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: CredentialGatewayFetch = fetch,
  ) {
    try { this.baseUrl = new URL(rawBaseUrl); } catch { throw new Error("Credential gateway URL is invalid."); }
    if (!['http:', 'https:'].includes(this.baseUrl.protocol) || this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash) throw new Error("Credential gateway URL must be HTTP(S) without embedded credentials or query parameters.");
    if (!serviceToken) throw new Error("Credential gateway service authentication is required.");
  }

  async issue(request: CredentialGatewayRequest): Promise<CredentialLease> {
    assertRequest(request);
    const response = await this.fetchImpl(new URL("v1/leases", this.baseUrl), { method: "POST", headers: this.headers(), body: JSON.stringify(request) });
    const body = await response.json().catch(() => ({})) as { leaseId?: unknown; expiresAt?: unknown };
    if (!response.ok || typeof body.leaseId !== "string" || typeof body.expiresAt !== "number") throw new Error("Credential gateway lease issuance failed.");
    return { leaseId: body.leaseId, expiresAt: body.expiresAt };
  }

  async consume(lease: CredentialLease, request: CredentialGatewayRequest): Promise<string | undefined> {
    assertRequest(request);
    const response = await this.fetchImpl(new URL(`v1/leases/${encodeURIComponent(lease.leaseId)}/consume`, this.baseUrl), { method: "POST", headers: this.headers(), body: JSON.stringify({ ...request, expiresAt: lease.expiresAt }) });
    const body = await response.json().catch(() => ({})) as { secret?: unknown };
    if (!response.ok) throw new Error("Credential gateway lease consumption failed.");
    return typeof body.secret === "string" ? body.secret : undefined;
  }

  private headers() { return { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.serviceToken}` }; }
}

/**
 * A process-local gateway for development and single-server deployments.
 * Production deployments should replace it with an external secret broker
 * behind the same interface. Secrets are never put in tool configuration,
 * events, argv, or returned after a lease has been consumed.
 */
export class EnvironmentCredentialGateway implements CredentialGateway {
  private readonly leases = new Map<string, { request: CredentialGatewayRequest; secret?: string; expiresAt: number }>();

  constructor(
    private readonly enabled = process.env.TOOL_CREDENTIAL_GATEWAY_ENABLED === "true",
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly ttlMs = boundedTtl(process.env.TOOL_CREDENTIAL_GATEWAY_TTL_MS),
  ) {}

  async issue(request: CredentialGatewayRequest): Promise<CredentialLease> {
    if (!this.enabled) throw new Error("Credential gateway is disabled; refusing real tool credentials.");
    assertRequest(request);
    for (const [id, lease] of this.leases) if (lease.expiresAt < Date.now()) this.leases.delete(id);
    const secret = this.environment[credentialEnvironmentName(request)];
    if (!secret) throw new Error(`Credential gateway has no configured credential for ${request.provider}/${request.alias}.`);
    const leaseId = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + this.ttlMs;
    this.leases.set(leaseId, { request, secret, expiresAt });
    return { leaseId, expiresAt };
  }

  async consume(lease: CredentialLease, request: CredentialGatewayRequest): Promise<string | undefined> {
    const stored = this.leases.get(lease.leaseId);
    this.leases.delete(lease.leaseId);
    if (!stored || stored.expiresAt < Date.now() || stored.expiresAt !== lease.expiresAt || !sameRequest(stored.request, request)) {
      throw new Error("Credential lease is invalid, expired, or bound to another execution context.");
    }
    return stored.secret;
  }
}

export function credentialGatewayFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): CredentialGateway {
  if (env.TOOL_CREDENTIAL_GATEWAY_URL?.trim()) return new HttpCredentialGateway(env.TOOL_CREDENTIAL_GATEWAY_URL, env.TOOL_CREDENTIAL_GATEWAY_SERVICE_TOKEN ?? "");
  return new EnvironmentCredentialGateway(env.TOOL_CREDENTIAL_GATEWAY_ENABLED === "true", env, boundedTtl(env.TOOL_CREDENTIAL_GATEWAY_TTL_MS));
}

export function credentialEnvironmentName(request: Pick<CredentialGatewayRequest, "provider" | "alias">): string {
  const alias = request.alias.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!alias || alias.length > 64) throw new Error("Credential gateway alias is invalid.");
  const suffix = request.provider === "database" ? "URL" : request.provider === "search" ? "API_KEY" : "TOKEN";
  return `TOOL_${request.provider.toUpperCase()}_${alias}_${suffix}`;
}

function assertRequest(request: CredentialGatewayRequest) {
  if (!request.tenantId || !request.principalId || !request.runId) throw new Error("Credential gateway requires tenant, principal, and run identity.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(request.alias)) throw new Error("Credential gateway alias is invalid.");
}

function sameRequest(a: CredentialGatewayRequest, b: CredentialGatewayRequest) {
  return a.provider === b.provider && a.alias === b.alias && a.tenantId === b.tenantId && a.principalId === b.principalId && a.runId === b.runId;
}

function boundedTtl(value: string | undefined) {
  const parsed = Number(value ?? 30_000);
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 5 * 60_000 ? parsed : 30_000;
}
