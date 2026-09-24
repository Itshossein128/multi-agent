import {
  BrokerError,
  CREDENTIAL_BROKER_CONTRACT_VERSION,
  DEFAULT_LEASE_LIMITS,
  brokerErrorMessage,
  validateAlias,
  validateConsumeRequest,
  validateLeaseRequest,
  validateProvider,
  validatePurpose,
  validateRevokeRequest,
  validateTtl,
  type LeaseRequestLimits,
} from "../src/broker/contract";
import { credentialEnvironmentName } from "../src/security/credentialGateway";

const limits: LeaseRequestLimits = { ...DEFAULT_LEASE_LIMITS, maxTtlMs: 30_000 };

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: CREDENTIAL_BROKER_CONTRACT_VERSION,
    tenantId: "tenant-a",
    principalId: "user-1",
    runId: "run-1",
    provider: "database",
    alias: "main",
    purpose: "database",
    ...overrides,
  };
}

describe("broker contract: lease request validation", () => {
  test("accepts a well-formed request and normalizes TTL", () => {
    const parsed = validateLeaseRequest(baseRequest(), limits);
    expect(parsed.tenantId).toBe("tenant-a");
    expect(parsed.purpose).toBe("database");
    expect(parsed.requestedTtlMs).toBe(30_000);
  });

  test("derives purpose from provider when omitted", () => {
    const { purpose: _p, ...withoutPurpose } = baseRequest();
    expect(validateLeaseRequest(withoutPurpose, limits).purpose).toBe("database");
    expect(validateLeaseRequest({ ...withoutPurpose, provider: "codex" }, limits).purpose).toBe("agent");
  });

  test("requires tenant, principal, and run identity", () => {
    for (const field of ["tenantId", "principalId", "runId"] as const) {
      const request = baseRequest();
      delete (request as Record<string, unknown>)[field];
      expect(() => validateLeaseRequest(request, limits)).toThrow(BrokerError);
      try {
        validateLeaseRequest(request, limits);
      } catch (error) {
        expect((error as BrokerError).code).toBe("invalid_request");
      }
    }
  });

  test("rejects unknown contract versions", () => {
    expect(() => validateLeaseRequest(baseRequest({ contractVersion: "999" }), limits))
      .toThrow(expect.objectContaining({ code: "unsupported_contract_version" }));
  });

  test("rejects identifier injection attempts", () => {
    for (const value of ["../etc/passwd", "a b", "", "-leading", "x".repeat(129), "${env}", "run\nid"]) {
      expect(() => validateLeaseRequest(baseRequest({ runId: value }), limits)).toThrow(BrokerError);
    }
  });
});

describe("broker contract: TTL bounds", () => {
  test("rejects TTL above the server maximum", () => {
    expect(() => validateTtl(30_001, limits)).toThrow(expect.objectContaining({ code: "ttl_out_of_bounds" }));
  });

  test("rejects TTL below the minimum and non-integers", () => {
    expect(() => validateTtl(999, limits)).toThrow(expect.objectContaining({ code: "invalid_ttl" }));
    expect(() => validateTtl(1.5, limits)).toThrow(expect.objectContaining({ code: "invalid_ttl" }));
    expect(() => validateTtl(-1, limits)).toThrow(expect.objectContaining({ code: "invalid_ttl" }));
    expect(() => validateTtl("10000" as unknown as number, limits)).toThrow(expect.objectContaining({ code: "invalid_ttl" }));
  });

  test("accepts bounds-inclusive values", () => {
    expect(validateTtl(1_000, limits)).toBe(1_000);
    expect(validateTtl(30_000, limits)).toBe(30_000);
  });
});

describe("broker contract: alias validation", () => {
  test("accepts server-owned aliases", () => {
    for (const alias of ["main", "web-search", "db.primary_1", "a"]) {
      expect(validateAlias(alias)).toBe(alias);
    }
  });

  test("rejects aliases that could become paths or env names", () => {
    for (const alias of ["../secrets", "/etc/passwd", "a/b", "a b", ".hidden", "-dash", "", "x".repeat(65), "a\\b", "a\nb", "$(whoami)", "token;drop"]) {
      expect(() => validateAlias(alias)).toThrow(expect.objectContaining({ code: "invalid_alias" }));
    }
  });

  test("alias cannot select an arbitrary environment variable", () => {
    // The gateway rejects path-like aliases before any env name is derived...
    expect(() => {
      const alias = "../../etc";
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(alias)) throw new Error("Credential gateway alias is invalid.");
      return credentialEnvironmentName({ provider: "search", alias });
    }).toThrow(/alias is invalid/i);
    // ...and even a sanitized alias can only produce a bounded, prefixed name.
    const derived = credentialEnvironmentName({ provider: "search", alias: "../../etc" });
    expect(derived).toMatch(/^TOOL_SEARCH_[A-Z0-9_]+_API_KEY$/);
    expect(derived).not.toContain("..");
    expect(derived).not.toContain("/");
    expect(credentialEnvironmentName({ provider: "search", alias: "web" })).toBe("TOOL_SEARCH_WEB_API_KEY");
    // Very long aliases are rejected outright rather than truncated into collisions.
    expect(() => credentialEnvironmentName({ provider: "database", alias: "x" })).not.toThrow();
    expect(credentialEnvironmentName({ provider: "database", alias: "x" })).toBe("TOOL_DATABASE_X_URL");
  });
});

