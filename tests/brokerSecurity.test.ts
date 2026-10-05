import { BrokerWorkerCredentialResolver } from "../src/agents/runtime/workerCredentials";
import { brokerClientConfigFromEnvironment, brokerServerConfigFromEnvironment } from "../src/broker/config";
import { EnvironmentCredentialGateway, HttpCredentialGateway, CredentialGatewayError, credentialGatewayFromEnvironment } from "../src/security/credentialGateway";
import { BrokerApiCredentialResolver } from "../src/security/providerCredentials";
import { createBrokerHarness, leaseRequest, type BrokerHarness } from "./helpers/brokerHarness";
import { createBrokerApp, StaticServiceAuth } from "../src/broker/httpApp";
import type { CredentialGatewayFetch } from "../src/security/credentialGateway";

const TOKEN = "fake-broker-token-0001";

function fetchFor(harness: BrokerHarness): CredentialGatewayFetch {
  const app = createBrokerApp({
    service: harness.service,
    auth: new StaticServiceAuth([{ token: TOKEN, name: "execution-server", scopes: ["leases:issue", "leases:consume", "leases:revoke", "audit:read"] }]),
  });
  return async (input, init) => app.fetch(new Request(String(input), {
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    ...(init?.body !== undefined ? { body: init.body as string } : {}),
  }));
}

function makeClient(harness: BrokerHarness): HttpCredentialGateway {
  return new HttpCredentialGateway("https://broker.internal", TOKEN, fetchFor(harness));
}

const tenantA = {
  provider: "database" as const, alias: "main",
  tenantId: "tenant-a", principalId: "user-a", runId: "run-a",
};
const tenantB = {
  provider: "database" as const, alias: "main",
  tenantId: "tenant-b", principalId: "user-b", runId: "run-b",
};

describe("security: lease isolation across tenants, principals, and runs", () => {
  test("tenant A cannot consume a lease belonging to tenant B", async () => {
    const harness = createBrokerHarness();
    const client = makeClient(harness);
    const lease = await client.issue(tenantB);
    const stolen = await client.consume(lease, { ...tenantB, tenantId: "tenant-a", principalId: "user-a", runId: "run-a" })
      .catch((error: unknown) => error);
    expect((stolen as CredentialGatewayError).code).toBe("context_mismatch");
    // Tenant B's own consume still works: denial did not burn the lease... but
    // attempts are counted, and one failed attempt is within budget.
    const secret = await client.consume(lease, tenantB);
    expect(secret).toBe("postgres://fake-broker-db/tenant-b");
    // Tenant A never observed tenant B's secret anywhere.
    expect(String(stolen)).not.toContain("tenant-b");
  });

  test("principal A cannot consume a lease belonging to principal B", async () => {
    const harness = createBrokerHarness();
    const client = makeClient(harness);
    const lease = await client.issue(tenantA);
    const error = await client.consume(lease, { ...tenantA, principalId: "user-a2" }).catch((caught: unknown) => caught);
    expect((error as CredentialGatewayError).code).toBe("context_mismatch");
  });

  test("run A cannot consume a lease belonging to run B", async () => {
    const harness = createBrokerHarness();
    const client = makeClient(harness);
    const lease = await client.issue(tenantA);
    const error = await client.consume(lease, { ...tenantA, runId: "run-a2" }).catch((caught: unknown) => caught);
    expect((error as CredentialGatewayError).code).toBe("context_mismatch");
  });

  test("replaying a consumed lease fails and never returns the secret again", async () => {
    const harness = createBrokerHarness();
    const client = makeClient(harness);
    const lease = await client.issue(tenantA);
    const first = await client.consume(lease, tenantA);
    expect(first).toBe("postgres://fake-broker-db/tenant-a");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = await client.consume(lease, tenantA).catch((error: unknown) => error);
      expect((replay as CredentialGatewayError).code).toBe("lease_consumed");
      expect(String(replay)).not.toContain("postgres://");
    }
  });

  test("a revoked lease cannot be consumed", async () => {
    const harness = createBrokerHarness();
    const client = makeClient(harness);
    const lease = await client.issue(tenantA);
    await client.revoke(lease, tenantA);
    const error = await client.consume(lease, tenantA).catch((caught: unknown) => caught);
    expect((error as CredentialGatewayError).code).toBe("lease_revoked");
  });

  test("a compromised worker brute-forcing bindings is rate-limited", async () => {
    const harness = createBrokerHarness({ rateLimits: { consumeAttemptsPerLease: 3 } });
    const client = makeClient(harness);
    const lease = await client.issue(tenantA);
    const codes: string[] = [];
    for (const runId of ["run-x1", "run-x2", "run-x3", "run-x4", "run-a"]) {
      const error = await client.consume(lease, { ...tenantA, runId }).catch((caught: unknown) => caught);
      codes.push((error as CredentialGatewayError).code);
    }
    expect(codes.slice(0, 3)).toEqual(["context_mismatch", "context_mismatch", "context_mismatch"]);
    expect(codes[3]).toBe("rate_limited");
    expect(codes[4]).toBe("rate_limited"); // rightful run locked out after brute force
    const auditJson = JSON.stringify(harness.audit.all());
    expect(auditJson).not.toContain("postgres://");
  });

  test("cross-tenant revoke is rejected without confirming existence", async () => {
    const harness = createBrokerHarness();
    const client = makeClient(harness);
    const lease = await client.issue(tenantA);
    const serviceError = await harness.service.revoke({
      leaseId: lease.leaseId, tenantId: "tenant-b", principalId: "user-b", runId: "run-b", contractVersion: "1",
    }).catch((caught: unknown) => caught);
    expect((serviceError as { code?: string }).code).toBe("context_mismatch");
    const stored = await harness.leases.get(lease.leaseId);
    expect(stored?.status).toBe("issued");
    // Client-side revoke is best-effort and never crashes the caller, but the
    // broker refused the foreign context: the lease stays issued and the
    // rightful owner can still consume it.
    await client.revoke(lease, tenantB);
    expect((await harness.leases.get(lease.leaseId))?.status).toBe("issued");
    await expect(client.consume(lease, tenantA)).resolves.toBeTruthy();
  });
});

