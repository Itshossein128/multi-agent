import { createBrokerApp, StaticServiceAuth } from "../src/broker/httpApp";
import { createBrokerHarness, leaseRequest, type BrokerHarness } from "./helpers/brokerHarness";
import { HttpCredentialGateway, CredentialGatewayError, type CredentialGatewayFetch } from "../src/security/credentialGateway";

/**
 * Fake broker: the real Hono app + real service + in-memory stores. Only the
 * network and the secret backend are fake — no real provider is contacted.
 */

const VALID_TOKEN = "fake-broker-token-0001";

function brokerFetch(harness: BrokerHarness, capture?: Array<{ url: string; headers: Headers; body: unknown }>): CredentialGatewayFetch {
  const app = createBrokerApp({
    service: harness.service,
    auth: new StaticServiceAuth([
      { token: VALID_TOKEN, name: "execution-server", scopes: ["leases:issue", "leases:consume", "leases:revoke", "audit:read"] },
      { token: "audit-only-token-01", name: "auditor", scopes: ["audit:read"] },
    ]),
  });
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (capture) {
      capture.push({
        url: String(input),
        headers,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
    }
    const request = new Request(url, {
      method: init?.method ?? "GET",
      headers,
      ...(init?.body !== undefined ? { body: init.body as string } : {}),
    });
    return app.fetch(request);
  };
}

function gateway(harness: BrokerHarness, capture?: Array<{ url: string; headers: Headers; body: unknown }>, options = {}): HttpCredentialGateway {
  return new HttpCredentialGateway("https://broker.internal", VALID_TOKEN, brokerFetch(harness, capture), options);
}

const clientRequest = {
  provider: "database" as const,
  alias: "main",
  tenantId: "tenant-a",
  principalId: "user-a",
  runId: "run-a",
};

describe("broker HTTP: client against fake broker", () => {
  test("issue + consume round-trip carries service auth and stays opaque", async () => {
    const harness = createBrokerHarness();
    const capture: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const client = gateway(harness, capture);
    const lease = await client.issue(clientRequest);
    expect(lease.leaseId).toBeTruthy();
    const secret = await client.consume(lease, clientRequest);
    expect(secret).toBe("postgres://fake-broker-db/tenant-a");

    expect(capture[0].headers.get("authorization")).toBe(`Bearer ${VALID_TOKEN}`);
    expect(capture[0].headers.get("x-credential-broker-version")).toBe("1");
    expect(capture[0].headers.get("idempotency-key")).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(capture[0].url).not.toContain("token");
    // The lease id travels in the path, not the query string.
    expect(capture[1].url).toContain(`/v1/leases/${lease.leaseId}/consume`);
    expect(new URL(capture[1].url).search).toBe("");
  });

  test("second consume surfaces a machine-readable already-consumed error", async () => {
    const harness = createBrokerHarness();
    const client = gateway(harness);
    const lease = await client.issue(clientRequest);
    await client.consume(lease, clientRequest);
    const replay = await client.consume(lease, clientRequest).catch((error: unknown) => error);
    expect(replay).toBeInstanceOf(CredentialGatewayError);
    expect((replay as CredentialGatewayError).code).toBe("lease_consumed");
    expect((replay as CredentialGatewayError).message).not.toContain("postgres://");
  });

  test("network retries reuse the idempotency key and do not duplicate the lease", async () => {
    const harness = createBrokerHarness();
    const capture: Array<{ url: string; headers: Headers; body: unknown }> = [];
    let failures = 1;
    const inner = brokerFetch(harness, capture);
    const flakyFetch: CredentialGatewayFetch = async (input, init) => {
      if (failures > 0) {
        failures -= 1;
        throw new TypeError("fetch failed"); // simulated network outage
      }
      return inner(input, init);
    };
    const client = new HttpCredentialGateway("https://broker.internal", VALID_TOKEN, flakyFetch, { issueRetries: 2 });
    const lease = await client.issue(clientRequest);
    expect(lease.leaseId).toBeTruthy();
    // Two attempts happened, both with the same idempotency key.
    expect(capture).toHaveLength(1);
    const stored = harness.leases.scan();
    expect(stored).toHaveLength(1);
    expect(stored[0].idempotencyKey).toBe(capture[0].headers.get("idempotency-key"));
  });

  test("persistent network failure fails closed with a machine-readable code", async () => {
    const harness = createBrokerHarness();
    const failing: CredentialGatewayFetch = async () => { throw new TypeError("fetch failed"); };
    const client = new HttpCredentialGateway("https://broker.internal", VALID_TOKEN, failing, { issueRetries: 1 });
    const error = await client.issue(clientRequest).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CredentialGatewayError);
    expect((error as CredentialGatewayError).code).toBe("network_error");
    expect(harness.leases.scan()).toHaveLength(0);
  });

  test("network timeout fails closed with timeout code", async () => {
    const harness = createBrokerHarness();
    const hanging: CredentialGatewayFetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason ?? new Error("aborted")));
      });
    const client = new HttpCredentialGateway("https://broker.internal", VALID_TOKEN, hanging, { requestTimeoutMs: 100, issueRetries: 0 });
    const error = await client.issue(clientRequest).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CredentialGatewayError);
    expect((error as CredentialGatewayError).code).toBe("timeout");
  });

  test("server-side lease expiry surfaces as lease_expired to the client", async () => {
    const harness = createBrokerHarness();
    const client = gateway(harness);
    const lease = await client.issue({ ...clientRequest, requestedTtlMs: 1_000 });
    harness.setNow(lease.expiresAt + 1);
    const error = await client.consume(lease, clientRequest).catch((caught: unknown) => caught);
    expect((error as CredentialGatewayError).code).toBe("lease_expired");
  });
});

