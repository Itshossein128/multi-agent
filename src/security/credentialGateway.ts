import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function readFileUtf8(file: string): string {
  return fs.readFileSync(file, "utf8") as string;
}
import {
  brokerClientConfigFromEnvironment,
  type BrokerClientConfig,
} from "../broker/config";
import { BrokerError, CREDENTIAL_BROKER_CONTRACT_VERSION, type BrokerErrorCode } from "../broker/contract";

export interface CredentialGatewayRequest {
  provider: "database" | "search" | "mcp" | "codex" | "claude-code" | "cursor" | "agy" | "openai" | "anthropic" | "gemini";
  alias: string;
  tenantId: string;
  principalId: string;
  runId: string;
  toolId?: string;
  agentId?: string;
  /** Broker purpose; the broker derives it from provider when omitted. */
  purpose?: string;
  requestedTtlMs?: number;
  correlationId?: string;
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

/** Error raised by the HTTP gateway; `code` is machine-readable, message is generic. */
export class CredentialGatewayError extends Error {
  readonly code: BrokerErrorCode | "network_error" | "timeout" | "gateway_unavailable";
  constructor(message: string, code: CredentialGatewayError["code"]) {
    super(message);
    this.name = "CredentialGatewayError";
    this.code = code;
  }
}

export interface HttpCredentialGatewayOptions {
  requestTimeoutMs?: number;
  maxTtlMs?: number;
  /** Retries for lease issuance (idempotent via Idempotency-Key) on network failure. */
  issueRetries?: number;
  /** mTLS material for production brokering. */
  tls?: {
    caFile: string;
    certFile: string;
    keyFile: string;
    /** Minimum TLS version (default TLSv1.2). */
    tlsMinVersion?: "TLSv1.2" | "TLSv1.3";
    /** SNI server name validated against the broker certificate (default: the gateway hostname). */
    serverName?: string;
  };
}

/**
 * Production adapter for a separately deployed credential broker.
 *
 * - Service-to-service auth via bearer token; mTLS material is attached when
 *   configured (production requires it; see brokerClientConfigFromEnvironment).
 * - Lease issuance carries a stable Idempotency-Key per logical request, so a
 *   network retry cannot create a second lease.
 * - Consumption is never retried: it is single-use, and a blind retry after a
 *   lost response would surface as a replay.
 * - Credentials are never accepted in URLs; the base URL is validated.
 * - Failures throw CredentialGatewayError with a machine-readable code and a
 *   generic message; response bodies are not echoed.
 */
export class HttpCredentialGateway implements CredentialGateway {
  private readonly baseUrl: URL;
  private readonly options: Required<Pick<HttpCredentialGatewayOptions, "requestTimeoutMs" | "issueRetries">> & HttpCredentialGatewayOptions;
  private readonly dispatcher: unknown;

  constructor(
    rawBaseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: CredentialGatewayFetch = fetch,
    options: HttpCredentialGatewayOptions = {},
  ) {
    try { this.baseUrl = new URL(rawBaseUrl); } catch { throw new Error("Credential gateway URL is invalid."); }
    if (!["http:", "https:"].includes(this.baseUrl.protocol) || this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash) {
      throw new Error("Credential gateway URL must be HTTP(S) without embedded credentials or query parameters.");
    }
    if (!serviceToken) throw new Error("Credential gateway service authentication is required.");
    this.options = {
      requestTimeoutMs: clampInt(options.requestTimeoutMs, 3_000, 100, 60_000),
      issueRetries: clampInt(options.issueRetries, 1, 0, 3),
      ...options,
    };
    if (options.tls) {
      validateMtlsOptions(options.tls!);
      const serverName = options.tls.serverName?.trim() || this.baseUrl.hostname;
      this.dispatcher = buildTlsDispatcher(options.tls!, serverName);
    }
  }