describe("security: production fail-closed configuration", () => {
  const productionEnv = {
    NODE_ENV: "production",
    CREDENTIAL_BROKER_URL: "https://credential-broker.internal",
    CREDENTIAL_BROKER_SERVICE_TOKEN: "rotatable-token",
    CREDENTIAL_BROKER_REQUIRE_MTLS: "true",
    CREDENTIAL_BROKER_CA_FILE: "/etc/broker/ca.pem",
    CREDENTIAL_BROKER_CLIENT_CERT_FILE: "/etc/broker/client.pem",
    CREDENTIAL_BROKER_CLIENT_KEY_FILE: "/etc/broker/client-key.pem",
  };

  test("production cannot construct a gateway without a broker URL", () => {
    expect(() => brokerClientConfigFromEnvironment({ NODE_ENV: "production" }))
      .toThrow(/Production requires CREDENTIAL_BROKER_URL/);
    expect(() => credentialGatewayFromEnvironment({ NODE_ENV: "production" }))
      .toThrow(/external credential broker|CREDENTIAL_BROKER_URL/);
  });

  test("production cannot fall back to the process-local gateway", () => {
    const env = {
      NODE_ENV: "production",
      TOOL_CREDENTIAL_GATEWAY_ENABLED: "true",
      TOOL_DATABASE_MAIN_URL: "postgres://should-not-be-used",
    };
    expect(() => credentialGatewayFromEnvironment(env)).toThrow();
    // Even with the legacy gateway enabled flag set, production refuses.
    const composed = () => credentialGatewayFromEnvironment({ ...env, TOOL_CREDENTIAL_GATEWAY_URL: "https://legacy.internal" });
    // Legacy URL without a token also fails.
    expect(composed).toThrow(/SERVICE_TOKEN/);
  });

  test("production requires mTLS and rejects disabling it", () => {
    expect(() => brokerClientConfigFromEnvironment({ ...productionEnv, CREDENTIAL_BROKER_REQUIRE_MTLS: "false" }))
      .toThrow(/REQUIRE_MTLS/);
    // Missing cert files (this path verifies existence checks fire).
    expect(() => brokerClientConfigFromEnvironment({
      ...productionEnv,
      CREDENTIAL_BROKER_CA_FILE: "/nonexistent/ca.pem",
      CREDENTIAL_BROKER_CLIENT_CERT_FILE: "/nonexistent/client.pem",
      CREDENTIAL_BROKER_CLIENT_KEY_FILE: "/nonexistent/key.pem",
    })).toThrow(/unavailable/);
  });

  test("production rejects broker URLs with embedded credentials or query strings", () => {
    for (const url of [
      "https://user:pass@broker.internal",
      "https://broker.internal?token=abc",
      "https://broker.internal/#fragment",
      "ftp://broker.internal",
      "not-a-url",
    ]) {
      expect(() => brokerClientConfigFromEnvironment({ ...productionEnv, CREDENTIAL_BROKER_URL: url })).toThrow();
    }
  });

  test("development may disable mTLS, production may not", () => {
    const dev = brokerClientConfigFromEnvironment({
      CREDENTIAL_BROKER_URL: "http://localhost:8484",
      CREDENTIAL_BROKER_SERVICE_TOKEN: "dev-token",
      CREDENTIAL_BROKER_REQUIRE_MTLS: "false",
    });
    expect(dev.requireMtls).toBe(false);
    expect(dev.enabled).toBe(true);

    // Default in production is mTLS on; verify with real (dummy) files on disk
    // since config validates file existence, not file contents.
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "broker-mtls-"));
    try {
      const ca = path.join(dir, "ca.pem");
      const cert = path.join(dir, "client.pem");
      const key = path.join(dir, "client-key.pem");
      fs.writeFileSync(ca, "dummy-ca");
      fs.writeFileSync(cert, "dummy-cert");
      fs.writeFileSync(key, "dummy-key");
      const { CREDENTIAL_BROKER_REQUIRE_MTLS: _omit, ...withoutFlag } = productionEnv;
      const config = brokerClientConfigFromEnvironment({
        ...withoutFlag,
        CREDENTIAL_BROKER_CA_FILE: ca,
        CREDENTIAL_BROKER_CLIENT_CERT_FILE: cert,
        CREDENTIAL_BROKER_CLIENT_KEY_FILE: key,
      });
      expect(config.requireMtls).toBe(true);
      expect(config.tls?.caFile).toBe(ca);
      // Production + mTLS + an http URL is rejected.
      expect(() => brokerClientConfigFromEnvironment({
        ...withoutFlag,
        CREDENTIAL_BROKER_URL: "http://credential-broker.internal",
        CREDENTIAL_BROKER_CA_FILE: ca,
        CREDENTIAL_BROKER_CLIENT_CERT_FILE: cert,
        CREDENTIAL_BROKER_CLIENT_KEY_FILE: key,
      })).toThrow(/HTTPS/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("production rejects fail-open broker configuration", () => {
    expect(() => brokerClientConfigFromEnvironment({ ...productionEnv, CREDENTIAL_BROKER_FAIL_CLOSED: "false" }))
      .toThrow(/FAIL_CLOSED/);
  });

  test("production broker server requires service tokens and vault", () => {
    expect(() => brokerServerConfigFromEnvironment({ NODE_ENV: "production" }))
      .toThrow(/SERVICE_TOKENS|VAULT/);
  });

  test("broker-enabled-without-URL is a hard error, not a silent fallback", () => {
    expect(() => brokerClientConfigFromEnvironment({ CREDENTIAL_BROKER_ENABLED: "true" }))
      .toThrow(/CREDENTIAL_BROKER_URL/);
  });
});

describe("security: worker credential delivery", () => {
  const context = { tenantId: "tenant-a", principalId: "user-a", runId: "run-a", agentId: "agent-1", provider: "codex" };

  test("broker worker resolver returns a secret only through the launch-secret channel", async () => {
    const harness = createBrokerHarness();
    const gateway = new HttpCredentialGateway("https://broker.internal", TOKEN, fetchFor(harness));
    const resolver = new BrokerWorkerCredentialResolver({
      enabled: true,
      trustedServerDelivery: true,
      isProduction: false,
      providerAliases: { codex: "dev" },
      providerEnvironmentNames: { codex: "OPENAI_API_KEY" },
    }, gateway);
    // Route the broker harness to the codex alias by overriding provisioned set.
    harness.authorization.provisioned.add("tenant-a/codex/dev");
    const secrets = await resolver.resolve(context);
    expect(secrets?.environment).toEqual({ OPENAI_API_KEY: "codex-fake-key" });
    // Nothing but the launch-secret object holds it; no files, no persistence.
    expect(secrets?.files).toBeUndefined();
    expect(JSON.stringify(secrets)).toContain("codex-fake-key");
  });

  test("disabled resolver returns no credentials at all", async () => {
    const harness = createBrokerHarness();
    const gateway = new HttpCredentialGateway("https://broker.internal", TOKEN, fetchFor(harness));
    const resolver = new BrokerWorkerCredentialResolver({
      enabled: false,
      trustedServerDelivery: false,
      isProduction: false,
      providerAliases: { codex: "dev" },
      providerEnvironmentNames: { codex: "OPENAI_API_KEY" },
    }, gateway);
    await expect(resolver.resolve(context)).resolves.toBeUndefined();
    expect(harness.leases.scan()).toHaveLength(0);
  });

  test("unsupported launch-secret environment names are rejected", async () => {
    const harness = createBrokerHarness();
    const gateway = new HttpCredentialGateway("https://broker.internal", TOKEN, fetchFor(harness));
    const resolver = new BrokerWorkerCredentialResolver({
      enabled: true,
      trustedServerDelivery: true,
      isProduction: false,
      providerAliases: { codex: "dev" },
      providerEnvironmentNames: { codex: "DATABASE_URL" },
    }, gateway);
    await expect(resolver.resolve(context)).rejects.toThrow(/Unsupported server credential environment/);
  });

  test("production refuses server-mediated delivery without explicit acknowledgment", () => {
    const harness = createBrokerHarness();
    void harness;
    const gateway = new HttpCredentialGateway("https://broker.internal", TOKEN, async () => new Response("{}"));
    expect(() => new BrokerWorkerCredentialResolver({
      enabled: true,
      trustedServerDelivery: false,
      isProduction: true,
      providerAliases: { codex: "dev" },
      providerEnvironmentNames: { codex: "OPENAI_API_KEY" },
    }, gateway)).toThrow(/TRUSTED_SERVER_DELIVERY/);
  });

  test("invalid broker aliases are rejected before any request is made", async () => {
    const harness = createBrokerHarness();
    let called = false;
    const fetchImpl: CredentialGatewayFetch = async (...args) => { called = true; return fetchFor(harness)(...args); };
    const gateway = new HttpCredentialGateway("https://broker.internal", TOKEN, fetchImpl);
    const resolver = new BrokerWorkerCredentialResolver({
      enabled: true,
      trustedServerDelivery: true,
      isProduction: false,
      providerAliases: { codex: "../etc/passwd" },
      providerEnvironmentNames: { codex: "OPENAI_API_KEY" },
    }, gateway);
    await expect(resolver.resolve(context)).rejects.toThrow(/alias is invalid/);
    expect(called).toBe(false);
  });
});

describe("security: API provider credential leasing", () => {
  test("leased key is passed to the model and never persisted", async () => {
    const harness = createBrokerHarness();
    harness.authorization.provisioned.add("tenant-a/openai/team");
    const gateway = new HttpCredentialGateway("https://broker.internal", TOKEN, fetchFor(harness));
    const resolver = new BrokerApiCredentialResolver(gateway, { openai: "team" });
    const key = await resolver.resolve({ provider: "openai", tenantId: "tenant-a", principalId: "user-a", runId: "run-a", agentId: "agent-1" });
    expect(key).toBe("sk-fake-not-real");
    // Lease consumed once; audit records contain no key material.
    expect(harness.leases.scan()[0].status).toBe("consumed");
    expect(JSON.stringify(harness.audit.all())).not.toContain("sk-fake-not-real");
  });

  test("unprovisioned provider alias fails closed", async () => {
    const harness = createBrokerHarness();
    const gateway = new HttpCredentialGateway("https://broker.internal", TOKEN, fetchFor(harness));
    const resolver = new BrokerApiCredentialResolver(gateway, { openai: "unknown-alias" });
    await expect(resolver.resolve({ provider: "openai", tenantId: "tenant-a", principalId: "user-a", runId: "run-a", agentId: "agent-1" }))
      .rejects.toMatchObject({ code: "credential_not_provisioned" });
  });
});

describe("security: secrets absent from unauthorized surfaces", () => {
  test("unauthenticated caller receives no lease data at all", async () => {
    const harness = createBrokerHarness();
    const app = createBrokerApp({
      service: harness.service,
      auth: new StaticServiceAuth([{ token: TOKEN, name: "execution-server", scopes: ["leases:issue"] }]),
    });
    const response = await app.fetch(new Request("https://broker.internal/v1/leases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leaseRequest()),
    }));
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toContain("leaseId");
    expect(text).not.toContain("postgres://");
    expect(harness.leases.scan()).toHaveLength(0);
  });

  test("environment gateway alias mapping cannot address arbitrary env vars", () => {
    const gateway = new EnvironmentCredentialGateway(true, { TOOL_DATABASE_MAIN_URL: "postgres://x" }, 1_000);
    void gateway;
    // The alias regex runs before any env lookup.
    return Promise.all([
      expect(gateway.issue({ provider: "database", alias: "main; rm -rf /", tenantId: "t", principalId: "p", runId: "r" }))
        .rejects.toThrow(/alias is invalid/),
      expect(gateway.issue({ provider: "database", alias: "$(env)", tenantId: "t", principalId: "p", runId: "r" }))
        .rejects.toThrow(/alias is invalid/),
      expect(gateway.issue({ provider: "database", alias: "main", tenantId: "t", principalId: "p", runId: "r" }))
        .resolves.toBeDefined(),
    ]);
  });

  test("process-local gateway is disabled by default and fails closed", async () => {
    const gateway = new EnvironmentCredentialGateway(false, { TOOL_DATABASE_MAIN_URL: "postgres://x" }, 1_000);
    await expect(gateway.issue({ provider: "database", alias: "main", tenantId: "t", principalId: "p", runId: "r" }))
      .rejects.toThrow(/disabled/);
  });
});