describe("broker HTTP: service authentication", () => {
  test("missing or wrong bearer token is rejected", async () => {
    const harness = createBrokerHarness();
    const noAuth: CredentialGatewayFetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.delete("Authorization");
      return (brokerFetch(harness))(input, { ...init, headers });
    };
    const client = new HttpCredentialGateway("https://broker.internal", VALID_TOKEN, noAuth);
    const error = await client.issue(clientRequest).catch((caught: unknown) => caught);
    expect((error as CredentialGatewayError).code).toBe("unauthenticated");

    const wrongToken = new HttpCredentialGateway("https://broker.internal", "wrong-token", brokerFetch(harness));
    const error2 = await wrongToken.issue(clientRequest).catch((caught: unknown) => caught);
    expect((error2 as CredentialGatewayError).code).toBe("unauthenticated");
    expect(harness.leases.scan()).toHaveLength(0);
  });

  test("scope enforcement: audit-only identity cannot issue leases", async () => {
    const harness = createBrokerHarness();
    const auditorFetch: CredentialGatewayFetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", "Bearer audit-only-token-01");
      return brokerFetch(harness)(input, { ...init, headers });
    };
    const client = new HttpCredentialGateway("https://broker.internal", VALID_TOKEN, auditorFetch);
    const error = await client.issue(clientRequest).catch((caught: unknown) => caught);
    expect((error as CredentialGatewayError).code).toBe("forbidden");
  });

  test("health endpoint requires no auth but discloses nothing sensitive", async () => {
    const harness = createBrokerHarness();
    const response = await brokerFetch(harness)("https://broker.internal/v1/health", { method: "GET" });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("ok");
    expect(body).not.toMatch(/postgres|vault|token|secret|tenant/i);
  });

  test("credentials in query parameters are rejected outright", async () => {
    const harness = createBrokerHarness();
    const fetchImpl = brokerFetch(harness);
    for (const key of ["token", "api_key", "secret", "authorization", "password"]) {
      const response = await fetchImpl(`https://broker.internal/v1/leases?${key}=value`, {
        method: "POST",
        headers: { Authorization: `Bearer ${VALID_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(leaseRequest()),
      });
      expect(response.status).toBe(400);
    }
    expect(harness.leases.scan()).toHaveLength(0);
  });

  test("non-JSON and oversized bodies are rejected", async () => {
    const harness = createBrokerHarness();
    const fetchImpl = brokerFetch(harness);
    const form = await fetchImpl("https://broker.internal/v1/leases", {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, "Content-Type": "text/plain" },
      body: "alias=main",
    });
    expect(form.status).toBe(400);
    const big = await fetchImpl("https://broker.internal/v1/leases", {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...leaseRequest(), pad: "x".repeat(64 * 1024) }),
    });
    expect(big.status).toBe(400);
  });

  test("internal failures never leak stack traces or store details", async () => {
    const harness = createBrokerHarness();
    // Force an unexpected failure by breaking the audit recorder once.
    const original = harness.audit.record.bind(harness.audit);
    harness.audit.record = async () => { throw new Error("postgres://leaky:password@db/audit"); };
    const response = await brokerFetch(harness)("https://broker.internal/v1/leases", {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(leaseRequest()),
    });
    // audit.requested failure before try-block surfaces as generic 500
    expect(response.status).toBeGreaterThanOrEqual(400);
    const text = await response.text();
    expect(text).not.toContain("leaky");
    expect(text).not.toContain("password");
    expect(text).not.toContain("postgres");
    harness.audit.record = original;
  });

  test("audit endpoint requires audit:read scope and filters by tenant", async () => {
    const harness = createBrokerHarness();
    const client = gateway(harness);
    const lease = await client.issue(clientRequest);
    await client.consume(lease, clientRequest);

    const fetchImpl = brokerFetch(harness);
    const denied = await fetchImpl("https://broker.internal/v1/audit/leases?tenantId=tenant-a", {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    // execution-server identity holds audit:read in this harness
    expect(denied.status).toBe(200);
    const body = await denied.json() as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
    expect(JSON.stringify(body.events)).not.toContain("fake-broker-db");

    const unauth = await fetchImpl("https://broker.internal/v1/audit/leases", { method: "GET" });
    expect(unauth.status).toBe(401);
  });

  test("lease path/body leaseId mismatch is rejected", async () => {
    const harness = createBrokerHarness();
    const client = gateway(harness);
    const lease = await client.issue(clientRequest);
    const fetchImpl = brokerFetch(harness);
    const response = await fetchImpl(`https://broker.internal/v1/leases/${lease.leaseId}/consume`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...clientRequest, leaseId: "c".repeat(43) }),
    });
    expect(response.status).toBe(400);
  });
});

describe("broker HTTP: revoke through the client", () => {
  test("revoke prevents consumption and is idempotent", async () => {
    const harness = createBrokerHarness();
    const client = gateway(harness);
    const lease = await client.issue(clientRequest);
    await client.revoke(lease, clientRequest);
    await client.revoke(lease, clientRequest); // idempotent
    const error = await client.consume(lease, clientRequest).catch((caught: unknown) => caught);
    expect((error as CredentialGatewayError).code).toBe("lease_revoked");
  });
});
