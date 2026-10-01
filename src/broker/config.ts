import fs from "node:fs";
import { BrokerError, DEFAULT_LEASE_LIMITS, type LeaseRequestLimits } from "./contract";
import { rateLimitFromEnvironment, type RateLimitConfig } from "./rateLimit";
import type { Scope } from "./httpApp";
import { TLS_MIN_VERSION, TLS_MAX_VERSION, type TlsVersion } from "./tls";

/**
 * Configuration boundary for both sides of the broker:
 * - `brokerConfigFromEnvironment` configures the broker service itself.
 * - `assertValidBrokerClientEnvironment` configures/validates the execution
 *   server's client before it may attempt a connection.
 *
 * Rules:
 * - Production (NODE_ENV === "production") fails startup unless a valid
 *   external broker URL, service token, and (when required) mTLS material are
 *   present. The process-local gateway is never selected in production.
 * - URLs with embedded credentials, query strings, fragments, or non-HTTP(S)
 *   schemes are rejected.
 * - Configuration values are never logged; only file *names* may be logged.
 * - Development may disable mTLS (NODE_ENV !== "production" only).
 */

export interface BrokerTlsConfig {
  caFile: string;
  certFile: string;
  keyFile: string;
  /** Server cert file (the broker listener cert), not the client cert. */
  serverCertFile: string;
  /** Server key file (the broker listener key), not the client key. */
  serverKeyFile: string;
  caBundleFile?: string;
  /** Minimum TLS version accepted by the broker listener. */
  minimumTlsVersion?: TlsVersion;
  /** Trust-bundle rotation window end (epoch ms). Certs signed before this are rejected unless superseded by the active CA. */
  trustBundleRotationEndMs?: number;
  /** Identity allowlist for client certificates by subject DN (exact/wildcard). */
  allowedClientSubjects?: string[];
  /** Identity allowlist for client certificates by SAN (wildcard prefixes stripped). */
  allowedClientSanPatterns?: string[];
  /** Allowed service identities for transparent proxy-terminated deployments. */
  allowedClientServiceIdentities?: string[];
  /** Trusted source addresses for proxy-terminated deployments. Empty = direct mTLS. */
  trustedProxyAddresses?: string[];
}

export interface BrokerClientConfig {
  url: string;
  serviceToken: string;
  requestTimeoutMs: number;
  maxTtlMs: number;
  requireMtls: boolean;
  tls?: BrokerTlsConfig;
  failClosed: boolean;
  enabled: boolean;
}

export type BrokerEnvironment = Readonly<Record<string, string | undefined>>;

function isProduction(env: BrokerEnvironment): boolean {
  return env.NODE_ENV === "production";
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function validateBrokerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Credential broker URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Credential broker URL must be HTTP(S).");
  }
  if (url.username || url.password) {
    throw new Error("Credential broker URL must not contain embedded credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Credential broker URL must not contain query parameters or fragments.");
  }
  return url.toString().replace(/\/$/, "");
}

function readTlsConfig(env: BrokerEnvironment): BrokerTlsConfig | undefined {
  const caFile = env.CREDENTIAL_BROKER_CA_FILE?.trim();
  const serverCertFile = env.CREDENTIAL_BROKER_SERVER_CERT_FILE?.trim() || env.CREDENTIAL_BROKER_CLIENT_CERT_FILE?.trim();
  const serverKeyFile = env.CREDENTIAL_BROKER_SERVER_KEY_FILE?.trim() || env.CREDENTIAL_BROKER_CLIENT_KEY_FILE?.trim();
  const caBundleFile = env.CREDENTIAL_BROKER_CA_BUNDLE_FILE?.trim();
  const minimumTlsVersion = env.CREDENTIAL_BROKER_TLS_MIN_VERSION === "TLSv1.2" || env.CREDENTIAL_BROKER_TLS_MIN_VERSION === "TLSv1.3"
    ? env.CREDENTIAL_BROKER_TLS_MIN_VERSION
    : undefined;
  const trustBundleRotationEndMs = env.CREDENTIAL_BROKER_TRUST_BUNDLE_ROTATION_END_MS
    ? Number(env.CREDENTIAL_BROKER_TRUST_BUNDLE_ROTATION_END_MS)
    : undefined;
  if (!caFile && !serverCertFile && !serverKeyFile) return undefined;
  if (!caFile || !serverCertFile || !serverKeyFile) {
    throw new Error("Credential broker mTLS requires CA, server cert, and server key files together.");
  }
  return {
    caFile,
    certFile: serverCertFile,
    keyFile: serverKeyFile,
    serverCertFile,
    serverKeyFile,
    caBundleFile: caBundleFile || undefined,
    minimumTlsVersion,
    trustBundleRotationEndMs: Number.isInteger(trustBundleRotationEndMs) ? trustBundleRotationEndMs : undefined,
  };
}

