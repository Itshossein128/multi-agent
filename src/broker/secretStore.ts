import { BrokerError } from "./contract";

/**
 * Secret storage boundary for the Credential Broker.
 *
 * - Lookups are tenant-scoped; a tenant can never read another tenant's secret.
 * - No secret value may ever appear in logs, errors, audit records, or traces.
 * - InMemorySecretStore exists for tests and local development only.
 * - VaultSecretStore is the production adapter (Vault KV v2 HTTP API).
 */

export interface SecretStoreInput {
  provider: string;
  alias: string;
  tenantId: string;
}

export interface StoredSecret {
  value: string;
  version?: string;
  expiresAt?: number;
}

export interface SecretStore {
  getSecret(input: SecretStoreInput): Promise<StoredSecret>;
  revoke?(input: SecretStoreInput): Promise<void>;
  rotate?(input: SecretStoreInput): Promise<{ version?: string }>;
}

/** Marks an explicitly shared/global credential. Deny-by-default: unset means tenant-only. */
export interface SharedSecretPolicy {
  /** provider/alias pairs allowed to fall back to a shared, tenant-independent entry. */
  allowedSharedAliases: ReadonlySet<string>;
}

function sharedKey(provider: string, alias: string): string {
  return `${provider}/${alias}`;
}

/**
 * Test/development-only store. Secrets are supplied by the test harness, never
 * read from the process environment of the execution server.
 */
export class InMemorySecretStore implements SecretStore {
  private readonly tenantSecrets = new Map<string, StoredSecret>();
  private readonly sharedSecrets = new Map<string, StoredSecret>();
  private readonly revoked = new Set<string>();
  private failNextWith: BrokerError | undefined;

  constructor(
    entries: ReadonlyArray<SecretStoreInput & { value: string; version?: string; expiresAt?: number }> = [],
    private readonly sharedPolicy: SharedSecretPolicy = { allowedSharedAliases: new Set() },
  ) {
    for (const entry of entries) {
      this.tenantSecrets.set(this.key(entry), { value: entry.value, version: entry.version, expiresAt: entry.expiresAt });
    }
  }

  putShared(provider: string, alias: string, value: string): void {
    if (!this.sharedPolicy.allowedSharedAliases.has(sharedKey(provider, alias))) {
      throw new BrokerError("policy_denied");
    }
    this.sharedSecrets.set(sharedKey(provider, alias), { value });
  }

  /** Fault injection for fail-closed tests. Never carries a secret value. */
  failNext(error: BrokerError): void {
    this.failNextWith = error;
  }

  async getSecret(input: SecretStoreInput): Promise<StoredSecret> {
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = undefined;
      throw error;
    }
    const key = this.key(input);
    if (this.revoked.has(key)) throw new BrokerError("secret_unavailable");
    const scoped = this.tenantSecrets.get(key);
    if (scoped) return this.checkExpiry(scoped);
    const sharedKeyed = sharedKey(input.provider, input.alias);
    if (this.sharedPolicy.allowedSharedAliases.has(sharedKeyed)) {
      const shared = this.sharedSecrets.get(sharedKeyed);
      if (shared) return this.checkExpiry(shared);
    }
    throw new BrokerError("credential_not_provisioned");
  }

  async revoke(input: SecretStoreInput): Promise<void> {
    this.revoked.add(this.key(input));
    this.tenantSecrets.delete(this.key(input));
  }

  async rotate(input: SecretStoreInput): Promise<{ version?: string }> {
    const key = this.key(input);
    const existing = this.tenantSecrets.get(key);
    if (!existing) throw new BrokerError("credential_not_provisioned");
    const version = `v${Math.random().toString(36).slice(2, 10)}`;
    this.tenantSecrets.set(key, { ...existing, version });
    return { version };
  }

  private key(input: SecretStoreInput): string {
    return `${input.tenantId}\u0000${input.provider}\u0000${input.alias}`;
  }

  private checkExpiry(secret: StoredSecret): StoredSecret {
    if (secret.expiresAt !== undefined && secret.expiresAt <= Date.now()) {
      throw new BrokerError("secret_unavailable");
    }
    return secret;
  }
}

export type SecretStoreFetch = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>
  signal?: AbortSignal
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface VaultSecretStoreOptions {
  baseUrl: string;
  token: string;
  /** KV v2 mount path, e.g. "secret". */
  mount?: string;
  fetchImpl?: SecretStoreFetch;
  timeoutMs?: number;
  sharedPolicy?: SharedSecretPolicy;
}

/**
 * HashiCorp Vault KV v2 adapter.
 *
 * - Secret path is derived only from validated provider/alias/tenant inputs;
 *   callers cannot smuggle path segments (contract validation runs first).
 * - Vault address and token come from broker-side configuration, never from
 *   the request. Errors are generic; response bodies are never surfaced.
 * - Fails closed on network errors, non-2xx responses, or malformed data.
 */