  async issue(request: CredentialGatewayRequest): Promise<CredentialLease> {
    assertRequest(request);
    // Hex keeps the first character alphanumeric so server-side key
    // validation can never silently drop it.
    const idempotencyKey = randomBytes(16).toString("hex");
    const body = JSON.stringify(request);
    let lastError: CredentialGatewayError | undefined;
    for (let attempt = 0; attempt <= this.options.issueRetries; attempt += 1) {
      try {
        const response = await this.request("v1/leases", { method: "POST", body, idempotencyKey });
        const payload = await this.readJson(response);
        if (!response.ok) throw errorFromResponse(payload);
        const lease = normalizeLease(payload);
        assertLeaseBinding(lease, request);
        return lease;
      } catch (error) {
        if (error instanceof CredentialGatewayError && (error.code === "network_error" || error.code === "timeout")) {
          lastError = error;
          continue; // idempotent retry with the same Idempotency-Key
        }
        throw error;
      }
    }
    throw lastError ?? new CredentialGatewayError("Credential gateway lease issuance failed.", "network_error");
  }

  async consume(lease: CredentialLease, request: CredentialGatewayRequest): Promise<string | undefined> {
    assertRequest(request);
    const body = JSON.stringify({
      ...request,
      leaseId: lease.leaseId,
      contractVersion: CREDENTIAL_BROKER_CONTRACT_VERSION,
    });
    const response = await this.request(`v1/leases/${encodeURIComponent(lease.leaseId)}/consume`, { method: "POST", body });
    const payload = await this.readJson(response);
    if (!response.ok) throw errorFromResponse(payload);
    const secret = (payload as { secret?: unknown }).secret;
    return typeof secret === "string" ? secret : undefined;
  }

  /** Revoke a lease (best effort, idempotent on the broker). */
  async revoke(lease: CredentialLease, request: CredentialGatewayRequest): Promise<void> {
    assertRequest(request);
    const body = JSON.stringify({
      leaseId: lease.leaseId,
      tenantId: request.tenantId,
      principalId: request.principalId,
      runId: request.runId,
      contractVersion: CREDENTIAL_BROKER_CONTRACT_VERSION,
    });
    try {
      await this.request(`v1/leases/${encodeURIComponent(lease.leaseId)}/revoke`, { method: "POST", body });
    } catch {
      // Revocation is best effort at the client; TTL still bounds the lease.
    }
  }