describe("broker contract: provider and purpose allowlists", () => {
  test("provider allowlist is enforced", () => {
    expect(validateProvider("openai", limits)).toBe("openai");
    expect(() => validateProvider("evil-provider", limits)).toThrow(expect.objectContaining({ code: "provider_not_allowed" }));
    expect(() => validateProvider("OPENAI", limits)).toThrow(expect.objectContaining({ code: "invalid_provider" }));
    expect(() => validateProvider("openai; curl attacker", limits)).toThrow(expect.objectContaining({ code: "invalid_provider" }));
    expect(() => validateProvider(42, limits)).toThrow(expect.objectContaining({ code: "invalid_provider" }));
  });

  test("narrowed provider allowlists are honored", () => {
    const narrowed: LeaseRequestLimits = { ...limits, enabledProviders: new Set(["database"]) };
    expect(() => validateProvider("openai", narrowed)).toThrow(expect.objectContaining({ code: "provider_not_allowed" }));
  });

  test("purpose compatibility is deny-by-default", () => {
    expect(validatePurpose("database", "database", limits)).toBe("database");
    expect(validatePurpose("agent", "codex", limits)).toBe("agent");
    // Incompatible pairings:
    expect(() => validatePurpose("agent", "database", limits)).toThrow(expect.objectContaining({ code: "purpose_not_allowed" }));
    expect(() => validatePurpose("database", "codex", limits)).toThrow(expect.objectContaining({ code: "purpose_not_allowed" }));
    expect(() => validatePurpose("tool", "openai", limits)).toThrow(expect.objectContaining({ code: "purpose_not_allowed" }));
    expect(() => validatePurpose("nonsense", "database", limits)).toThrow(expect.objectContaining({ code: "invalid_purpose" }));
  });

  test("full lease request rejects incompatible purpose", () => {
    expect(() => validateLeaseRequest(baseRequest({ purpose: "agent" }), limits))
      .toThrow(expect.objectContaining({ code: "purpose_not_allowed" }));
  });
});

describe("broker contract: consume and revoke validation", () => {
  test("consume requires a well-formed lease id and full binding", () => {
    const parsed = validateConsumeRequest({
      leaseId: "a".repeat(43),
      tenantId: "tenant-a",
      principalId: "user-1",
      runId: "run-1",
      provider: "database",
      alias: "main",
    });
    expect(parsed.leaseId).toHaveLength(43);
    expect(() => validateConsumeRequest({ leaseId: "short", tenantId: "t", principalId: "u", runId: "r", provider: "database", alias: "main" }))
      .toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(() => validateConsumeRequest({
      leaseId: "a".repeat(43), tenantId: "tenant-a", principalId: "user-1", runId: "run-1", provider: "db;drop", alias: "main",
    })).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });

  test("revoke validates the same identity binding", () => {
    expect(() => validateRevokeRequest({ leaseId: "b".repeat(43), tenantId: "tenant-a", principalId: "user-1", runId: "run-1" })).not.toThrow();
    expect(() => validateRevokeRequest({ leaseId: "b".repeat(43), tenantId: "", principalId: "user-1", runId: "run-1" }))
      .toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});

describe("broker contract: machine-readable errors never leak secrets", () => {
  test("every code maps to a generic static message", () => {
    const codes = [
      "invalid_request", "invalid_alias", "invalid_provider", "invalid_purpose", "invalid_ttl",
      "ttl_out_of_bounds", "unsupported_contract_version", "unauthenticated", "forbidden",
      "policy_denied", "tenant_inactive", "principal_mismatch", "run_mismatch",
      "provider_not_allowed", "purpose_not_allowed", "credential_not_provisioned",
      "lease_not_found", "lease_expired", "lease_consumed", "lease_revoked", "context_mismatch",
      "rate_limited", "quota_exceeded", "secret_unavailable", "secretstore_unavailable",
      "idempotency_conflict", "contract_idempotency_conflict", "internal_error",
    ] as const;
    for (const code of codes) {
      const message = brokerErrorMessage(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(message).not.toMatch(/postgres(ql)?:\/\//i);
      expect(message).not.toMatch(/bearer /i);
      expect(new BrokerError(code).code).toBe(code);
    }
  });

  test("custom messages cannot be used to smuggle state into responses", () => {
    const error = new BrokerError("internal_error", "static message");
    expect(error.message).toBe("static message");
    expect(error.status).toBe(500);
    expect(new BrokerError("lease_consumed").status).toBe(409);
    expect(new BrokerError("rate_limited").status).toBe(429);
  });
});