export class VaultSecretStore implements SecretStore {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly fetchImpl: SecretStoreFetch;
  private readonly timeoutMs: number;
  private readonly sharedPolicy: SharedSecretPolicy;

  constructor(options: VaultSecretStoreOptions) {
    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      throw new BrokerError("secretstore_unavailable");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new BrokerError("secretstore_unavailable");
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new BrokerError("secretstore_unavailable");
    if (!options.token) throw new BrokerError("secretstore_unavailable");
    this.baseUrl = parsed.toString().replace(/\/$/, "");
    this.token = options.token;
    this.mount = (options.mount ?? "secret").replace(/[^a-zA-Z0-9-]/g, "") || "secret";
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as SecretStoreFetch);
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.sharedPolicy = options.sharedPolicy ?? { allowedSharedAliases: new Set() };
  }

  async getSecret(input: SecretStoreInput): Promise<StoredSecret> {
    let scoped: StoredSecret | undefined;
    try {
      scoped = await this.read(input.tenantId, input.provider, input.alias);
    } catch (error) {
      // Only a clean tenant miss (404) may consider the shared scope. An
      // expired or malformed tenant secret fails closed instead of silently
      // downgrading to shared credentials.
      if (!(error instanceof BrokerError) || error.code !== "credential_not_provisioned") throw error;
    }
    if (scoped !== undefined) return scoped;
    if (this.sharedPolicy.allowedSharedAliases.has(sharedKey(input.provider, input.alias))) {
      // read() surfaces a shared-scope miss as credential_not_provisioned.
      const shared = await this.read("_shared", input.provider, input.alias);
      if (shared !== undefined) return shared;
    }
    throw new BrokerError("credential_not_provisioned");
  }

  async revoke(input: SecretStoreInput): Promise<void> {
    const path = this.dataPath(input.tenantId, input.provider, input.alias);
    await this.request(path, "DELETE");
  }

  async rotate(input: SecretStoreInput): Promise<{ version?: string }> {
    const path = this.dataPath(input.tenantId, input.provider, input.alias);
    const body = await this.request(path, "POST", {});
    const version = readVersion(body);
    return version ? { version } : {};
  }

  private async read(tenantId: string, provider: string, alias: string): Promise<StoredSecret | undefined> {
    const body = await this.request(this.dataPath(tenantId, provider, alias), "GET");
    const data = unwrapKv2(body);
    if (!data || typeof data.value !== "string" || !data.value) throw new BrokerError("secret_unavailable");
    const expiresAt = typeof data.expires_at === "number" ? data.expires_at : undefined;
    if (expiresAt !== undefined && expiresAt <= Date.now()) throw new BrokerError("secret_unavailable");
    const version = body && typeof body === "object"
      ? String((body as { data?: { metadata?: { version?: unknown } } }).data?.metadata?.version ?? "")
      : "";
    return { value: data.value, ...(version ? { version } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}) };
  }

  private dataPath(tenantId: string, provider: string, alias: string): string {
    // All three segments are contract-validated ([A-Za-z0-9._-] only), so they
    // can never contain path traversal characters.
    return `${this.baseUrl}/v1/data/${this.mount}/${encodeURIComponent(tenantId)}/${encodeURIComponent(provider)}/${encodeURIComponent(alias)}`;
  }

  private async request(path: string, method: string, body?: unknown): Promise<unknown> {
    let response: { ok: boolean; status: number; json(): Promise<unknown> };
    try {
      response = await this.fetchImpl(path, {
        method,
        headers: { "X-Vault-Token": this.token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) } as never),
        signal: AbortSignal.timeout(this.timeoutMs),
      } as never);
    } catch {
      throw new BrokerError("secretstore_unavailable");
    }
    if (method === "DELETE") {
      if (!response.ok && response.status !== 404) throw new BrokerError("secretstore_unavailable");
      return undefined;
    }
    if (!response.ok) {
      throw new BrokerError(response.status === 404 ? "credential_not_provisioned" : "secretstore_unavailable");
    }
    try {
      return await response.json();
    } catch {
      throw new BrokerError("secretstore_unavailable");
    }
  }
}

function unwrapKv2(body: unknown): { value?: string; expires_at?: number } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const inner = (body as { data?: { data?: unknown } }).data?.data;
  if (!inner || typeof inner !== "object") return undefined;
  const record = inner as Record<string, unknown>;
  const value = typeof record.value === "string"
    ? record.value
    : typeof record.secret === "string"
      ? record.secret
      : undefined;
  return {
    ...(value !== undefined ? { value } : {}),
    ...(typeof record.expires_at === "number" ? { expires_at: record.expires_at } : {}),
  };
}

function readVersion(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const version = (body as { data?: { version?: unknown } }).data?.version;
  return version === undefined || version === null ? undefined : String(version);
}
