import { createBrokerHarness, leaseRequest, verifyAuditChain, type BrokerHarness } from "./helpers/brokerHarness";

const SECOND = 1_000;

function auditEvents(harness: BrokerHarness, operation?: string) {
  return harness.audit.all().filter((record) => (operation ? record.operation === operation : true));
}

async function issueAndConsume(harness: BrokerHarness, overrides: Record<string, unknown> = {}) {
  const request = leaseRequest(overrides);
  const lease = await harness.service.issue(request);
  const secret = await harness.service.consume({ ...request, leaseId: lease.leaseId });
  return { request, lease, secret };
}

describe("broker service: lease lifecycle", () => {
  test("issue returns a single-use lease bound to tenant, principal, run, provider, and alias", async () => {
    const harness = createBrokerHarness();
    const lease = await harness.service.issue(leaseRequest());
    expect(lease.singleUse).toBe(true);
    expect(lease.tenantId).toBe("tenant-a");
    expect(lease.principalId).toBe("user-a");
    expect(lease.runId).toBe("run-a");
    expect(lease.provider).toBe("database");
    expect(lease.alias).toBe("main");
    expect(lease.contractVersion).toBe("1");
    expect(lease.expiresAt).toBeGreaterThan(Date.now());

    const stored = await harness.leases.get(lease.leaseId);
    expect(stored).not.toBeNull();
    // The lease record itself never carries secret material.
    expect(JSON.stringify(stored)).not.toContain("postgres://");
  });

  test("consume returns the secret exactly once; replay fails", async () => {
    const harness = createBrokerHarness();
    const { request, lease, secret } = await issueAndConsume(harness);
    expect(secret).toBe("postgres://fake-broker-db/tenant-a");
    await expect(harness.service.consume({ ...request, leaseId: lease.leaseId }))
      .rejects.toMatchObject({ code: "lease_consumed" });
  });

  test("expired leases are not consumable", async () => {
    const harness = createBrokerHarness({ limits: { maxTtlMs: 5_000, defaultTtlMs: 2_000 } });
    const request = leaseRequest({ requestedTtlMs: 2_000 });
    const lease = await harness.service.issue(request);
    harness.setNow(lease.expiresAt + 1);
    await expect(harness.service.consume({ ...request, leaseId: lease.leaseId }))
      .rejects.toMatchObject({ code: "lease_expired" });
    expect(auditEvents(harness, "lease.consume.denied")[0].reasonCode).toBe("lease_expired");
  });

  test("revoke is idempotent and blocks later consumption", async () => {
    const harness = createBrokerHarness();
    const request = leaseRequest();
    const lease = await harness.service.issue(request);
    await expect(harness.service.revoke({ ...request, leaseId: lease.leaseId })).resolves.toEqual({ revoked: true });
    await expect(harness.service.revoke({ ...request, leaseId: lease.leaseId })).resolves.toEqual({ revoked: true });
    await expect(harness.service.consume({ ...request, leaseId: lease.leaseId }))
      .rejects.toMatchObject({ code: "lease_revoked" });
    // Revoking an unknown lease also succeeds (idempotent by contract).
    await expect(harness.service.revoke({ ...request, leaseId: "z".repeat(43) })).resolves.toEqual({ revoked: true });
  });

  test("wrong-context consumption is rejected for tenant, principal, run, provider, and alias", async () => {
    const harness = createBrokerHarness();
    const request = leaseRequest();
    const lease = await harness.service.issue(request);
    const mismatches: Array<Record<string, unknown>> = [
      { tenantId: "tenant-b", principalId: "user-b", runId: "run-b" },
      { principalId: "user-a2" },
      { runId: "run-a2" },
      { provider: "search" },
      { alias: "web" },
    ];
    for (const mismatch of mismatches) {
      await expect(harness.service.consume({ ...request, ...mismatch, leaseId: lease.leaseId }))
        .rejects.toMatchObject({ code: "context_mismatch" });
    }
    // The rightful owner can still consume after failed hijack attempts.
    const secret = await harness.service.consume({ ...request, leaseId: lease.leaseId });
    expect(secret).toBe("postgres://fake-broker-db/tenant-a");
  });

  test("concurrent consumption allows only one success", async () => {
    const harness = createBrokerHarness();
    const request = leaseRequest();
    const lease = await harness.service.issue(request);
    const attempts = Array.from({ length: 8 }, () =>
      harness.service.consume({ ...request, leaseId: lease.leaseId }).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    );
    const results = await Promise.all(attempts);
    const successes = results.filter((result) => result.ok);
    expect(successes).toHaveLength(1);
    for (const failure of results.filter((result) => !result.ok)) {
      expect((failure as { error: { code?: string } }).error.code).toBe("lease_consumed");
    }
  });

  test("revoked/consumed lease state survives a store restart (persistence contract)", async () => {
    const harness = createBrokerHarness();
    const request = leaseRequest();
    const lease = await harness.service.issue(request);
    await harness.leases.revoke(lease.leaseId, "test", Date.now());
    // A brand-new read path (simulating a fresh process over the same store)
    // still observes the revocation.
    const reloaded = await harness.leases.get(lease.leaseId);
    expect(reloaded?.status).toBe("revoked");
    await expect(harness.service.consume({ ...request, leaseId: lease.leaseId }))
      .rejects.toMatchObject({ code: "lease_revoked" });
  });
});