  private async request(path: string, init: { method: string; body: string; idempotencyKey?: string }): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.serviceToken}`,
      "X-Credential-Broker-Version": CREDENTIAL_BROKER_CONTRACT_VERSION,
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    };
    try {
      const requestInit: RequestInit & { dispatcher?: unknown } = {
        method: init.method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      };
      if (this.dispatcher) requestInit.dispatcher = this.dispatcher;
      return await this.fetchImpl(new URL(path, this.baseUrl), requestInit);
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new CredentialGatewayError("Credential gateway request timed out.", "timeout");
      }
      throw new CredentialGatewayError("Credential gateway is unreachable.", "network_error");
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
}

function errorFromResponse(payload: unknown): CredentialGatewayError {
  const code = (payload as { error?: { code?: unknown } })?.error?.code;
  if (typeof code === "string" && /^[a-z_]{3,48}$/.test(code)) {
    return new CredentialGatewayError("Credential gateway request was denied.", code as BrokerErrorCode);
  }
  return new CredentialGatewayError("Credential gateway request failed.", "gateway_unavailable");
}

function normalizeLease(payload: unknown): CredentialLease {
  const source = (payload as { lease?: unknown }).lease ?? payload;
  const record = source as { leaseId?: unknown; expiresAt?: unknown };
  if (typeof record.leaseId !== "string" || !record.leaseId || typeof record.expiresAt !== "number") {
    throw new CredentialGatewayError("Credential gateway lease response is invalid.", "gateway_unavailable");
  }
  return { leaseId: record.leaseId, expiresAt: record.expiresAt };
}

/** Defense in depth: a broker response must echo the requested binding when present. */
function assertLeaseBinding(lease: CredentialLease, request: CredentialGatewayRequest): void {
  const source = lease as CredentialLease & { tenantId?: string; principalId?: string; runId?: string; provider?: string; alias?: string };
  if (source.tenantId && source.tenantId !== request.tenantId) {
    throw new CredentialGatewayError("Credential gateway lease is bound to another tenant.", "gateway_unavailable");
  }
  if (source.principalId && source.principalId !== request.principalId) {
    throw new CredentialGatewayError("Credential gateway lease is bound to another principal.", "gateway_unavailable");
  }
  if (source.runId && source.runId !== request.runId) {
    throw new CredentialGatewayError("Credential gateway lease is bound to another run.", "gateway_unavailable");
  }
  if (source.provider && source.provider !== request.provider) {
    throw new CredentialGatewayError("Credential gateway lease provider mismatch.", "gateway_unavailable");
  }
  if (source.alias && source.alias !== request.alias) {
    throw new CredentialGatewayError("Credential gateway lease alias mismatch.", "gateway_unavailable");
  }
}

function validateMtlsOptions(tls: NonNullable<HttpCredentialGatewayOptions["tls"]>): void {
  for (const file of [tls.caFile, tls.certFile, tls.keyFile]) {
    if (!fs.existsSync(file)) throw new Error(`Credential broker mTLS file ${file} is unavailable.`);
  }
  // The client cert and the private key must belong to the same subject; Node
  // cannot encode SPKI identities from PEM strings, so reject obvious swaps
  // before touching the network.
  const cert = fs.readFileSync(tls.certFile, "utf8");
  const key = fs.readFileSync(tls.keyFile, "utf8");
  if (cert.includes("PRIVATE KEY") && key.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("Credential broker mTLS certificate and key appear to be swapped.");
  }
  if (!tls.tlsMinVersion || (tls.tlsMinVersion !== "TLSv1.2" && tls.tlsMinVersion !== "TLSv1.3")) {
    throw new Error("Credential broker mTLS tlsMinVersion must be TLSv1.2 or TLSv1.3.");
  }
}

function buildTlsDispatcher(tls: NonNullable<HttpCredentialGatewayOptions["tls"]>, serverName: string): unknown {
  try {
    // undici powers the global fetch; a connected Agent presents client certs.
    const { Agent } = require("undici") as { Agent: new (options: Record<string, unknown>) => unknown };
    return new Agent({
      connect: {
        ca: readFileUtf8(tls.caFile),
        cert: readFileUtf8(tls.certFile),
        key: readFileUtf8(tls.keyFile),
        rejectUnauthorized: true,
        minVersion: tls.tlsMinVersion ?? "TLSv1.2",
        servername: serverName,
      },
    });
  } catch {
    throw new Error("Credential broker mTLS material is unavailable.");
  }
}

/**
 * A process-local gateway for development and single-server deployments.
 * Production deployments must replace it with an external secret broker
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

/**
 * Resolve the gateway for this process.
 *
 * Precedence:
 * 1. CREDENTIAL_BROKER_URL (external broker; preferred in production)
 * 2. TOOL_CREDENTIAL_GATEWAY_URL (legacy broker URL, still honored)
 * 3. EnvironmentCredentialGateway — development/single-server only.
 *
 * Production never falls back to the process-local gateway: a missing or
 * invalid broker configuration throws at startup (fail closed).
 */
export function credentialGatewayFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): CredentialGateway {
  const config = brokerClientConfigFromEnvironment(env);
  if (config.enabled && config.url) {
    return httpGatewayFromConfig(config, env);
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Production requires an external credential broker; the process-local gateway is not permitted.");
  }
  return new EnvironmentCredentialGateway(env.TOOL_CREDENTIAL_GATEWAY_ENABLED === "true", env, boundedTtl(env.TOOL_CREDENTIAL_GATEWAY_TTL_MS));
}

function httpGatewayFromConfig(config: BrokerClientConfig, env: Readonly<Record<string, string | undefined>>): HttpCredentialGateway {
  const retries = Number(env.CREDENTIAL_BROKER_ISSUE_RETRIES ?? 1);
  const tls = config.tls
    ? ({
        caFile: config.tls.caFile,
        certFile: config.tls.certFile,
        keyFile: config.tls.keyFile,
        tlsMinVersion: env.CREDENTIAL_BROKER_TLS_MIN_VERSION === "TLSv1.3" ? "TLSv1.3" : "TLSv1.2",
        serverName: env.CREDENTIAL_BROKER_TLS_SERVER_NAME?.trim(),
      } as HttpCredentialGatewayOptions["tls"])
    : undefined;
  return new HttpCredentialGateway(
    config.url,
    config.serviceToken,
    fetch,
    {
      requestTimeoutMs: config.requestTimeoutMs,
      issueRetries: Number.isInteger(retries) && retries >= 0 && retries <= 3 ? retries : 1,
      ...(tls ? { tls } : {}),
    },
  );
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

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