function parseStringList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function assertFilesExist(tls: BrokerTlsConfig): void {
  // Only file names appear in errors — never file contents.
  for (const [label, file] of [["CA", tls.caFile], ["server cert", tls.certFile], ["server key", tls.keyFile]] as const) {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(file);
    } catch {
      stat = undefined;
    }
    if (!stat || !stat.isFile()) throw new Error(`Credential broker ${label} file "${file.split(/[\\/]/).pop()}" is unavailable.`);
  }
}

/**
 * Validate and build the execution-server broker client configuration.
 * Throws on any production-unsafe combination (fail closed at startup).
 */
export function brokerClientConfigFromEnvironment(env: BrokerEnvironment = process.env): BrokerClientConfig {
  const url = env.CREDENTIAL_BROKER_URL?.trim() || env.TOOL_CREDENTIAL_GATEWAY_URL?.trim() || "";
  const serviceToken = env.CREDENTIAL_BROKER_SERVICE_TOKEN?.trim() || env.TOOL_CREDENTIAL_GATEWAY_SERVICE_TOKEN?.trim() || "";
  const requireMtlsRaw = env.CREDENTIAL_BROKER_REQUIRE_MTLS;
  const production = isProduction(env);
  const failClosed = env.CREDENTIAL_BROKER_FAIL_CLOSED !== "false";
  const enabled = env.CREDENTIAL_BROKER_ENABLED === "true" || Boolean(url);

  if (!url) {
    if (production) {
      throw new Error("Production requires CREDENTIAL_BROKER_URL; the process-local credential gateway is not permitted.");
    }
    if (env.CREDENTIAL_BROKER_ENABLED === "true") {
      // Explicit enablement without a URL is a misconfiguration, not a fallback.
      throw new Error("CREDENTIAL_BROKER_ENABLED=true requires CREDENTIAL_BROKER_URL.");
    }
    return {
      url: "", serviceToken, requestTimeoutMs: 3_000, maxTtlMs: DEFAULT_LEASE_LIMITS.maxTtlMs,
      requireMtls: false, failClosed, enabled: false,
    };
  }

  const validatedUrl = validateBrokerUrl(url);
  if (!serviceToken) {
    if (production) throw new Error("Production requires CREDENTIAL_BROKER_SERVICE_TOKEN.");
    throw new Error("CREDENTIAL_BROKER_SERVICE_TOKEN is required to reach the credential broker.");
  }

  const requireMtls = requireMtlsRaw === undefined
    ? production
    : requireMtlsRaw === "true";
  if (production && requireMtlsRaw === "false") {
    throw new Error("Production requires CREDENTIAL_BROKER_REQUIRE_MTLS=true.");
  }
  if (production && !failClosed) {
    throw new Error("Production requires CREDENTIAL_BROKER_FAIL_CLOSED=true.");
  }
  if (requireMtls && validatedUrl.startsWith("http:")) {
    throw new Error("Credential broker mTLS requires an HTTPS URL.");
  }

  const tls = readTlsConfig(env);
  if (requireMtls) {
    if (!tls) throw new Error("Production credential broker requires CA, client cert, and client key files.");
    assertFilesExist(tls);
  } else if (tls) {
    assertFilesExist(tls);
  }
  return {
    url: validatedUrl,
    serviceToken,
    requestTimeoutMs: boundedInt(env.CREDENTIAL_BROKER_REQUEST_TIMEOUT_MS, 3_000, 100, 60_000),
    maxTtlMs: boundedInt(env.CREDENTIAL_BROKER_MAX_TTL_MS, DEFAULT_LEASE_LIMITS.maxTtlMs, 1_000, 5 * 60_000),
    requireMtls,
    ...(tls ? { tls } : {}),
    failClosed,
    enabled: true,
  };
}

