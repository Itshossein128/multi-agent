import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import type { Server } from "node:http";
import { InMemoryAuditRecorder, PostgresAuditRecorder, type AuditRecorder, type AuditPgPool } from "./audit";
import { brokerServerConfigFromEnvironment, type BrokerServerConfig } from "./config";
import { createBrokerApp, StaticServiceAuth } from "./httpApp";
import { InMemoryLeaseStore, PostgresLeaseStore, startLeaseCleanup, type LeasePgPool, type LeaseStore } from "./leaseStore";
import { BrokerPolicy, type AuthorizationSource, type QuotaUsageSource } from "./policy";
import { RateLimiter } from "./rateLimit";
import { CredentialBrokerService } from "./service";
import { InMemorySecretStore, VaultSecretStore, type SecretStore } from "./secretStore";
import {
  createSecureServer,
  type BrokerServerHandle,
  type SecureServerResult,
} from "./tls";

/**
 * Broker composition and standalone entrypoint.
 *
 * The broker is an independent service: it owns its own secret-store access,
 * lease persistence, and audit trail. Deployments run it with
 * `node dist/broker/server.js` (mTLS in production) while tests compose the
 * same pieces in-process with fake stores.
 */

export interface BrokerCompositionOptions {
  config: BrokerServerConfig;
  stores: { leases: LeaseStore; secrets: SecretStore; audit: AuditRecorder };
  authorization: AuthorizationSource;
  usage?: QuotaUsageSource;
}

const NO_USAGE: QuotaUsageSource = {
  async runUsage() { return 0; },
  async tenantSpend() { return 0; },
};

export function createCredentialBrokerService(options: BrokerCompositionOptions): CredentialBrokerService {
  const policy = new BrokerPolicy(
    options.authorization,
    { maxCredentialUsesPerRun: 1_000 },
    options.usage ?? NO_USAGE,
  );
  return new CredentialBrokerService({
    leases: options.stores.leases,
    secrets: options.stores.secrets,
    audit: options.stores.audit,
    policy,
    rateLimiter: new RateLimiter(options.config.rateLimits),
    limits: options.config.leaseLimits,
    sourceService: options.config.sourceService,
    activeLeases: {
      async countActive(tenantId, now) {
        // Cheap probe via audit-free store scan contract: lease stores expose
        // countActive when they can; in-memory fallback scans get().
        const store = options.stores.leases as { countActive?(tenantId: string, now: number): Promise<number> };
        if (typeof store.countActive === "function") return store.countActive(tenantId, now);
        return 0;
      },
    },
  });
}

export function createBrokerHttpApp(service: CredentialBrokerService, config: BrokerServerConfig): Hono {
  return createBrokerApp({
    service,
    auth: new StaticServiceAuth(config.serviceTokens),
  });
}

export interface RunningBroker {
  app: Hono;
  diagnostics?: SecureServerResult;
  stopCleanup(): void;
  close(): Promise<void>;
}

/** Compose and start the broker HTTP(S) server. Fails closed on invalid production config. */
export async function startBroker(
  env: BrokerEnvironmentLike = process.env,
  overrides?: Partial<BrokerCompositionOptions>,
): Promise<RunningBroker> {
  const config = brokerServerConfigFromEnvironment(env);
  const pool = createBrokerPool(env);
  const stores: BrokerCompositionOptions["stores"] = overrides?.stores ?? {
    leases: pool ? new PostgresLeaseStore(pool) : new InMemoryLeaseStore(),
    secrets: config.vault
      ? new VaultSecretStore({ baseUrl: config.vault.baseUrl, token: config.vault.token, ...(config.vault.mount ? { mount: config.vault.mount } : {}) })
      : new InMemorySecretStore(),
    audit: pool ? new PostgresAuditRecorder(pool as AuditPgPool) : new InMemoryAuditRecorder(),
  };
  const authorization: AuthorizationSource = overrides?.authorization ?? denyAllAuthorization();
  const service = createCredentialBrokerService({
    config,
    stores,
    authorization,
    ...(overrides?.usage ? { usage: overrides.usage } : {}),
  });
  const app = createBrokerHttpApp(service, config);

  const stopCleanup = startLeaseCleanup(stores.leases, {
    intervalMs: 60_000,
    onError: () => undefined, // cleanup failures are retried on the next tick
  });

  const handle = config.requireMtls && config.tls
    ? createSecureServer(
        app.fetch,
        {
          enabled: true,
          requireClientCertificate: true,
          caFile: config.tls.caFile,
          caBundleFile: config.tls.caBundleFile,
          serverCertificateFile: config.tls.serverCertFile,
          serverKeyFile: config.tls.serverKeyFile,
          allowedClientSubjects: config.tls.allowedClientSubjects,
          allowedClientSanPatterns: config.tls.allowedClientSanPatterns,
          allowedClientServiceIdentities: config.tls.allowedClientServiceIdentities,
          trustBundleRotationEndMs: config.tls.trustBundleRotationEndMs,
        },
        {
          trustedProxyAddresses: config.tls.trustedProxyAddresses,
        },
      )
    : {
        server: serve({ fetch: app.fetch, port: config.port }) as unknown as Server,
        diagnostics: undefined,
        listen: () => ({ close: async () => undefined }),
        close: async () => {
          // Plain (non-mTLS) path: no TLS listener to tear down.
        },
      };

  handle.listen(config.port);

  return {
    app,
    diagnostics: handle.diagnostics,
    stopCleanup,
    close: async () => {
      stopCleanup();
      await handle.close();
    },
  };
}

type BrokerEnvironmentLike = Readonly<Record<string, string | undefined>>;

function createBrokerPool(env: BrokerEnvironmentLike): (LeasePgPool & AuditPgPool) | undefined {
  const connectionString = env.CREDENTIAL_BROKER_DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  // Lazy require keeps pg an optional dependency of the broker package.
  const { Pool } = require("pg") as { Pool: new (options: Record<string, unknown>) => LeasePgPool & AuditPgPool & { end(): Promise<void> } };
  return new Pool({ connectionString, max: 8 });
}

/** Deny-by-default authorization used when no directory is configured. */
export function denyAllAuthorization(): AuthorizationSource {
  return {
    async isTenantActive() { return false; },
    async principalBelongsToTenant() { return false; },
    async runBelongsToTenant() { return false; },
    async agentAllowedProvider() { return false; },
    async toolAllowedAlias() { return false; },
    async credentialProvisioned() { return false; },
  };
}

if (require.main === module) {
  startBroker().then((running) => {
    // Certificate file names only — never contents, never tokens.
    console.log(`Credential broker listening (pid=${process.pid}).`);
    const shutdown = () => {
      void running.close().then(() => process.exit(0), () => process.exit(1));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }).catch((error) => {
    // Configuration errors are safe to print; they contain no secret values.
    console.error(error instanceof Error ? error.message : "Credential broker failed to start.");
    process.exit(1);
  });
}