describe("broker service: idempotent issuance", () => {
  test("same idempotency key returns the original lease", async () => {
    const harness = createBrokerHarness();
    const first = await harness.service.issue(leaseRequest(), "idem-key-0001");
    const second = await harness.service.issue(leaseRequest(), "idem-key-0001");
    expect(second.leaseId).toBe(first.leaseId);
  });

  test("same key with a different request is a conflict", async () => {
    const harness = createBrokerHarness();
    await harness.service.issue(leaseRequest(), "idem-key-0002");
    await expect(harness.service.issue(leaseRequest({ alias: "web", provider: "search", purpose: "search" }), "idem-key-0002"))
      .rejects.toMatchObject({ code: "contract_idempotency_conflict" });
  });

  test("idempotency keys are tenant-scoped", async () => {
    const harness = createBrokerHarness();
    const first = await harness.service.issue(leaseRequest(), "shared-key-01");
    const second = await harness.service.issue(
      leaseRequest({ tenantId: "tenant-b", principalId: "user-b", runId: "run-b" }),
      "shared-key-01",
    );
    expect(second.leaseId).not.toBe(first.leaseId);
  });
});

describe("broker service: rate limits and quotas", () => {
  test("lease issuance per tenant per minute is enforced", async () => {
    const harness = createBrokerHarness({ rateLimits: { issuePerTenantPerMinute: 2 } });
    await harness.service.issue(leaseRequest({ alias: "web", provider: "search", purpose: "search" }));
    await harness.service.issue(leaseRequest({ alias: "web", provider: "search", purpose: "search" }));
    await expect(harness.service.issue(leaseRequest({ alias: "web", provider: "search", purpose: "search" })))
      .rejects.toMatchObject({ code: "rate_limited" });
    expect(auditEvents(harness, "lease.issue.denied").some((record) => record.reasonCode === "rate_limited")).toBe(true);
  });

  test("rate limit responses never leak policy detail", async () => {
    const harness = createBrokerHarness({ rateLimits: { issuePerTenantPerMinute: 0 } });
    // Zero limit: every issuance is denied.
    await expect(harness.service.issue(leaseRequest())).rejects.toMatchObject({
      code: "rate_limited",
      message: expect.not.stringMatching(/60|tenant-a|policy/i),
    });
  });

  test("consumption attempts per lease are bounded", async () => {
    const harness = createBrokerHarness({ rateLimits: { consumeAttemptsPerLease: 2 } });
    const request = leaseRequest();
    const lease = await harness.service.issue(request);
    // Two failed attempts (wrong run) exhaust the attempt budget...
    await expect(harness.service.consume({ ...request, runId: "run-a2", leaseId: lease.leaseId })).rejects.toMatchObject({ code: "context_mismatch" });
    await expect(harness.service.consume({ ...request, runId: "run-a2", leaseId: lease.leaseId })).rejects.toMatchObject({ code: "context_mismatch" });
    // ...so even the rightful owner is now limited.
    await expect(harness.service.consume({ ...request, leaseId: lease.leaseId })).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("active leases per tenant cap concurrent issuance", async () => {
    const harness = createBrokerHarness({ rateLimits: { activeLeasesPerTenant: 2 } });
    await harness.service.issue(leaseRequest({ alias: "web", provider: "search", purpose: "search" }));
    await harness.service.issue(leaseRequest({ alias: "web", provider: "search", purpose: "search" }));
    await expect(harness.service.issue(leaseRequest({ alias: "web", provider: "search", purpose: "search" })))
      .rejects.toMatchObject({ code: "rate_limited" });
    // Consuming frees capacity because the lease is no longer active.
    const leases = harness.leases.scan().filter((record) => record.status === "issued");
    await harness.service.consume({ ...leaseRequest({ alias: "web", provider: "search", purpose: "search" }), leaseId: leases[0].leaseId });
    await expect(harness.service.issue(leaseRequest({ alias: "web", provider: "search", purpose: "search" }))).resolves.toBeDefined();
  });

  test("per-run credential usage quota is enforced", async () => {
    let used = 0;
    const harness = createBrokerHarness({
      usage: { async runUsage() { return used; }, async tenantSpend() { return 0; } },
    });
    used = 0;
    await harness.service.issue(leaseRequest());
    used = 1_000; // quota in the harness policy is 1000
    await expect(harness.service.issue(leaseRequest())).rejects.toMatchObject({ code: "quota_exceeded" });
  });

  test("per-tenant cost budget is enforced", async () => {
    const { BrokerPolicy } = await import("../src/broker/policy");
    const { validateLeaseRequest, DEFAULT_LEASE_LIMITS } = await import("../src/broker/contract");
    const harness = createBrokerHarness();
    const policy = new BrokerPolicy(harness.authorization, { maxCredentialUsesPerRun: 100, tenantBudgets: { "tenant-a": 5 } }, {
      async runUsage() { return 0; },
      async tenantSpend(tenantId) { return tenantId === "tenant-a" ? 5 : 0; },
    });
    const request = validateLeaseRequest(leaseRequest(), DEFAULT_LEASE_LIMITS);
    await expect(policy.authorizeIssue({ request, now: Date.now() }))
      .rejects.toMatchObject({ code: "quota_exceeded" });
    // An unbudgeted tenant is unaffected.
    const other = validateLeaseRequest(
      leaseRequest({ tenantId: "tenant-b", principalId: "user-b", runId: "run-b" }),
      DEFAULT_LEASE_LIMITS,
    );
    await expect(policy.authorizeIssue({ request: other, now: Date.now() })).resolves.toBeUndefined();
  });
});

describe("broker service: policy denial and secret-store failure", () => {
  test("inactive tenant, foreign principal, and foreign run are all denied", async () => {
    const harness = createBrokerHarness();
    harness.authorization.activeTenants.delete("tenant-a");
    await expect(harness.service.issue(leaseRequest())).rejects.toMatchObject({ code: "tenant_inactive" });
    harness.authorization.activeTenants.add("tenant-a");

    await expect(harness.service.issue(leaseRequest({ principalId: "user-x" })))
      .rejects.toMatchObject({ code: "principal_mismatch" });
    await expect(harness.service.issue(leaseRequest({ runId: "run-x" })))
      .rejects.toMatchObject({ code: "run_mismatch" });
    await expect(harness.service.issue(leaseRequest({ alias: "other" })))
      .rejects.toMatchObject({ code: "credential_not_provisioned" });
  });

  test("agent/tool bindings are enforced when present", async () => {
    const harness = createBrokerHarness();
    await expect(harness.service.issue(leaseRequest({ agentId: "agent-1" }))).resolves.toBeDefined();
    await expect(harness.service.issue(leaseRequest({ agentId: "agent-evil" })))
      .rejects.toMatchObject({ code: "policy_denied" });
    await expect(harness.service.issue(leaseRequest({ toolId: "tool-1" }))).resolves.toBeDefined();
    await expect(harness.service.issue(leaseRequest({ toolId: "tool-evil" })))
      .rejects.toMatchObject({ code: "policy_denied" });
  });

  test("secret store outage fails closed and never returns a fallback", async () => {
    const harness = createBrokerHarness();
    const request = leaseRequest();
    const lease = await harness.service.issue(request);
    harness.secrets.failNext(new (await import("../src/broker/contract")).BrokerError("secretstore_unavailable"));
    await expect(harness.service.consume({ ...request, leaseId: lease.leaseId }))
      .rejects.toMatchObject({ code: "secretstore_unavailable" });
    // The lease was consumed; recovery requires a fresh issue (fail closed).
    await expect(harness.service.consume({ ...request, leaseId: lease.leaseId }))
      .rejects.toMatchObject({ code: "lease_consumed" });
    const denied = auditEvents(harness, "lease.consume.denied");
    expect(denied.some((record) => record.reasonCode === "secretstore_unavailable")).toBe(true);
  });
});

describe("broker service: audit trail", () => {
  test("issue and consume produce the full event set with no secret material", async () => {
    const harness = createBrokerHarness();
    await issueAndConsume(harness);
    const operations = harness.audit.all().map((record) => record.operation);
    expect(operations).toEqual(expect.arrayContaining([
      "lease.issue.requested",
      "lease.issue.succeeded",
      "lease.consume.succeeded",
    ]));
    const serialized = JSON.stringify(harness.audit.all());
    expect(serialized).not.toContain("postgres://fake-broker-db");
    expect(serialized).not.toContain("search-fake-key");
    expect(serialized).not.toContain("Bearer");
    expect(verifyAuditChain(harness.audit.all())).toBe(true);
  });

  test("denied operations record a machine-readable reason code", async () => {
    const harness = createBrokerHarness();
    harness.authorization.activeTenants.delete("tenant-a");
    await expect(harness.service.issue(leaseRequest())).rejects.toThrow();
    const denied = auditEvents(harness, "lease.issue.denied");
    expect(denied).toHaveLength(1);
    expect(denied[0].reasonCode).toBe("tenant_inactive");
    expect(denied[0].result).toBe("denied");
    expect(denied[0].tenantId).toBe("tenant-a");
    expect(denied[0].sourceService).toBe("test-broker");
  });

  test("audit records are queryable by tenant and run", async () => {
    const harness = createBrokerHarness();
    await issueAndConsume(harness);
    await issueAndConsume(harness, { runId: "run-a2" });
    const byRun = await harness.audit.query({ runId: "run-a2" });
    expect(byRun.length).toBeGreaterThan(0);
    expect(byRun.every((record) => record.runId === "run-a2")).toBe(true);
    const byTenant = await harness.audit.query({ tenantId: "tenant-a" });
    expect(byTenant.length).toBe(harness.audit.all().length);
    const foreign = await harness.audit.query({ tenantId: "tenant-zzz" });
    expect(foreign).toHaveLength(0);
  });

  test("audit builder drops unknown input fields and rejects secret-looking values", async () => {
    const { auditEvent } = await import("../src/broker/audit");
    // Unknown fields on the input are structurally ignored: only whitelisted
    // fields are ever constructed into the record.
    const record = auditEvent({
      tenantId: "t", principalId: "p", operation: "lease.issue.succeeded", result: "succeeded",
      sourceService: "s", alias: "main",
      apiKey: "sk-should-never-appear",
      authorization: "Bearer abc",
    } as never, 1, "0".repeat(64), Date.now());
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("sk-should-never-appear");
    expect(serialized).not.toContain("Bearer abc");
    expect(Object.keys(record)).toEqual(expect.arrayContaining([
      "eventId", "timestamp", "tenantId", "principalId", "operation", "result", "sourceService",
    ]));
    // Values that look like credentials are rejected outright.
    expect(() => auditEvent({
      tenantId: "t", principalId: "p", operation: "lease.issue.succeeded", result: "succeeded",
      sourceService: "s", correlationId: "postgres://user:pass@db/secret",
    }, 1, "0".repeat(64), Date.now())).toThrow();
    expect(() => auditEvent({
      tenantId: "t", principalId: "p", operation: "lease.consume.succeeded", result: "succeeded",
      sourceService: "s", alias: "main",
    }, 1, "0".repeat(64), Date.now())).not.toThrow();
  });

  test("expired-lease cleanup removes records and reports a count", async () => {
    const harness = createBrokerHarness({ limits: { maxTtlMs: 3_000, defaultTtlMs: 1_000 } });
    const lease = await harness.service.issue(leaseRequest());
    expect(await harness.service.cleanupExpired()).toBe(0);
    harness.setNow(lease.expiresAt + SECOND);
    expect(await harness.service.cleanupExpired()).toBe(1);
    expect(await harness.leases.get(lease.leaseId)).toBeNull();
  });
});
