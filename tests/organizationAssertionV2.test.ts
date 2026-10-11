import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
} from "../src/auth/internalPrincipal";
import { resolveRequestPrincipal, INTERNAL_PRINCIPAL_HEADER } from "../apps/server/src/auth/principal";

describe("principal assertion v2", () => {
  it("signs and verifies { userId, organizationId, exp, nonce, v: 2 }", () => {
    const assertion = createInternalPrincipalAssertion(
      { userId: "user-a", organizationId: "org-a" },
      "test-secret",
      1_000,
    );
    const verified = verifyInternalPrincipalAssertion(assertion, "test-secret", 2_000);
    expect(verified).toEqual({
      userId: "user-a",
      tenantId: "org-a",
      organizationId: "org-a",
    });

    const [body] = assertion.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    expect(payload.v).toBe(2);
    expect(payload.organizationId).toBe("org-a");
    expect(payload.tenantId).toBe("org-a");
    expect(typeof payload.nonce).toBe("string");
    expect(payload.exp).toBe(1_000 + 60_000);
  });

  it("accepts legacy tenantId-only assertions as organizationId alias until Phase 5", () => {
    const assertion = createInternalPrincipalAssertion(
      { userId: "user-b", tenantId: "tenant-b" },
      "test-secret",
      1_000,
    );
    expect(verifyInternalPrincipalAssertion(assertion, "test-secret", 2_000)).toEqual({
      userId: "user-b",
      tenantId: "tenant-b",
      organizationId: "tenant-b",
    });
  });

  it("rejects forged, unsigned, and expired v2 assertions", () => {
    const assertion = createInternalPrincipalAssertion(
      { userId: "user-a", organizationId: "org-a" },
      "test-secret",
      1_000,
    );
    expect(verifyInternalPrincipalAssertion(assertion, "wrong-secret", 2_000)).toBeNull();
    const [body] = assertion.split(".");
    expect(verifyInternalPrincipalAssertion(body, "test-secret", 2_000)).toBeNull();
    expect(verifyInternalPrincipalAssertion(assertion, "test-secret", 62_000)).toBeNull();
  });

  it("server resolver accepts signed v2 transport only", () => {
    expect(
      resolveRequestPrincipal(
        new Request("http://x", { headers: { "X-User-Id": "a", "X-Organization-Id": "b" } }),
        "secret",
      ),
    ).toBeNull();
    const assertion = createInternalPrincipalAssertion({ userId: "a", organizationId: "b" }, "secret");
    expect(
      resolveRequestPrincipal(new Request("http://x", { headers: { [INTERNAL_PRINCIPAL_HEADER]: assertion } }), "secret"),
    ).toEqual({ userId: "a", tenantId: "b", organizationId: "b" });
  });
});