/** Startup assertion for the execution server: production never silently degrades. */
export function assertValidBrokerClientEnvironment(env: BrokerEnvironment = process.env): BrokerClientConfig {
  const config = brokerClientConfigFromEnvironment(env);
  if (isProduction(env) && !config.enabled) {
    throw new Error("Production requires an external credential broker.");
  }
  return config;
}

export interface BrokerServerConfig {
  port: number;
  requireMtls: boolean;
  tls?: BrokerTlsConfig & { serverCertFile: string; serverKeyFile: string };
  /** Accepted service tokens with scopes; deny-by-default when empty in production. */
  serviceTokens: Array<{ token: string; name: string; scopes: Scope[] }>;
  leaseLimits: LeaseRequestLimits;
  rateLimits: RateLimitConfig;
  auditEnabled: boolean;
  sourceService: string;
  vault?: { baseUrl: string; token: string; mount?: string };
}

const ALL_SCOPES: Scope[] = ["leases:issue", "leases:consume", "leases:revoke", "audit:read"];

/**
 * Broker-side configuration. In production: mTLS material, at least one service
 * token, and a secret store address are mandatory; otherwise startup fails.
 */
export function brokerServerConfigFromEnvironment(env: BrokerEnvironment = process.env): BrokerServerConfig {
  const production = isProduction(env);
  const requireMtls = env.CREDENTIAL_BROKER_REQUIRE_MTLS === "true" || (production && env.CREDENTIAL_BROKER_REQUIRE_MTLS !== "false");

  // Rotatable token list: name:token[:scopes] entries, comma separated.
  const serviceTokens = (env.CREDENTIAL_BROKER_SERVICE_TOKENS ?? "").split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, token, scopes] = entry.split(":");
      return {
        name: name?.trim() || "service",
        token: token?.trim() || "",
        scopes: (scopes?.split("+").filter(Boolean) as Scope[] | undefined) ?? ALL_SCOPES,
      };
    })
    .filter((entry) => entry.token);

  if (production && serviceTokens.length === 0) {
    throw new Error("Production credential broker requires CREDENTIAL_BROKER_SERVICE_TOKENS.");
  }

  let tls: BrokerTlsConfig | undefined;
  if (requireMtls) {
    const caFile = env.CREDENTIAL_BROKER_CA_FILE?.trim();
    const caBundleFile = env.CREDENTIAL_BROKER_CA_BUNDLE_FILE?.trim();
    const certFile = env.CREDENTIAL_BROKER_SERVER_CERT_FILE?.trim() || env.CREDENTIAL_BROKER_CLIENT_CERT_FILE?.trim();
    const keyFile = env.CREDENTIAL_BROKER_SERVER_KEY_FILE?.trim() || env.CREDENTIAL_BROKER_CLIENT_KEY_FILE?.trim();
    if (!caFile || !certFile || !keyFile) {
      throw new Error("Credential broker mTLS requires CA, server cert, and server key files.");
    }
    for (const file of [caFile, certFile, keyFile]) {
      if (!fs.existsSync(file)) throw new Error(`Credential broker TLS file "${file.split(/[\\/]/).pop()}" is unavailable.`);
    }
    tls = {
      caFile,
      certFile,
      keyFile,
      serverCertFile: certFile,
      serverKeyFile: keyFile,
      caBundleFile,
      minimumTlsVersion: env.CREDENTIAL_BROKER_TLS_MIN_VERSION === "TLSv1.2" || env.CREDENTIAL_BROKER_TLS_MIN_VERSION === "TLSv1.3" ? env.CREDENTIAL_BROKER_TLS_MIN_VERSION : undefined,
      trustBundleRotationEndMs: env.CREDENTIAL_BROKER_TRUST_BUNDLE_ROTATION_END_MS
        ? Number(env.CREDENTIAL_BROKER_TRUST_BUNDLE_ROTATION_END_MS)
        : undefined,
      allowedClientSubjects: parseStringList(env.CREDENTIAL_BROKER_ALLOWED_CLIENT_SUBJECTS),
      allowedClientSanPatterns: parseStringList(env.CREDENTIAL_BROKER_ALLOWED_CLIENT_SAN_PATTERNS),
      allowedClientServiceIdentities: parseStringList(env.CREDENTIAL_BROKER_ALLOWED_CLIENT_SERVICE_IDENTITIES),
      trustedProxyAddresses: parseStringList(env.CREDENTIAL_BROKER_TRUSTED_PROXY_ADDRESSES),
    };
  } else if (requireMtls === false) {
    tls = undefined;
  } else {
    // requireMtls was not explicitly enabled: production must fail closed.
    if (production && env.CREDENTIAL_BROKER_REQUIRE_MTLS !== "false") {
      throw new Error("Production requires CREDENTIAL_BROKER_REQUIRE_MTLS=true.");
    }
    tls = undefined;
  }

  const vaultBaseUrl = env.CREDENTIAL_BROKER_VAULT_URL?.trim() ?? "";
  const vaultToken = env.CREDENTIAL_BROKER_VAULT_TOKEN?.trim() ?? "";
  if (vaultBaseUrl) {
    try {
      const parsed = new URL(vaultBaseUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
      if (parsed.username || parsed.password || parsed.search) throw new Error();
    } catch {
      throw new Error("CREDENTIAL_BROKER_VAULT_URL must be HTTP(S) without embedded credentials or query parameters.");
    }
  }
  if (production && !vaultBaseUrl) {
    throw new Error("Production credential broker requires CREDENTIAL_BROKER_VAULT_URL.");
  }

  const maxTtlMs = boundedInt(env.CREDENTIAL_BROKER_MAX_TTL_MS, DEFAULT_LEASE_LIMITS.maxTtlMs, 1_000, 5 * 60_000);
  const enabledProviders = new Set(
    (env.CREDENTIAL_BROKER_ENABLED_PROVIDERS ?? "").split(",").map((p) => p.trim()).filter(Boolean),
  );

  return {
    port: boundedInt(env.CREDENTIAL_BROKER_PORT, 8484, 1, 65_535),
    requireMtls,
    ...(tls ? { tls } : {}),
    serviceTokens,
    leaseLimits: {
      maxTtlMs,
      defaultTtlMs: Math.min(boundedInt(env.CREDENTIAL_BROKER_DEFAULT_TTL_MS, 30_000, 1_000, maxTtlMs), maxTtlMs),
      minTtlMs: boundedInt(env.CREDENTIAL_BROKER_MIN_TTL_MS, 1_000, 100, maxTtlMs),
      enabledProviders: enabledProviders.size ? enabledProviders : DEFAULT_LEASE_LIMITS.enabledProviders,
    },
    rateLimits: rateLimitFromEnvironment(env),
    auditEnabled: env.CREDENTIAL_BROKER_AUDIT_ENABLED !== "false",
    sourceService: env.CREDENTIAL_BROKER_SOURCE_SERVICE?.trim() || "credential-broker",
    ...(vaultBaseUrl ? { vault: { baseUrl: vaultBaseUrl, token: vaultToken, ...(env.CREDENTIAL_BROKER_VAULT_MOUNT ? { mount: env.CREDENTIAL_BROKER_VAULT_MOUNT } : {}) } } : {}),
  };
}

/** Map environment misconfiguration to a broker-coded error for HTTP surfaces. */
export function configError(error: unknown): BrokerError {
  return error instanceof BrokerError ? error : new BrokerError("internal_error");
}
